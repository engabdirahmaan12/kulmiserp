'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { ReportWidget } from '@/components/reports/ReportLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChartTooltip, PALETTE } from '@/lib/chart-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function CashFlowTab() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const { metrics, isLoading, currency } = useAccountingAccounts();

  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);

  const { data: journalSummary = [] } = useQuery({
    queryKey: ['cash-flow-journals', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('journal_lines')
        .select('debit_amount, credit_amount, account:chart_of_accounts(code, account_type, name)')
        .eq('store_id', currentStore!.id)
        .order('created_at', { ascending: false })
        .limit(500);
      return data ?? [];
    },
    enabled: !!currentStore,
  });

  const flows = useMemo(() => {
    let operating = 0;
    let investing = 0;
    let financing = 0;

    for (const line of journalSummary) {
      const acct = line.account as unknown as { code: string; account_type: string; name: string };
      if (!acct) continue;
      const net = (line.debit_amount || 0) - (line.credit_amount || 0);
      if (['1110', '1120', '1130', '1140', '1150'].includes(acct.code)) {
        operating += net;
      } else if (acct.code === '1300' || acct.account_type === 'cogs') {
        investing += net;
      } else if (acct.account_type === 'equity' || acct.code === '2100') {
        financing += net;
      }
    }

    return [
      { nameKey: 'cashFlow.operating', value: operating, fill: PALETTE.blue },
      { nameKey: 'cashFlow.investing', value: investing, fill: PALETTE.violet },
      { nameKey: 'cashFlow.financing', value: financing, fill: PALETTE.indigo ?? PALETTE.blue },
    ];
  }, [journalSummary]);

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-white">{t('cashFlow.title')}</h3>
        <p className="text-xs text-slate-500">{t('cashFlow.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { labelKey: 'cashFlow.cashOnHand', value: metrics.cashBalance },
          { labelKey: 'cashFlow.netOperating', value: flows[0]?.value ?? 0 },
          { labelKey: 'cashFlow.workingCapital', value: metrics.totalAssets - metrics.totalLiabilities },
        ].map(({ labelKey, value }) => (
          <div key={labelKey} className="rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/80">
            <p className="text-[11px] text-slate-500">{t(labelKey as Parameters<typeof t>[0])}</p>
            <p className="text-xl font-bold tabular-nums mt-1 text-slate-900 dark:text-white">{fmtC(value)}</p>
          </div>
        ))}
      </div>

      <ReportWidget title={t('cashFlow.widgetTitle')} subtitle={t('cashFlow.widgetSubtitle')} compact menu>
        <div className="w-full min-w-0 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
          <BarChart data={flows.map((f) => ({ ...f, name: t(f.nameKey as Parameters<typeof t>[0]) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
            <Tooltip content={<ChartTooltip formatter={fmtC} />} />
            <Bar dataKey="value" name={t('cashFlow.amount')} radius={[6, 6, 0, 0]} maxBarSize={48}>
              {flows.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      </ReportWidget>
    </div>
  );
}
