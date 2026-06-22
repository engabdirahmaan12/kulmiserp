'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useStoreIntelligence } from '@/lib/hooks/useIntelligence';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, startOfMonth } from 'date-fns';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { JournalEntry } from '@/types';
import { canWriteAccounting } from '@/lib/accounting/permissions';
import { useAccountingAccounts, useClosedPeriods } from '@/lib/accounting/hooks';
import { toSelectItems } from '@/lib/ui/select-utils';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface JournalLineInput {
  account_code: string;
  debit: string;
  credit: string;
  description: string;
}

type ActivityFilter = 'all' | 'sale' | 'purchase' | 'expense' | 'payment' | 'other';

const FILTER_OPTIONS: { id: ActivityFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'journals.filterAll' },
  { id: 'sale', labelKey: 'journals.filterSales' },
  { id: 'purchase', labelKey: 'journals.filterPurchases' },
  { id: 'expense', labelKey: 'journals.filterExpenses' },
  { id: 'payment', labelKey: 'journals.filterPayments' },
  { id: 'other', labelKey: 'journals.filterOther' },
];

function entryKind(referenceType?: string): ActivityFilter {
  if (!referenceType) return 'other';
  if (referenceType.includes('sale')) return 'sale';
  if (referenceType.includes('purchase')) return 'purchase';
  if (referenceType.includes('expense')) return 'expense';
  if (referenceType.includes('payment') || referenceType.includes('debt')) return 'payment';
  return 'other';
}

