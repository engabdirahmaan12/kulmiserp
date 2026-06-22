'use client';

import { memo, useState } from 'react';
import {
  Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Line, ComposedChart,
} from 'recharts';
import {
  CHART_COLORS, PM_COLORS, PALETTE, ChartTooltip, GradientDefs,
  ChartViewToggle, ChartEmpty,
} from '@/lib/chart-utils';
import { ReportWidget } from './ReportLayout';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

type ChartView = 'revenue' | 'transactions' | 'breakdown';

export interface DailyRow {
  date: string;
  revenue: number;
  transactions: number;
  discount: number;
  tax: number;
  net: number;
}

export interface PmRow {
  name: string;
  value: number;
}

export interface ProductRow {
  name: string;
  saleQty: number;
  baseQty: number;
  revenue: number;
  cost: number;
  unitHint?: string;
}

export interface HourlyRow {
  hour: number;
  label: string;
  count: number;
  revenue: number;
}

export interface ReportsChartsPanelProps {
  dailyData: DailyRow[];
  pmData: PmRow[];
  productReport: ProductRow[] | undefined;
  hourlyData: HourlyRow[];
  peakHourLabel: string;
  totals: { revenue: number; discount: number } | null;
  marginPct: number;
  radialData: { name: string; value: number; fill: string }[];
  fmt: (n: number) => string;
  fmtC: (n: number) => string;
}

const BOTTOM_CHART_H = 188;

