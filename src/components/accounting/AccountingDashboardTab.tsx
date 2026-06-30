'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  Wallet,
  Users,
  Building2,
  ArrowDownRight,
  Landmark,
  Smartphone,
} from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { ReportKpiGrid, ReportKpiCard, ReportWidget } from '@/components/reports/ReportLayout';
import { ChartTooltip, GradientDefs, PALETTE } from '@/lib/chart-utils';
import { AccountingIntegrationFeed } from '@/components/accounting/AccountingIntegrationFeed';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function AccountingDashboardTab() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const { accounts, metrics, isLoading, currency } = useAccountingAccounts();

  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);

  const { data: monthlySales = [] } = useQuery({
    queryKey: ['accounting-monthly-sales', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('sales')
        .select('total_amount, sale_date')
        .eq('store_id', currentStore!.id)
        .eq('status', 'completed')
        .gte('sale_date', subMonths(new Date(), 5).toISOString().split('T')[0])
        .order('sale_date');
      return data ?? [];
    },
    enabled: !!currentStore,
  });

  const { data: monthlyExpenses = [] } = useQuery({
    queryKey: ['accounting-monthly-expenses', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('expenses')
        .select('amount, expense_date')
        .eq('store_id', currentStore!.id)
        .gte('expense_date', subMonths(new Date(), 5).toISOString().split('T')[0]);
      return data ?? [];
    },
    enabled: !!currentStore,
  });

  const trendData = useMemo(() => {
    const map: Record<string, { revenue: number; expenses: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const key = format(subMonths(new Date(), i), 'MMM yyyy');
      map[key] = { revenue: 0, expenses: 0 };
    }
    for (const s of monthlySales) {
      const key = format(new Date(s.sale_date), 'MMM yyyy');
      if (map[key]) map[key].revenue += s.total_amount;
    }
    for (const e of monthlyExpenses) {
      const key = format(new Date(e.expense_date), 'MMM yyyy');
      if (map[key]) map[key].expenses += e.amount;
    }
    return Object.entries(map).map(([month, v]) => ({
      month,
      revenue: v.revenue,
      expenses: v.expenses,
      profit: v.revenue - v.expenses,
    }));
  }, [monthlySales, monthlyExpenses]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AccountingIntegrationFeed />

      <ReportKpiGrid className="grid-cols-2 lg:grid-cols-4">
        <ReportKpiCard label={t('accountingDash.kpiCashBalance')} value={fmtC(metrics.cashOnHand)} icon={Wallet} accent="violet" />
        <ReportKpiCard label={t('accountingDash.kpiBankBalance')} value={fmtC(metrics.bankBalance)} icon={Landmark} accent="blue" />
        <ReportKpiCard label={t('accountingDash.kpiMobileMoney')} value={fmtC(metrics.mobileMoneyBalance)} icon={Smartphone} accent="violet" />
        <ReportKpiCard label={t('accountingDash.kpiProfit')} value={fmtC(metrics.netProfit)} icon={TrendingUp} accent={metrics.netProfit >= 0 ? 'blue' : 'rose'} />
        <ReportKpiCard label={t('accountingDash.kpiRevenue')} value={fmtC(metrics.totalRevenue)} icon={DollarSign} accent="blue" />
        <ReportKpiCard label={t('accountingDash.kpiExpenses')} value={fmtC(metrics.totalExpenses)} icon={ArrowDownRight} accent="orange" />
        <ReportKpiCard label={t('accountingDash.kpiAccountsReceivable')} value={fmtC(metrics.accountsReceivable)} icon={Users} accent="blue" />
        <ReportKpiCard label={t('accountingDash.kpiAccountsPayable')} value={fmtC(metrics.accountsPayable)} icon={Building2} accent="rose" />
      </ReportKpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 items-stretch">
        <ReportWidget title={t('accountingDash.trendTitle')} subtitle={t('accountingDash.trendSubtitle')} fill compact menu>
          {trendData.some((d) => d.revenue > 0 || d.expenses > 0) ? (
            <div className="w-full min-w-0 h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <GradientDefs />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                  <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                  <Area type="monotone" dataKey="revenue" name={t('accountingDash.kpiRevenue')} stroke={PALETTE.blue} fill="url(#grad-blue)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="expenses" name={t('accountingDash.kpiExpenses')} stroke={PALETTE.orange} fill="url(#grad-orange)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-12">{t('accountingDash.noTrendData')}</p>
          )}
        </ReportWidget>

        <ReportWidget title={t('accountingDash.cashSummaryTitle')} subtitle={t('accountingDash.cashSummarySubtitle')} fill compact>
          <div className="space-y-3 text-sm">
            {[
              { labelKey: 'accountingDash.rowTotalAssets', value: metrics.totalAssets, color: 'text-blue-600' },
              { labelKey: 'accountingDash.rowTotalLiabilities', value: metrics.totalLiabilities, color: 'text-orange-600' },
              { labelKey: 'accountingDash.rowOwnerEquity', value: metrics.totalEquity, color: 'text-violet-600' },
              { labelKey: 'accountingDash.rowWorkingCapital', value: metrics.totalAssets - metrics.totalLiabilities, color: 'text-blue-600' },
            ].map(({ labelKey, value, color }) => (
              <div key={labelKey} className="flex justify-between gap-2 border-b border-slate-50 pb-2 last:border-0 dark:border-slate-800">
                <span className="text-slate-500">{t(labelKey)}</span>
                <span className={`font-semibold tabular-nums ${color}`}>{fmtC(value)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">
            {t('accountingDash.autoSyncNote')}
          </p>
        </ReportWidget>
      </div>

      {accounts.length === 0 && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded-xl p-3 dark:bg-amber-950/30">
          {t('accountingDash.noAccountsWarning')}
        </p>
      )}
    </div>
  );
}
