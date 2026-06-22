import { createClient } from '@/lib/supabase/client';
import type { GlobalSearchResult } from './types';

export async function globalSearch(storeId: string, query: string): Promise<GlobalSearchResult[]> {
  if (!query.trim() || query.length < 2) return [];
  const supabase = createClient();
  const q = `%${query.trim()}%`;
  const results: GlobalSearchResult[] = [];

  const [products, customers, suppliers, sales, expenses] = await Promise.all([
    supabase.from('products').select('id, name, sku, barcode').eq('store_id', storeId).eq('is_active', true).ilike('name', q).limit(8),
    supabase.from('customers').select('id, full_name, phone').eq('store_id', storeId).eq('is_active', true).ilike('full_name', q).limit(6),
    supabase.from('suppliers').select('id, name, phone').eq('store_id', storeId).ilike('name', q).limit(5),
    supabase.from('sales').select('id, invoice_number, total_amount').eq('store_id', storeId).ilike('invoice_number', q).limit(5),
    supabase.from('expenses').select('id, description, amount').eq('store_id', storeId).ilike('description', q).limit(5),
  ]);

  for (const p of products.data ?? []) {
    results.push({ id: p.id, type: 'product', title: p.name, subtitle: p.sku ?? undefined, href: '/dashboard/inventory' });
  }
  for (const c of customers.data ?? []) {
    results.push({ id: c.id, type: 'customer', title: c.full_name, subtitle: c.phone ?? undefined, href: '/dashboard/customers' });
  }
  for (const s of suppliers.data ?? []) {
    results.push({ id: s.id, type: 'supplier', title: s.name, subtitle: s.phone ?? undefined, href: '/dashboard/suppliers' });
  }
  for (const s of sales.data ?? []) {
    results.push({ id: s.id, type: 'sale', title: s.invoice_number, subtitle: String(s.total_amount), href: '/dashboard/sales-history' });
  }
  for (const e of expenses.data ?? []) {
    results.push({ id: e.id, type: 'expense', title: e.description, subtitle: String(e.amount), href: '/dashboard/expenses' });
  }

  return results;
}
