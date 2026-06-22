import { createClient } from '@/lib/supabase/client';
import type { DebtDashboardData, DebtEvent, DebtNote, DebtPartyType, DebtRecord, PortalData } from './types';

export async function fetchDebtDashboard(storeId: string): Promise<DebtDashboardData> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_debt_dashboard', { p_store_id: storeId });
  if (error) throw error;
  const result = data as { success: boolean; data: DebtDashboardData };
  return result.data;
}

export async function fetchDebtRecords(
  storeId: string,
  partyType: DebtPartyType,
  opts?: { status?: string; search?: string; page?: number; pageSize?: number },
): Promise<{ records: DebtRecord[]; total: number }> {
  const supabase = createClient();
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('debt_records')
    .select(
      partyType === 'customer'
        ? '*, customer:customers(id, full_name, phone, balance, credit_limit, total_purchases)'
        : '*, supplier:suppliers(id, name, phone, balance)',
      { count: 'exact' },
    )
    .eq('store_id', storeId)
    .eq('party_type', partyType)
    .order('due_date', { ascending: true, nullsFirst: false });

  if (opts?.status && opts.status !== 'all') {
    if (opts.status === 'open') {
      query = query.gt('remaining_balance', 0).neq('status', 'written_off');
    } else {
      query = query.eq('status', opts.status);
    }
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  let records = (data ?? []) as DebtRecord[];
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    records = records.filter((r) => {
      const name = r.customer?.full_name ?? r.supplier?.name ?? '';
      return name.toLowerCase().includes(q) || r.invoice_number.toLowerCase().includes(q);
    });
  }

  return { records, total: count ?? records.length };
}

export async function fetchDebtEvents(debtRecordId: string): Promise<DebtEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('debt_events')
    .select('*')
    .eq('debt_record_id', debtRecordId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DebtEvent[];
}

export async function fetchDebtNotes(opts: {
  debtRecordId?: string;
  customerId?: string;
  supplierId?: string;
}): Promise<DebtNote[]> {
  const supabase = createClient();
  let query = supabase.from('debt_notes').select('*').order('created_at', { ascending: false }).limit(50);
  if (opts.debtRecordId) query = query.eq('debt_record_id', opts.debtRecordId);
  else if (opts.customerId) query = query.eq('customer_id', opts.customerId);
  else if (opts.supplierId) query = query.eq('supplier_id', opts.supplierId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DebtNote[];
}

export async function fetchCustomerDebtsForProfile(customerId: string, storeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('debt_records')
    .select('*')
    .eq('store_id', storeId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as DebtRecord[];
}

export async function fetchPortalData(token: string): Promise<PortalData> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_debt_portal', { p_token: token });
  if (error) throw error;
  const result = data as { success: boolean; error?: string } & PortalData;
  if (!result.success) throw new Error(result.error || 'Invalid portal link');
  return result;
}

export async function computeDebtAnalytics(storeId: string, partyType: DebtPartyType) {
  const supabase = createClient();
  const { data: records } = await supabase
    .from('debt_records')
    .select('total_amount, paid_amount, remaining_balance, status, due_date, created_at')
    .eq('store_id', storeId)
    .eq('party_type', partyType);

  const all = records ?? [];
  const totalOriginated = all.reduce((s, r) => s + (r.total_amount ?? 0), 0);
  const totalCollected = all.reduce((s, r) => s + (r.paid_amount ?? 0), 0);
  const openOverdue = all.filter((r) => r.status === 'overdue').length;
  const openCount = all.filter((r) => (r.remaining_balance ?? 0) > 0).length;

  return {
    collectionRate: totalOriginated > 0 ? Math.round((totalCollected / totalOriginated) * 100) : 100,
    recoveryRate: openCount > 0 ? Math.round(((openCount - openOverdue) / openCount) * 100) : 100,
    avgPaymentDelayDays: 0,
    overdueTrend: openOverdue,
  };
}
