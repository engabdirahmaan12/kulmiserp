'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Loader2, Lock, LockOpen, Plus, FileSpreadsheet, FileText, Download,
  TrendingUp, TrendingDown, ShoppingCart, Package, Receipt, Users, Truck,
  BookOpen, AlertTriangle, CheckCircle2, Clock, BarChart3,
} from 'lucide-react';
import type { AccountingPeriod, PeriodArchive, PeriodStatus } from '@/types';
import { cn } from '@/lib/utils';
import { exportPeriodCsv, exportPeriodExcel, exportPeriodPdf, fmtMoney } from '@/lib/accounting/period-export';
import { usePermission } from '@/lib/hooks/usePermission';
import { useTranslation } from '@/lib/i18n/useTranslation';

// ── Status config ─────────────────────────────────────────
const STATUS_CLASS: Record<PeriodStatus, { cls: string; Icon: React.ElementType }> = {
  open:     { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  closed:   { cls: 'bg-red-100 text-red-700 border-red-200',             Icon: Lock },
  reopened: { cls: 'bg-amber-100 text-amber-700 border-amber-200',       Icon: LockOpen },
};

// ── KPI Card ──────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className="font-semibold text-slate-900 text-sm truncate">{value}</p>
      </div>
    </div>
  );
}

// ── Period KPIs panel ──────────────────────────────────────
function PeriodKpisPanel({ archive, currency }: {
  period: AccountingPeriod; archive: PeriodArchive; currency: string;
}) {
  const { t } = useTranslation();
  const isProfit = archive.net_profit >= 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
      <KpiCard label={t('periodClose.kpiTotalSales')} value={fmtMoney(archive.total_sales, currency)} icon={ShoppingCart} color="bg-blue-100 text-blue-600" />
      <KpiCard label={t('periodClose.kpiPurchases')} value={fmtMoney(archive.total_purchases, currency)} icon={Package} color="bg-violet-100 text-violet-600" />
      <KpiCard label={t('periodClose.kpiExpenses')} value={fmtMoney(archive.total_expenses, currency)} icon={Receipt} color="bg-orange-100 text-orange-600" />
      <KpiCard label={t('periodClose.kpiNetProfit')} value={fmtMoney(archive.net_profit, currency)} icon={isProfit ? TrendingUp : TrendingDown} color={isProfit ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'} />
      <KpiCard label={t('periodClose.kpiReceivables')} value={fmtMoney(archive.total_ar, currency)} icon={Users} color="bg-teal-100 text-teal-600" />
      <KpiCard label={t('periodClose.kpiPayables')} value={fmtMoney(archive.total_ap, currency)} icon={Truck} color="bg-pink-100 text-pink-600" />
      <KpiCard label={t('periodClose.kpiJournalEntries')} value={String(archive.journal_count)} icon={BookOpen} color="bg-slate-100 text-slate-600" />
      <KpiCard label={t('periodClose.kpiGrossProfit')} value={fmtMoney(archive.gross_profit, currency)} icon={BarChart3} color="bg-indigo-100 text-indigo-600" />
    </div>
  );
}

