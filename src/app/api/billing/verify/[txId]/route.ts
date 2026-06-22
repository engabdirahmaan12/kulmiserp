import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getPlanTotalUsd } from '@/lib/billing/plan-prices';

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Poll payment status and activate subscription ONLY after verified WAAFI response.
 * This is the ONLY route that may call activate_subscription_after_payment.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ txId: string }> }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { txId } = await params;

    const { data: tx, error: fetchError } = await supabaseAdmin
      .from('payment_transactions')
      .select('*')
      .eq('id', txId)
      .single();

    if (fetchError || !tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const { data: membership } = await supabaseAdmin
      .from('store_users')
      .select('id')
      .eq('store_id', tx.store_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Already activated
    if (tx.status === 'success') {
      return NextResponse.json({
        status: 'success',
        plan: tx.plan_id,
        months: tx.months,
        merchant_reference: tx.merchant_reference,
      });
    }

    if (['failed', 'cancelled', 'expired'].includes(tx.status)) {
      return NextResponse.json({
        status: tx.status,
        reason: tx.failure_reason ?? 'Payment was not successful',
      });
    }

    // Session timeout
    const ageMs = Date.now() - new Date(tx.initiated_at).getTime();
    if (ageMs > 10 * 60 * 1000) {
      await supabaseAdmin.rpc('fail_payment_transaction', {
        p_transaction_id: txId,
        p_provider_tx_id: tx.provider_transaction_id ?? '',
        p_provider_status: 'TIMEOUT',
        p_reason: 'Payment session expired — no confirmation within 10 minutes',
      });
      return NextResponse.json({ status: 'expired', reason: 'Payment session expired' });
    }

    // Still waiting for WAAFI popup / customer PIN
    if (tx.status === 'initiated' || tx.status === 'pending') {
      return NextResponse.json({
        status: 'pending',
        message: 'Waiting for payment confirmation… Approve the WAAFI prompt on your phone and enter your PIN.',
      });
    }

    // Gateway returned APPROVED — verify amount + tx id then activate (backend only)
    if (tx.status === 'verifying' && tx.provider_status === 'APPROVED' && tx.provider_transaction_id) {
      const expectedAmount = getPlanTotalUsd(tx.plan_id, tx.months);
      if (expectedAmount === null) {
        return NextResponse.json({ error: 'Invalid plan on transaction' }, { status: 500 });
      }

      const amountVerified = tx.amount_verified_usd ?? expectedAmount;

      const { data: activateResult, error: activateError } = await supabaseAdmin.rpc(
        'activate_subscription_after_payment',
        {
          p_transaction_id: txId,
          p_provider_tx_id: tx.provider_transaction_id,
          p_provider_status: 'APPROVED',
          p_amount_verified_usd: amountVerified,
        }
      );

      if (activateError) {
        console.error('[billing/verify] Activation error:', activateError);
        return NextResponse.json({ error: activateError.message }, { status: 500 });
      }

      const activated = activateResult as {
        success?: boolean;
        error?: string;
        plan?: string;
        subscription_ends_at?: string;
      };

      if (!activated?.success) {
        if (activated?.error?.includes('already finalized') || tx.status === 'success') {
          return NextResponse.json({ status: 'success', plan: tx.plan_id, months: tx.months });
        }
        return NextResponse.json({ error: activated?.error ?? 'Activation failed' }, { status: 500 });
      }

      return NextResponse.json({
        status: 'success',
        plan: activated.plan ?? tx.plan_id,
        months: tx.months,
        subscription_ends_at: activated.subscription_ends_at,
        merchant_reference: tx.merchant_reference,
      });
    }

    return NextResponse.json({
      status: 'pending',
      message: 'Waiting for payment confirmation…',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[billing/verify]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
