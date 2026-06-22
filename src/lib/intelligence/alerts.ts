import { createClient } from '@/lib/supabase/client';
import type { Store } from '@/types';
import type { StoreAlert } from './types';

export async function fetchStoreAlerts(store: Store): Promise<StoreAlert[]> {
  const supabase = createClient();
  const result: StoreAlert[] = [];

  const { data: products } = await supabase
    .from('products')
    .select('id, name, stock_quantity, min_stock_level')
    .eq('store_id', store.id)
    .eq('track_inventory', true)
    .eq('is_active', true)
    .limit(200);

  for (const p of products ?? []) {
    const stock = p.stock_quantity ?? 0;
    const min = p.min_stock_level ?? 0;
    if (stock === 0) {
      result.push({
        id: `oos_${p.id}`,
        type: 'out_of_stock',
        title: `Out of Stock: ${p.name}`,
        message: 'Product has zero inventory',
        severity: 'error',
        metadata: { product_id: p.id },
      });
    } else if (stock <= min) {
      result.push({
        id: `low_${p.id}`,
        type: 'low_stock',
        title: `Low Stock: ${p.name}`,
        message: `${stock} units left (min: ${min})`,
        severity: 'warning',
        metadata: { product_id: p.id },
      });
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const { data: overdueDebts } = await supabase
    .from('debt_records')
    .select('id, invoice_number, remaining_balance, due_date, party_type, customer:customers(full_name), supplier:suppliers(name)')
    .eq('store_id', store.id)
    .eq('status', 'overdue')
    .gt('remaining_balance', 0)
    .order('remaining_balance', { ascending: false })
    .limit(10);

  for (const d of overdueDebts ?? []) {
    const name = (d.customer as { full_name?: string } | null)?.full_name
      ?? (d.supplier as { name?: string } | null)?.name
      ?? 'Unknown';
    result.push({
      id: `overdue_${d.id}`,
      type: 'overdue_debt',
      title: `Overdue ${d.party_type === 'customer' ? 'receivable' : 'payable'}: ${name}`,
      message: `${d.invoice_number} — ${Number(d.remaining_balance).toFixed(2)} due ${d.due_date ?? ''}`,
      severity: 'error',
      metadata: { debt_record_id: d.id, party_type: d.party_type },
    });
  }

  const { data: dueToday } = await supabase
    .from('debt_records')
    .select('id, invoice_number, remaining_balance, party_type, customer:customers(full_name), supplier:suppliers(name)')
    .eq('store_id', store.id)
    .eq('due_date', today)
    .gt('remaining_balance', 0)
    .limit(8);

  for (const d of dueToday ?? []) {
    const name = (d.customer as { full_name?: string } | null)?.full_name
      ?? (d.supplier as { name?: string } | null)?.name
      ?? 'Unknown';
    result.push({
      id: `due_today_${d.id}`,
      type: 'overdue_debt',
      title: `Due today: ${name}`,
      message: `${d.invoice_number} — ${Number(d.remaining_balance).toFixed(2)}`,
      severity: 'warning',
      metadata: { debt_record_id: d.id },
    });
  }

  const { data: promiseDue } = await supabase
    .from('debt_records')
    .select('id, invoice_number, promise_date, customer:customers(full_name)')
    .eq('store_id', store.id)
    .eq('promise_date', today)
    .gt('remaining_balance', 0)
    .limit(5);

  for (const d of promiseDue ?? []) {
    result.push({
      id: `promise_${d.id}`,
      type: 'overdue_debt',
      title: `Payment promise today: ${(d.customer as { full_name?: string })?.full_name ?? 'Customer'}`,
      message: `Promised payment for ${d.invoice_number}`,
      severity: 'warning',
      metadata: { debt_record_id: d.id },
    });
  }

  if (store.subscription_status === 'trial' && store.trial_ends_at) {
    const daysLeft = Math.ceil(
      (new Date(store.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (daysLeft <= 7) {
      result.push({
        id: 'trial_expiring',
        type: 'expiring_subscription',
        title: 'Trial ending soon',
        message: `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left on free trial`,
        severity: daysLeft <= 2 ? 'error' : 'warning',
      });
    }
  }

  if (store.subscription_status === 'expired') {
    result.push({
      id: 'sub_expired',
      type: 'expiring_subscription',
      title: 'Subscription expired',
      message: 'Renew to restore full access',
      severity: 'error',
    });
  }

  return result;
}
