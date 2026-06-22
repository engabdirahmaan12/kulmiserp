'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { btnOutline, inputSoft, tableHead } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { ClipboardList, Search, Download, Package, ChevronRight, Printer } from 'lucide-react';
import { format } from 'date-fns';
import type { PurchaseOrder, PurchaseOrderItem, Supplier } from '@/types';
import { buildPurchaseInvoiceData } from '@/lib/purchase/build-purchase-invoice';
import { printThermalHtml } from '@/lib/invoice-utils';
import { PurchaseReturnModal } from '@/components/purchase/PurchaseReturnModal';
import { SupplierPaymentModal } from '@/components/purchase/SupplierPaymentModal';
import {
  purchaseBalanceDue,
  purchasePaymentStatus,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
} from '@/lib/payments/status';
import { useTranslation } from '@/lib/i18n/useTranslation';

type POWithSupplier = PurchaseOrder & { supplier: Supplier | null };

const STATUS_CLASS = {
  draft: 'bg-slate-100 text-slate-600',
  pending: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
} as const;

async function fetchAllPOs(storeId: string): Promise<POWithSupplier[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, supplier:suppliers(*)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as POWithSupplier[];
}

async function fetchPOItems(poId: string): Promise<{ items: PurchaseOrderItem[]; po: POWithSupplier }> {
  const supabase = createClient();
  const [poRes, itemsRes] = await Promise.all([
    supabase.from('purchase_orders').select('*, supplier:suppliers(*)').eq('id', poId).single(),
    supabase.from('purchase_order_items').select('*').eq('purchase_order_id', poId),
  ]);
  if (poRes.error) throw poRes.error;
  if (itemsRes.error) throw itemsRes.error;
  return { po: poRes.data as POWithSupplier, items: (itemsRes.data ?? []) as PurchaseOrderItem[] };
}

export default function PurchaseHistoryPage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <div className="p-8 space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        </PageShell>
      }
    >
      <PurchaseHistoryContent />
    </Suspense>
  );
}

function PurchaseHistoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const poIdParam = searchParams.get('po');
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedPO, setSelectedPO] = useState<POWithSupplier | null>(null);
  const [sheetItems, setSheetItems] = useState<PurchaseOrderItem[]>([]);
  const [showReturn, setShowReturn] = useState(false);
  const [showPaySupplier, setShowPaySupplier] = useState(false);

  const currency = currentStore?.currency ?? 'USD';
  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['purchase_orders_history', currentStore?.id],
    queryFn: () => fetchAllPOs(currentStore!.id),
    enabled: !!currentStore,
  });

  const filtered = pos.filter((po) => {
    if (statusFilter !== 'all' && po.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!po.po_number.toLowerCase().includes(q) && !po.supplier?.name?.toLowerCase().includes(q)) return false;
    }
    if (dateFrom && po.created_at < dateFrom) return false;
    if (dateTo && po.created_at > dateTo + 'T23:59:59') return false;
    return true;
  });

  const openDetail = useCallback(async (po: POWithSupplier) => {
    try {
      const { po: fresh, items } = await fetchPOItems(po.id);
      setSelectedPO(fresh);
      setSheetItems(items);
    } catch {
      setSelectedPO(po);
      setSheetItems([]);
    }
  }, []);

  const closeDetail = () => {
    setSelectedPO(null);
    setSheetItems([]);
    if (poIdParam) router.replace('/dashboard/purchase-history');
  };

  const poInList = poIdParam ? pos.find((p) => p.id === poIdParam) : undefined;

  const { data: linkedPO } = useQuery({
    queryKey: ['purchase-history-link', currentStore?.id, poIdParam],
    queryFn: async () => fetchPOItems(poIdParam!),
    enabled: !!currentStore && !!poIdParam && !poInList,
  });

  useEffect(() => {
    if (!poIdParam || !currentStore) return;
    if (poInList) {
      void openDetail(poInList);
      return;
    }
    if (linkedPO) {
      setSelectedPO(linkedPO.po);
      setSheetItems(linkedPO.items);
      const d = linkedPO.po.created_at.split('T')[0];
      if (!dateFrom || d < dateFrom) setDateFrom(d);
      if (!dateTo || d > dateTo) setDateTo(d);
    }
  }, [poIdParam, poInList, linkedPO, currentStore, openDetail, dateFrom, dateTo]);

  const exportCSV = () => {
    const rows = [
      ['PO Number', 'Supplier', 'Date', 'Total', 'Paid', 'Balance', 'Status'],
      ...filtered.map((po) => [
        po.po_number,
        po.supplier?.name ?? '',
        format(new Date(po.created_at), 'yyyy-MM-dd'),
        po.total_amount.toFixed(2),
        po.paid_amount.toFixed(2),
        (po.total_amount - po.paid_amount).toFixed(2),
        po.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purchase-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportLinesCSV = async () => {
    if (!currentStore || filtered.length === 0) return;
    const supabase = createClient();
    const poIds = filtered.map((p) => p.id);
    const { data: lines, error } = await supabase
      .from('purchase_order_items')
      .select('*, purchase_order:purchase_orders(po_number, created_at, supplier:suppliers(name))')
      .eq('store_id', currentStore.id)
      .in('purchase_order_id', poIds);
    if (error) return;

    const rows = [
      ['PO Number', 'Supplier', 'Date', 'Product', 'Purchase Qty', 'Unit', 'Base Qty', 'Unit Cost', 'Line Total'],
      ...(lines ?? []).map((item) => {
        const po = item.purchase_order as {
          po_number?: string;
          created_at?: string;
          supplier?: { name?: string } | null;
        } | null;
        const purchaseQty = item.purchase_unit_qty ?? item.quantity;
        return [
          po?.po_number ?? '',
          po?.supplier?.name ?? '',
          po?.created_at ? format(new Date(po.created_at), 'yyyy-MM-dd') : '',
          item.product_name,
          String(purchaseQty),
          item.purchase_unit_code ?? 'PCS',
          String(item.base_qty ?? purchaseQty),
          Number(item.unit_cost).toFixed(2),
          Number(item.subtotal).toFixed(2),
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purchase-lines-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const receivedCount = pos.filter((p) => p.status === 'received').length;
  const pendingCount = pos.filter((p) => p.status === 'pending' || p.status === 'partial').length;
  const totalValue = pos.reduce((s, p) => s + p.total_amount, 0);
  const outstanding = pos.reduce((s, p) => s + (p.total_amount - p.paid_amount), 0);

  return (
    <PageShell>
      <PageHeader
        title={t('purchaseHistory.title')}
        description={t('purchaseHistory.description')}
        icon={ClipboardList}
        variant="banner"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportCSV} variant="outline" className={cn(btnOutline, 'gap-2 h-10 rounded-xl bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white')}>
              <Download className="h-4 w-4" /> {t('purchaseHistory.exportCsv')}
            </Button>
            <Button onClick={() => void exportLinesCSV()} variant="outline" className={cn(btnOutline, 'gap-2 h-10 rounded-xl bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white')}>
              <Download className="h-4 w-4" /> {t('purchaseHistory.exportLines')}
            </Button>
          </div>
        }
      />

      <StatStrip>
        <StatChip label={t('purchaseHistory.totalOrders')} value={String(pos.length)} accent="blue" />
        <StatChip label={t('purchaseHistory.received')} value={String(receivedCount)} accent="emerald" />
        <StatChip label={t('purchaseHistory.pending')} value={String(pendingCount)} accent={pendingCount > 0 ? 'orange' : 'slate'} />
        <StatChip label={t('purchaseHistory.outstanding')} value={fmtC(outstanding)} accent={outstanding > 0 ? 'red' : 'slate'} />
      </StatStrip>

      <PageFilterBar>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('purchaseHistory.searchPoSupplier')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(inputSoft, 'pl-9')}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className={cn(inputSoft, 'w-36')}>
              <SelectValue placeholder={t('purchaseHistory.allStatus')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('purchaseHistory.allStatus')}</SelectItem>
              {(Object.keys(STATUS_CLASS) as Array<keyof typeof STATUS_CLASS>).map((k) => (
                <SelectItem key={k} value={k}>{t(`poStatus.${k}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={cn(inputSoft, 'w-40')}
            placeholder="From"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={cn(inputSoft, 'w-40')}
            placeholder="To"
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">{t('purchaseHistory.resultsValue', { count: filtered.length, value: fmtC(totalValue) })}</p>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr>
                  <th className={tableHead}>{t('purchaseHistory.poNum')}</th>
                  <th className={cn(tableHead, 'hidden sm:table-cell')}>{t('purchaseHistory.supplier')}</th>
                  <th className={cn(tableHead, 'hidden md:table-cell')}>{t('purchaseHistory.date')}</th>
                  <th className={cn(tableHead, 'text-right')}>{t('purchaseHistory.total')}</th>
                  <th className={cn(tableHead, 'text-right hidden sm:table-cell')}>{t('purchaseHistory.paid')}</th>
                  <th className={cn(tableHead, 'text-right hidden md:table-cell')}>{t('purchaseHistory.balance')}</th>
                  <th className={cn(tableHead, 'text-center hidden lg:table-cell')}>{t('purchaseHistory.payStatus')}</th>
                  <th className={cn(tableHead, 'text-center')}>{t('purchaseHistory.status')}</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((po) => {
                  const balance = purchaseBalanceDue(po);
                  const payStatus = purchasePaymentStatus(po);
                  return (
                    <tr
                      key={po.id}
                      onClick={() => openDetail(po)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{po.po_number}</td>
                      <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                        {po.supplier?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {format(new Date(po.created_at), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {fmtC(po.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-green-600 hidden sm:table-cell">
                        {fmtC(po.paid_amount)}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className={balance > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>
                          {fmtC(balance)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        <Badge variant="outline" className={`text-[10px] border ${PAYMENT_STATUS_BADGES[payStatus]}`}>
                          {PAYMENT_STATUS_LABELS[payStatus]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`${STATUS_CLASS[po.status]} border-0 text-xs`}>{t(`poStatus.${po.status}`)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <ClipboardList className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('purchaseHistory.noPoFound')}</p>
              </div>
            )}
          </div>
        )}
      </DataPanel>

      {/* Detail Sheet */}
      <Sheet open={!!selectedPO} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col overflow-hidden">
          {selectedPO && (
            <div className="flex flex-col h-full min-h-0">
              <SheetHeader className="shrink-0 px-5 pt-5 pb-3 border-b">
                <SheetTitle className="flex items-center justify-between gap-3 pr-8">
                  <span className="flex items-center gap-2 min-w-0">
                    <ClipboardList className="h-5 w-5 text-blue-600 shrink-0" />
                    <span className="truncate">{selectedPO.po_number}</span>
                  </span>
                  <Badge className={cn('border-0 text-[10px] shrink-0', STATUS_CLASS[selectedPO.status])}>
                    {t(`poStatus.${selectedPO.status}`)}
                  </Badge>
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-5 py-4 gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
                  {[
                    { label: t('purchaseHistory.supplier'), value: selectedPO.supplier?.name ?? '—' },
                    { label: t('purchaseHistory.orderDate'), value: format(new Date(selectedPO.created_at), 'MMM d, yyyy') },
                    { label: t('purchaseHistory.total'), value: fmtC(selectedPO.total_amount), bold: true },
                    { label: t('purchaseHistory.balance'), value: fmtC(selectedPO.total_amount - selectedPO.paid_amount), red: true },
                  ].map((chip) => (
                    <div key={chip.label} className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{chip.label}</p>
                      <p className={cn('text-xs font-medium mt-0.5 truncate', chip.bold && 'font-bold', chip.red && 'text-red-600')}>{chip.value}</p>
                    </div>
                  ))}
                </div>
                {selectedPO.notes && (
                  <div className="shrink-0 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-900">{selectedPO.notes}</div>
                )}
                <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-[1fr_56px_48px_56px_64px_72px] gap-1 px-3 py-2 bg-slate-100/80 border-b text-[10px] font-semibold uppercase text-slate-500 shrink-0">
                    <span>{t('purchaseHistory.product')}</span>
                    <span className="text-center">{t('purchaseHistory.qty')}</span>
                    <span className="text-center">Unit</span>
                    <span className="text-center">Base</span>
                    <span className="text-right">{t('purchases.cost')}</span>
                    <span className="text-right">{t('purchaseHistory.total')}</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-slate-100">
                    {sheetItems.map((item) => {
                      const purchaseQty = item.purchase_unit_qty ?? item.quantity;
                      const baseQty = item.base_qty ?? purchaseQty;
                      return (
                        <div key={item.id} className="grid grid-cols-[1fr_56px_48px_56px_64px_72px] gap-1 px-3 py-2.5 items-center bg-white text-sm">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{item.product_name}</p>
                            <p className="text-[10px] text-slate-400">
                              {t('purchaseHistory.receivedOf', { received: item.received_quantity, total: purchaseQty })}
                            </p>
                          </div>
                          <span className="text-center text-xs tabular-nums">{purchaseQty}</span>
                          <span className="text-center text-[10px] font-medium text-slate-500 truncate" title={item.purchase_unit_code}>
                            {item.purchase_unit_code ?? 'PCS'}
                          </span>
                          <span className="text-center text-xs tabular-nums text-slate-500">{baseQty}</span>
                          <span className="text-right text-xs tabular-nums text-slate-600">{fmtC(item.unit_cost)}</span>
                          <span className="text-right text-xs font-semibold tabular-nums">{fmtC(item.subtotal)}</span>
                        </div>
                      );
                    })}
                    {sheetItems.length === 0 && <p className="text-sm text-slate-400 text-center py-8">{t('purchaseHistory.noItems')}</p>}
                  </div>
                </div>
              </div>
              <div className="shrink-0 border-t px-5 py-3 flex flex-wrap gap-2">
                {selectedPO.status === 'received' && purchaseBalanceDue(selectedPO) > 0 && (
                  <Button className="flex-1 h-9 gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => setShowPaySupplier(true)}>
                    {t('purchaseHistory.paySupplier')}
                  </Button>
                )}
                {selectedPO.status === 'received' && (
                  <Button variant="outline" className="flex-1 h-9 gap-1 text-orange-600 border-orange-200" onClick={() => setShowReturn(true)}>
                    {t('purchaseHistory.purchaseReturn')}
                  </Button>
                )}
                {selectedPO.status === 'received' && currentStore && (
                  <Button
                    variant="outline"
                    className="flex-1 h-9 gap-1"
                    onClick={() => void printThermalHtml(buildPurchaseInvoiceData(selectedPO, sheetItems, currentStore))}
                  >
                    <Printer className="h-4 w-4" /> {t('purchaseHistory.printInvoice')}
                  </Button>
                )}
                <Button variant="ghost" className="flex-1 h-9" onClick={closeDetail}>{t('purchaseHistory.close')}</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <PurchaseReturnModal
        open={showReturn}
        po={selectedPO}
        items={sheetItems}
        onClose={() => setShowReturn(false)}
      />
      <SupplierPaymentModal
        open={showPaySupplier}
        po={selectedPO}
        onClose={() => setShowPaySupplier(false)}
      />
    </PageShell>
  );
}