function entryHeading(entry: JournalEntry): string {
  const desc = entry.description?.trim();
  if (desc) return desc;
  const type = entry.reference_type?.replace(/_/g, ' ') ?? 'Journal';
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} ${entry.entry_number}`;
}

export function JournalEntriesTab() {
  const { currentStore, user, storeUser } = useAuthStore();
  const { t } = useTranslation();
  const canManualPost = canWriteAccounting(storeUser?.role);
  const queryClient = useQueryClient();
  const { accounts } = useAccountingAccounts();
  const { isDateClosed } = useClosedPeriods();
  const { data: intel } = useStoreIntelligence();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const accountSelectItems = useMemo(
    () => toSelectItems(accounts, (a) => a.code, (a) => `${a.code} ${a.name}`),
    [accounts],
  );
  const [showManual, setShowManual] = useState(false);
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [lines, setLines] = useState<JournalLineInput[]>([
    { account_code: '1110', debit: '', credit: '', description: '' },
    { account_code: '4100', debit: '', credit: '', description: '' },
  ]);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['journal-entries', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('journal_entries')
        .select(`*, lines:journal_lines(*, account:chart_of_accounts(code, name))`)
        .eq('store_id', currentStore!.id)
        .order('entry_date', { ascending: false })
        .limit(80);
      return data as JournalEntry[];
    },
    enabled: !!currentStore,
  });

  const currency = currentStore?.currency || 'USD';
  const fmtMoney = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  const fmtNum = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n);

  const filteredEntries = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => entryKind(e.reference_type) === filter)),
    [entries, filter],
  );

  const periodLabel = format(startOfMonth(new Date()), 'MMMM yyyy');

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  const { mutate: postManual, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const payload = lines
        .filter((l) => (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0)
        .map((l) => ({
          account_code: l.account_code,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description || description,
        }));
      const { data, error } = await supabase.rpc('create_manual_journal_entry', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_description: description,
        p_entry_date: entryDate,
        p_lines: payload,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed to post journal');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      toast.success(t('journals.postedToast'));
      setShowManual(false);
      setDescription('');
      setLines([
        { account_code: '1110', debit: '', credit: '', description: '' },
        { account_code: '4100', debit: '', credit: '', description: '' },
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary banner — mockup style */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-5 text-white shadow-lg shadow-blue-900/20">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-200">{t('journals.cashFlowLabel')}</p>
        <p className="text-sm text-blue-100 mt-0.5">{periodLabel}</p>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-[10px] uppercase text-blue-200 tracking-wide">{t('journals.totalIncome')}</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">
              {intel ? fmtMoney(intel.metrics.monthRevenue) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-blue-200 tracking-wide">{t('journals.netProfit')}</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">
              {intel ? fmtMoney(intel.metrics.monthProfit) : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('journals.title')}</h3>
          <p className="text-xs text-slate-500">
            {t('journals.subtitle', { count: String(filteredEntries.length) })}
          </p>
        </div>
        {canManualPost && (
          <Button size="sm" className="gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700" onClick={() => setShowManual(true)}>
            <Plus className="h-4 w-4" /> {t('journals.newLedger')}
          </Button>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === f.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {t(f.labelKey as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm rounded-2xl border border-dashed border-slate-200">
          {t('journals.noEntries')}
        </div>
      ) : (
        <div className="space-y-3 pb-4">
          {filteredEntries.map((entry) => {
            const entryDebit = entry.lines?.reduce((s, l) => s + (l.debit_amount || 0), 0) || 0;
            const kind = entryKind(entry.reference_type);
            return (
              <div
                key={entry.id}
                className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
              >
                <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-50 dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {entryHeading(entry)}
                      </h4>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px] capitalize',
                          kind === 'sale' && 'bg-emerald-50 text-emerald-700',
                          kind === 'purchase' && 'bg-violet-50 text-violet-700',
                          kind === 'expense' && 'bg-orange-50 text-orange-700',
                          kind === 'payment' && 'bg-blue-50 text-blue-700',
                          kind === 'other' && 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {kind}
                      </Badge>
                      {!entry.is_auto && (
                        <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700">{t('journals.manualBadge')}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {format(new Date(entry.entry_date), 'MMM d, yyyy')} · {entry.entry_number}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-900 tabular-nums dark:text-white">{fmtMoney(entryDebit)}</p>
                    <p className="text-[10px] text-slate-400 uppercase">{currency}</p>
                  </div>
                </div>

                {entry.lines && entry.lines.length > 0 && (
                  <div className="divide-y divide-slate-50 dark:divide-slate-800">
                    {entry.lines.map((line) => {
                      const acct = line.account as unknown as { code: string; name: string } | undefined;
                      return (
                        <div key={line.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                          <span className="text-slate-600 dark:text-slate-400 min-w-0 truncate">
                            <span className="font-medium text-slate-800 dark:text-slate-200">{acct?.name ?? 'Account'}</span>
                            {acct?.code && (
                              <code className="ml-1.5 text-[10px] text-slate-400">{acct.code}</code>
                            )}
                          </span>
                          <div className="flex gap-4 shrink-0 tabular-nums">
                            <span className="w-20 text-right text-blue-600 font-medium">
                              {line.debit_amount > 0 ? fmtNum(line.debit_amount) : '—'}
                            </span>
                            <span className="w-20 text-right text-orange-600 font-medium">
                              {line.credit_amount > 0 ? fmtNum(line.credit_amount) : '—'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showManual} onOpenChange={setShowManual}>
        <DialogContent className="sm:max-w-lg max-h-[min(92vh,620px)] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b">
            <DialogTitle>{t('journals.dialogTitle')}</DialogTitle>
            <p className="text-xs text-slate-500 font-normal">{t('journals.dialogNote')}</p>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('journals.labelDescription')}</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('journals.descriptionPlaceholder')} /></div>
              <div>
                <Label>{t('journals.labelDate')}</Label>
                <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                {isDateClosed(entryDate) && (
                  <div className="flex items-start gap-1.5 mt-1.5 rounded-lg bg-red-50 border border-red-200 px-2.5 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{isDateClosed(entryDate)}</p>
                  </div>
                )}
              </div>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_32px] gap-2 items-end">
                <div>
                  {i === 0 && <Label className="text-[10px]">{t('journals.labelAccount')}</Label>}
                  <Select
                    items={accountSelectItems}
                    value={line.account_code}
                    onValueChange={(v) => {
                    const next = [...lines];
                    next[i].account_code = v ?? '1110';
                    setLines(next);
                  }}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => <SelectItem key={a.id} value={a.code}>{a.code} {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  {i === 0 && <Label className="text-[10px]">{t('journals.labelDebit')}</Label>}
                  <Input className="h-9" type="number" step="0.01" value={line.debit} onChange={(e) => { const next = [...lines]; next[i].debit = e.target.value; setLines(next); }} />
                </div>
                <div>
                  {i === 0 && <Label className="text-[10px]">{t('journals.labelCredit')}</Label>}
                  <Input className="h-9" type="number" step="0.01" value={line.credit} onChange={(e) => { const next = [...lines]; next[i].credit = e.target.value; setLines(next); }} />
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-8" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { account_code: '6500', debit: '', credit: '', description: '' }])}>
              {t('journals.addLine')}
            </Button>
            <div className={cn('flex justify-between text-sm font-medium px-1', isBalanced ? 'text-blue-600' : 'text-red-500')}>
              <span>{t('journals.debitTotal', { n: fmtNum(totalDebit) })}</span>
              <span>{t('journals.creditTotal', { n: fmtNum(totalCredit) })}</span>
            </div>
            <Button className="w-full shrink-0" disabled={!isBalanced || !description || isPending || !!isDateClosed(entryDate)} onClick={() => postManual()}>
              {t('journals.postButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
