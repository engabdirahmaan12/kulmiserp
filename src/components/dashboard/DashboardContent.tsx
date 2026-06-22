'use client';

import { useState, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/useRealtime';
import { fetchStoreIntelligence } from '@/lib/intelligence/engine';
import { DashboardSkeleton } from './DashboardSkeleton';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, Line,
} from 'recharts';
import {
  ShoppingCart, TrendingUp, DollarSign, AlertTriangle,
  Users, CreditCard, ArrowUpRight, ArrowDownRight, BarChart3,
  Sparkles, Receipt, Zap, Package, Clock, ExternalLink,
  ChevronRight, FileText, ShoppingBag, Activity, Tag, Percent,
} from 'lucide-react';
import { format, subDays, differenceInDays } from 'date-fns';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { DailyBriefingCard, BusinessHealthCard, GoalsWidget } from '@/components/intelligence/IntelligenceWidgets';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  CHART_COLORS, PM_COLORS, PALETTE, GradientDefs, ChartTooltip,
  axisProps, gridProps, SafeChartContainer,
} from '@/lib/chart-utils';
import { cogsByDate, sumCogsForPeriod } from '@/lib/sales/cogs';

// ─── Data Fetcher (unchanged business logic) ──────────────────────────────────
async function fetchDashboard(storeId: string) {
  const supabase = createClient();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = subDays(new Date(), 1).toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const last30 = subDays(new Date(), 29).toISOString().split('T')[0];

  const [
    todaySales, yesterdaySales, monthSales, todayExp, monthExp,
    receivables, lowStock, recentSales, salesChart, monthExpenses,
    saleItems,
  ] = await Promise.all([
    supabase.from('sales').select('total_amount').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', today),
    supabase.from('sales').select('total_amount').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', yesterday).lt('sale_date', today),
    supabase.from('sales').select('total_amount, payment_method, sale_date').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', monthStart),
    supabase.from('expenses').select('amount').eq('store_id', storeId).gte('expense_date', today),
    supabase.from('expenses').select('amount, category').eq('store_id', storeId).gte('expense_date', monthStart),
    supabase.from('customers').select('balance').eq('store_id', storeId).gt('balance', 0),
    supabase.from('products').select('id, name, stock_quantity, min_stock_level, unit, base_unit:unit_types!base_unit_id(code)').eq('store_id', storeId).eq('is_active', true).eq('track_inventory', true),
    supabase.from('sales').select('id, invoice_number, total_amount, payment_method, sale_date, status, customer:customers(full_name)').eq('store_id', storeId).eq('status', 'completed').order('sale_date', { ascending: false }).limit(8),
    supabase.from('sales').select('total_amount, sale_date').eq('store_id', storeId).eq('status', 'completed').gte('sale_date', last30).order('sale_date', { ascending: true }),
    supabase.from('expenses').select('amount, expense_date').eq('store_id', storeId).gte('expense_date', last30),
    supabase.from('sale_items').select('product_name, quantity, base_qty, sale_unit_qty, sale_unit_code, subtotal, cost_price, sale:sales!inner(store_id, sale_date, status)').eq('sale.store_id', storeId).eq('sale.status', 'completed').gte('sale.sale_date', last30),
  ]);

  const todayRevenue = (todaySales.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);
  const yesterdayRevenue = (yesterdaySales.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);
  const monthRevenue = (monthSales.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);
  const todayExpTotal = (todayExp.data || []).reduce((s, r) => s + (r.amount || 0), 0);
  const monthExpTotal = (monthExp.data || []).reduce((s, r) => s + (r.amount || 0), 0);
  const totalReceivables = (receivables.data || []).reduce((s, r) => s + (r.balance || 0), 0);
  const lowStockRaw = lowStock.data || [];
  const lowStockList = lowStockRaw
    .filter((p) => (p.stock_quantity ?? 0) <= (p.min_stock_level ?? 0))
    .map((p) => ({
      id: p.id,
      name: p.name,
      stock_quantity: p.stock_quantity ?? 0,
      min_stock_level: p.min_stock_level ?? 0,
      unit: (p.base_unit as { code?: string } | null)?.code ?? p.unit ?? 'PCS',
    }));

  const saleItemRows = (saleItems.data || []).map((item) => ({
    ...item,
    sale: Array.isArray(item.sale) ? (item.sale[0] ?? null) : item.sale,
  }));
  const todayCogs = sumCogsForPeriod(saleItemRows, today);
  const monthCogs = saleItemRows.reduce((s, item) => {
    const d = item.sale?.sale_date?.split('T')[0];
    if (!d || d < monthStart) return s;
    return s + (Number(item.base_qty ?? item.quantity ?? 0) * (Number(item.cost_price) || 0));
  }, 0);
  const dailyCogsMap = cogsByDate(saleItemRows);

  const revenueDelta = yesterdayRevenue > 0
    ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
    : todayRevenue > 0 ? 100 : 0;

  const dailyMap: Record<string, { revenue: number; expenses: number; count: number }> = {};
  for (let i = 29; i >= 0; i--) {
    const d = subDays(new Date(), i).toISOString().split('T')[0];
    dailyMap[d] = { revenue: 0, expenses: 0, count: 0 };
  }
  for (const s of salesChart.data || []) {
    const d = s.sale_date?.split('T')[0];
    if (d && d in dailyMap) {
      dailyMap[d].revenue += s.total_amount || 0;
      dailyMap[d].count += 1;
    }
  }
  for (const e of monthExpenses.data || []) {
    const d = e.expense_date?.split('T')[0];
    if (d && d in dailyMap) dailyMap[d].expenses += e.amount || 0;
  }
  const chartData = Object.entries(dailyMap)
    .map(([date, v]) => ({
      date: format(new Date(date), 'MMM d'),
      revenue: v.revenue,
      expenses: v.expenses,
      cogs: dailyCogsMap[date] ?? 0,
      profit: v.revenue - v.expenses - (dailyCogsMap[date] ?? 0),
      transactions: v.count,
    }))
    .slice(-14);

  const hourMap: Record<number, { count: number; revenue: number }> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { count: 0, revenue: 0 };
  for (const s of salesChart.data || []) {
    const h = new Date(s.sale_date).getHours();
    hourMap[h].count += 1;
    hourMap[h].revenue += s.total_amount || 0;
  }
  const hourLabel = (h: number) => {
    if (h === 0) return '12a';
    if (h < 12) return `${h}a`;
    if (h === 12) return '12p';
    return `${h - 12}p`;
  };
  const salesByHour = Object.entries(hourMap).map(([h, v]) => ({
    hour: Number(h),
    label: hourLabel(Number(h)),
    count: v.count,
    revenue: v.revenue,
  }));

  const productMap: Record<string, { name: string; qty: number; baseQty: number; revenue: number }> = {};
  for (const item of saleItemRows) {
    const d = item.sale?.sale_date?.split('T')[0];
    if (!d || d < monthStart) continue;
    const name = item.product_name || 'Unknown';
    if (!productMap[name]) productMap[name] = { name, qty: 0, baseQty: 0, revenue: 0 };
    productMap[name].qty += Number(item.sale_unit_qty ?? item.quantity ?? 0);
    productMap[name].baseQty += Number(item.base_qty ?? item.quantity ?? 0);
    productMap[name].revenue += item.subtotal || 0;
  }
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  const pmMap: Record<string, number> = {};
  for (const s of monthSales.data || []) {
    const pm = (s.payment_method || 'cash').toUpperCase();
    pmMap[pm] = (pmMap[pm] || 0) + (s.total_amount || 0);
  }
  const paymentData = Object.entries(pmMap).map(([name, value]) => ({ name, value }));

  const expMap: Record<string, number> = {};
  for (const e of monthExp.data || []) {
    const cat = e.category || 'Other';
    expMap[cat] = (expMap[cat] || 0) + (e.amount || 0);
  }
  const expenseData = Object.entries(expMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const monthNetProfit = monthRevenue - monthCogs - monthExpTotal;
  const todayNetProfit = todayRevenue - todayCogs - todayExpTotal;
  const monthGrossProfit = monthRevenue - monthCogs;
  const todayGrossProfit = todayRevenue - todayCogs;
  const profitMargin = monthRevenue > 0
    ? Math.round((monthNetProfit / monthRevenue) * 100)
    : 0;
  const expenseRatio = monthRevenue > 0
    ? Math.round((monthExpTotal / monthRevenue) * 100)
    : 0;

  return {
    today_count: todaySales.data?.length || 0,
    today_revenue: todayRevenue,
    yesterday_revenue: yesterdayRevenue,
    revenue_delta: revenueDelta,
    month_revenue: monthRevenue,
    today_expenses: todayExpTotal,
    month_expenses: monthExpTotal,
    today_cogs: todayCogs,
    month_cogs: monthCogs,
    today_gross_profit: todayGrossProfit,
    month_gross_profit: monthGrossProfit,
    today_profit: todayNetProfit,
    month_profit: monthNetProfit,
    profit_margin: profitMargin,
    expense_ratio: expenseRatio,
    total_receivables: totalReceivables,
    low_stock_count: lowStockList.length,
    low_stock_list: lowStockList.slice(0, 5),
    recent_sales: recentSales.data || [],
    chart_data: chartData,
    payment_data: paymentData,
    expense_data: expenseData,
    top_products: topProducts,
    sales_by_hour: salesByHour,
    month_transactions: monthSales.data?.length || 0,
  };
}

// ─── Type helpers ─────────────────────────────────────────────────────────────
type RecentSale = {
  id: string;
  invoice_number?: string;
  sale_date?: string;
  customer?: { full_name?: string } | null;
  payment_method?: string;
  total_amount?: number;
};

type LowStockItem = {
  id: string;
  name: string;
  stock_quantity: number;
  min_stock_level: number;
  unit?: string;
};

// ─── Stat Card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  delta?: number;
  href?: string;
}

