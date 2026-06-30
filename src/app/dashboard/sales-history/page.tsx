'use client';

import { Suspense, useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { ReportExportActions } from '@/components/reports/ReportLayout';
import { exportSalesCsv, exportSalesExcel } from '@/lib/export/sales-export';
import { inputSoft } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  History,
  Search,
  TrendingUp,
  ShoppingBag,
  DollarSign,
  RotateCcw,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { RefundModal } from '@/components/sales/RefundModal';
import { ReceivePaymentModal } from '@/components/sales/ReceivePaymentModal';
import { InvoiceDocument } from '@/components/invoice/InvoiceDocument';
import type { InvoiceData } from '@/lib/invoice-utils';
import type { Sale, SaleItem, PaymentMethod, Store } from '@/types';
import {
  saleBalanceDue,
  salePaymentStatus,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
} from '@/lib/payments/status';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { toast } from 'sonner';

type SaleWithItems = Sale & { items: SaleItem[] };

async function fetchSaleById(storeId: string, saleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales')
    .select('*, customer:customers(id, full_name, phone, email), items:sale_items(*)')
    .eq('store_id', storeId)
    .eq('id', saleId)
    .single();
  if (error) throw error;
  return data as SaleWithItems;
}

async function fetchSalesHistory(storeId: string, from: string, to: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales')
    .select('*, customer:customers(id, full_name, phone, email), items:sale_items(*)')
    .eq('store_id', storeId)
    .neq('status', 'draft')
    .neq('status', 'held')
    .gte('sale_date', from)
    .lte('sale_date', to + 'T23:59:59')
    .order('sale_date', { ascending: false });
  if (error) throw error;
  return data as SaleWithItems[];
}

function fmtCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  void: 'bg-slate-100 text-slate-500',
  refunded: 'bg-yellow-100 text-yellow-700',
  partially_refunded: 'bg-amber-100 text-amber-800',
  held: 'bg-orange-100 text-orange-700',
  draft: 'bg-blue-100 text-blue-600',
};

const PAYMENT_LABELS: Record<PaymentMethod | string, string> = {
  cash: 'Cash',
  waafi: 'WAAFI',
  evc: 'EVC',
  sahal: 'SAHAL',
  zaad: 'ZAAD',
  credit: 'Credit',
  split: 'Split',
};

function getToday() {
  return new Date().toISOString().split('T')[0];
}
function subtractDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
function getMonthStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

export default function SalesHistoryPage() {
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
      <SalesHistoryContent />
    </Suspense>
  );
}

function SalesHistoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const saleIdParam = searchParams.get('sale');
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const currency = currentStore?.currency || 'USD';

  const [fromDate, setFromDate] = useState(getMonthStart());
  const [toDate, setToDate] = useState(getToday());
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [selectedSale, setSelectedSale] = useState<SaleWithItems | null>(null);
  const [refundSale, setRefundSale] = useState<SaleWithItems | null>(null);
  const [paymentSale, setPaymentSale] = useState<SaleWithItems | null>(null);

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['sales-history', currentStore?.id, fromDate, toDate],
    queryFn: () => fetchSalesHistory(currentStore!.id, fromDate, toDate),
    enabled: !!currentStore,
  });

  const cashierIds = useMemo(
    () => [...new Set(sales.map((s) => s.cashier_id).filter(Boolean))],
    [sales],
  );

  const { data: cashierNames = new Map<string, string>() } = useQuery({
    queryKey: ['sale-cashiers', cashierIds],
    queryFn: async () => {
      if (cashierIds.length === 0) return new Map<string, string>();
      const supabase = createClient();
      const { data } = await supabase
        .from('user_profiles')
        .select('id, full_name')
        .in('id', cashierIds);
      return new Map((data ?? []).map((r) => [r.id, r.full_name ?? 'Staff']));
    },
    enabled: cashierIds.length > 0,
  });

  const saleInList = saleIdParam ? sales.find((s) => s.id === saleIdParam) : undefined;

  const { data: linkedSale } = useQuery({
    queryKey: ['sales-history-link', currentStore?.id, saleIdParam],
    queryFn: () => fetchSaleById(currentStore!.id, saleIdParam!),
    enabled: !!currentStore && !!saleIdParam && !saleInList,
  });

  useEffect(() => {
    if (!saleIdParam) return;
    const sale = saleInList ?? linkedSale;
    if (!sale) return;
    setSelectedSale(sale);
    const d = sale.sale_date.split('T')[0];
    if (d < fromDate) setFromDate(d);
    if (d > toDate) setToDate(d);
  }, [saleIdParam, saleInList, linkedSale, fromDate, toDate]);

  const closeSaleDetail = () => {
    setSelectedSale(null);
    if (saleIdParam) router.replace('/dashboard/sales-history');
  };

  const filtered = useMemo(() => {
    return sales.filter((sale) => {
      const matchSearch =
        !search ||
        sale.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
        (sale.customer as { full_name?: string } | null)?.full_name
          ?.toLowerCase()
          .includes(search.toLowerCase());
      const matchPayment =
        paymentFilter === 'all' || sale.payment_method === paymentFilter;
      const pStatus = salePaymentStatus(sale);
      const matchPayStatus =
        paymentStatusFilter === 'all' || pStatus === paymentStatusFilter;
      return matchSearch && matchPayment && matchPayStatus;
    });
  }, [sales, search, paymentFilter, paymentStatusFilter]);

  const stats = useMemo(() => {
    const total = filtered.reduce((s, sale) => s + sale.total_amount, 0);
    const avg = filtered.length ? total / filtered.length : 0;
    return { count: filtered.length, total, avg };
  }, [filtered]);

  const applyQuickRange = (range: string) => {
    const today = getToday();
    switch (range) {
      case 'today':
        setFromDate(today);
        setToDate(today);
        break;
      case 'yesterday': {
        const y = subtractDays(1);
        setFromDate(y);
        setToDate(y);
        break;
      }
      case '7days':
        setFromDate(subtractDays(7));
        setToDate(today);
        break;
      case 'month':
        setFromDate(getMonthStart());
        setToDate(today);
        break;
    }
  };

  const exportCsv = () => {
    exportSalesCsv(
      filtered.map((s) => ({
        invoice_number: s.invoice_number,
        sale_date: s.sale_date,
        status: s.status,
        payment_method: PAYMENT_LABELS[s.payment_method] || s.payment_method,
        subtotal: s.subtotal,
        tax_amount: s.tax_amount,
        discount_amount: s.discount_amount,
        total_amount: s.total_amount,
        customer: s.customer as { full_name?: string; phone?: string } | null,
        items: s.items?.map((i) => ({
          product_name: i.product_name,
          sku: i.product_sku,
          quantity: i.quantity,
          unit_price: i.unit_price,
          subtotal: i.subtotal,
        })),
      })),
      fromDate,
      toDate,
    );
  };

  const exportExcel = () => {
    exportSalesExcel(
      filtered.map((s) => ({
        invoice_number: s.invoice_number,
        sale_date: s.sale_date,
        status: s.status,
        payment_method: PAYMENT_LABELS[s.payment_method] || s.payment_method,
        subtotal: s.subtotal,
        tax_amount: s.tax_amount,
        discount_amount: s.discount_amount,
        total_amount: s.total_amount,
        customer: s.customer as { full_name?: string; phone?: string } | null,
        items: s.items?.map((i) => ({
          product_name: i.product_name,
          sku: i.product_sku,
          quantity: i.quantity,
          unit_price: i.unit_price,
          subtotal: i.subtotal,
        })),
      })),
      fromDate,
      toDate,
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={t('salesHistory.title')}
        description={t('salesHistory.description')}
        icon={History}
        variant="banner"
        actions={
          <ReportExportActions
            showAiLink={false}
            showPrintButton={false}
            disabled={!filtered.length}
            onExportCsv={exportCsv}
            onExportExcel={exportExcel}
          />
        }
      />

      <StatStrip>
        <StatChip label={t('salesHistory.sales')} value={String(stats.count)} accent="blue" />
        <StatChip label={t('salesHistory.totalRevenue')} value={fmtCurrency(stats.total, currency)} accent="emerald" />
        <StatChip label={t('salesHistory.averageSale')} value={fmtCurrency(stats.avg, currency)} accent="violet" />
        <StatChip label={t('salesHistory.period')} value={`${fromDate}`} sub={t('salesHistory.to', { date: toDate })} accent="slate" />
      </StatStrip>

      <PageFilterBar className="space-y-3">
        {/* Date Range */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 shrink-0">{t('salesHistory.from')}</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 w-36 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 shrink-0">{t('salesHistory.toLabel')}</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 w-36 text-sm"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { label: t('salesHistory.today'), key: 'today' },
              { label: t('salesHistory.yesterday'), key: 'yesterday' },
              { label: t('salesHistory.sevenDays'), key: '7days' },
              { label: t('salesHistory.thisMonth'), key: 'month' },
            ].map((r) => (
              <Button
                key={r.key}
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => applyQuickRange(r.key)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Search + Payment filter */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('salesHistory.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(inputSoft, 'pl-9')}
            />
          </div>
          <Select value={paymentFilter} onValueChange={(v: string | null) => setPaymentFilter(v ?? 'all')}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder={t('salesHistory.payment')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('salesHistory.allMethods')}</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="waafi">WAAFI</SelectItem>
              <SelectItem value="evc">EVC</SelectItem>
              <SelectItem value="sahal">SAHAL</SelectItem>
              <SelectItem value="zaad">ZAAD</SelectItem>
            </SelectContent>
          </Select>
          <Select value={paymentStatusFilter} onValueChange={(v: string | null) => setPaymentStatusFilter(v ?? 'all')}>
            <SelectTrigger className="w-32 h-9">
              <SelectValue placeholder="Pay status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="credit">Credit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    {t('salesHistory.invoiceCol')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">
                    {t('salesHistory.date')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">
                    {t('salesHistory.customer')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">
                    Salesperson
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">
                    Paid
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">
                    Balance
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">
                    Pay Status
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Total
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((sale) => {
                  const payStatus = salePaymentStatus(sale);
                  const balance = saleBalanceDue(sale);
                  return (
                  <tr
                    key={sale.id}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedSale(sale)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-mono text-sm font-medium text-slate-900">
                        {sale.invoice_number}
                      </p>
                      <p className="text-xs text-slate-400 md:hidden">
                        {new Date(sale.sale_date).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                      {fmtDate(sale.sale_date)}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-slate-700">
                        {(sale.customer as { full_name?: string } | null)?.full_name || (
                          <span className="text-slate-400 italic">{t('salesHistory.walkIn')}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-500 text-xs truncate max-w-[120px]">
                      {cashierNames.get(sale.cashier_id) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell text-emerald-600 tabular-nums">
                      {fmtCurrency(sale.paid_amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell tabular-nums">
                      <span className={balance > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>
                        {fmtCurrency(balance, currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <Badge variant="outline" className={`text-[10px] border ${PAYMENT_STATUS_BADGES[payStatus]}`}>
                        {PAYMENT_STATUS_LABELS[payStatus]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {fmtCurrency(sale.total_amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        className={`text-[11px] border-0 ${STATUS_COLORS[sale.status] || 'bg-slate-100 text-slate-600'}`}
                      >
                        {sale.status.replace('_', ' ')}
                      </Badge>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>

            {filtered.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <History className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('salesHistory.noSales')}</p>
                <p className="text-xs mt-1">{t('salesHistory.adjustFilters')}</p>
              </div>
            )}
          </div>
        )}
      </DataPanel>

      <RefundModal
        open={!!refundSale}
        sale={refundSale}
        onClose={() => setRefundSale(null)}
      />

      <ReceivePaymentModal
        open={!!paymentSale}
        sale={paymentSale}
        onClose={() => setPaymentSale(null)}
      />

      {/* Sale Detail Sheet */}
      <Sheet open={!!selectedSale} onOpenChange={(open) => !open && closeSaleDetail()}>
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col overflow-hidden" side="right">
          {selectedSale && (
            <SaleDetailView
              sale={selectedSale}
              currency={currency}
              store={currentStore}
              onClose={closeSaleDetail}
              onRefund={() => {
                setRefundSale(selectedSale);
                closeSaleDetail();
              }}
              onReceivePayment={() => {
                setPaymentSale(selectedSale);
                closeSaleDetail();
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function SaleDetailView({
  sale,
  currency,
  store,
  onClose,
  onRefund,
  onReceivePayment,
}: {
  sale: SaleWithItems;
  currency: string;
  store: Store | null;
  onClose: () => void;
  onRefund: () => void;
  onReceivePayment: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentStore } = useAuthStore();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(sale.notes ?? '');

  useEffect(() => {
    setNotesDraft(sale.notes ?? '');
    setEditingNotes(false);
  }, [sale.id, sale.notes]);

  const saveNotes = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from('sales')
        .update({ notes: notesDraft.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', sale.id)
        .eq('store_id', currentStore!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-history', currentStore?.id] });
      setEditingNotes(false);
      toast.success('Notes saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const customer = sale.customer as { full_name?: string; phone?: string; email?: string } | null;
  const settings = (store?.settings ?? {}) as Record<string, unknown>;

  const paymentStatus = salePaymentStatus(sale);
  const balanceDue = saleBalanceDue(sale);

  const invoiceData: InvoiceData = {
    type: sale.status === 'refunded' ? 'refund' : 'custom',
    invoice_number: sale.invoice_number,
    store_id: store?.id,
    store_name: store?.name || '',
    store_address: store?.address,
    store_phone: store?.phone,
    store_email: store?.email,
    logo_url: store?.logo_url,
    tax_number: settings.tax_number as string | undefined,
    footer_message: settings.invoice_footer as string | undefined,
    terms_and_conditions: settings.invoice_terms as string | undefined,
    currency: currency,
    date: sale.sale_date,
    customer_name: customer?.full_name,
    customer_phone: customer?.phone,
    customer_email: customer?.email,
    items: (sale.items || []).map((it) => ({
      id: it.id,
      name: it.product_name,
      sku: it.product_sku,
      quantity: it.sale_unit_qty ?? it.quantity,
      unit_code: it.sale_unit_code,
      base_qty: it.base_qty ?? it.quantity,
      unit_price: it.unit_price,
      discount_amount: it.discount_amount,
      tax_amount: it.tax_amount,
      subtotal: it.subtotal,
    })),
    subtotal: sale.subtotal,
    discount_amount: sale.discount_amount,
    tax_amount: sale.tax_amount,
    total_amount: sale.total_amount,
    paid_amount: sale.paid_amount,
    credit_amount: sale.credit_amount,
    change_amount: sale.change_amount,
    balance_due: balanceDue,
    payment_method: sale.payment_method,
    payment_label: PAYMENT_LABELS[sale.payment_method] || sale.payment_method,
    payment_status: paymentStatus === 'credit' ? 'unpaid' : paymentStatus,
    status: sale.status,
    is_refund: sale.status === 'refunded',
    notes: notesDraft || sale.notes,
  };

  const invoiceOptions = {
    showTax: settings.show_tax !== false,
    showDiscount: settings.show_discount !== false,
    showSku: false,
    showLogo: settings.show_logo !== false,
    theme: (settings.invoice_theme as 'blue' | 'green' | 'purple' | 'dark' | 'custom') ?? 'blue',
  };

  return (
    <div className="flex flex-col min-h-full">
      <SheetHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <SheetTitle className="text-base font-bold truncate">{sale.invoice_number}</SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">{fmtDate(sale.sale_date)}</p>
          </div>
          <div className="text-right shrink-0 space-y-1">
            <p className="text-lg font-bold text-slate-900 tabular-nums">
              {fmtCurrency(sale.total_amount, currency)}
            </p>
            <Badge className={cn('text-[10px] border-0', STATUS_COLORS[sale.status] || 'bg-slate-100 text-slate-600')}>
              {t(`saleStatus.${sale.status}`)}
            </Badge>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 px-4 py-4 space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-xs font-semibold text-slate-500 uppercase">Invoice notes</p>
            {!editingNotes ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setEditingNotes(true)}>
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingNotes(false); setNotesDraft(sale.notes ?? ''); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" className="h-7 px-2 text-xs gap-1" disabled={saveNotes.isPending} onClick={() => saveNotes.mutate()}>
                  <Check className="h-3 w-3" /> Save
                </Button>
              </div>
            )}
          </div>
          {editingNotes ? (
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={3}
              className="text-sm resize-none bg-white"
              placeholder="Add notes for this invoice..."
            />
          ) : (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{sale.notes?.trim() || 'No notes'}</p>
          )}
        </div>

        <InvoiceDocument
          data={invoiceData}
          id="sales-history-invoice"
          variant="panel"
          options={invoiceOptions}
          showControls
        />
      </div>

      <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 backdrop-blur px-4 py-3 space-y-2 shrink-0">
        {balanceDue > 0 && sale.customer_id && sale.status === 'completed' && (
          <Button
            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 h-10"
            onClick={onReceivePayment}
          >
            <DollarSign className="h-4 w-4" />
            Receive Payment ({fmtCurrency(balanceDue, currency)})
          </Button>
        )}
        {(sale.status === 'completed' || sale.status === 'partially_refunded') && (
          <Button
            variant="outline"
            className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50 h-10"
            onClick={onRefund}
          >
            <RotateCcw className="h-4 w-4" />
            {t('salesHistory.processRefund')}
          </Button>
        )}
        <Button variant="ghost" className="w-full h-9 text-slate-600" onClick={onClose}>
          {t('salesHistory.close')}
        </Button>
      </div>
    </div>
  );
}
