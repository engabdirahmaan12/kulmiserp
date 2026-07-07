'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { Download, Search, Package } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { inputSoft } from '@/lib/ui-classes';
import { downloadCsv, escapeCsvCell } from '@/lib/export/spreadsheet';

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
};

function getToday() {
  return new Date().toISOString().split('T')[0];
}

export function PurchasesTab() {
  const { currentStore } = useAuthStore();
  const currency = currentStore?.currency || 'USD';
  const [dateFrom, setDateFrom] = useState(startOfMonth(new Date()).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(getToday());
  const [view, setView] = useState<'list' | 'top-products' | 'supplier-compare'>('list');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState('');

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  // ── Section 1: Purchase list + trend ──────────────────────────────────────
  const { data: purchases = [], isLoading: loadingPurchases } = useQuery({
    queryKey: ['reports-purchases', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('id, po_number, total_amount, status, created_at, supplier:suppliers(name)')
        .eq('store_id', currentStore!.id)
        .gte('created_at', dateFrom)
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string; po_number: string; total_amount: number; status: string; created_at: string;
        supplier: { name: string } | null;
      }>;
    },
    enabled: !!currentStore,
  });

  const purchaseTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of purchases) {
      const day = p.created_at.split('T')[0];
      map.set(day, (map.get(day) ?? 0) + (p.total_amount || 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date: format(new Date(date), 'MMM d'), total }));
  }, [purchases]);

  const purchasesTotal = purchases.reduce((s, p) => s + (p.total_amount || 0), 0);
  const maxTrend = Math.max(1, ...purchaseTrend.map((d) => d.total));

  const exportPurchasesCsv = () => {
    const rows = purchases.map((p) => [
      p.po_number,
      p.supplier?.name ?? 'Unknown',
      format(new Date(p.created_at), 'yyyy-MM-dd'),
      p.total_amount.toFixed(2),
      p.status,
    ]);
    const csv = [
      ['PO #', 'Supplier', 'Date', 'Total', 'Status'],
      ...rows,
    ].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
    downloadCsv(csv, `purchases-${dateFrom}-to-${dateTo}.csv`);
  };

  // ── Section 2: Top purchased products ─────────────────────────────────────
  const { data: purchaseItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ['reports-purchase-items', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('product_id, product_name, quantity, base_qty, unit_cost, subtotal, purchase_order:purchase_orders!inner(store_id, created_at, supplier_id, supplier:suppliers(name))')
        .eq('purchase_order.store_id', currentStore!.id)
        .gte('purchase_order.created_at', dateFrom)
        .lte('purchase_order.created_at', dateTo + 'T23:59:59');
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        product_id: string | null; product_name: string; quantity: number; base_qty: number | null;
        unit_cost: number; subtotal: number;
        purchase_order: { store_id: string; created_at: string; supplier_id: string | null; supplier: { name: string } | null };
      }>;
    },
    enabled: !!currentStore,
  });

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; spend: number; count: number }>();
    for (const it of purchaseItems) {
      const key = it.product_name;
      const cur = map.get(key) ?? { name: it.product_name, qty: 0, spend: 0, count: 0 };
      cur.qty += Number(it.base_qty ?? it.quantity ?? 0);
      cur.spend += it.subtotal || 0;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 30);
  }, [purchaseItems]);

  const exportTopProductsCsv = () => {
    const rows = topProducts.map((p) => [p.name, p.count, p.qty, p.spend.toFixed(2)]);
    const csv = [
      ['Product', 'Purchase Lines', 'Qty Bought', 'Total Spend'],
      ...rows,
    ].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
    downloadCsv(csv, `top-purchased-products-${dateFrom}-to-${dateTo}.csv`);
  };

  // ── Section 3: Supplier price comparison for one product ──────────────────
  const { data: allProducts = [] } = useQuery({
    queryKey: ['reports-products-list', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku')
        .eq('store_id', currentStore!.id)
        .order('name')
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; sku: string | null }>;
    },
    enabled: !!currentStore,
  });

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return [];
    const q = productSearch.toLowerCase();
    return allProducts
      .filter((p) => p.name.toLowerCase().includes(q) || (p.sku?.toLowerCase().includes(q) ?? false))
      .slice(0, 8);
  }, [allProducts, productSearch]);

  const { data: supplierRows = [], isLoading: loadingSupplierCompare } = useQuery({
    queryKey: ['reports-supplier-compare', currentStore?.id, selectedProductId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('unit_cost, purchase_order:purchase_orders!inner(store_id, created_at, supplier:suppliers(name))')
        .eq('product_id', selectedProductId!)
        .eq('purchase_order.store_id', currentStore!.id);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        unit_cost: number;
        purchase_order: { created_at: string; supplier: { name: string } | null };
      }>;
    },
    enabled: !!currentStore && !!selectedProductId,
  });

  const supplierComparison = useMemo(() => {
    const map = new Map<string, { name: string; prices: number[]; lastDate: string; lastPrice: number }>();
    for (const r of supplierRows) {
      const name = r.purchase_order.supplier?.name ?? 'Unknown supplier';
      const cur = map.get(name) ?? { name, prices: [], lastDate: r.purchase_order.created_at, lastPrice: r.unit_cost };
      cur.prices.push(r.unit_cost);
      if (r.purchase_order.created_at > cur.lastDate) {
        cur.lastDate = r.purchase_order.created_at;
        cur.lastPrice = r.unit_cost;
      }
      map.set(name, cur);
    }
    return Array.from(map.values())
      .map((s) => ({
        name: s.name,
        timesBought: s.prices.length,
        lastPrice: s.lastPrice,
        avgPrice: s.prices.reduce((a, b) => a + b, 0) / s.prices.length,
        lowestPrice: Math.min(...s.prices),
      }))
      .sort((a, b) => a.avgPrice - b.avgPrice);
  }, [supplierRows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-36 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-36 text-sm" />
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList className="h-9">
          <TabsTrigger value="list" className="text-xs px-3 h-8">Purchase list</TabsTrigger>
          <TabsTrigger value="top-products" className="text-xs px-3 h-8">Top purchased</TabsTrigger>
          <TabsTrigger value="supplier-compare" className="text-xs px-3 h-8">Supplier prices</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold">{fmt(purchasesTotal)}</span> across {purchases.length} purchase{purchases.length === 1 ? '' : 's'}
            </p>
            <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" disabled={!purchases.length} onClick={exportPurchasesCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
          </div>

          {purchaseTrend.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-end gap-1.5 h-32">
                {purchaseTrend.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                    <div
                      className="w-full rounded-t bg-blue-500/80"
                      style={{ height: `${Math.max((d.total / maxTrend) * 100, 3)}%` }}
                      title={`${d.date}: ${fmt(d.total)}`}
                    />
                    <span className="text-[9px] text-slate-400 truncate w-full text-center">{d.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ReportTableShell className="border-0 shadow-none rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={reportTableHead}>PO #</th>
                  <th className={reportTableHead}>Supplier</th>
                  <th className={cn(reportTableHead, 'hidden sm:table-cell')}>Date</th>
                  <th className={reportTableHeadRight}>Total</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loadingPurchases ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400">Loading…</td></tr>
                ) : purchases.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400">No purchases in this period</td></tr>
                ) : (
                  purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{p.po_number}</td>
                      <td className="px-4 py-2.5 text-slate-700">{p.supplier?.name ?? 'Unknown'}</td>
                      <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{format(new Date(p.created_at), 'MMM d, yyyy')}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(p.total_amount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge className={cn('text-[11px] border-0', STATUS_CLASS[p.status] || 'bg-slate-100 text-slate-600')}>
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ReportTableShell>
        </TabsContent>

        <TabsContent value="top-products" className="mt-3 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" disabled={!topProducts.length} onClick={exportTopProductsCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
          </div>
          <ReportTableShell className="border-0 shadow-none rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={reportTableHead}>#</th>
                  <th className={reportTableHead}>Product</th>
                  <th className={reportTableHeadRight}>Purchase lines</th>
                  <th className={reportTableHeadRight}>Qty bought</th>
                  <th className={reportTableHeadRight}>Total spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loadingItems ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400">Loading…</td></tr>
                ) : topProducts.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400">No purchases in this period</td></tr>
                ) : (
                  topProducts.map((p, i) => (
                    <tr key={p.name} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{p.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{p.count}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{p.qty.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(p.spend)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ReportTableShell>
        </TabsContent>

        <TabsContent value="supplier-compare" className="mt-3 space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search a product to compare supplier prices…"
              value={selectedProductId ? selectedProductName : productSearch}
              onChange={(e) => {
                setProductSearch(e.target.value);
                setSelectedProductId(null);
              }}
              className={cn(inputSoft, 'pl-9')}
            />
            {productSearch && !selectedProductId && filteredProducts.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onMouseDown={() => {
                      setSelectedProductId(p.id);
                      setSelectedProductName(p.name);
                      setProductSearch('');
                    }}
                  >
                    <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-900">{p.name}</span>
                    {p.sku && <span className="text-xs text-slate-400">{p.sku}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProductId ? (
            <ReportTableShell className="border-0 shadow-none rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={reportTableHead}>Supplier</th>
                    <th className={reportTableHeadRight}>Times bought</th>
                    <th className={reportTableHeadRight}>Last price</th>
                    <th className={reportTableHeadRight}>Avg price</th>
                    <th className={reportTableHeadRight}>Lowest price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loadingSupplierCompare ? (
                    <tr><td colSpan={5} className="text-center py-12 text-slate-400">Loading…</td></tr>
                  ) : supplierComparison.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-12 text-slate-400">No purchase history for this product</td></tr>
                  ) : (
                    supplierComparison.map((s, i) => (
                      <tr key={s.name} className={cn('hover:bg-slate-50/80 transition-colors', i === 0 && 'bg-emerald-50/50')}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {s.name}
                          {i === 0 && supplierComparison.length > 1 && (
                            <span className="ml-2 text-[10px] font-semibold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">Cheapest</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{s.timesBought}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(s.lastPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(s.avgPrice)}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-700 tabular-nums">{fmt(s.lowestPrice)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ReportTableShell>
          ) : (
            <p className="text-sm text-slate-400 text-center py-12">Search and pick a product above to compare supplier prices</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