// ── Close confirmation dialog ──────────────────────────────
function CloseConfirmDialog({ period, onConfirm, onCancel, isPending, currency }: {
  period: AccountingPeriod;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  currency: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">{t('periodClose.closingWarning', { name: period.name })}</p>
          <p className="text-xs text-amber-700 mt-0.5">
            {format(new Date(period.period_start), 'MMM d, yyyy')} – {format(new Date(period.period_end), 'MMM d, yyyy')}
          </p>
          <p className="text-xs text-amber-700 mt-1.5">
            {t('periodClose.closingNote')}
          </p>
        </div>
      </div>
      <ul className="text-xs text-slate-600 space-y-1.5">
        <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {t('periodClose.closeCheck1')}</li>
        <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {t('periodClose.closeCheck2')}</li>
        <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-red-500" /> {t('periodClose.closeLock1')}</li>
        <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-red-500" /> {t('periodClose.closeLock2')}</li>
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('periodClose.cancelButton')}</Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending} className="gap-2">
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Lock className="h-4 w-4" /> {t('periodClose.confirmClose')}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Reopen dialog ─────────────────────────────────────────
function ReopenDialog({ period, onConfirm, onCancel, isPending }: {
  period: AccountingPeriod;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">{t('periodClose.reopenWarning', { name: period.name })}</p>
          <p className="text-xs text-amber-700 mt-1">
            {t('periodClose.reopenNote')}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{t('periodClose.reopenReasonLabel')} <span className="text-red-500">*</span></Label>
        <Textarea
          rows={3}
          placeholder={t('periodClose.reopenReasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-slate-400">{t('periodClose.reopenReasonNote')}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('periodClose.cancelButton')}</Button>
        <Button
          onClick={() => onConfirm(reason)}
          disabled={isPending || !reason.trim()}
          className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <LockOpen className="h-4 w-4" /> {t('periodClose.reopenButton')}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Export row ─────────────────────────────────────────────
function ExportRow({ period, archive, currency, storeName }: {
  period: AccountingPeriod;
  archive: PeriodArchive;
  currency: string;
  storeName: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      <span className="text-xs text-slate-400 mr-1">{t('periodClose.exportLabel')}</span>
      <Button
        size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
        onClick={() => exportPeriodCsv(period, archive, currency)}
      >
        <Download className="h-3 w-3" /> CSV
      </Button>
      <Button
        size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
        onClick={() => exportPeriodExcel(period, archive, currency).catch((e) => toast.error('Excel export failed: ' + e.message))}
      >
        <FileSpreadsheet className="h-3 w-3 text-green-600" /> Excel
      </Button>
      <Button
        size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
        onClick={() => exportPeriodPdf(period, archive, storeName, currency).catch((e) => toast.error('PDF export failed: ' + e.message))}
      >
        <FileText className="h-3 w-3 text-red-500" /> PDF
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────
export function PeriodCloseTab() {
  const { currentStore, user } = useAuthStore();
  const { role } = usePermission();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = currentStore?.currency ?? 'USD';
  const storeName = currentStore?.name ?? 'Store';

  const [name, setName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState<AccountingPeriod | null>(null);
  const [reopeningPeriod, setReopeningPeriod] = useState<AccountingPeriod | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const canClose = role === 'owner' || role === 'manager' || role === 'accountant';
  const canReopen = role === 'owner' || role === 'accountant';

  const { data: periods = [], isLoading } = useQuery<AccountingPeriod[]>({
    queryKey: ['accounting-periods', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_periods_with_archives', { p_store_id: currentStore!.id });
      if (error) {
        // Fallback: direct query if RPC not yet applied
        const { data: fallback } = await supabase
          .from('accounting_periods')
          .select('*')
          .eq('store_id', currentStore!.id)
          .order('period_start', { ascending: false });
        return (fallback ?? []) as AccountingPeriod[];
      }
      return (data ?? []) as AccountingPeriod[];
    },
    enabled: !!currentStore,
  });

  const { mutate: createPeriod, isPending: creating } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_accounting_period', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_name: name,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods', currentStore?.id] });
      toast.success(t('periodClose.toastPeriodCreated'));
      setName(''); setPeriodStart(''); setPeriodEnd(''); setShowCreate(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { mutate: closePeriod, isPending: closing } = useMutation({
    mutationFn: async (periodId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('close_accounting_period', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_period_id: periodId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods', currentStore?.id] });
      toast.success(t('periodClose.toastPeriodClosed'));
      setClosingPeriod(null);
    },
    onError: (e: Error) => { toast.error(e.message); setClosingPeriod(null); },
  });

  const { mutate: reopenPeriod, isPending: reopening } = useMutation({
    mutationFn: async ({ periodId, reason }: { periodId: string; reason: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('reopen_accounting_period', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_period_id: periodId,
        p_reason: reason,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods', currentStore?.id] });
      toast.success(t('periodClose.toastPeriodReopened'));
      setReopeningPeriod(null);
    },
    onError: (e: Error) => { toast.error(e.message); setReopeningPeriod(null); },
  });

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('periodClose.title')}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{t('periodClose.subtitle')}</p>
        </div>
        {canClose && (
          <Button size="sm" onClick={() => setShowCreate(!showCreate)} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" /> {t('periodClose.newPeriod')}
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3 max-w-lg">
          <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-600" /> {t('periodClose.newPeriodTitle')}
          </h4>
          <div>
            <Label className="text-xs">{t('periodClose.periodNameLabel')}</Label>
            <Input placeholder={t('periodClose.periodNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('periodClose.startDateLabel')}</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">{t('periodClose.endDateLabel')}</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => createPeriod()} disabled={creating || !name || !periodStart || !periodEnd} className="gap-2">
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t('periodClose.createButton')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>{t('periodClose.cancelButton')}</Button>
          </div>
        </div>
      )}

      {/* Periods list */}
      {periods.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-slate-200">
          <Clock className="h-12 w-12 mx-auto mb-3 text-slate-200" />
          <p className="text-slate-400 font-medium">{t('periodClose.noPeriods')}</p>
          <p className="text-xs text-slate-400 mt-1">{t('periodClose.noPeriodsNote')}</p>
          {canClose && <Button size="sm" variant="link" className="mt-2 text-blue-600" onClick={() => setShowCreate(true)}>{t('periodClose.createFirst')}</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {periods.map((p) => {
            const statusKey = p.status ?? (p.is_closed ? 'closed' : 'open');
            const statusCfg = STATUS_CLASS[statusKey as PeriodStatus];
            const StatusIcon = statusCfg.Icon;
            const statusLabel = t(`periodClose.status${statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}` as Parameters<typeof t>[0]);
            const isExpanded = expandedId === p.id;
            const archive = p.archive;

            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-2xl border bg-white overflow-hidden transition-all',
                  p.is_closed && p.status !== 'reopened' ? 'border-slate-200' : 'border-slate-200',
                )}
              >
                {/* Row header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  {/* Status dot */}
                  <div className={cn('h-2.5 w-2.5 rounded-full shrink-0',
                    p.status === 'open' ? 'bg-emerald-500' :
                    p.status === 'reopened' ? 'bg-amber-500' : 'bg-red-500'
                  )} />

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {format(new Date(p.period_start), 'MMM d, yyyy')} – {format(new Date(p.period_end), 'MMM d, yyyy')}
                    </p>
                  </div>

                  <Badge className={cn('border text-xs font-medium gap-1 shrink-0', statusCfg.cls)}>
                    <StatusIcon className="h-3 w-3" /> {statusLabel}
                  </Badge>

                  {/* Actions */}
                  <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {archive && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-green-600" title="Export CSV"
                          onClick={() => exportPeriodCsv(p, archive, currency)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-green-600" title="Export Excel"
                          onClick={() => exportPeriodExcel(p, archive, currency).catch(() => toast.error('Excel failed'))}>
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-red-600" title="Export PDF"
                          onClick={() => exportPeriodPdf(p, archive, storeName, currency).catch(() => toast.error('PDF failed'))}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {!p.is_closed && canClose && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => setClosingPeriod(p)}>
                        <Lock className="h-3 w-3" /> {t('periodClose.closeButton')}
                      </Button>
                    )}
                    {p.is_closed && canReopen && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => setReopeningPeriod(p)}>
                        <LockOpen className="h-3 w-3" /> {t('periodClose.reopenActionButton')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                    {/* Metadata */}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 mb-3">
                      {p.closed_at && (
                        <span>{t('periodClose.closedAt', { datetime: format(new Date(p.closed_at), 'MMM d, yyyy HH:mm') })}</span>
                      )}
                      {p.reopened_at && (
                        <span className="text-amber-600">
                          {t('periodClose.reopenedAt', { datetime: format(new Date(p.reopened_at), 'MMM d, yyyy HH:mm') })}
                          {p.reopen_reason ? ` — "${p.reopen_reason}"` : ''}
                        </span>
                      )}
                    </div>

                    {/* KPIs from archive */}
                    {archive ? (
                      <>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t('periodClose.periodSummary')}</p>
                        <PeriodKpisPanel period={p} archive={archive} currency={currency} />
                        <ExportRow period={p} archive={archive} currency={currency} storeName={storeName} />
                      </>
                    ) : !p.is_closed ? (
                      <p className="text-xs text-slate-400 italic">{t('periodClose.kpiWhenClosed')}</p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">{t('periodClose.archiveUnavailable')}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('periodClose.legendOpen')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> {t('periodClose.legendClosed')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> {t('periodClose.legendReopened')}</span>
      </div>

      {/* Close confirm dialog */}
      <Dialog open={!!closingPeriod} onOpenChange={(o) => !o && setClosingPeriod(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Lock className="h-5 w-5" /> {t('periodClose.closeDialogTitle')}
            </DialogTitle>
          </DialogHeader>
          {closingPeriod && (
            <CloseConfirmDialog
              period={closingPeriod}
              onConfirm={() => closePeriod(closingPeriod.id)}
              onCancel={() => setClosingPeriod(null)}
              isPending={closing}
              currency={currency}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={!!reopeningPeriod} onOpenChange={(o) => !o && setReopeningPeriod(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <LockOpen className="h-5 w-5" /> {t('periodClose.reopenDialogTitle')}
            </DialogTitle>
          </DialogHeader>
          {reopeningPeriod && (
            <ReopenDialog
              period={reopeningPeriod}
              onConfirm={(reason) => reopenPeriod({ periodId: reopeningPeriod.id, reason })}
              onCancel={() => setReopeningPeriod(null)}
              isPending={reopening}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
