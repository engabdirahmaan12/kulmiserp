export type DebtPartyType = 'customer' | 'supplier';
export type DebtStatus = 'current' | 'due_soon' | 'overdue' | 'paid' | 'written_off';
export type CreditScoreTier = 'excellent' | 'good' | 'average' | 'risky' | 'high_risk';
export type SupplierScoreTier = 'excellent' | 'good' | 'average' | 'poor';

export interface DebtRecord {
  id: string;
  store_id: string;
  party_type: DebtPartyType;
  customer_id?: string | null;
  supplier_id?: string | null;
  sale_id?: string | null;
  purchase_order_id?: string | null;
  invoice_number: string;
  due_date?: string | null;
  promise_date?: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_balance: number;
  status: DebtStatus;
  written_off_at?: string | null;
  write_off_reason?: string | null;
  created_at: string;
  updated_at: string;
  customer?: { id: string; full_name: string; phone?: string; balance: number; credit_limit: number; total_purchases: number } | null;
  supplier?: { id: string; name: string; phone?: string; balance: number } | null;
}

export interface DebtEvent {
  id: string;
  debt_record_id: string;
  event_type: string;
  title: string;
  description?: string | null;
  amount?: number | null;
  created_at: string;
  created_by?: string | null;
}

export interface DebtNote {
  id: string;
  debt_record_id?: string | null;
  customer_id?: string | null;
  supplier_id?: string | null;
  note: string;
  created_at: string;
}

export interface DebtAgingBucket {
  '0_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

export interface DebtPartySummary {
  total: number;
  overdue: number;
  due_today: number;
  due_this_week: number;
  count: number;
  aging: DebtAgingBucket;
}

export interface DebtDashboardData {
  customer: DebtPartySummary;
  supplier: DebtPartySummary;
}

export interface DebtAnalytics {
  collectionRate: number;
  recoveryRate: number;
  avgPaymentDelayDays: number;
  overdueTrend: number;
}

export interface PortalData {
  party_type: DebtPartyType;
  store: { name: string; currency: string; phone?: string };
  party: { name: string; phone?: string; balance: number };
  debts: Array<{
    invoice_number: string;
    due_date?: string;
    total_amount: number;
    paid_amount: number;
    remaining_balance: number;
    status: DebtStatus;
  }>;
  payments: Array<{
    amount: number;
    payment_method: string;
    payment_date: string;
  }>;
}
