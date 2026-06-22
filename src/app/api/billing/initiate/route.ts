import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { PaymentProvider } from '@/lib/payment/waafi';
import { getPlanPricePerMonth } from '@/lib/billing/plan-prices';

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_PROVIDERS: PaymentProvider[] = ['waafi', 'evc', 'sahal', 'zaad'];

/**
 * Creates a payment request ONLY.
 * Does NOT call WAAFI and does NOT activate subscription.
 * Frontend must call POST /api/billing/process/[txId] then poll GET /api/billing/verify/[txId].
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: {
      store_id?: string;
      plan_id?: string;
      months?: number;
      provider?: string;
      phone?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { store_id, plan_id, months = 1, provider, phone } = body;

    if (!store_id || !plan_id || !provider || !phone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!VALID_PROVIDERS.includes(provider as PaymentProvider)) {
      return NextResponse.json({ error: 'Invalid payment provider' }, { status: 400 });
    }

    const pricePerMonth = getPlanPricePerMonth(plan_id);
    if (!pricePerMonth) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const monthsNum = Math.max(1, Math.min(24, Math.round(Number(months) || 1)));

    const { data: txResult, error: txError } = await supabaseAdmin.rpc('initiate_payment_transaction', {
      p_store_id: store_id,
      p_user_id: user.id,
      p_plan_id: plan_id,
      p_months: monthsNum,
      p_amount_usd: pricePerMonth,
      p_provider: provider,
      p_phone_number: phone,
    });

    if (txError) {
      console.error('[billing/initiate] RPC error:', txError);
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }

    const tx = txResult as {
      success?: boolean;
      error?: string;
      transaction_id?: string;
      merchant_reference?: string;
    };

    if (!tx?.success) {
      return NextResponse.json({ error: tx?.error ?? 'Failed to create payment request' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      status: 'initiated',
      transaction_id: tx.transaction_id,
      merchant_reference: tx.merchant_reference,
      message: 'Payment request created. Proceed to WAAFI authorization.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[billing/initiate]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