function ReportsChartsPanelInner({
  dailyData,
  pmData,
  productReport,
  hourlyData,
  peakHourLabel,
  totals,
  marginPct,
  fmt,
  fmtC,
}: ReportsChartsPanelProps) {
  const { t } = useTranslation();
  const [chartView, setChartView] = useState<ChartView>('revenue');

  const pmTotal = pmData.reduce((s, e) => s + Number(e.value), 0);
  const topProduct = productReport?.[0];

  return (
    <div className="space-y-4">
      {/* Row 1: main chart + sidebar — equal column heights */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_252px] gap-4 items-stretch">
        <ReportWidget
          title={t('reportsCharts.salesPerformance')}
          subtitle={t('reportsCharts.salesSubtitle')}
          menu
          fill
          compact
          action={
            <ChartViewToggle<ChartView>
              value={chartView}
              onChange={setChartView}
              options={[
                { value: 'revenue', label: t('reportsCharts.viewRevenue') },
                { value: 'transactions', label: t('reportsCharts.viewOrders') },
                { value: 'breakdown', label: t('reportsCharts.viewBreakdown') },
              ]}
            />
          }
        >
          {dailyData.length > 0 ? (
            <div className="flex flex-1 flex-col min-h-[300px]">
              <div className="flex-1 min-h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <GradientDefs />
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                    />
                    <Tooltip content={<ChartTooltip formatter={chartView === 'transactions' ? fmt : fmtC} />} />
                    {chartView === 'revenue' && (
                      <>
                        <defs>
                          <linearGradient id="reports-area-blue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={PALETTE.blue} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={PALETTE.blue} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="revenue"
                          name="Revenue"
                          stroke={PALETTE.blue}
                          strokeWidth={2.5}
                          fill="url(#reports-area-blue)"
                          dot={false}
                          activeDot={{ r: 5, fill: PALETTE.blue, stroke: '#fff', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="transactions"
                          name="Orders"
                          stroke={PALETTE.violet}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: PALETTE.violet }}
                        />
                      </>
                    )}
                    {chartView === 'transactions' && (
                      <Bar
                        dataKey="transactions"
                        name="Orders"
                        fill="url(#bar-grad-indigo)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={36}
                      />
                    )}
                    {chartView === 'breakdown' && (
                      <>
                        <Bar dataKey="net" name="Net" stackId="a" fill={PALETTE.emerald} maxBarSize={32} />
                        <Bar dataKey="discount" name="Discount" stackId="a" fill={PALETTE.orange} maxBarSize={32} />
                        <Bar dataKey="tax" name="Tax" stackId="a" fill={PALETTE.violet} radius={[4, 4, 0, 0]} maxBarSize={32} />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {chartView === 'revenue' && (
                <div className="flex justify-center gap-6 pt-1 pb-0.5 text-xs shrink-0">
                  {[
                    { label: t('reportsCharts.viewRevenue'), color: PALETTE.blue },
                    { label: t('reportsCharts.viewOrders'), color: PALETTE.violet },
                  ].map(({ label, color }) => (
                    <span key={label} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ChartEmpty />
          )}
        </ReportWidget>

        {/* Sidebar — stretches to match chart height */}
        <div className="flex flex-col gap-3 min-h-0">
          <ReportWidget title="Revenue Health" subtitle="Net margin overview" fill compact className="flex-1">
            {totals && totals.revenue > 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-1">
                <svg viewBox="0 0 100 100" width="108" height="108" style={{ display: 'block' }}>
                  <circle cx="50" cy="50" r="38" fill="none" stroke="#f1f5f9" strokeWidth="9" className="dark:stroke-slate-800" />
                  {marginPct > 0 && (
                    <circle
                      cx="50" cy="50" r="38"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={`${(Math.min(marginPct, 100) / 100) * 238.76} 238.76`}
                      transform="rotate(-90 50 50)"
                    />
                  )}
                  <text
                    x="50" y="46"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontSize: 17, fontWeight: 800, fill: '#0f172a', fontFamily: 'system-ui, sans-serif' }}
                  >
                    {marginPct}%
                  </text>
                  <text
                    x="50" y="60"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontSize: 7, fontWeight: 600, fill: '#94a3b8', letterSpacing: '0.1em', fontFamily: 'system-ui, sans-serif' }}
                  >
                    NET
                  </text>
                </svg>
                <div className="w-full space-y-1.5 text-xs px-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">{t('reportsCharts.revenue')}</span>
                    <span className="font-semibold tabular-nums text-right">{fmtC(totals.revenue)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">{t('reportsCharts.discounts')}</span>
                    <span className="font-semibold tabular-nums text-orange-600 text-right">{fmtC(totals.discount)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <ChartEmpty message={t('reportsCharts.noRevenue')} />
            )}
          </ReportWidget>

          {topProduct && (
            <ReportWidget title={t('reportsCharts.topProduct')} subtitle={t('reportsCharts.topProductSubtitle')} compact className="shrink-0">
              <div className="space-y-2">
                <p className="font-semibold text-sm text-slate-900 truncate dark:text-white">{topProduct.name}</p>
                <div className="space-y-1.5">
                  {[
                    { label: t('reportsCharts.labelRevenue'), value: fmtC(topProduct.revenue), cls: 'font-bold text-emerald-600' },
                    { label: t('reportsCharts.labelUnitsSold'), value: fmt(topProduct.saleQty), cls: 'font-semibold text-slate-700 dark:text-slate-300' },
                    {
                      label: t('reportsCharts.labelProfit'),
                      value: fmtC(topProduct.revenue - topProduct.cost),
                      cls: cn(
                        'font-semibold',
                        topProduct.revenue - topProduct.cost >= 0 ? 'text-emerald-600' : 'text-red-500',
                      ),
                    },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500">{label}</span>
                      <span className={cn('tabular-nums', cls)}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ReportWidget>
          )}
        </div>
      </div>

      {/* Row 2: four equal-height widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-fr">
        <ReportWidget title={t('reportsCharts.paymentMethods')} subtitle={t('reportsCharts.paymentSubtitle')} menu fill compact className="min-h-[300px]">
          {pmData.length > 0 ? (
            <div className="flex h-full flex-col">
              <div className="relative shrink-0" style={{ height: BOTTOM_CHART_H }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <GradientDefs />
                    <Pie
                      data={pmData}
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={66}
                      paddingAngle={3}
                      dataKey="value"
                      animationDuration={800}
                    >
                      {pmData.map((entry, i) => (
                        <Cell key={i} fill={PM_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-base font-bold text-slate-900 tabular-nums dark:text-white">{fmtC(pmTotal)}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{t('reportsCharts.total')}</p>
                </div>
              </div>
              <div className="mt-auto space-y-1.5 pt-2">
                {pmData.slice(0, 5).map((e, i) => {
                  const pct = pmTotal > 0 ? Math.round((Number(e.value) / pmTotal) * 100) : 0;
                  const color = PM_COLORS[e.name] || CHART_COLORS[i % CHART_COLORS.length];
                  return (
                    <div key={e.name} className="flex items-center gap-2 text-[11px]">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-slate-600 flex-1 truncate dark:text-slate-400">{e.name}</span>
                      <span className="text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                      <span className="font-semibold tabular-nums w-[4.5rem] text-right shrink-0 dark:text-slate-200">{fmtC(Number(e.value))}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <ChartEmpty message={t('reportsCharts.noPayments')} />
          )}
        </ReportWidget>

        <ReportWidget title={t('reportsCharts.topProducts')} subtitle={t('reportsCharts.topProductsSubtitle')} menu fill compact className="min-h-[300px]">
          {productReport && productReport.length > 0 ? (
            <ResponsiveContainer width="100%" height={BOTTOM_CHART_H + 24}>
              <BarChart data={productReport.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <GradientDefs />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={72} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]} maxBarSize={14}>
                  {productReport.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t('reportsCharts.noProducts')} />
          )}
        </ReportWidget>

        <ReportWidget title={t('reportsCharts.peakHours')} subtitle={t('reportsCharts.peakHoursSubtitle', { hour: peakHourLabel })} menu fill compact className="min-h-[300px]">
          {hourlyData.some((h) => h.revenue > 0) ? (
            <ResponsiveContainer width="100%" height={BOTTOM_CHART_H + 24}>
              <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]} maxBarSize={10}>
                  {hourlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.label === peakHourLabel ? PALETTE.violet : '#e2e8f0'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t('reportsCharts.noHourly')} />
          )}
        </ReportWidget>

        <ReportWidget title={t('reportsCharts.productProfit')} subtitle={t('reportsCharts.productProfitSubtitle')} menu fill compact className="min-h-[300px]">
          {productReport && productReport.length > 0 ? (
            <ul className="flex flex-col justify-center gap-2.5 h-full min-h-[212px]">
              {productReport.slice(0, 5).map((p, i) => {
                const profit = p.revenue - p.cost;
                return (
                  <li key={p.name} className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate dark:text-slate-200">{p.name}</p>
                      <p className="text-[10px] text-slate-400">{t('reportsCharts.soldBase', { qty: fmt(p.saleQty), base: fmt(p.baseQty) })}</p>
                    </div>
                    <span className={cn(
                      'text-xs font-bold tabular-nums shrink-0',
                      profit >= 0 ? 'text-emerald-600' : 'text-red-500',
                    )}>
                      {fmtC(profit)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ChartEmpty message={t('reportsCharts.noProducts')} />
          )}
        </ReportWidget>
      </div>
    </div>
  );
}

const ReportsChartsPanel = memo(ReportsChartsPanelInner);
export default ReportsChartsPanel;
