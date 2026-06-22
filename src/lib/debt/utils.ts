import { differenceInDays, parseISO, isToday, isWithinInterval, addDays } from 'date-fns';
import type { CreditScoreTier, DebtRecord, DebtStatus, SupplierScoreTier } from './types';

export const DEBT_STATUS_LABELS: Record<DebtStatus, string> = {
  current: 'Current',
  due_soon: 'Due Soon',
  overdue: 'Overdue',
  paid: 'Paid',
  written_off: 'Written Off',
};

export const DEBT_STATUS_STYLES: Record<DebtStatus, string> = {
  current: 'bg-blue-100 text-blue-700',
  due_soon: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  paid: 'bg-slate-100 text-slate-600',
  written_off: 'bg-violet-100 text-violet-700',
};

export function fmtDebtCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

export function buildWhatsAppDebtReminder(opts: {
  partyName: string;
  balance: number;
  storeName: string;
  currency: string;
  invoiceNumber?: string;
  type?: 'reminder' | 'statement' | 'payment_request';
}) {
  const { partyName, balance, storeName, currency, invoiceNumber, type = 'reminder' } = opts;
  const amt = fmtDebtCurrency(balance, currency);

  if (type === 'statement') {
    return `Hello ${partyName},\n\nYour account statement from ${storeName}:\nOutstanding balance: ${amt}${invoiceNumber ? `\nInvoice: ${invoiceNumber}` : ''}\n\nThank you.`;
  }
  if (type === 'payment_request') {
    return `Hello ${partyName},\n\nPayment request from ${storeName}.\nAmount due: ${amt}${invoiceNumber ? `\nReference: ${invoiceNumber}` : ''}\n\nPlease settle at your earliest convenience.\n\nThank you.`;
  }
  return `Hello ${partyName},\n\nYou have an outstanding balance of ${amt} at ${storeName}.${invoiceNumber ? `\nInvoice: ${invoiceNumber}` : ''}\n\nPlease settle your balance.\n\nThank you.`;
}

export function openWhatsApp(phone: string | undefined | null, message: string) {
  const digits = phone?.replace(/[^0-9]/g, '');
  if (!digits) return false;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank');
  return true;
}

export function computeCustomerCreditScore(debts: DebtRecord[], totalPurchases: number): {
  score: number;
  tier: CreditScoreTier;
  label: string;
} {
  const open = debts.filter((d) => d.remaining_balance > 0 && d.status !== 'written_off');
  const overdue = open.filter((d) => d.status === 'overdue').length;
  const totalDebt = open.reduce((s, d) => s + d.remaining_balance, 0);
  const paidOnTime = debts.filter((d) => d.status === 'paid').length;

  let score = 75;
  if (totalPurchases > 0) score += Math.min(15, totalPurchases / 1000);
  score -= overdue * 12;
  score -= Math.min(25, totalDebt / 500);
  score += Math.min(10, paidOnTime * 2);
  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier: CreditScoreTier = 'average';
  if (score >= 85) tier = 'excellent';
  else if (score >= 70) tier = 'good';
  else if (score >= 50) tier = 'average';
  else if (score >= 30) tier = 'risky';
  else tier = 'high_risk';

  const labels: Record<CreditScoreTier, string> = {
    excellent: 'Excellent',
    good: 'Good',
    average: 'Average',
    risky: 'Risky',
    high_risk: 'High Risk',
  };

  return { score, tier, label: labels[tier] };
}

export function computeSupplierScore(debts: DebtRecord[], totalPurchases: number): {
  score: number;
  tier: SupplierScoreTier;
  label: string;
} {
  const open = debts.filter((d) => d.remaining_balance > 0);
  const overdue = open.filter((d) => d.status === 'overdue').length;
  let score = 70 + Math.min(20, totalPurchases / 2000) - overdue * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier: SupplierScoreTier = 'average';
  if (score >= 85) tier = 'excellent';
  else if (score >= 70) tier = 'good';
  else if (score >= 50) tier = 'average';
  else tier = 'poor';

  return { score, tier, label: tier.charAt(0).toUpperCase() + tier.slice(1) };
}

export function isDueToday(dueDate?: string | null) {
  if (!dueDate) return false;
  return isToday(parseISO(dueDate));
}

export function isDueThisWeek(dueDate?: string | null) {
  if (!dueDate) return false;
  const d = parseISO(dueDate);
  return isWithinInterval(d, { start: new Date(), end: addDays(new Date(), 7) });
}

export function agingDaysFromDue(dueDate?: string | null) {
  if (!dueDate) return 0;
  return differenceInDays(new Date(), parseISO(dueDate));
}

export const CREDIT_TIER_STYLES: Record<CreditScoreTier, string> = {
  excellent: 'text-blue-600 bg-blue-50',
  good: 'text-indigo-600 bg-indigo-50',
  average: 'text-amber-600 bg-amber-50',
  risky: 'text-orange-600 bg-orange-50',
  high_risk: 'text-red-600 bg-red-50',
};
