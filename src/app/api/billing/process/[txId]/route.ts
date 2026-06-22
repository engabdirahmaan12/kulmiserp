import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { processWaafiPayment } from '@/lib/billing/process-waafi-payment';

export const maxDuration = 120;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Sends WAAFI STK push and waits for customer PIN approval.
 * Stores gateway response only — NEVER activates subscription.
 */
export async function POST(
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

    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, store_id, status')
      .eq('id', txId)
      .single();

    if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const { data: membership } = await supabaseAdmin
      .from('store_users')
      .select('id')
      .eq('store_id', tx.store_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (['success', 'failed', 'cancelled', 'expired'].includes(tx.status)) {
      return NextResponse.json({ status: tx.status, message: 'Transaction already finalized' });
    }

    await processWaafiPayment(txId);

    const { data: updated } = await supabaseAdmin
      .from('payment_transactions')
      .select('status, provider_status, failure_reason')
      .eq('id', txId)
      .single();

    return NextResponse.json({
      status: updated?.status ?? 'pending',
      provider_status: updated?.provider_status,
      reason: updated?.failure_reason,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[billing/process]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
