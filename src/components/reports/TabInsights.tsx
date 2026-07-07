'use client';

import {
  Area, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, BarChart, PieChart, Pie,
} from 'recharts';
import { ReportWidget } from './ReportLayout';
import {
  SafeChartContainer, GradientDefs, ChartTooltip, ChartEmpty,
  PALETTE, CHART_COLORS, PM_COLORS, expenseCategoryColor,
} from '@/lib/chart-utils';
import { PRICE_TIER_LABELS } from '@/lib/units/conversion';
import { cn } from '@/lib/utils';

/* Shared shapes (mirrors the derived data already computed in reports/page.tsx) */
interface DailyRow {
  date: string;
  revenue: number;
  transactions: number;
  discount: number;
  tax: number;
  net: number;
}
interface PmRow { name: string; value: number }
interface ProductRow {
  name: string;
  saleQty: number;
  baseQty: number;
  revenue: number;
  cost: number;
  unitHint?: string;
}
type TierKey = 'retail' | 'wholesale' | 'vip' | 'distributor' | 'custom';
type TierBreakdown = Record<TierKey, { revenue: number; qty: number; count: number }>;
interface PriceHistoryRow {
  id: string;
  product: string;
  type: 'Cost' | 'Retail' | 'Wholesale' | 'VIP' | 'Distributor';
  oldPrice: number;
  newPrice: number;
  date: string;
  source: string;
}
interface ExpenseCategory { category: string; total: number; count: number }
interface ExpenseTrend { date: string; total: number }

type Fmt = (n: number) => string;

const AXIS = { tick: { fontSize: 10, fill: '#94a3b8' }, tickLine: false as const, axisLine: false as const };
const kAxis = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));

/* ─── Sales: revenue+orders trend + payment mix donut ────────────────────── */