const StatCard = memo(function StatCard({ label, value, sub, icon: Icon, iconColor, iconBg, delta, href }: StatCardProps) {
  const content = (
    <div className="group relative flex flex-col justify-between rounded-2xl bg-white border border-slate-100 p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden h-full min-h-[110px]">
      <div className="flex items-start justify-between mb-2">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>
        {delta !== undefined ? (
          <div className={cn(
            'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0',
            delta >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500',
          )}>
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta)}%
          </div>
        ) : href ? (
          <ChevronRight className="h-3.5 w-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        ) : null}
      </div>
      <div>
        <p className="text-xl font-bold text-slate-900 tracking-tight leading-none truncate">{value}</p>
        <p className="text-xs font-semibold text-slate-500 mt-1 truncate">{label}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
  if (href) return <Link href={href} className="block h-full">{content}</Link>;
  return content;
});

// ─── Quick Action Button ───────────────────────────────────────────────────────
interface QuickActionProps {
  label: string;
  href: string;
  icon: React.ElementType;
  gradient: string;
}

const QuickAction = memo(function QuickAction({ label, href, icon: Icon, gradient }: QuickActionProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-1.5 rounded-xl p-3 hover:bg-slate-50 transition-all duration-150 active:scale-95"
    >
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl shadow-sm group-hover:shadow transition-shadow', gradient)}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <span className="text-[10px] font-semibold text-slate-500 text-center leading-tight">{label}</span>
    </Link>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────
export function DashboardContent() {
  const { currentStore, user } = useAuthStore();
  const { t, formatCurrency, locale } = useTranslation();
  const [chartView, setChartView] = useState<'revenue' | 'transactions'>('revenue');
  useRealtimeDashboard();

  // Run in parallel with dashboard metrics so briefing/health are ready sooner.
  useQuery({
    queryKey: ['intelligence', currentStore?.id, locale],
    queryFn: () => fetchStoreIntelligence(currentStore!, user?.full_name, t),
    enabled: !!currentStore,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-v5', currentStore?.id],
    queryFn: () => fetchDashboard(currentStore!.id),
    enabled: !!currentStore,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: activePromos = [] } = useQuery({
    queryKey: ['promotions-active', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('promotions')
        .select('id, name, discount_type, discount_value, end_date, applies_to')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .or(`start_date.is.null,start_date.lte.${now}`)
        .or(`end_date.is.null,end_date.gte.${now}`)
        .limit(5);
      return (data ?? []) as Array<{ id: string; name: string; discount_type: string; discount_value: number; end_date?: string; applies_to: string }>;
    },
    enabled: !!currentStore,
    staleTime: 60_000,
  });

  if (isLoading || !data) return <DashboardSkeleton />;

  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) =>
    formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('dashboard.greetingMorning') : hour < 17 ? t('dashboard.greetingAfternoon') : t('dashboard.greetingEvening');

  const peakHour = data.sales_by_hour.reduce(
    (best, h) => h.revenue > best.revenue ? h : best,
    data.sales_by_hour[0] ?? { label: '—', revenue: 0 },
  );

  const QUICK_ACTIONS: QuickActionProps[] = [
    { label: t('dashboard.qaNewSale'), href: '/dashboard/pos', icon: ShoppingCart, gradient: 'bg-gradient-to-br from-blue-500 to-blue-600' },
    { label: t('dashboard.qaAddProduct'), href: '/dashboard/inventory', icon: Package, gradient: 'bg-gradient-to-br from-emerald-500 to-teal-600' },
    { label: t('dashboard.qaPurchase'), href: '/dashboard/purchase', icon: ShoppingBag, gradient: 'bg-gradient-to-br from-violet-500 to-purple-600' },
    { label: t('dashboard.qaAddExpense'), href: '/dashboard/expenses', icon: Receipt, gradient: 'bg-gradient-to-br from-orange-400 to-amber-500' },
    { label: t('dashboard.qaInvoice'), href: '/dashboard/custom-sales', icon: FileText, gradient: 'bg-gradient-to-br from-sky-500 to-cyan-500' },
    { label: t('dashboard.qaReports'), href: '/dashboard/reports', icon: BarChart3, gradient: 'bg-gradient-to-br from-slate-500 to-slate-600' },
  ];

  const widgetSnapshot = {
    today_revenue: data.today_revenue,
    today_profit: data.today_profit,
    today_expenses: data.today_expenses,
    month_revenue: data.month_revenue,
    month_expenses: data.month_expenses,
    month_profit: data.month_profit,
    profit_margin: data.profit_margin,
    total_receivables: data.total_receivables,
    revenue_delta: data.revenue_delta,
    low_stock_count: data.low_stock_count,
  };

  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-4">

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <DailyBriefingCard snapshot={widgetSnapshot} />
        </div>
        <div className="space-y-4">
          <BusinessHealthCard compact snapshot={widgetSnapshot} />
          <GoalsWidget monthRevenue={data.month_revenue} />
        </div>
      </div>

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">{t('dashboard.liveDashboard')}</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 leading-tight">
            {greeting}, {user?.full_name?.split(' ')[0] || currentStore?.name} 👋
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
            <span className="mx-1.5">·</span>
            {currentStore?.name}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/dashboard/reports"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          >
            <BarChart3 className="h-4 w-4" />
            {t('dashboard.reports')}
          </Link>
          <Link
            href="/dashboard/pos"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-sm active:scale-95"
          >
            <ShoppingCart className="h-4 w-4" />
            {t('dashboard.newSale')}
          </Link>
        </div>
      </div>

      {/* ── 8 KPI Cards — unified grid ───────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 auto-rows-fr">
        <StatCard label={t('dashboard.todaySales')}    value={data.today_count.toString()} sub={fmt(data.today_revenue)}         icon={ShoppingCart}   iconColor="text-blue-600"   iconBg="bg-blue-50"   delta={data.revenue_delta} href="/dashboard/pos" />
        <StatCard label={t('dashboard.monthlyRevenue')}  value={fmt(data.month_revenue)}     sub={t('dashboard.thisMonth')}                      icon={TrendingUp}      iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <StatCard label={t('dashboard.todayProfit')}   value={fmt(data.today_profit)}      sub={`Net · Gross ${fmt(data.today_gross_profit)}`}       icon={DollarSign}     iconColor={data.today_profit >= 0 ? 'text-green-600' : 'text-red-500'}  iconBg={data.today_profit >= 0 ? 'bg-green-50' : 'bg-red-50'} />
        <StatCard label={t('dashboard.monthExpenses')}   value={fmt(data.month_expenses)}    sub={t('dashboard.ratio', { value: data.expense_ratio })}  icon={CreditCard}     iconColor="text-orange-500" iconBg="bg-orange-50" href="/dashboard/accounting" />
        <StatCard label={t('dashboard.receivables')}      value={fmt(data.total_receivables)} sub={t('dashboard.outstanding')}                     icon={Users}          iconColor="text-violet-600" iconBg="bg-violet-50" href="/dashboard/customers" />
        <StatCard label={t('dashboard.lowStock')}        value={data.low_stock_count.toString()} sub={t('dashboard.itemsToRestock')}            icon={AlertTriangle}  iconColor={data.low_stock_count > 0 ? 'text-amber-600' : 'text-slate-400'} iconBg={data.low_stock_count > 0 ? 'bg-amber-50' : 'bg-slate-50'} href="/dashboard/inventory" />
        <StatCard label={t('dashboard.transactions')}     value={data.month_transactions.toString()} sub={t('dashboard.thisMonth')}               icon={Receipt}        iconColor="text-teal-600"   iconBg="bg-teal-50"   href="/dashboard/sales-history" />
        <StatCard label="Gross profit"    value={fmt(data.month_gross_profit)}    sub={`Net ${fmt(data.month_profit)} · ${data.profit_margin}%`}                 icon={Sparkles}       iconColor="text-indigo-600" iconBg="bg-indigo-50" href="/dashboard/reports" />
      </div>

      {/* ── Two-column: Charts | Sidebar ────────────────────────────────
           Left  = Revenue chart + Best Selling Products
           Right = Quick Actions + Active Hours + Health + Payment + Expenses
           Below = Recent Transactions (full-width) + Low Stock
      ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">

        {/* ── Left: Charts ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* Revenue & Profit Trend */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.revenueProfitTrend')}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{t('dashboard.last14days')}</p>
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold shrink-0">
                {(['revenue', 'transactions'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setChartView(v)}
                    className={cn(
                      'px-3 py-1.5 transition-all duration-150',
                      chartView === v ? 'bg-blue-600 text-white' : 'text-slate-500 bg-white hover:bg-slate-50',
                    )}
                  >
                    {v === 'revenue' ? t('dashboard.revenue') : t('dashboard.txns')}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-5 pt-3.5 pb-0">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">{fmt(data.month_revenue)}</span>
                <span className={cn('flex items-center gap-0.5 text-[11px] font-bold', data.revenue_delta >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                  {data.revenue_delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {t('dashboard.vsYesterday', { value: Math.abs(data.revenue_delta) })}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{t('dashboard.totalRevenueThisMonth')}</p>
            </div>
            <div className="px-2 pb-3 pt-3 min-w-0 w-full">
              <SafeChartContainer height={220}>
                <ComposedChart data={data.chart_data} margin={{ top: 5, right: 16, left: -10, bottom: 0 }}>
                  <GradientDefs />
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis yAxisId="left" {...axisProps} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip content={<ChartTooltip formatter={fmt} />} />
                  {chartView === 'revenue' ? (
                    <>
                      <Area yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke={PALETTE.blue} strokeWidth={2.5} fill="url(#grad-blue)" dot={false} activeDot={{ r: 5, fill: PALETTE.blue, stroke: '#fff', strokeWidth: 2 }} />
                      <Area yAxisId="left" type="monotone" dataKey="expenses" name="Expenses" stroke={PALETTE.orange} strokeWidth={2} fill="url(#grad-orange)" dot={false} activeDot={{ r: 4 }} />
                      <Line yAxisId="left" type="monotone" dataKey="profit" name="Net Profit" stroke={PALETTE.emerald} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </>
                  ) : (
                    <Bar yAxisId="left" dataKey="transactions" name="Transactions" fill="url(#bar-grad-violet)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  )}
                </ComposedChart>
              </SafeChartContainer>
              {chartView === 'revenue' && (
                <div className="flex justify-center gap-5 pt-1">
                  {[{ label: t('dashboard.revenue'), color: PALETTE.blue }, { label: t('dashboard.expenses'), color: PALETTE.orange }, { label: t('dashboard.netProfit'), color: PALETTE.emerald }].map(({ label, color }) => (
                    <span key={label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Best Selling Products */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.bestSelling')}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{t('dashboard.byRevenueThisMonth')}</p>
              </div>
              <Link href="/dashboard/inventory" className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium shrink-0">
                {t('dashboard.viewAll')} <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            {data.top_products.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Package className="h-5 w-5 opacity-30" />
                <p className="text-sm">{t('dashboard.noProductSales')}</p>
              </div>
            ) : (
              <div>
                {data.top_products.slice(0, 5).map((p, i) => {
                  const maxRevenue = data.top_products[0]?.revenue || 1;
                  const pct = Math.round((p.revenue / maxRevenue) * 100);
                  const rankColors = ['text-amber-500', 'text-slate-400', 'text-orange-400', 'text-slate-300', 'text-slate-300'];
                  return (
                    <div key={p.name} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 transition-colors border-b border-slate-50 last:border-0">
                      <span className={cn('text-xs font-black w-5 text-center tabular-nums shrink-0', rankColors[i] || 'text-slate-300')}>
                        #{i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                            {t('dashboard.unitsSold', { count: p.qty })}
                            {p.baseQty !== p.qty ? ` · ${p.baseQty} base` : ''}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-slate-900 shrink-0 tabular-nums">{fmt(p.revenue)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Transactions — flex-1 fills remaining left-column height */}
          <div className="flex-1 rounded-2xl bg-white border border-slate-100 shadow-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <Receipt className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.recentTransactions')}</h3>
                  <p className="text-[11px] text-slate-400">{t('dashboard.latestSalesActivity')}</p>
                </div>
              </div>
              <Link href="/dashboard/sales-history" className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium shrink-0">
                {t('dashboard.viewAll')} <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="text-left px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{t('dashboard.invoice')}</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden sm:table-cell">{t('dashboard.customer')}</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden md:table-cell">{t('dashboard.method')}</th>
                    <th className="text-right px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{t('dashboard.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_sales.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-slate-400 text-sm">
                        {t('dashboard.noSalesYet')}{' '}
                        <Link href="/dashboard/pos" className="text-blue-600 underline">{t('dashboard.startSelling')}</Link>
                      </td>
                    </tr>
                  ) : (data.recent_sales as unknown as RecentSale[]).map((sale) => (
                    <tr key={sale.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-2.5">
                        <p className="font-mono text-xs font-bold text-slate-700">{sale.invoice_number}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {sale.sale_date ? format(new Date(sale.sale_date), 'MMM d, h:mm a') : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell text-slate-600 text-sm">
                        {sale.customer?.full_name || <span className="text-slate-400 italic text-xs">{t('dashboard.walkIn')}</span>}
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{
                            background: `${PM_COLORS[(sale.payment_method || 'cash').toUpperCase()] || PALETTE.blue}18`,
                            color: PM_COLORS[(sale.payment_method || 'cash').toUpperCase()] || PALETTE.blue,
                          }}
                        >
                          {sale.payment_method || 'cash'}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right font-bold text-slate-900 tabular-nums">{fmt(sale.total_amount || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Right Sidebar ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* Quick Actions */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50">
              <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.quickActions')}</h3>
            </div>
            <div className="grid grid-cols-3 p-2">
              {QUICK_ACTIONS.map((action) => (
                <QuickAction key={action.href} {...action} />
              ))}
            </div>
          </div>

          {/* Most Active Hours */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.activeHours')}</h3>
              <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{t('dashboard.peak')}: {peakHour.label}</span>
            </div>
            <div className="px-1 pt-2 pb-2 min-w-0 w-full">
              <SafeChartContainer height={100}>
                <BarChart data={data.sales_by_hour} margin={{ top: 2, right: 6, left: -30, bottom: 0 }}>
                  <GradientDefs />
                  <XAxis dataKey="label" {...axisProps} interval={5} />
                  <Tooltip content={<ChartTooltip formatter={fmt} />} />
                  <Bar dataKey="revenue" name="Revenue" radius={[2, 2, 0, 0]} maxBarSize={7}>
                    {data.sales_by_hour.map((entry, i) => (
                      <Cell key={i} fill={entry.label === peakHour.label ? PALETTE.blue : '#e2e8f0'} />
                    ))}
                  </Bar>
                </BarChart>
              </SafeChartContainer>
            </div>
          </div>

          {/* Financial Health */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50">
              <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.financialHealth')}</h3>
            </div>
            <div className="flex flex-col items-center gap-3 py-4 px-4">
              {/* Single-ring SVG gauge — profit margin */}
              <svg viewBox="0 0 100 100" width="128" height="128" style={{ display: 'block' }}>
                {/* Background track */}
                <circle cx="50" cy="50" r="38" fill="none" stroke="#f1f5f9" strokeWidth="9" />
                {/* Profit margin arc */}
                {data.profit_margin > 0 && (
                  <circle
                    cx="50" cy="50" r="38"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={`${(Math.min(data.profit_margin, 100) / 100) * 238.76} 238.76`}
                    transform="rotate(-90 50 50)"
                    style={{ transition: 'stroke-dasharray 0.9s ease' }}
                  />
                )}
                {/* Expense ratio arc (inner) */}
                {data.expense_ratio > 0 && (
                  <circle
                    cx="50" cy="50" r="27"
                    fill="none"
                    stroke="#fb923c"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${(Math.min(data.expense_ratio, 100) / 100) * 169.65} 169.65`}
                    transform="rotate(-90 50 50)"
                    style={{ transition: 'stroke-dasharray 0.9s ease' }}
                  />
                )}
                {/* Center: margin % */}
                <text
                  x="50" y="46"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 18, fontWeight: 800, fill: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                >
                  {data.profit_margin}%
                </text>
                {/* Center: label */}
                <text
                  x="50" y="60"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 7, fontWeight: 600, fill: '#94a3b8', letterSpacing: '0.1em', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                >
                  {t('dashboard.margin')}
                </text>
              </svg>

              {/* Legend */}
              <div className="flex items-center justify-center gap-5 w-full">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  {t('dashboard.marginLabel')} {data.profit_margin}%
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                  <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" />
                  {t('dashboard.expensesLabel')} {data.expense_ratio}%
                </span>
              </div>
            </div>
          </div>

          {/* Payment Methods */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50">
              <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.paymentMethods')}</h3>
            </div>
            {data.payment_data.length > 0 ? (
              <div className="px-4 py-3">
                <div className="relative h-[110px] min-w-0 w-full">
                  <SafeChartContainer height={110}>
                    <PieChart>
                      <GradientDefs />
                      <Pie data={data.payment_data} cx="50%" cy="50%" innerRadius={32} outerRadius={50} paddingAngle={3} dataKey="value" animationDuration={800}>
                        {data.payment_data.map((entry, i) => (
                          <Cell key={i} fill={PM_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip formatter={fmt} />} />
                    </PieChart>
                  </SafeChartContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-xs font-bold text-slate-700 leading-none">
                      {fmt(data.payment_data.reduce((s, e) => s + Number(e.value), 0))}
                    </p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{t('dashboard.total')}</p>
                  </div>
                </div>
                <div className="mt-2 space-y-1.5">
                  {data.payment_data.slice(0, 5).map((entry, i) => {
                    const total = data.payment_data.reduce((s, e) => s + Number(e.value), 0);
                    const pct = total > 0 ? Math.round((Number(entry.value) / total) * 100) : 0;
                    const color = PM_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length];
                    return (
                      <div key={entry.name} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-xs text-slate-600 flex-1 truncate">{entry.name}</span>
                        <span className="text-xs font-bold text-slate-700 tabular-nums">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-6">{t('empty.sales')}</p>
            )}
          </div>

          {/* Active Promotions */}
          {activePromos.length > 0 && (
            <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-blue-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <Tag className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-blue-900 text-sm">{t('dashboard.activePromotions')}</h3>
                </div>
                <Link href="/dashboard/promotions" className="text-[11px] text-blue-600 hover:underline font-semibold">{t('dashboard.viewAll')}</Link>
              </div>
              <div className="divide-y divide-blue-100">
                {activePromos.map((p) => {
                  const daysLeft = p.end_date ? differenceInDays(new Date(p.end_date), new Date()) : null;
                  return (
                    <div key={p.id} className="flex items-center gap-2.5 px-4 py-2.5">
                      <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        {p.discount_type === 'percentage' ? <Percent className="h-3.5 w-3.5 text-blue-600" /> : <DollarSign className="h-3.5 w-3.5 text-blue-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-blue-900 truncate">{p.name}</p>
                        <p className="text-[10px] text-blue-600">
                          {p.discount_value}{p.discount_type === 'percentage' ? '%' : ''} {t('dashboard.off')} · {p.applies_to === 'all' ? t('dashboard.storeWide') : p.applies_to}
                        </p>
                      </div>
                      {daysLeft !== null && daysLeft >= 0 && (
                        <span className={cn('text-[10px] font-bold shrink-0', daysLeft <= 3 ? 'text-red-600' : 'text-blue-500')}>
                          {daysLeft === 0 ? t('dashboard.today') : t('dashboard.daysShort', { days: daysLeft })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Expense Summary — flex-1 fills remaining sidebar height */}
          <div className="flex-1 rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                <CreditCard className="h-3.5 w-3.5 text-orange-500" />
              </div>
              <h3 className="font-semibold text-slate-900 text-sm">{t('dashboard.expenseSummary')}</h3>
            </div>
            {data.expense_data.length > 0 && (
              <div className="px-1 pt-2 pb-1 min-w-0 w-full">
                <SafeChartContainer height={130}>
                  <BarChart data={data.expense_data} margin={{ top: 4, right: 8, left: -22, bottom: 32 }}>
                    <GradientDefs />
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} angle={-30} textAnchor="end" height={40} interval={0} tick={{ fontSize: 8, fill: '#94a3b8' }} />
                    <YAxis {...axisProps} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                    <Tooltip content={<ChartTooltip formatter={fmt} />} />
                    <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={24}>
                      {data.expense_data.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </SafeChartContainer>
              </div>
            )}
            <div className={cn('px-4 py-3 space-y-2', data.expense_data.length > 0 && 'border-t border-slate-50')}>
              {[
                { label: t('dashboard.totalExpenses'), value: fmt(data.month_expenses), color: 'text-slate-900' },
                { label: 'COGS', value: fmt(data.month_cogs), color: 'text-slate-600' },
                { label: t('dashboard.netProfit'),     value: fmt(data.month_profit),   color: data.month_profit >= 0 ? 'text-emerald-600' : 'text-red-500' },
                { label: t('dashboard.expenseRatio'),  value: `${data.expense_ratio}%`, color: 'text-orange-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className={cn('text-xs font-bold tabular-nums', color)}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Low Stock Alert ───────────────────────────────────────────── */}
      {data.low_stock_count > 0 && (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-amber-100">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <Zap className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-900 text-sm">{t('dashboard.lowStockAlert')}</h3>
                <p className="text-[11px] text-amber-600">{t('dashboard.productsNeedAttention', { count: data.low_stock_count })}</p>
              </div>
            </div>
            <Link href="/dashboard/inventory" className="text-xs text-amber-700 hover:underline font-semibold flex items-center gap-1">
              {t('dashboard.manage')} <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-4">
            {(data.low_stock_list as unknown as LowStockItem[]).map((p) => {
              const pct = p.min_stock_level > 0 ? Math.min((p.stock_quantity / p.min_stock_level) * 100, 100) : 0;
              return (
                <div key={p.id} className="rounded-xl bg-white border border-amber-100 p-3">
                  <p className="text-xs font-semibold text-slate-800 truncate">{p.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded-full', p.stock_quantity === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                      {p.stock_quantity} {p.unit || t('dashboard.pcs')}
                    </span>
                    <Clock className="h-3 w-3 text-amber-400" />
                  </div>
                  <p className="text-[10px] text-amber-600/80 mt-1">
                    Min {p.min_stock_level} {p.unit || t('dashboard.pcs')}
                  </p>
                  <div className="h-1 w-full rounded-full bg-amber-100 mt-2">
                    <div className={cn('h-full rounded-full', p.stock_quantity === 0 ? 'bg-red-500' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
