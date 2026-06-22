/** Shared payment status helpers for sales and purchases */

export type PaymentStatus = 'paid' | 'partial' | 'credit';

export interface PayableRecord {
  total_amount: number;
  paid_amount?: number | null;
  credit_amount?: number | null;
}

export function saleBalanceDue(sale: PayableRecord): number {
  if (sale.credit_amount != null && sale.credit_amount > 0) return sale.credit_amount;
  return Math.max(0, sale.total_amount - (sale.paid_amount ?? 0));
}

export function salePaymentStatus(sale: PayableRecord): PaymentStatus {
  const balance = saleBalanceDue(sale);
  if (balance <= 0.001) return 'paid';
  const paid = sale.paid_amount ?? 0;
  if (paid > 0.001) return 'partial';
  return 'credit';
}

export function purchaseBalanceDue(po: PayableRecord): number {
  return Math.max(0, po.total_amount - (po.paid_amount ?? 0));
}

export function purchasePaymentStatus(po: PayableRecord): PaymentStatus {
  const balance = purchaseBalanceDue(po);
  if (balance <= 0.001) return 'paid';
  const paid = po.paid_amount ?? 0;
  if (paid > 0.001) return 'partial';
  return 'credit';
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid',
  partial: 'Partial',
  credit: 'Credit',
};

export const PAYMENT_STATUS_BADGES: Record<PaymentStatus, string> = {
  paid: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  partial: 'bg-orange-100 text-orange-700 border-orange-200',
  credit: 'bg-red-100 text-red-700 border-red-200',
};

export type RefundMethod = 'cash' | 'bank' | 'waafi' | 'store_credit';

export const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'waafi', label: 'Wallet (WAAFI)' },
  { value: 'store_credit', label: 'Store Credit' },
];
