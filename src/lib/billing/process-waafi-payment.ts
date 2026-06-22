import { createClient as createAdmin } from '@supabase/supabase-js';
import { callWaafiPurchase, mapWaafiStateToStatus, type PaymentProvider } from '@/lib/payment/waafi';
import { getPlanTotalUsd } from '@/lib/billing/plan-prices';
import { logPaymentAudit } from '@/lib/billing/payment-audit';

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Calls WaafiPay for an existing transaction and stores the gateway response.
 * NEVER activates subscription — that only happens in /api/billing/verify.
 */
export async function processWaafiPayment(transactionId: string): Promise<void> {
  const { data: tx, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('id', transactionId)
    .single();

  if (error || !tx) {
    console.error('[processWaafiPayment] Transaction not found:', transactionId);
    return;
  }

  if (['success', 'failed', 'cancelled', 'expired'].includes(tx.status)) {
    return; // already finalized
  }

  const totalAmount = getPlanTotalUsd(tx.plan_id, tx.months);
  if (totalAmount === null) {
    await supabaseAdmin.rpc('fail_payment_transaction', {
      p_transaction_id: transactionId,
      p_provider_tx_id: '',
      p_provider_status: 'FAILED',
      p_reason: 'Invalid plan on transaction',
    });
    return;
  }

  // Mark popup as sent — customer should see WAAFI prompt on their phone
  await supabaseAdmin
    .from('payment_transactions')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', transactionId);

  await logPaymentAudit({
    transactionId,
    storeId: tx.store_id,
    userId: tx.user_id,
    event: 'payment_popup_sent',
    details: { provider: tx.provider, phone: tx.phone_number, amount: totalAmount },
  });

  const gw = await callWaafiPurchase({
    provider: tx.provider as PaymentProvider,
    phone: tx.phone_number,
    amountUsd: totalAmount,
    merchantReference: tx.merchant_reference,
    description: `KULMIS ERP — ${tx.plan_id} × ${tx.months}mo`,
  });

  if (gw.approved) {
    // Store gateway proof — verify route will validate and activate
    await supabaseAdmin.rpc('store_payment_gateway_response', {
      p_transaction_id: transactionId,
      p_provider_tx_id: gw.transactionId!,
      p_provider_status: gw.state,
      p_amount_reported_usd: gw.amountCharged ?? totalAmount,
      p_gateway_response: gw.rawResponse ?? {},
    });

    await logPaymentAudit({
      transactionId,
      storeId: tx.store_id,
      userId: tx.user_id,
      event: 'payment_confirmed',
      details: {
        provider_tx_id: gw.transactionId,
        amount: gw.amountCharged,
        state: gw.state,
      },
    });
    return;
  }

  const failStatus = mapWaafiStateToStatus(gw.state, gw.responseCode);
  await supabaseAdmin.rpc('fail_payment_transaction', {
    p_transaction_id: transactionId,
    p_provider_tx_id: gw.transactionId ?? '',
    p_provider_status: gw.state || failStatus.toUpperCase(),
    p_reason: gw.error ?? 'Payment not approved by customer',
  });

  await logPaymentAudit({
    transactionId,
    storeId: tx.store_id,
    userId: tx.user_id,
    event: 'payment_failed',
    details: { state: gw.state, error: gw.error, response_code: gw.responseCode },
  });
}
