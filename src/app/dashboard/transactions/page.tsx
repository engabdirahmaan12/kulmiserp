'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeftRight, Search, ChevronLeft, ChevronRight, ExternalLink,
  Receipt, ShoppingBag, ShoppingCart, Calendar, X, Coins, Banknote, Users, Truck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { btnOutline, inputSoft, tableHead } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { TransactionDetailSheet, type TransactionRow } from '@/components/transactions/TransactionDetailSheet';
import { CashMovementModal } from '@/components/transactions/CashMovementModal';
import { useTranslation } from '@/lib/i18n/useTranslation';

const TYPE_CLASS: Record<string, { className: string; icon: typeof Receipt }> = {
  sale: { className: 'bg-emerald-100 text-emerald-700', icon: ShoppingCart },
  purchase: { className: 'bg-blue-100 text-blue-700', icon: ShoppingBag },
  purchase_return: { className: 'bg-orange-100 text-orange-700', icon: ShoppingBag },
  expense: { className: 'bg-orange-100 text-orange-700', icon: Receipt },
  payment_received: { className: 'bg-teal-100 text-teal-700', icon: Receipt },
  supplier_payment: { className: 'bg-indigo-100 text-indigo-700', icon: Receipt },
  deposit: { className: 'bg-cyan-100 text-cyan-700', icon: Receipt },
  withdrawal: { className: 'bg-rose-100 text-rose-700', icon: Receipt },
  customer_deposit: { className: 'bg-violet-100 text-violet-700', icon: Coins },
  customer_advance: { className: 'bg-amber-100 text-amber-700', icon: Banknote },
  employee_loan: { className: 'bg-purple-100 text-purple-700', icon: Users },
  supplier_advance: { className: 'bg-sky-100 text-sky-700', icon: Truck },
  transfer: { className: 'bg-slate-100 text-slate-700', icon: ArrowLeftRight },
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  received: 'bg-green-100 text-green-700',
  approved: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-amber-100 text-amber-700',
  void: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-blue-100 text-blue-700',
};

const TYPE_ROUTES: Record<string, (id: string) => string> = {
  sale: (id) => `/dashboard/sales-history?sale=${id}`,
  purchase: (id) => `/dashboard/purchase-history?po=${id}`,
  expense: (id) => `/dashboard/expenses?expense=${id}`,
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  waafi: 'WAAFI',
  evc: 'EVC',
  sahal: 'Sahal',
  zaad: 'Zaad',
  credit: 'Credit',
  split: 'Split',
  bank: 'Bank',
};

