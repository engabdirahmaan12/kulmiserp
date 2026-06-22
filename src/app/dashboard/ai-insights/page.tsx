'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/components/layout/PageShell';
import { ReportPageHeader, ReportWidget, ReportKpiGrid, ReportKpiCard } from '@/components/reports/ReportLayout';
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle, Package, Users, Clock, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { CHART_COLORS, ChartTooltip, GradientDefs, axisProps, gridProps } from '@/lib/chart-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface InsightsData {
  salesByDay: { date: string; revenue: number }[];
  salesByHour: { hour: number; count: number; revenue: number }[];
  topProductsByRevenue: { name: string; revenue: number }[];
  topProductsByQty: { name: string; qty: number }[];
  totalCustomers: number;
  repeatCustomers: number;
  avgPurchaseValue: number;
  topCustomer: string;
  expensesByCategory: { category: string; amount: number }[];
  thisMonthRevenue: number;
  lastMonthRevenue: number;
  thisMonthExpenses: number;
  lastMonthExpenses: number;
  lowStockProducts: { name: string; stock: number; dailySales: number }[];
}

async function fetchInsights(storeId: string): Promise<InsightsData> {
  const supabase = createClient();
  const now = new Date();
  const thirtyDaysAgo = format(subDays(now, 30), 'yyyy-MM-dd');
  const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const thisMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
  const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

  const [salesRes, thisMonthSalesRes, lastMonthSalesRes, expensesRes, thisMonthExpRes, lastMonthExpRes, customersRes, productsRes, saleItemsRes] = await Promise.all([
    supabase.from('sales').select('total_amount, sale_date').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', thirtyDaysAgo),
    supabase.from('sales').select('total_amount').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', thisMonthStart).lte('sale_date', thisMonthEnd),
    supabase.from('sales').select('total_amount').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', lastMonthStart).lte('sale_date', lastMonthEnd),
    supabase.from('expenses').select('amount, category').eq('store_id', storeId).gte('expense_date', thirtyDaysAgo),
    supabase.from('expenses').select('amount').eq('store_id', storeId).gte('expense_date', thisMonthStart).lte('expense_date', thisMonthEnd),
    supabase.from('expenses').select('amount').eq('store_id', storeId).gte('expense_date', lastMonthStart).lte('expense_date', lastMonthEnd),
    supabase.from('customers').select('id, full_name, total_purchases').eq('store_id', storeId).eq('is_active', true),
    supabase.from('products').select('id, name, stock_quantity, is_active').eq('store_id', storeId).eq('is_active', true),
    supabase.from('sale_items').select('product_id, product_name, quantity, subtotal, sale:sales(sale_date)').eq('store_id', storeId),
  ]);

  const sales = salesRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const customers = customersRes.data ?? [];
  const products = productsRes.data ?? [];
  const saleItems = saleItemsRes.data ?? [];

  // Sales by day (last 30 days)
  const dayMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    dayMap.set(format(subDays(now, i), 'yyyy-MM-dd'), 0);
  }
  for (const s of sales) {
    const d = s.sale_date.substring(0, 10);
    if (dayMap.has(d)) dayMap.set(d, (dayMap.get(d) ?? 0) + s.total_amount);
  }
  const salesByDay = Array.from(dayMap.entries()).map(([date, revenue]) => ({
    date: format(new Date(date), 'MMM d'),
    revenue,
  }));

  // Sales by hour
  const hourMap: Record<number, { count: number; revenue: number }> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { count: 0, revenue: 0 };
  for (const s of sales) {
    const h = new Date(s.sale_date).getHours();
    hourMap[h].count++;
    hourMap[h].revenue += s.total_amount;
  }
  const salesByHour = Object.entries(hourMap).map(([h, v]) => ({ hour: Number(h), ...v }));

  // Top products by revenue
  const productRevMap = new Map<string, { name: string; revenue: number; qty: number }>();
  for (const item of saleItems) {
    const existing = productRevMap.get(item.product_id ?? item.product_name) ?? { name: item.product_name, revenue: 0, qty: 0 };
    existing.revenue += item.subtotal;
    existing.qty += item.quantity;
    productRevMap.set(item.product_id ?? item.product_name, existing);
  }
  const sortedByRev = Array.from(productRevMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const sortedByQty = Array.from(productRevMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);

  // Customer stats
  const totalCustomers = customers.length;
  const repeatCustomers = customers.filter((c) => c.total_purchases > 0).length;
  const totalRevenue30 = sales.reduce((s, r) => s + r.total_amount, 0);
  const avgPurchaseValue = totalCustomers > 0 ? totalRevenue30 / Math.max(sales.length, 1) : 0;
  const topCustomer = customers.sort((a, b) => b.total_purchases - a.total_purchases)[0]?.full_name ?? '—';

  // Expenses by category
  const expCatMap = new Map<string, number>();
  for (const e of expenses) {
    const cat = e.category ?? 'Other';
    expCatMap.set(cat, (expCatMap.get(cat) ?? 0) + e.amount);
  }
  const expensesByCategory = Array.from(expCatMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Month comparison
  const thisMonthRevenue = (thisMonthSalesRes.data ?? []).reduce((s, r) => s + r.total_amount, 0);
  const lastMonthRevenue = (lastMonthSalesRes.data ?? []).reduce((s, r) => s + r.total_amount, 0);
  const thisMonthExpenses = (thisMonthExpRes.data ?? []).reduce((s, r) => s + r.amount, 0);
  const lastMonthExpenses = (lastMonthExpRes.data ?? []).reduce((s, r) => s + r.amount, 0);

  // Low stock prediction (products selling >0 and stock < 30 days worth)
  const productDailySales = new Map<string, number>();
  for (const item of saleItems) {
    if (item.product_id) {
      productDailySales.set(item.product_id, (productDailySales.get(item.product_id) ?? 0) + item.quantity / 30);
    }
  }
  const lowStockProducts = products
    .map((p) => ({ name: p.name, stock: p.stock_quantity, dailySales: productDailySales.get(p.id) ?? 0 }))
    .filter((p) => p.dailySales > 0 && p.stock / p.dailySales < 14)
    .sort((a, b) => a.stock / Math.max(a.dailySales, 0.01) - b.stock / Math.max(b.dailySales, 0.01))
    .slice(0, 5);

  return {
    salesByDay, salesByHour, topProductsByRevenue: sortedByRev, topProductsByQty: sortedByQty,
    totalCustomers, repeatCustomers, avgPurchaseValue, topCustomer, expensesByCategory,
    thisMonthRevenue, lastMonthRevenue, thisMonthExpenses, lastMonthExpenses, lowStockProducts,
  };
}

function StatCard({ label, value, sub, color = 'text-slate-900' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function InsightCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string; accent?: string }) {
  return (
    <ReportWidget title={title} subtitle={subtitle} className={className} menu>
      {children}
    </ReportWidget>
  );
}

export default function AIInsightsPage() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();

  const currency = currentStore?.currency ?? 'USD';
  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  const { data, isLoading } = useQuery({
    queryKey: ['ai_insights', currentStore?.id],
    queryFn: () => fetchInsights(currentStore!.id),
    enabled: !!currentStore,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <PageShell>
        <ReportPageHeader
          title={t('aiInsights.title')}
          description={t('aiInsights.description')}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      </PageShell>
    );
  }

  const revenueGrowth = data.lastMonthRevenue > 0
    ? ((data.thisMonthRevenue - data.lastMonthRevenue) / data.lastMonthRevenue) * 100
    : 0;
  const expenseRatio = data.thisMonthRevenue > 0
    ? (data.thisMonthExpenses / data.thisMonthRevenue) * 100
    : 0;
  const avgDailyRevenue = data.salesByDay.reduce((s, d) => s + d.revenue, 0) / 30;
  const bestDay = data.salesByDay.reduce((best, d) => d.revenue > best.revenue ? d : best, data.salesByDay[0] ?? { date: '—', revenue: 0 });
  const worstDay = data.salesByDay.filter((d) => d.revenue > 0).reduce((worst, d) => d.revenue < worst.revenue ? d : worst, data.salesByDay.find((d) => d.revenue > 0) ?? { date: '—', revenue: 0 });
  const repeatPct = data.totalCustomers > 0 ? (data.repeatCustomers / data.totalCustomers) * 100 : 0;
  const peakHour = data.salesByHour.reduce((best, h) => h.revenue > best.revenue ? h : best, data.salesByHour[0]);

  // Smart recommendations
  const recommendations: { type: 'warning' | 'success' | 'info'; text: string }[] = [];
  if (data.lowStockProducts.length > 0) {
    const p = data.lowStockProducts[0];
    const days = Math.floor(p.stock / Math.max(p.dailySales, 0.01));
    recommendations.push({ type: 'warning', text: t('aiInsights.recReorder', { name: p.name, days: String(days) }) });
  }
  if (expenseRatio > 50) {
    const topCat = data.expensesByCategory[0]?.category ?? 'expenses';
    recommendations.push({ type: 'warning', text: t('aiInsights.recExpensesHigh', { pct: expenseRatio.toFixed(0), cat: topCat }) });
  } else if (expenseRatio > 0) {
    recommendations.push({ type: 'info', text: expenseRatio < 30 ? t('aiInsights.recExpensesOk', { pct: expenseRatio.toFixed(0) }) : t('aiInsights.recExpensesElevated', { pct: expenseRatio.toFixed(0) }) });
  }
  if (revenueGrowth > 5) {
    recommendations.push({ type: 'success', text: t('aiInsights.recRevenueUp', { pct: revenueGrowth.toFixed(1) }) });
  } else if (revenueGrowth < -10) {
    recommendations.push({ type: 'warning', text: t('aiInsights.recRevenueDown', { pct: Math.abs(revenueGrowth).toFixed(1) }) });
  }
  if (data.thisMonthRevenue === 0) {
    recommendations.push({ type: 'warning', text: t('aiInsights.recNoSales') });
  }
  if (recommendations.length === 0) {
    recommendations.push({ type: 'success', text: t('aiInsights.recAllGood') });
  }

  const HOUR_LABELS = (h: number) => {
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
  };

  const chartHours = data.salesByHour.map((h) => ({
    ...h,
    label: HOUR_LABELS(h.hour),
    isPeak: h.hour === peakHour?.hour,
  }));

  return (
    <PageShell>
      <div id="report-print-area" className="space-y-4">
        <ReportPageHeader
          greeting={t('aiInsights.greeting')}
          title={t('aiInsights.title')}
          description={t('aiInsights.description')}
        />

        <ReportKpiGrid className="grid-cols-2 md:grid-cols-4">
          <ReportKpiCard
            label={t('aiInsights.kpiRevenue')}
            value={fmtC(data.thisMonthRevenue)}
            delta={Math.round(revenueGrowth)}
            icon={DollarSign}
            accent="emerald"
          />
          <ReportKpiCard
            label={t('aiInsights.kpiExpenses')}
            value={fmtC(data.thisMonthExpenses)}
            icon={TrendingDown}
            accent="orange"
          />
          <ReportKpiCard
            label={t('aiInsights.kpiCustomers')}
            value={String(data.totalCustomers)}
            sub={t('aiInsights.kpiRepeatSub', { pct: String(Math.round(repeatPct)) })}
            icon={Users}
            accent="blue"
          />
          <ReportKpiCard
            label={t('aiInsights.kpiLowStock')}
            value={String(data.lowStockProducts.length)}
            icon={Package}
            accent={data.lowStockProducts.length > 0 ? 'rose' : 'teal'}
          />
        </ReportKpiGrid>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

          {/* 1. Sales Velocity */}
          <InsightCard title={t('aiInsights.widgetVelocity')} subtitle={t('aiInsights.widgetVelocitySub')} accent="border-blue-400">
            <div className="flex gap-3 mb-3">
              <div className="flex-1 rounded-xl bg-blue-50 p-3">
                <p className="text-[10px] text-blue-500 font-semibold uppercase">{t('aiInsights.statAvgDay')}</p>
                <p className="text-lg font-bold text-blue-700">{fmtC(avgDailyRevenue)}</p>
              </div>
              <div className="flex-1 rounded-xl bg-emerald-50 p-3">
                <p className="text-[10px] text-emerald-500 font-semibold uppercase">{t('aiInsights.statBestDay')}</p>
                <p className="text-lg font-bold text-emerald-700">{fmtC(bestDay.revenue)}</p>
                <p className="text-[10px] text-emerald-400">{bestDay.date}</p>
              </div>
            </div>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.salesByDay} margin={{ top: 2, right: 2, left: -20, bottom: 0 }}>
                  <GradientDefs />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#3b82f6" fill="url(#grad-blue)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                  <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </InsightCard>

          {/* 2. Peak Sales Hours */}
          <InsightCard title={t('aiInsights.widgetPeakHours')} subtitle={peakHour ? t('aiInsights.widgetPeakHoursSub', { hour: HOUR_LABELS(peakHour.hour) }) : undefined} accent="border-violet-400">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartHours} margin={{ top: 4, right: 2, left: -24, bottom: 0 }}>
                  <GradientDefs />
                  <XAxis dataKey="label" {...axisProps} interval={3} />
                  <YAxis {...axisProps} />
                  <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                  <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]} maxBarSize={14}>
                    {chartHours.map((entry, i) => (
                      <Cell key={i} fill={entry.isPeak ? '#8b5cf6' : '#e2e8f0'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </InsightCard>

          {/* 3. Top Products by Revenue */}
          <InsightCard title={t('aiInsights.widgetTopProducts')} subtitle={t('aiInsights.widgetTopProductsSub')} accent="border-emerald-400">
            {data.topProductsByRevenue.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">{t('aiInsights.noSalesData')}</p>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topProductsByRevenue} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                    <GradientDefs />
                    <XAxis type="number" {...axisProps} tickFormatter={(v) => `${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={82} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                    <Bar dataKey="revenue" name="Revenue" fill="url(#bar-grad-emerald)" radius={[0, 5, 5, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </InsightCard>

          {/* 4. Customer Insights */}
          <InsightCard title={t('aiInsights.widgetCustomers')} subtitle={t('aiInsights.widgetCustomersSub')} accent="border-sky-400">
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: t('aiInsights.statTotalCustomers'), value: data.totalCustomers, color: 'bg-sky-50 text-sky-700' },
                { label: t('aiInsights.statRepeatRate'),     value: `${repeatPct.toFixed(0)}%`, color: 'bg-blue-50 text-blue-700' },
                { label: t('aiInsights.statAvgSale'),  value: fmtC(data.avgPurchaseValue), color: 'bg-indigo-50 text-indigo-700' },
              ].map(({ label, value, color }) => (
                <div key={label} className={cn('rounded-xl p-3', color)}>
                  <p className="text-[10px] font-semibold uppercase opacity-70">{label}</p>
                  <p className="text-lg font-bold">{value}</p>
                </div>
              ))}
              <div className="rounded-xl bg-slate-50 p-3 col-span-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase">{t('aiInsights.statTopCustomer')}</p>
                <p className="text-sm font-bold text-slate-800 truncate mt-0.5">{data.topCustomer}</p>
              </div>
            </div>
          </InsightCard>

          {/* 5. Expense Ratio */}
          <InsightCard title={t('aiInsights.widgetExpenseRatio')} subtitle={t('aiInsights.widgetExpenseRatioSub')} accent={expenseRatio < 30 ? 'border-emerald-400' : expenseRatio < 50 ? 'border-amber-400' : 'border-red-400'}>
            <div className="flex items-center justify-center py-2">
              <div className={cn(
                'text-4xl font-black tracking-tight',
                expenseRatio < 30 ? 'text-emerald-600' : expenseRatio < 50 ? 'text-amber-500' : 'text-red-600'
              )}>
                {expenseRatio.toFixed(1)}%
              </div>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-3 mx-1">
              <div
                className={cn('h-full rounded-full transition-all duration-700', expenseRatio < 30 ? 'bg-emerald-500' : expenseRatio < 50 ? 'bg-amber-400' : 'bg-red-500')}
                style={{ width: `${Math.min(expenseRatio, 100)}%` }}
              />
            </div>
            <div className="space-y-1.5">
              {data.expensesByCategory.slice(0, 3).map((e, i) => (
                <div key={e.category} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i] }} />
                  <span className="text-slate-500 flex-1 truncate">{e.category}</span>
                  <span className="font-semibold text-slate-700">{fmtC(e.amount)}</span>
                </div>
              ))}
            </div>
          </InsightCard>

          {/* 6. MoM Growth */}
          <InsightCard title={t('aiInsights.widgetMoM')} subtitle={t('aiInsights.widgetMoMSub')} accent="border-indigo-400">
            <div className="space-y-3.5">
              {[
                { label: t('aiInsights.rowRevenue'),  current: data.thisMonthRevenue,  last: data.lastMonthRevenue,  bar: 'bg-blue-500'    },
                { label: t('aiInsights.rowExpenses'), current: data.thisMonthExpenses, last: data.lastMonthExpenses, bar: 'bg-orange-400'  },
                { label: t('aiInsights.rowProfit'),
                  current: data.thisMonthRevenue - data.thisMonthExpenses,
                  last: data.lastMonthRevenue - data.lastMonthExpenses,
                  bar: 'bg-emerald-500' },
              ].map((row) => {
                const growth = row.last > 0 ? ((row.current - row.last) / row.last) * 100 : 0;
                const isPositive = row.label === t('aiInsights.rowExpenses') ? growth <= 0 : growth >= 0;
                return (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-500 font-medium">{row.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-800">{fmtC(row.current)}</span>
                        {row.last > 0 && (
                          <span className={cn('flex items-center gap-0.5', isPositive ? 'text-emerald-600' : 'text-red-500')}>
                            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {fmtPct(growth)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-700', row.bar)}
                        style={{ width: `${Math.min((row.current / Math.max(row.last, row.current, 1)) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </InsightCard>

          {/* 7. Low Stock Prediction */}
          <InsightCard title={t('aiInsights.widgetStockRisk')} subtitle={t('aiInsights.widgetStockRiskSub')} accent="border-amber-400">
            {data.lowStockProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-5 text-slate-400">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-2">
                  <Package className="h-5 w-5 text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-slate-600">{t('aiInsights.allWellStocked')}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {data.lowStockProducts.map((p) => {
                  const daysLeft = Math.floor(p.stock / Math.max(p.dailySales, 0.01));
                  const urgency = daysLeft < 3 ? 'bg-red-50 border-red-200' : daysLeft < 7 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200';
                  return (
                    <div key={p.name} className={cn('flex items-center gap-3 p-2.5 rounded-xl border', urgency)}>
                      <AlertTriangle className={cn('h-4 w-4 shrink-0', daysLeft < 3 ? 'text-red-500' : 'text-amber-500')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500">{t('aiInsights.stockInfo', { qty: String(p.stock), days: String(daysLeft) })}</p>
                      </div>
                      <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', daysLeft < 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                        {daysLeft}d
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </InsightCard>

          {/* 8. Smart Recommendations */}
          <InsightCard title={t('aiInsights.widgetRecommendations')} subtitle={t('aiInsights.widgetRecommendationsSub', { n: String(recommendations.length) })} className="md:col-span-2 xl:col-span-1" accent="border-purple-400">
            <div className="space-y-2">
              {recommendations.map((rec, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-xl text-sm',
                    rec.type === 'warning' ? 'bg-amber-50 border border-amber-100' :
                    rec.type === 'success' ? 'bg-emerald-50 border border-emerald-100' :
                    'bg-blue-50 border border-blue-100'
                  )}
                >
                  <div className={cn(
                    'mt-0.5 h-6 w-6 shrink-0 rounded-lg flex items-center justify-center',
                    rec.type === 'warning' ? 'bg-amber-200' : rec.type === 'success' ? 'bg-emerald-200' : 'bg-blue-200'
                  )}>
                    {rec.type === 'warning'
                      ? <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                      : rec.type === 'success'
                      ? <TrendingUp className="h-3.5 w-3.5 text-emerald-700" />
                      : <Clock className="h-3.5 w-3.5 text-blue-700" />}
                  </div>
                  <p className={cn(
                    'text-xs leading-relaxed',
                    rec.type === 'warning' ? 'text-amber-800' : rec.type === 'success' ? 'text-emerald-800' : 'text-blue-800'
                  )}>{rec.text}</p>
                </div>
              ))}
            </div>
          </InsightCard>

        </div>
      </div>
    </PageShell>
  );
}
