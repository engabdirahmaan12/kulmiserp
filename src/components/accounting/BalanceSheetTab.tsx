'use client';

import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { normalBalance } from '@/lib/accounting/utils';
import { ReportWidget } from '@/components/reports/ReportLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Account } from '@/types';

function SectionTable({
  title,
  totalLabel,
  accounts,
  fmt,
}: {
  title: string;
  totalLabel: string;
  accounts: Account[];
  fmt: (n: number) => string;
}) {
  const total = accounts.reduce((s, a) => s + normalBalance(a), 0);
  return (
    <ReportWidget title={title} compact>
      <div className="divide-y divide-slate-50 dark:divide-slate-800 text-sm">
        {accounts.map((a) => (
          <div key={a.id} className="flex justify-between py-2.5 gap-2">
            <span className="text-slate-600 dark:text-slate-400 truncate">
              <code className="text-[10px] bg-slate-100 dark:bg-slate-800 rounded px-1 mr-1.5">{a.code}</code>
              {a.name}
            </span>
            <span className="font-mono tabular-nums font-medium shrink-0">{fmt(normalBalance(a))}</span>
          </div>
        ))}
        <div className="flex justify-between py-3 font-bold text-slate-900 dark:text-white border-t border-slate-100 dark:border-slate-800">
          <span>{totalLabel}</span>
          <span className="font-mono tabular-nums">{fmt(total)}</span>
        </div>
      </div>
    </ReportWidget>
  );
}

export function BalanceSheetTab() {
  const { accounts, isLoading, currency, metrics } = useAccountingAccounts();
  const { t } = useTranslation();
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>;
  }

  const assets = accounts.filter((a) => a.account_type === 'asset' && normalBalance(a) !== 0);
  const liabilities = accounts.filter((a) => a.account_type === 'liability' && normalBalance(a) !== 0);
  const equity = accounts.filter((a) => a.account_type === 'equity' && normalBalance(a) !== 0);

  const retainedEarnings = metrics.netProfit;
  const totalLiabilitiesEquity = metrics.totalLiabilities + metrics.totalEquity + retainedEarnings;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('balanceSheet.title')}</h3>
          <p className="text-xs text-slate-500">{t('balanceSheet.asOf', { date: new Date().toLocaleDateString() })}</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>{t('balanceSheet.assetsLabel')} <span className="font-bold text-slate-800 dark:text-white">{fmt(metrics.totalAssets)}</span></p>
          <p>{t('balanceSheet.liabilitiesEquityLabel')} <span className="font-bold text-slate-800 dark:text-white">{fmt(totalLiabilitiesEquity)}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionTable title={t('balanceSheet.sectionAssets')} totalLabel={t('balanceSheet.totalSection', { section: t('balanceSheet.sectionAssets') })} accounts={assets} fmt={fmt} />
        <div className="space-y-4">
          <SectionTable title={t('balanceSheet.sectionLiabilities')} totalLabel={t('balanceSheet.totalSection', { section: t('balanceSheet.sectionLiabilities') })} accounts={liabilities} fmt={fmt} />
          <ReportWidget title={t('balanceSheet.sectionEquity')} compact>
            <div className="divide-y divide-slate-50 dark:divide-slate-800 text-sm">
              {equity.map((a) => (
                <div key={a.id} className="flex justify-between py-2.5">
                  <span className="text-slate-600">{a.name}</span>
                  <span className="font-mono tabular-nums">{fmt(normalBalance(a))}</span>
                </div>
              ))}
              <div className="flex justify-between py-2.5">
                <span className="text-slate-600">{t('balanceSheet.currentPeriodEarnings')}</span>
                <span className={`font-mono tabular-nums ${retainedEarnings >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {fmt(retainedEarnings)}
                </span>
              </div>
            </div>
          </ReportWidget>
        </div>
      </div>
    </div>
  );
}
