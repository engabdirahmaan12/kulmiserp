'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import {
  ReportTableShell, reportTableHead, reportTableHeadRight,
  ReportKpiGrid, ReportKpiCard, ReportWidget,
} from '@/components/reports/ReportLayout';
import { TabExportButton } from '@/components/reports/TabInsights';
import {
  SafeChartContainer, ChartTooltip, ChartEmpty, CHART_COLORS, PM_COLORS,
} from '@/lib/chart-utils';
import { Wallet, Layers, Landmark } from 'lucide-react';
import { startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { inputSoft } from '@/lib/ui-classes';
import { downloadCsv, buildCsv } from '@/lib/export/spreadsheet';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

/** The four money-in sources that record which payment method was used. */
type SourceKey = 'sales' | 'debt' | 'deposit' | 'cashin';
const SOURCE_LABELS: Record<SourceKey, string> = {
  sales: 'Sales',
  debt: 'Debt payments',
  deposit: 'Deposits',
  cashin: 'Cash-in',
};
const SOURCE_ORDER: SourceKey[] = ['sales', 'debt', 'deposit', 'cashin'];

interface MethodRow {
  slug: string;
  label: string;
  sales: number;
  debt: number;
  deposit: number;
  cashin: number;
  total: number;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

export function PaymentAccountsTab() {
  const { currentStore } = useAuthStore();
  const currency = currentStore?.currency || 'USD';
  const [dateFrom, setDateFrom] = useState(startOfMonth(new Date()).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(getToday());

  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  const { data: methods = [] } = useStorePaymentMethods({ includeInactive: true });

  // slug → display label (fall back to a tidy upper-cased slug for legacy rows).
  const slugLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of methods) map.set(m.slug, m.label);
    return (slug: string) => map.get(slug) ?? slug.toUpperCase().replace(/_/g, ' ');
  }, [methods]);

  const { data, isLoading } = useQuery({
    queryKey: ['payment-accounts-report', currentStore?.id, dateFrom, dateTo],
    queryFn: async () => {
      const supabase = createClient();
      const from = dateFrom;
      const to = dateTo + 'T23:59:59';
      const [salesRes, debtRes, depRes, cashRes] = await Promise.all([
        supabase
          .from('sales')
          .select('payment_method, total_amount')
          .eq('store_id', currentStore!.id)
          .eq('status', 'completed')
          .gte('sale_date', from)
          .lte('sale_date', to),
        supabase
          .from('debt_payments')
          .select('payment_method, amount')
          .eq('store_id', currentStore!.id)
          .gte('paid_at', from)
          .lte('paid_at', to),
        supabase
          .from('customer_deposits')
          .select('payment_method, amount')
          .eq('store_id', currentStore!.id)
          .eq('type', 'deposit')
          .gte('created_at', from)
          .lte('created_at', to),
        supabase
          .from('cash_movements')
          .select('payment_method, amount')
          .eq('store_id', currentStore!.id)
          .eq('movement_type', 'deposit')
          .gte('movement_date', from)
          .lte('movement_date', to),
      ]);

      return {
        sales: (salesRes.data ?? []) as { payment_method: string | null; total_amount: number }[],
        debt: (debtRes.data ?? []) as { payment_method: string | null; amount: number }[],
        deposit: (depRes.data ?? []) as { payment_method: string | null; amount: number }[],
        cashin: (cashRes.data ?? []) as { payment_method: string | null; amount: number }[],
      };
    },
    enabled: !!currentStore,
  });

  const rows = useMemo<MethodRow[]>(() => {
    if (!data) return [];
    const map = new Map<string, MethodRow>();
    const ensure = (slug: string) => {
      const key = slug || 'cash';
      let r = map.get(key);
      if (!r) {
        r = { slug: key, label: slugLabel(key), sales: 0, debt: 0, deposit: 0, cashin: 0, total: 0 };
        map.set(key, r);
      }
      return r;
    };
    // 'credit'/'split' aren't real cash accounts — skip credit; split rows have
    // no single account so they fall through under their stored slug.
    for (const s of data.sales) {
      const slug = (s.payment_method || 'cash').toLowerCase();
      if (slug === 'credit') continue;
      const amt = Number(s.total_amount) || 0;
      const r = ensure(slug);
      r.sales += amt;
      r.total += amt;
    }
    for (const p of data.debt) {
      const amt = Number(p.amount) || 0;
      const r = ensure((p.payment_method || 'cash').toLowerCase());
      r.debt += amt;
      r.total += amt;
    }
    for (const d of data.deposit) {
      const amt = Number(d.amount) || 0;
      const r = ensure((d.payment_method || 'cash').toLowerCase());
      r.deposit += amt;
      r.total += amt;
    }
    for (const c of data.cashin) {
      const amt = Number(c.amount) || 0;
      const r = ensure((c.payment_method || 'cash').toLowerCase());
      r.cashin += amt;
      r.total += amt;
    }
    return Array.from(map.values())
      .filter((r) => r.total !== 0)
      .sort((a, b) => b.total - a.total);
  }, [data, slugLabel]);

  const grandTotal = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);
  const topAccount = rows[0];

  const donutData = useMemo(
    () => rows.map((r) => ({ name: r.label, slug: r.slug, value: r.total })),
    [rows],
  );

  const exportCsv = () => {
    const headers = ['Account', ...SOURCE_ORDER.map((k) => SOURCE_LABELS[k]), 'Total'];
    const body = rows.map((r) => [
      r.label,
      r.sales.toFixed(2),
      r.debt.toFixed(2),
      r.deposit.toFixed(2),
      r.cashin.toFixed(2),
      r.total.toFixed(2),
    ]);
    body.push([
      'TOTAL',
      rows.reduce((s, r) => s + r.sales, 0).toFixed(2),
      rows.reduce((s, r) => s + r.debt, 0).toFixed(2),
      rows.reduce((s, r) => s + r.deposit, 0).toFixed(2),
      rows.reduce((s, r) => s + r.cashin, 0).toFixed(2),
      grandTotal.toFixed(2),
    ]);
    downloadCsv(buildCsv(headers, body), `payment-accounts-${dateFrom}-to-${dateTo}.csv`);
  };

  const colorFor = (slug: string, i: number) =>
    PM_COLORS[slug.toUpperCase()] || CHART_COLORS[i % CHART_COLORS.length];

  return (
    <div className="space-y-4">
      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500 shrink-0">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={cn(inputSoft, 'w-36 text-sm h-9 rounded-xl')}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500 shrink-0">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={cn(inputSoft, 'w-36 text-sm h-9 rounded-xl')}
          />
        </div>
        <div className="ml-auto">
          <TabExportButton onClick={exportCsv} disabled={!rows.length} />
        </div>
      </div>

      {/* KPIs */}
      <ReportKpiGrid className="lg:grid-cols-3">
        <ReportKpiCard label="Total received" value={fmtC(grandTotal)} icon={Wallet} accent="emerald" loading={isLoading} />
        <ReportKpiCard label="Active accounts" value={String(rows.length)} icon={Layers} accent="blue" loading={isLoading} />
        <ReportKpiCard
          label="Top account"
          value={topAccount ? topAccount.label : '—'}
          sub={topAccount ? fmtC(topAccount.total) : undefined}
          icon={Landmark}
          accent="violet"
          loading={isLoading}
        />
      </ReportKpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
        {/* Donut: received per account */}
        <ReportWidget title="Received per account" subtitle="Share of money-in" compact fill>
          {donutData.length > 0 ? (
            <div className="flex h-full flex-col">
              <div className="relative shrink-0" style={{ height: 188 }}>
                <SafeChartContainer height={188}>
                  <PieChart>
                    <Pie data={donutData} cx="50%" cy="50%" innerRadius={50} outerRadius={72} paddingAngle={3} dataKey="value" animationDuration={700}>
                      {donutData.map((d, i) => (
                        <Cell key={d.slug} fill={colorFor(d.slug, i)} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip formatter={fmtC} />} />
                  </PieChart>
                </SafeChartContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-base font-bold text-slate-900 tabular-nums dark:text-white">{fmtC(grandTotal)}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total</p>
                </div>
              </div>
              <div className="mt-auto space-y-1.5 pt-2">
                {donutData.slice(0, 6).map((d, i) => {
                  const pct = grandTotal > 0 ? Math.round((d.value / grandTotal) * 100) : 0;
                  return (
                    <div key={d.slug} className="flex items-center gap-2 text-[11px]">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorFor(d.slug, i) }} />
                      <span className="text-slate-600 flex-1 truncate dark:text-slate-400">{d.name}</span>
                      <span className="text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                      <span className="font-semibold tabular-nums w-[4.5rem] text-right shrink-0 dark:text-slate-200">{fmtC(d.value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <ChartEmpty message="No money-in for this period" />
          )}
        </ReportWidget>

        {/* Matrix: where each account's money came from */}
        <ReportTableShell className="border-0 shadow-none rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className={reportTableHead}>Account</th>
                {SOURCE_ORDER.map((k) => (
                  <th key={k} className={cn(reportTableHeadRight, k !== 'sales' && 'hidden sm:table-cell')}>
                    {SOURCE_LABELS[k]}
                  </th>
                ))}
                <th className={reportTableHeadRight}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">No money-in for this period</td></tr>
              ) : (
                <>
                  {rows.map((r, i) => (
                    <tr key={r.slug} className="hover:bg-slate-50/80 transition-colors dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-200">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorFor(r.slug, i) }} />
                          {r.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtC(r.sales)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 hidden sm:table-cell dark:text-slate-400">{fmtC(r.debt)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 hidden sm:table-cell dark:text-slate-400">{fmtC(r.deposit)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 hidden sm:table-cell dark:text-slate-400">{fmtC(r.cashin)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{fmtC(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50/70 dark:bg-slate-800/40 font-semibold">
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtC(rows.reduce((s, r) => s + r.sales, 0))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums hidden sm:table-cell">{fmtC(rows.reduce((s, r) => s + r.debt, 0))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums hidden sm:table-cell">{fmtC(rows.reduce((s, r) => s + r.deposit, 0))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums hidden sm:table-cell">{fmtC(rows.reduce((s, r) => s + r.cashin, 0))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{fmtC(grandTotal)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-slate-400">
            Shows money received into each account and where it came from. Credit sales are excluded (no cash received);
            outflows like expenses and supplier payments aren&apos;t tied to a specific account, so this is money-in, not a bank balance.
          </p>
        </ReportTableShell>
      </div>
    </div>
  );
}
