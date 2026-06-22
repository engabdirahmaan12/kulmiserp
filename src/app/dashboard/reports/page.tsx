'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BarChart3,
  DollarSign,
  Package,
  Percent,
  Receipt,
  Search,
  ShoppingCart,
  Tag,
} from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/components/layout/PageShell';
import { cn } from '@/lib/utils';
import { inputSoft } from '@/lib/ui-classes';
import { PALETTE } from '@/lib/chart-utils';
import type { ReportsChartsPanelProps } from '@/components/reports/ReportsChartsPanel';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  ReportPageHeader,
  ReportExportActions,
  ReportFilterStrip,
  ReportTabBar,
  ReportKpiGrid,
  ReportKpiCard,
  ReportTableShell,
  reportTableHead,
  reportTableHeadRight,
} from '@/components/reports/ReportLayout';

const ReportsChartsPanel = dynamic(
  () => import('@/components/reports/ReportsChartsPanel'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-[360px] w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    ),
  },
);

function getGreetingKey(): 'reports.greetingMorning' | 'reports.greetingAfternoon' | 'reports.greetingEvening' {
  const h = new Date().getHours();
  if (h < 12) return 'reports.greetingMorning';
  if (h < 17) return 'reports.greetingAfternoon';
  return 'reports.greetingEvening';
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState(startOfMonth(new Date()).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [activeTab, setActiveTab] = useState('overview');
  const [tableSearch, setTableSearch] = useState('');
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();

  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 0 }).format(n);
  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);

  const { data: salesReport, isLoading } = useQuery({
    queryKey: ['sales-report', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('sales')
        .select('id, invoice_number, total_amount, subtotal, discount_amount, tax_amount, payment_method, sale_date, status, customer:customers(full_name)')
        .eq('store_id', currentStore!.id)
        .eq('status', 'completed')
        .gte('sale_date', dateFrom)
        .lte('sale_date', dateTo + 'T23:59:59')
        .order('sale_date', { ascending: false });
      return data || [];
    },
    enabled: !!currentStore,
  });

  const { data: periodExpenses = 0 } = useQuery({
    queryKey: ['report-expenses', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('expenses')
        .select('amount')
        .eq('store_id', currentStore!.id)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo);
      return (data ?? []).reduce((s, e) => s + (e.amount || 0), 0);
    },
    enabled: !!currentStore,
  });

  const { data: productReport } = useQuery({
    queryKey: ['product-report', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('sale_items')
        .select('product_id, product_name, quantity, base_qty, sale_unit_qty, sale_unit_code, subtotal, cost_price, sale:sales!inner(store_id, sale_date, status)')
        .eq('sale.store_id', currentStore!.id)
        .eq('sale.status', 'completed')
        .gte('sale.sale_date', dateFrom)
        .lte('sale.sale_date', dateTo + 'T23:59:59');
      if (!data) return [];
      const map: Record<string, {
        name: string;
        saleQty: number;
        baseQty: number;
        revenue: number;
        cost: number;
        unitHint: string;
      }> = {};
      for (const item of data) {
        const key = item.product_name;
        if (!map[key]) {
          map[key] = { name: item.product_name, saleQty: 0, baseQty: 0, revenue: 0, cost: 0, unitHint: '' };
        }
        const base = Number(item.base_qty ?? item.quantity ?? 0);
        const saleQty = Number(item.sale_unit_qty ?? item.quantity ?? 0);
        map[key].saleQty += saleQty;
        map[key].baseQty += base;
        map[key].revenue += item.subtotal || 0;
        map[key].cost += (item.cost_price || 0) * base;
        if (item.sale_unit_code && !map[key].unitHint.includes(item.sale_unit_code)) {
          map[key].unitHint = item.sale_unit_code;
        }
      }
      return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
    },
    enabled: !!currentStore,
  });

  const { data: saleLineExport = [] } = useQuery({
    queryKey: ['sale-lines-export', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('sale_items')
        .select(`
          product_name, product_sku, sale_unit_code, sale_unit_qty, base_qty, quantity,
          unit_price, cost_price, subtotal, price_tier,
          sale:sales!inner(invoice_number, sale_date, status, store_id)
        `)
        .eq('sale.store_id', currentStore!.id)
        .eq('sale.status', 'completed')
        .gte('sale.sale_date', dateFrom)
        .lte('sale.sale_date', dateTo + 'T23:59:59');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!currentStore,
  });

  const dailyData = useMemo(() => {
    if (!salesReport) return [];
    const map: Record<string, { revenue: number; transactions: number; discount: number; tax: number }> = {};
    for (const s of salesReport) {
      const d = s.sale_date.split('T')[0];
      if (!map[d]) map[d] = { revenue: 0, transactions: 0, discount: 0, tax: 0 };
      map[d].revenue += s.total_amount;
      map[d].transactions += 1;
      map[d].discount += s.discount_amount || 0;
      map[d].tax += s.tax_amount || 0;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date: format(new Date(date), 'MMM d'),
        revenue: v.revenue,
        transactions: v.transactions,
        discount: v.discount,
        tax: v.tax,
        net: v.revenue - v.discount,
      }));
  }, [salesReport]);

  const pmData = useMemo(() => {
    if (!salesReport) return [];
    return Object.entries(
      salesReport.reduce((acc, s) => {
        const pm = (s.payment_method || 'cash').toUpperCase();
        acc[pm] = (acc[pm] || 0) + s.total_amount;
        return acc;
      }, {} as Record<string, number>),
    ).map(([name, value]) => ({ name, value }));
  }, [salesReport]);

  const hourlyData = useMemo(() => {
    if (!salesReport) return [];
    const hourMap: Record<number, { count: number; revenue: number }> = {};
    for (let h = 0; h < 24; h++) hourMap[h] = { count: 0, revenue: 0 };
    for (const s of salesReport) {
      const h = new Date(s.sale_date).getHours();
      hourMap[h].count += 1;
      hourMap[h].revenue += s.total_amount;
    }
    const hourLabel = (h: number) => {
      if (h === 0) return '12a';
      if (h < 12) return `${h}a`;
      if (h === 12) return '12p';
      return `${h - 12}p`;
    };
    return Object.entries(hourMap).map(([h, v]) => ({
      hour: Number(h),
      label: hourLabel(Number(h)),
      count: v.count,
      revenue: v.revenue,
    }));
  }, [salesReport]);

  const peakHour = hourlyData.reduce(
    (best, h) => (h.revenue > best.revenue ? h : best),
    hourlyData[0] ?? { label: '—', revenue: 0 },
  );

  const totals = salesReport
    ? {
        count: salesReport.length,
        revenue: salesReport.reduce((s, r) => s + r.total_amount, 0),
        discount: salesReport.reduce((s, r) => s + (r.discount_amount || 0), 0),
        tax: salesReport.reduce((s, r) => s + (r.tax_amount || 0), 0),
      }
    : null;

  const totalCogs = productReport?.reduce((s, p) => s + p.cost, 0) ?? 0;
  const grossProfit = productReport?.reduce((s, p) => s + (p.revenue - p.cost), 0) ?? 0;
  const netProfit = grossProfit - periodExpenses;
  const grossMarginPct =
    totals && totals.revenue > 0 ? Math.round((grossProfit / totals.revenue) * 100) : 0;
  const netMarginPct =
    totals && totals.revenue > 0 ? Math.round((netProfit / totals.revenue) * 100) : 0;
  const avgOrder = totals && totals.count > 0 ? totals.revenue / totals.count : 0;
  const discountPct =
    totals && totals.revenue > 0
      ? Math.round((totals.discount / totals.revenue) * 100)
      : 0;

  const radialData = totals
    ? [
        { name: 'Gross Margin', value: grossMarginPct, fill: PALETTE.emerald },
        { name: 'Discounts', value: discountPct, fill: PALETTE.orange },
      ]
    : [];

  const revenueSparkline = dailyData.slice(-7).map((d) => d.revenue);
  const ordersSparkline = dailyData.slice(-7).map((d) => d.transactions);

  const chartProps: ReportsChartsPanelProps = {
    dailyData,
    pmData,
    productReport,
    hourlyData,
    peakHourLabel: peakHour.label,
    totals: totals ? { revenue: totals.revenue, discount: totals.discount } : null,
    marginPct: grossMarginPct,
    radialData,
    fmt,
    fmtC,
  };

  const filteredSales = useMemo(() => {
    if (!salesReport) return [];
    const q = tableSearch.toLowerCase();
    if (!q) return salesReport;
    return salesReport.filter(
      (s) =>
        s.invoice_number?.toLowerCase().includes(q) ||
        (s.customer as unknown as { full_name: string })?.full_name?.toLowerCase().includes(q) ||
        s.payment_method?.toLowerCase().includes(q),
    );
  }, [salesReport, tableSearch]);

  const buildCsv = () => {
    if (!salesReport) return '';
    const rows = salesReport.map((s) => [
      s.invoice_number,
      format(new Date(s.sale_date), 'yyyy-MM-dd'),
      (s.customer as unknown as { full_name: string })?.full_name || 'Walk-in',
      s.payment_method,
      s.total_amount.toFixed(2),
    ]);
    return [['Invoice', 'Date', 'Customer', 'Payment', 'Amount'], ...rows]
      .map((r) => r.join(','))
      .join('\n');
  };

  const buildProductsCsv = () => {
    if (!productReport?.length) return '';
    const rows = productReport.map((p) => [
      p.name,
      p.saleQty,
      p.baseQty,
      p.unitHint ?? '',
      p.revenue.toFixed(2),
      p.cost.toFixed(2),
      (p.revenue - p.cost).toFixed(2),
    ]);
    return [
      ['Product', 'Units Sold', 'Base Qty', 'Unit', 'Revenue', 'COGS', 'Profit'],
      ...rows,
    ].map((r) => r.join(',')).join('\n');
  };

  const buildLineItemsCsv = () => {
    if (!saleLineExport.length) return '';
    const rows = saleLineExport.map((row) => {
      const sale = row.sale as { invoice_number?: string; sale_date?: string };
      const baseQty = Number(row.base_qty ?? row.quantity ?? 0);
      const cogs = (Number(row.cost_price) || 0) * baseQty;
      return [
        sale?.invoice_number ?? '',
        sale?.sale_date ? format(new Date(sale.sale_date), 'yyyy-MM-dd') : '',
        row.product_name,
        row.product_sku ?? '',
        row.sale_unit_qty ?? row.quantity ?? '',
        row.sale_unit_code ?? '',
        baseQty,
        row.price_tier ?? 'retail',
        Number(row.unit_price).toFixed(2),
        Number(row.subtotal).toFixed(2),
        cogs.toFixed(2),
        (Number(row.subtotal) - cogs).toFixed(2),
      ];
    });
    return [
      ['Invoice', 'Date', 'Product', 'SKU', 'Qty Sold', 'Unit', 'Base Qty', 'Tier', 'Unit Price', 'Revenue', 'COGS', 'Profit'],
      ...rows,
    ].map((r) => r.join(',')).join('\n');
  };

  const downloadCsv = (content: string, filename: string) => {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  const exportCSV = () => downloadCsv(buildCsv(), `sales-${dateFrom}-to-${dateTo}.csv`);

  const exportExcel = () => {
    const csv = buildCsv();
    if (!csv) return;
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales-${dateFrom}-to-${dateTo}.xls`;
    a.click();
  };

  const exportProductsCsv = () => downloadCsv(buildProductsCsv(), `products-${dateFrom}-to-${dateTo}.csv`);
  const exportLineItemsCsv = () => downloadCsv(buildLineItemsCsv(), `line-items-${dateFrom}-to-${dateTo}.csv`);

  const printReport = () => {
    window.print();
  };

  const QUICK_RANGES = [
    {
      label: t('reports.rangeToday'),
      fn: () => {
        const today = new Date().toISOString().split('T')[0];
        setDateFrom(today);
        setDateTo(today);
      },
    },
    {
      label: t('reports.range7Days'),
      fn: () => {
        setDateFrom(subDays(new Date(), 7).toISOString().split('T')[0]);
        setDateTo(new Date().toISOString().split('T')[0]);
      },
    },
    {
      label: t('reports.rangeThisMonth'),
      fn: () => {
        setDateFrom(startOfMonth(new Date()).toISOString().split('T')[0]);
        setDateTo(new Date().toISOString().split('T')[0]);
      },
    },
  ];

  const firstName = user?.full_name?.split(' ')[0] || 'there';

  return (
    <PageShell className="print:p-0 pb-20 space-y-3">
      <div id="report-print-area" className="space-y-3 print:space-y-3">
        <ReportPageHeader
          greeting={`${t(getGreetingKey())}, ${firstName}`}
          title={t('reports.title')}
          description={t('reports.description')}
          actions={
            <ReportExportActions
              disabled={!salesReport?.length}
              onExportCsv={exportCSV}
              onExportExcel={exportExcel}
              onExportProducts={productReport?.length ? exportProductsCsv : undefined}
              onExportLineItems={saleLineExport.length ? exportLineItemsCsv : undefined}
              onPrint={printReport}
            />
          }
        />

        <ReportFilterStrip>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-500 shrink-0 dark:text-slate-400">{t('reports.labelFrom')}</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={cn(inputSoft, 'w-36 text-sm h-9 rounded-xl dark:bg-slate-800 dark:border-slate-700')}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-500 shrink-0 dark:text-slate-400">{t('reports.labelTo')}</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={cn(inputSoft, 'w-36 text-sm h-9 rounded-xl dark:bg-slate-800 dark:border-slate-700')}
                />
              </div>
              <div className="flex gap-1.5">
                {QUICK_RANGES.map(({ label, fn }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={fn}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-600 hover:text-white transition-all duration-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-teal-600"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(activeTab === 'sales' || activeTab === 'products') && (
              <div className="relative w-full lg:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder={t('reports.searchPlaceholder')}
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="h-9 pl-9 rounded-xl text-sm dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            )}
          </div>
        </ReportFilterStrip>

        <ReportKpiGrid>
          <ReportKpiCard
            label={t('reports.kpiRevenue')}
            value={totals ? fmtC(totals.revenue) : '—'}
            icon={DollarSign}
            accent="emerald"
            sparkline={revenueSparkline}
            loading={isLoading}
          />
          <ReportKpiCard
            label={t('reports.kpiGrossProfit')}
            value={productReport ? fmtC(grossProfit) : '—'}
            sub={productReport ? t('reports.kpiGrossSub', { cogs: fmtC(totalCogs), pct: grossMarginPct }) : undefined}
            icon={BarChart3}
            accent="blue"
            loading={isLoading}
          />
          <ReportKpiCard
            label={t('reports.kpiNetProfit')}
            value={productReport ? fmtC(netProfit) : '—'}
            sub={productReport ? t('reports.kpiNetSub', { exp: fmtC(periodExpenses), pct: netMarginPct }) : undefined}
            icon={DollarSign}
            accent="emerald"
            loading={isLoading}
          />
          <ReportKpiCard
            label={t('reports.kpiTotalOrders')}
            value={totals ? fmt(totals.count) : '—'}
            icon={ShoppingCart}
            accent="violet"
            sparkline={ordersSparkline}
            loading={isLoading}
          />
          <ReportKpiCard
            label={t('reports.kpiAvgOrder')}
            value={totals ? fmtC(avgOrder) : '—'}
            icon={Receipt}
            accent="teal"
            loading={isLoading}
          />
          <ReportKpiCard
            label={t('reports.kpiDiscounts')}
            value={totals ? fmtC(totals.discount) : '—'}
            icon={Tag}
            accent="orange"
            loading={isLoading}
          />
          <ReportKpiCard
            label={t('reports.kpiTax')}
            value={totals ? fmtC(totals.tax) : '—'}
            sub={totals ? t('reports.kpiTaxSub', { pct: discountPct }) : undefined}
            icon={Percent}
            accent="rose"
            loading={isLoading}
          />
        </ReportKpiGrid>

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900/80">
          <div className="px-4 md:px-5 pt-1 border-b border-slate-50 dark:border-slate-800/80">
            <ReportTabBar
              tabs={[
                { id: 'overview', label: t('reports.tabOverview') },
                { id: 'sales', label: t('reports.tabSales') },
                { id: 'products', label: t('reports.tabProducts') },
              ]}
              active={activeTab}
              onChange={setActiveTab}
            />
          </div>

          <div className="p-3 md:p-4">
            {activeTab === 'overview' && <ReportsChartsPanel {...chartProps} />}

            {activeTab === 'sales' && (
              <ReportTableShell className="border-0 shadow-none rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={reportTableHead}>{t('reports.colInvoice')}</th>
                      <th className={cn(reportTableHead, 'hidden sm:table-cell')}>{t('reports.colDate')}</th>
                      <th className={cn(reportTableHead, 'hidden md:table-cell')}>{t('reports.colCustomer')}</th>
                      <th className={cn(reportTableHead, 'hidden md:table-cell')}>{t('reports.colPayment')}</th>
                      <th className={reportTableHeadRight}>{t('reports.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {isLoading
                      ? Array.from({ length: 6 }).map((_, i) => (
                          <tr key={i}>
                            <td colSpan={5} className="px-4 py-2">
                              <Skeleton className="h-7 rounded-lg" />
                            </td>
                          </tr>
                        ))
                      : filteredSales.map((sale) => (
                          <tr
                            key={sale.id}
                            className="hover:bg-slate-50/80 transition-colors dark:hover:bg-slate-800/50"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                              {sale.invoice_number}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 text-xs hidden sm:table-cell">
                              {format(new Date(sale.sale_date), 'MMM d, h:mm a')}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell dark:text-slate-400">
                              {(sale.customer as unknown as { full_name: string })?.full_name || t('reports.walkIn')}
                            </td>
                            <td className="px-4 py-2.5 hidden md:table-cell">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase font-medium dark:bg-slate-800 dark:text-slate-400">
                                {sale.payment_method}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums dark:text-white">
                              {fmtC(sale.total_amount)}
                            </td>
                          </tr>
                        ))}
                    {!isLoading && filteredSales.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-slate-400">
                          {t('reports.noSales')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ReportTableShell>
            )}

            {activeTab === 'products' && (
              <ReportTableShell className="border-0 shadow-none rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={reportTableHead}>#</th>
                      <th className={reportTableHead}>{t('reports.colProduct')}</th>
                      <th className={reportTableHeadRight}>{t('reports.colUnitsSold')}</th>
                      <th className={cn(reportTableHeadRight, 'hidden md:table-cell')}>{t('reports.colBaseQty')}</th>
                      <th className={reportTableHeadRight}>{t('reports.colRevenue')}</th>
                      <th className={cn(reportTableHeadRight, 'hidden sm:table-cell')}>{t('reports.colCogs')}</th>
                      <th className={cn(reportTableHeadRight, 'hidden sm:table-cell')}>{t('reports.colProfit')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {productReport
                      ?.filter((p) => !tableSearch || p.name.toLowerCase().includes(tableSearch.toLowerCase()))
                      .map((p, i) => (
                        <tr
                          key={p.name}
                          className="hover:bg-slate-50/80 transition-colors dark:hover:bg-slate-800/50"
                        >
                          <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-200">
                            <span className="flex items-center gap-2">
                              <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              {p.name}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums dark:text-slate-400">
                            {fmt(p.saleQty)}
                            {p.unitHint ? <span className="text-[10px] text-slate-400 ml-1">{p.unitHint}</span> : null}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums hidden md:table-cell dark:text-slate-400">
                            {fmt(p.baseQty)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtC(p.revenue)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500 hidden sm:table-cell tabular-nums">
                            {fmtC(p.cost)}
                          </td>
                          <td
                            className={cn(
                              'px-4 py-2.5 text-right font-semibold hidden sm:table-cell tabular-nums',
                              p.revenue - p.cost >= 0 ? 'text-emerald-600' : 'text-red-600',
                            )}
                          >
                            {fmtC(p.revenue - p.cost)}
                          </td>
                        </tr>
                      ))}
                    {!productReport?.length && (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-slate-400">
                          {t('reports.noProducts')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ReportTableShell>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
