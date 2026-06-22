'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CHART_COLORS, ChartTooltip, GradientDefs, axisProps, gridProps } from '@/lib/chart-utils';
import { ReportKpiGrid, ReportKpiCard, ReportWidget, ReportStatementTable } from '@/components/reports/ReportLayout';
import { useTranslation } from '@/lib/i18n/useTranslation';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const PERIOD_KEYS = ['month', 'quarter', 'year'] as const;

export function PnLTab() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');

  const dateRange = {
    month:   new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    quarter: new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1).toISOString().split('T')[0],
    year:    new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
  };

  const { data, isLoading } = useQuery({
    queryKey: ['pnl-v3', currentStore?.id, period],
    queryFn: async () => {
      const supabase = createClient();
      const start = dateRange[period];

      const [salesRes, cogsRes, expensesRes, monthlySalesRes, monthlyExpRes] = await Promise.all([
        supabase.from('sales').select('total_amount').eq('store_id', currentStore!.id).eq('status', 'completed').gte('sale_date', start),
        supabase.from('sale_items').select('cost_price, quantity, sale:sales!inner(store_id, sale_date, status)').eq('sale.store_id', currentStore!.id).eq('sale.status', 'completed').gte('sale.sale_date', start),
        supabase.from('expenses').select('amount, category, expense_date').eq('store_id', currentStore!.id).gte('expense_date', start),
        supabase.from('sales').select('total_amount, sale_date').eq('store_id', currentStore!.id).eq('status', 'completed').gte('sale_date', start).order('sale_date', { ascending: true }),
        supabase.from('expenses').select('amount, expense_date').eq('store_id', currentStore!.id).gte('expense_date', start).order('expense_date', { ascending: true }),
      ]);

      const revenue      = (salesRes.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);
      const cogs         = (cogsRes.data || []).reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0);
      const totalExpenses = (expensesRes.data || []).reduce((s, e) => s + (e.amount || 0), 0);

      const expByCategory = (expensesRes.data || []).reduce((acc, e) => {
        const cat = e.category || 'Other';
        acc[cat] = (acc[cat] || 0) + e.amount;
        return acc;
      }, {} as Record<string, number>);
      const expPieData = Object.entries(expByCategory).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

      // Combined revenue + expenses per period
      const revMap: Record<string, number> = {};
      const expMapMonthly: Record<string, number> = {};
      for (const s of monthlySalesRes.data || []) {
        const key = period === 'year'
          ? format(new Date(s.sale_date), 'MMM')
          : period === 'quarter'
          ? `W${Math.ceil(new Date(s.sale_date).getDate() / 7)}`
          : format(new Date(s.sale_date), 'MMM d');
        revMap[key] = (revMap[key] || 0) + (s.total_amount || 0);
      }
      for (const e of monthlyExpRes.data || []) {
        const key = period === 'year'
          ? format(new Date(e.expense_date), 'MMM')
          : period === 'quarter'
          ? `W${Math.ceil(new Date(e.expense_date).getDate() / 7)}`
          : format(new Date(e.expense_date), 'MMM d');
        expMapMonthly[key] = (expMapMonthly[key] || 0) + (e.amount || 0);
      }
      const allKeys = [...new Set([...Object.keys(revMap), ...Object.keys(expMapMonthly)])];
      const trendData = allKeys.slice(-14).map((label) => ({
        label,
        revenue: revMap[label] || 0,
        expenses: expMapMonthly[label] || 0,
        profit: (revMap[label] || 0) - (expMapMonthly[label] || 0),
      }));

      return {
        revenue, cogs,
        gross_profit:  revenue - cogs,
        gross_margin:  revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
        expenses:      totalExpenses,
        net_profit:    revenue - cogs - totalExpenses,
        net_margin:    revenue > 0 ? ((revenue - cogs - totalExpenses) / revenue) * 100 : 0,
        exp_pie:       expPieData,
        trend:         trendData,
      };
    },
    enabled: !!currentStore,
  });

  const currency = currentStore?.currency || 'USD';
  const fmt  = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  if (isLoading) return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Header + Period Switcher */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold text-slate-900 text-lg dark:text-white">{t('pnl.title')}</h3>
          <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
            {period === 'month' ? t('pnl.currentMonth') : period === 'quarter' ? t('pnl.thisQuarter') : t('pnl.yearToDate')}
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 overflow-hidden p-0.5 bg-slate-50 gap-0.5 dark:border-slate-700 dark:bg-slate-800">
          {PERIOD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={cn(
                'px-4 py-1.5 text-xs font-semibold rounded-lg transition-all',
                period === key
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {t(`pnl.period${key.charAt(0).toUpperCase() + key.slice(1)}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <ReportKpiGrid className="grid-cols-2 md:grid-cols-4">
            <ReportKpiCard label={t('pnl.kpiRevenue')} value={fmt(data.revenue)} icon={TrendingUp} accent="blue" />
            <ReportKpiCard label={t('pnl.kpiGrossProfit')} value={fmt(data.gross_profit)} sub={`${fmtPct(data.gross_margin)} margin`} icon={DollarSign} accent="blue" />
            <ReportKpiCard label={t('pnl.kpiExpenses')} value={fmt(data.expenses)} icon={TrendingDown} accent="orange" />
            <ReportKpiCard
              label={data.net_profit >= 0 ? t('pnl.kpiNetProfit') : t('pnl.kpiNetLoss')}
              value={fmt(data.net_profit)}
              sub={`${fmtPct(data.net_margin)} margin`}
              icon={data.net_profit >= 0 ? TrendingUp : TrendingDown}
              accent={data.net_profit >= 0 ? 'blue' : 'rose'}
            />
          </ReportKpiGrid>

          {/* Combined Revenue vs Expenses Chart */}
          {data.trend.length > 1 && (
            <ReportWidget title={t('pnl.chartTitle')} subtitle={t('pnl.chartSubtitle')} menu>
              <div className="flex items-center justify-end gap-4 text-xs mb-2 -mt-2">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> {t('pnl.legendRevenue')}
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2.5 w-2.5 rounded-sm bg-orange-400" /> {t('pnl.legendExpenses')}
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-0.5 w-5 bg-blue-500" /> {t('pnl.legendNet')}
                </span>
              </div>
              <div className="w-full min-w-0 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.trend} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <GradientDefs />
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v) => `${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip content={<ChartTooltip formatter={fmt} />} />
                  <Bar dataKey="revenue" name={t('pnl.legendRevenue')} fill="url(#bar-grad-blue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="expenses" name={t('pnl.legendExpenses')} fill="url(#bar-grad-orange)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line dataKey="profit" name={t('pnl.kpiNetProfit')} type="monotone" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </ReportWidget>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReportStatementTable
              title={t('pnl.statementTitle')}
              fmt={fmt}
              rows={[
                { label: t('pnl.rowTotalRevenue'), value: data.revenue, cls: 'text-blue-700 font-semibold dark:text-blue-400' },
                { label: `  ${t('pnl.rowCostOfGoods')}`, value: -data.cogs, cls: 'text-slate-500', indent: true },
                { label: t('pnl.rowGrossProfit'), value: data.gross_profit, cls: 'text-blue-700 font-bold bg-blue-50/50 dark:text-blue-400 dark:bg-blue-950/20' },
                { label: `  ${t('pnl.rowOpExpenses')}`, value: -data.expenses, cls: 'text-orange-600 dark:text-orange-400', indent: true },
                {
                  label: data.net_profit >= 0 ? t('pnl.rowNetProfit') : t('pnl.rowNetLoss'),
                  value: data.net_profit,
                  cls: `font-bold text-base ${data.net_profit >= 0 ? 'text-blue-700 bg-blue-50/50 dark:text-blue-400 dark:bg-blue-950/20' : 'text-red-700 bg-red-50/50 dark:text-red-400 dark:bg-red-950/20'}`,
                },
              ]}
            />

            {data.exp_pie.length > 0 ? (
              <ReportWidget title={t('pnl.expBreakdownTitle')} subtitle={t('pnl.expCategories', { n: data.exp_pie.length })} menu>
                <div className="w-full min-w-0 h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <GradientDefs />
                    <Pie
                      data={data.exp_pie}
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={68}
                      paddingAngle={4}
                      dataKey="value"
                      animationBegin={0}
                      animationDuration={900}
                    >
                      {data.exp_pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip formatter={fmt} />} />
                  </PieChart>
                </ResponsiveContainer>
                </div>
                <div className="px-5 pb-4 space-y-2">
                  {data.exp_pie.slice(0, 5).map((e, i) => {
                    const total = data.exp_pie.reduce((s, x) => s + x.value, 0);
                    const pct = total > 0 ? Math.round((e.value / total) * 100) : 0;
                    return (
                      <div key={e.name} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-xs text-slate-600 flex-1 truncate">{e.name}</span>
                        <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                        <span className="text-xs font-semibold text-slate-800 font-mono w-20 text-right">{fmt(e.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </ReportWidget>
            ) : (
              <ReportWidget title={t('pnl.expBreakdownTitle')} subtitle="No data">
                <p className="text-sm text-slate-500 text-center py-6">{t('pnl.noExpenses')}</p>
              </ReportWidget>
            )}
          </div>
        </>
      )}
    </div>
  );
}