function storeDateString(timeZone: string, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function daysAgoInTz(timeZone: string, n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return storeDateString(timeZone, d);
}

function monthStartInTz(timeZone: string) {
  const today = storeDateString(timeZone);
  return today.slice(0, 8) + '01';
}

export default function TransactionsPage() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const router = useRouter();

  const TYPE_CONFIG: Record<string, { label: string; className: string; icon: typeof Receipt }> = {
    sale: { label: t('transactions.typeSale'), ...TYPE_CLASS.sale },
    purchase: { label: t('transactions.typePurchase'), ...TYPE_CLASS.purchase },
    purchase_return: { label: t('transactions.typePurchaseReturn'), ...TYPE_CLASS.purchase_return },
    expense: { label: t('transactions.typeExpense'), ...TYPE_CLASS.expense },
    payment_received: { label: t('transactions.typePaymentReceived'), ...TYPE_CLASS.payment_received },
    supplier_payment: { label: t('transactions.typeSupplierPayment'), ...TYPE_CLASS.supplier_payment },
    deposit: { label: t('transactions.typeDeposit'), ...TYPE_CLASS.deposit },
    withdrawal: { label: t('transactions.typeWithdrawal'), ...TYPE_CLASS.withdrawal },
    customer_deposit: { label: t('transactions.typeCustomerDeposit'), ...TYPE_CLASS.customer_deposit },
    customer_advance: { label: t('transactions.typeCustomerAdvance'), ...TYPE_CLASS.customer_advance },
    employee_loan: { label: t('transactions.typeEmployeeLoan'), ...TYPE_CLASS.employee_loan },
    supplier_advance: { label: t('transactions.typeSupplierAdvance'), ...TYPE_CLASS.supplier_advance },
    transfer: { label: t('transactions.typeTransfer'), ...TYPE_CLASS.transfer },
  };
  const storeTz = currentStore?.timezone ?? 'Africa/Mogadishu';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => daysAgoInTz('Africa/Mogadishu', 30));
  const [dateTo, setDateTo] = useState(() => storeDateString('Africa/Mogadishu'));
  const [selectedRow, setSelectedRow] = useState<TransactionRow | null>(null);
  const [cashModal, setCashModal] = useState<'deposit' | 'withdrawal' | null>(null);

  const pageSize = 25;
  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['store-transactions', currentStore?.id, page, search, typeFilter, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data: result, error: rpcError } = await supabase.rpc('list_store_transactions', {
        p_store_id: currentStore!.id,
        p_page: page,
        p_page_size: pageSize,
        p_type: typeFilter === 'all' ? null : typeFilter,
        p_search: search.trim() || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
      if (rpcError) throw rpcError;
      const payload = result as {
        success: boolean;
        error?: string;
        items: TransactionRow[];
        total: number;
      };
      if (!payload?.success) {
        throw new Error(payload?.error || 'Failed to load transactions');
      }
      return payload;
    },
    enabled: !!currentStore,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageTotal = useMemo(
    () => items.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    [items],
  );

  const applyQuickRange = (key: string) => {
    const today = storeDateString(storeTz);
    if (key === 'today') {
      setDateFrom(today);
      setDateTo(today);
    } else if (key === '7days') {
      setDateFrom(daysAgoInTz(storeTz, 7));
      setDateTo(today);
    } else if (key === 'month') {
      setDateFrom(monthStartInTz(storeTz));
      setDateTo(today);
    }
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setDateFrom(daysAgoInTz(storeTz, 30));
    setDateTo(storeDateString(storeTz));
    setPage(1);
  };

  const hasActiveFilters = search.trim() !== '' || typeFilter !== 'all';

  return (
    <PageShell>
      <PageHeader
        title={t('transactions.title')}
        description={t('transactions.description')}
        icon={ArrowLeftRight}
        variant="banner"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={() => setCashModal('deposit')}
            >
              {t('transactions.deposit')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={() => setCashModal('withdrawal')}
            >
              {t('transactions.withdrawal')}
            </Button>
          </div>
        }
      />

      <StatStrip>
        <StatChip label={t('transactions.statTotalRecords')} value={String(total)} accent="blue" />
        <StatChip
          label={t('transactions.statPageAmount')}
          value={fmt(pageTotal)}
          accent="emerald"
        />
        <StatChip
          label={t('transactions.statShowing')}
          value={t('transactions.statShowingOf', { n: String(items.length), total: String(total) })}
          sub={t('transactions.statPage', { page: String(page), total: String(totalPages) })}
          accent="violet"
        />
        <StatChip
          label={t('transactions.statPeriod')}
          value={dateFrom ? format(new Date(dateFrom), 'MMM d') : '—'}
          sub={dateTo ? t('transactions.statPeriodTo', { date: format(new Date(dateTo), 'MMM d, yyyy') }) : undefined}
          accent="slate"
        />
      </StatStrip>

      <PageFilterBar className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 shrink-0">{t('transactions.labelFrom')}</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="h-9 w-[140px] text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 shrink-0">{t('transactions.labelTo')}</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="h-9 w-[140px] text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: t('transactions.rangeToday'), key: 'today' },
              { label: t('transactions.range7Days'), key: '7days' },
              { label: t('transactions.rangeThisMonth'), key: 'month' },
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder={t('transactions.searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className={cn(inputSoft, 'h-9 pl-9')}
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v ?? 'all'); setPage(1); }}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue placeholder={t('transactions.allTypes')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('transactions.allTypes')}</SelectItem>
              <SelectItem value="sale">{t('transactions.filterSale')}</SelectItem>
              <SelectItem value="purchase">{t('transactions.filterPurchase')}</SelectItem>
              <SelectItem value="purchase_return">{t('transactions.filterPurchaseReturn')}</SelectItem>
              <SelectItem value="expense">{t('transactions.filterExpense')}</SelectItem>
              <SelectItem value="payment_received">{t('transactions.filterPaymentReceived')}</SelectItem>
              <SelectItem value="supplier_payment">{t('transactions.filterSupplierPayment')}</SelectItem>
              <SelectItem value="deposit">{t('transactions.filterDeposit')}</SelectItem>
              <SelectItem value="withdrawal">{t('transactions.filterWithdrawal')}</SelectItem>
              <SelectItem value="customer_deposit">{t('transactions.typeCustomerDeposit')}</SelectItem>
              <SelectItem value="customer_advance">{t('transactions.typeCustomerAdvance')}</SelectItem>
              <SelectItem value="employee_loan">{t('transactions.typeEmployeeLoan')}</SelectItem>
              <SelectItem value="supplier_advance">{t('transactions.typeSupplierAdvance')}</SelectItem>
              <SelectItem value="transfer">{t('transactions.typeTransfer')}</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> {t('transactions.clearBtn')}
            </Button>
          )}
        </div>
      </PageFilterBar>

      <DataPanel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHead}>
                <th className="px-4 py-3 text-left font-semibold">{t('transactions.colDate')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('transactions.colType')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('transactions.colReference')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('transactions.colParty')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('transactions.colPayment')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('transactions.colStatus')}</th>
                <th className="px-4 py-3 text-right font-semibold">{t('transactions.colAmount')}</th>
                <th className="px-4 py-3 text-right font-semibold w-[100px]">{t('transactions.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td colSpan={8} className="px-4 py-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))}

              {!isLoading && isError && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <p className="font-medium text-red-600">
                        {(error as Error)?.message || t('transactions.errLoad')}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => refetch()}>
                        {t('transactions.retry')}
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && !isError && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                        <Calendar className="h-7 w-7 text-slate-300" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-600">{t('transactions.noTitle')}</p>
                        <p className="text-xs mt-1">{t('transactions.noSub')}</p>
                      </div>
                      {hasActiveFilters && (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          {t('transactions.clearFilters')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && !isError && items.map((row) => {
                const typeCfg = TYPE_CONFIG[row.tx_type] ?? {
                  label: row.tx_type,
                  className: 'bg-slate-100 text-slate-600',
                  icon: Receipt,
                };
                const TypeIcon = typeCfg.icon;
                return (
                  <tr
                    key={`${row.tx_type}-${row.id}`}
                    className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer"
                    onClick={() => setSelectedRow(row)}
                  >
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {format(new Date(row.tx_date), 'MMM d, yyyy')}
                      <span className="block text-[11px] text-slate-400">
                        {format(new Date(row.tx_date), 'h:mm a')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold', typeCfg.className)}>
                        <TypeIcon className="h-3 w-3" />
                        {typeCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.reference}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[180px] truncate">{row.party_name}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize text-xs">
                      {row.payment_method
                        ? PAYMENT_LABELS[row.payment_method] ?? row.payment_method
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="secondary"
                        className={cn('capitalize font-medium', STATUS_COLORS[row.status] ?? 'bg-slate-100 text-slate-600')}
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {fmt(row.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 h-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(TYPE_ROUTES[row.tx_type]?.(row.id) ?? '/dashboard');
                        }}
                      >
                        {t('transactions.viewBtn')} <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            {isFetching && !isLoading ? t('transactions.updating') : total === 1 ? t('transactions.txCount', { n: String(total) }) : t('transactions.txCountPlural', { n: String(total) })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(btnOutline, 'h-8')}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-slate-600 min-w-[90px] text-center">
              {t('transactions.pageOf', { page: String(page), total: String(totalPages) })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className={cn(btnOutline, 'h-8')}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DataPanel>

      <TransactionDetailSheet
        row={selectedRow}
        open={!!selectedRow}
        onClose={() => setSelectedRow(null)}
      />

      <CashMovementModal
        open={cashModal !== null}
        defaultType={cashModal ?? 'deposit'}
        onClose={() => setCashModal(null)}
      />
    </PageShell>
  );
}
