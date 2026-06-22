import { createClient as createAdmin } from '@supabase/supabase-js';

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type PaymentAuditEvent =
  | 'payment_requested'
  | 'payment_popup_sent'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'subscription_activated';

export async function logPaymentAudit(params: {
  transactionId: string;
  storeId: string;
  userId?: string | null;
  event: PaymentAuditEvent;
  details?: Record<string, unknown>;
}) {
  const { error } = await supabaseAdmin.rpc('record_payment_audit', {
    p_transaction_id: params.transactionId,
    p_store_id: params.storeId,
    p_user_id: params.userId ?? null,
    p_event: params.event,
    p_details: params.details ?? {},
  });
  if (error) console.error('[payment-audit]', params.event, error.message);
}
