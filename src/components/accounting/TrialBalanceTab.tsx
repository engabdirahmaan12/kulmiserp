'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { trialBalanceAmounts } from '@/lib/accounting/utils';
import { cn } from '@/lib/utils';

export function TrialBalanceTab() {
  const { accounts, isLoading, currency } = useAccountingAccounts();
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n);

  const rows = accounts
    .map((account) => ({ account, ...trialBalanceAmounts(account) }))
    .filter((r) => r.debit > 0 || r.credit > 0);

  const totalDebits = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredits = rows.reduce((s, r) => s + r.credit, 0);

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">Trial Balance</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Enterprise accounting report</p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">As of {new Date().toLocaleDateString()}</p>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>Account</th>
              <th className={cn(reportTableHeadRight, 'text-blue-600 dark:text-blue-400')}>Debit</th>
              <th className={cn(reportTableHeadRight, 'text-orange-600 dark:text-orange-400')}>Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {rows.map(({ account, debit, credit }) => (
                <tr key={account.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-slate-400 mr-2 font-mono">{account.code}</span>
                    <span className="text-slate-900 dark:text-slate-200">{account.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-blue-600 font-medium tabular-nums dark:text-blue-400">
                    {debit > 0 ? `${currency} ${fmt(debit)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-orange-600 font-medium tabular-nums dark:text-orange-400">
                    {credit > 0 ? `${currency} ${fmt(credit)}` : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm border-t-2 border-slate-200 dark:bg-slate-900/95 dark:border-slate-700">
            <tr>
              <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">TOTAL</td>
              <td className="px-4 py-3 text-right font-bold text-blue-700 tabular-nums dark:text-blue-400">{currency} {fmt(totalDebits)}</td>
              <td className="px-4 py-3 text-right font-bold text-orange-700 tabular-nums dark:text-orange-400">{currency} {fmt(totalCredits)}</td>
            </tr>
          </tfoot>
        </table>
      </ReportTableShell>

      {Math.abs(totalDebits - totalCredits) > 0.01 && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
          Trial balance is out of balance by {currency} {fmt(Math.abs(totalDebits - totalCredits))}
        </div>
      )}
    </div>
  );
}
