'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { computeRunningBalances } from '@/lib/accounting/utils';
import { PAGE_SIZE } from '@/lib/accounting/permissions';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { cn } from '@/lib/utils';
import { toSelectItems } from '@/lib/ui/select-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface LedgerLine {
  id: string;
  debit_amount: number;
  credit_amount: number;
  line_description?: string;
  entry_number: string;
  entry_date: string;
  entry_description?: string;
  reference_type?: string;
  account_code: string;
  account_name: string;
}

export function GeneralLedgerTab() {
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const { accounts, currency } = useAccountingAccounts();
  const [accountId, setAccountId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const accountSelectItems = useMemo(
    () => toSelectItems(accounts, (a) => a.id, (a) => `${a.code} — ${a.name}`, [{ value: 'all', label: t('generalLedger.allAccounts') }]),
    [accounts, t],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['general-ledger', currentStore?.id, accountId, dateFrom, dateTo, page],
    queryFn: async () => {
      const supabase = createClient();
      const { data: result, error } = await supabase.rpc('get_general_ledger', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_account_id: accountId || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: PAGE_SIZE.ledger,
        p_offset: page * PAGE_SIZE.ledger,
      });
      if (error) throw error;
      const res = result as {
        success?: boolean;
        error?: string;
        opening_balance?: number;
        total?: number;
        lines?: LedgerLine[];
      };
      if (!res?.success) throw new Error(res?.error || 'Failed to load ledger');
      return res;
    },
    enabled: !!currentStore && !!user,
  });

  const opening = data?.opening_balance ?? 0;
  const lines = data?.lines ?? [];
  const total = data?.total ?? 0;
  const runningBalances = accountId ? computeRunningBalances(opening, lines) : [];
  const totalPages = Math.ceil(total / PAGE_SIZE.ledger);

  const periodDebits = lines.reduce((s, l) => s + (l.debit_amount || 0), 0);
  const periodCredits = lines.reduce((s, l) => s + (l.credit_amount || 0), 0);
  const closing = accountId ? opening + periodDebits - periodCredits : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 min-w-[200px] flex-1">
          <Label className="text-xs text-slate-500">{t('generalLedger.labelAccount')}</Label>
          <Select
            items={accountSelectItems}
            value={accountId || 'all'}
            onValueChange={(v) => { setAccountId(v === 'all' ? '' : v ?? ''); setPage(0); }}
          >
            <SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder={t('generalLedger.allAccounts')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('generalLedger.allAccounts')}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">{t('generalLedger.labelFrom')}</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="h-9 w-36 rounded-xl" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">{t('generalLedger.labelTo')}</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="h-9 w-36 rounded-xl" />
        </div>
      </div>

      {accountId && !isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 dark:bg-blue-950/30">
            <p className="text-slate-500">{t('generalLedger.opening')}</p>
            <p className="font-semibold tabular-nums">{fmt(opening)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border px-3 py-2 dark:bg-slate-900">
            <p className="text-slate-500">{t('generalLedger.periodDebits')}</p>
            <p className="font-semibold text-blue-600 tabular-nums">{fmt(periodDebits)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border px-3 py-2 dark:bg-slate-900">
            <p className="text-slate-500">{t('generalLedger.periodCredits')}</p>
            <p className="font-semibold text-orange-600 tabular-nums">{fmt(periodCredits)}</p>
          </div>
          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 dark:bg-indigo-950/30">
            <p className="text-slate-500">{t('generalLedger.closing')}</p>
            <p className="font-semibold tabular-nums">{fmt(closing ?? 0)}</p>
          </div>
        </div>
      )}

      {!accountId && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 dark:bg-amber-950/30">
          {t('generalLedger.selectHint')}
        </p>
      )}

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('generalLedger.colDate')}</th>
              <th className={reportTableHead}>{t('generalLedger.colJe')}</th>
              <th className={reportTableHead}>{t('generalLedger.colAccount')}</th>
              <th className={reportTableHead}>{t('generalLedger.colDescription')}</th>
              <th className={reportTableHeadRight}>{t('generalLedger.colDebit')}</th>
              <th className={reportTableHeadRight}>{t('generalLedger.colCredit')}</th>
              {accountId && <th className={reportTableHeadRight}>{t('generalLedger.colBalance')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={accountId ? 7 : 6} className="p-2"><Skeleton className="h-7 rounded-lg" /></td></tr>
                ))
              : lines.map((line, i) => (
                  <tr key={line.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {line.entry_date ? format(new Date(line.entry_date), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{line.entry_number}</td>
                    <td className="px-4 py-2 text-xs">
                      <code className="bg-slate-100 dark:bg-slate-800 rounded px-1">{line.account_code}</code>
                      <span className="ml-1 text-slate-600 hidden sm:inline">{line.account_name}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600 max-w-[180px] truncate">
                      {line.line_description || line.entry_description}
                    </td>
                    <td className={cn(reportTableHeadRight, 'text-blue-600 font-medium')}>
                      {line.debit_amount > 0 ? fmt(line.debit_amount) : '—'}
                    </td>
                    <td className={cn(reportTableHeadRight, 'text-orange-600 font-medium')}>
                      {line.credit_amount > 0 ? fmt(line.credit_amount) : '—'}
                    </td>
                    {accountId && (
                      <td className={cn(reportTableHeadRight, 'font-semibold tabular-nums')}>
                        {fmt(runningBalances[i] ?? 0)}
                      </td>
                    )}
                  </tr>
                ))}
            {!isLoading && lines.length === 0 && (
              <tr><td colSpan={accountId ? 7 : 6} className="text-center py-12 text-slate-400">{t('generalLedger.noEntries')}</td></tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-slate-500">{t('generalLedger.paginationLabel', { total: String(total), page: String(page + 1), totalPages: String(totalPages) })}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