export function SalesInsights({ dailyData, pmData, fmtC }: {
  dailyData: DailyRow[];
  pmData: PmRow[];
  fmtC: Fmt;
}) {
  const pmTotal = pmData.reduce((s, e) => s + Number(e.value), 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
      <ReportWidget title="Revenue & orders trend" subtitle="Daily sales across the selected period" compact fill>
        {dailyData.length > 0 ? (
          <SafeChartContainer height={240}>
            <ComposedChart data={dailyData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <GradientDefs />
              <defs>
                <linearGradient id="tab-sales-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.blue} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={PALETTE.blue} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={kAxis} />
              <Tooltip content={<ChartTooltip formatter={fmtC} />} />
              <Area
                type="monotone" dataKey="revenue" name="Revenue"
                stroke={PALETTE.blue} strokeWidth={2.5} fill="url(#tab-sales-area)"
                dot={false} activeDot={{ r: 5, fill: PALETTE.blue, stroke: '#fff', strokeWidth: 2 }}
              />
              <Line
                type="monotone" dataKey="transactions" name="Orders"
                stroke={PALETTE.violet} strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: PALETTE.violet }}
              />
            </ComposedChart>
          </SafeChartContainer>
        ) : (
          <ChartEmpty />
        )}
      </ReportWidget>

      <ReportWidget title="Payment mix" subtitle="Revenue by method" compact fill>
        {pmData.length > 0 ? (
          <div className="flex h-full flex-col">
            <div className="relative shrink-0" style={{ height: 176 }}>
              <SafeChartContainer height={176}>
                <PieChart>
                  <Pie data={pmData} cx="50%" cy="50%" innerRadius={46} outerRadius={66} paddingAngle={3} dataKey="value" animationDuration={700}>
                    {pmData.map((entry, i) => (
                      <Cell key={i} fill={PM_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                </PieChart>
              </SafeChartContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-base font-bold text-slate-900 tabular-nums dark:text-white">{fmtC(pmTotal)}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total</p>
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
          <ChartEmpty message="No payments in this period" />
        )}
      </ReportWidget>
    </div>
  );
}

/* ─── Products: top sellers revenue vs cost ──────────────────────────────── */

export function ProductsInsights({ productReport, fmtC }: {
  productReport: ProductRow[] | undefined;
  fmtC: Fmt;
}) {
  const top = (productReport ?? []).slice(0, 8);
  return (
    <ReportWidget title="Top products" subtitle="Revenue vs cost for your best sellers" compact>
      {top.length > 0 ? (
        <SafeChartContainer height={Math.max(top.length * 34, 200)}>
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barGap={2}>
            <GradientDefs />
            <XAxis type="number" {...AXIS} tickFormatter={kAxis} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={96} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={fmtC} />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="revenue" name="Revenue" fill={PALETTE.blue} radius={[0, 5, 5, 0]} maxBarSize={11} />
            <Bar dataKey="cost" name="Cost" fill="#e2e8f0" radius={[0, 5, 5, 0]} maxBarSize={11} />
          </BarChart>
        </SafeChartContainer>
      ) : (
        <ChartEmpty message="No products sold in this period" />
      )}
    </ReportWidget>
  );
}

/* ─── Pricing: revenue share by price level ──────────────────────────────── */

const TIER_COLORS: Record<string, string> = {
  retail: PALETTE.blue,
  wholesale: PALETTE.emerald,
  vip: PALETTE.violet,
  distributor: PALETTE.teal,
  custom: PALETTE.amber,
};

export function PricingInsights({ tierBreakdown, fmt, fmtC }: {
  tierBreakdown: TierBreakdown;
  fmt: Fmt;
  fmtC: Fmt;
}) {
  const tiers = ['retail', 'wholesale', 'vip', 'distributor'] as const;
  const data = tiers
    .map((tier) => ({ name: PRICE_TIER_LABELS[tier], key: tier, value: tierBreakdown[tier].revenue, qty: tierBreakdown[tier].qty }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <ReportWidget title="Revenue by price level" subtitle="Retail / Wholesale / VIP / Distributor mix" compact fill>
        {data.length > 0 ? (
          <div className="flex h-full flex-col">
            <div className="relative shrink-0" style={{ height: 188 }}>
              <SafeChartContainer height={188}>
                <PieChart>
                  <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={72} paddingAngle={3} dataKey="value" animationDuration={700}>
                    {data.map((d) => (
                      <Cell key={d.key} fill={TIER_COLORS[d.key] || PALETTE.blue} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                </PieChart>
              </SafeChartContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-base font-bold text-slate-900 tabular-nums dark:text-white">{fmtC(total)}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total</p>
              </div>
            </div>
            <div className="mt-auto space-y-1.5 pt-2">
              {data.map((d) => {
                const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                return (
                  <div key={d.key} className="flex items-center gap-2 text-[11px]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: TIER_COLORS[d.key] }} />
                    <span className="text-slate-600 flex-1 truncate dark:text-slate-400">{d.name}</span>
                    <span className="text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                    <span className="font-semibold tabular-nums w-[4.5rem] text-right shrink-0 dark:text-slate-200">{fmtC(d.value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <ChartEmpty message="No priced sales in this period" />
        )}
      </ReportWidget>

      <ReportWidget title="Units sold by level" subtitle="Quantity moved per price level" compact fill>
        {data.length > 0 ? (
          <SafeChartContainer height={220}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={kAxis} />
              <Tooltip content={<ChartTooltip formatter={fmt} />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="qty" name="Units" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {data.map((d) => (
                  <Cell key={d.key} fill={TIER_COLORS[d.key] || PALETTE.blue} />
                ))}
              </Bar>
            </BarChart>
          </SafeChartContainer>
        ) : (
          <ChartEmpty message="No priced sales in this period" />
        )}
      </ReportWidget>
    </div>
  );
}

/* ─── Price History: biggest movers by absolute change ───────────────────── */

export function PriceHistoryInsights({ priceHistory, fmtC }: {
  priceHistory: PriceHistoryRow[];
  fmtC: Fmt;
}) {
  const movers = [...priceHistory]
    .map((r) => ({ name: r.product, type: r.type, change: r.newPrice - r.oldPrice }))
    .filter((r) => r.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 8);

  return (
    <ReportWidget title="Biggest price movers" subtitle="Largest cost/price changes in this period" compact>
      {movers.length > 0 ? (
        <SafeChartContainer height={Math.max(movers.length * 34, 200)}>
          <BarChart data={movers} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
            <XAxis type="number" {...AXIS} tickFormatter={kAxis} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={96} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={fmtC} />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="change" name="Change" radius={[0, 5, 5, 0]} maxBarSize={16}>
              {movers.map((m, i) => (
                <Cell key={i} fill={m.change >= 0 ? PALETTE.rose : PALETTE.emerald} />
              ))}
            </Bar>
          </BarChart>
        </SafeChartContainer>
      ) : (
        <ChartEmpty message="No price changes in this period" />
      )}
    </ReportWidget>
  );
}

/* ─── Expenses: category donut + spend trend ─────────────────────────────── */

export function ExpensesInsights({ expensesByCategory, expensesTrend, fmtC }: {
  expensesByCategory: ExpenseCategory[];
  expensesTrend: ExpenseTrend[];
  fmtC: Fmt;
}) {
  const total = expensesByCategory.reduce((s, c) => s + c.total, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <ReportWidget title="Expenses by category" subtitle="Where the money went" compact fill>
        {expensesByCategory.length > 0 ? (
          <div className="flex h-full flex-col">
            <div className="relative shrink-0" style={{ height: 188 }}>
              <SafeChartContainer height={188}>
                <PieChart>
                  <Pie data={expensesByCategory} cx="50%" cy="50%" innerRadius={50} outerRadius={72} paddingAngle={3} dataKey="total" nameKey="category" animationDuration={700}>
                    {expensesByCategory.map((c, i) => (
                      <Cell key={c.category} fill={expenseCategoryColor(c.category, i)} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                </PieChart>
              </SafeChartContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-base font-bold text-slate-900 tabular-nums dark:text-white">{fmtC(total)}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total</p>
              </div>
            </div>
            <div className="mt-auto space-y-1.5 pt-2">
              {expensesByCategory.slice(0, 5).map((c, i) => {
                const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
                return (
                  <div key={c.category} className="flex items-center gap-2 text-[11px]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: expenseCategoryColor(c.category, i) }} />
                    <span className="text-slate-600 flex-1 truncate dark:text-slate-400">{c.category}</span>
                    <span className="text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                    <span className="font-semibold tabular-nums w-[4.5rem] text-right shrink-0 dark:text-slate-200">{fmtC(c.total)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <ChartEmpty message="No expenses in this period" />
        )}
      </ReportWidget>

      <ReportWidget title="Spend trend" subtitle="Daily expenses over the period" compact fill>
        {expensesTrend.length > 0 ? (
          <SafeChartContainer height={220}>
            <ComposedChart data={expensesTrend} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="tab-exp-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.rose} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={PALETTE.rose} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={kAxis} />
              <Tooltip content={<ChartTooltip formatter={fmtC} />} />
              <Area
                type="monotone" dataKey="total" name="Expenses"
                stroke={PALETTE.rose} strokeWidth={2.5} fill="url(#tab-exp-area)"
                dot={false} activeDot={{ r: 5, fill: PALETTE.rose, stroke: '#fff', strokeWidth: 2 }}
              />
            </ComposedChart>
          </SafeChartContainer>
        ) : (
          <ChartEmpty message="No expenses in this period" />
        )}
      </ReportWidget>
    </div>
  );
}

/* Small reusable per-tab export button so every tab has an obvious export. */
export function TabExportButton({ onClick, disabled, label = 'Export CSV' }: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 shadow-sm transition-colors',
        'hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none',
        'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
      {label}
    </button>
  );
}
