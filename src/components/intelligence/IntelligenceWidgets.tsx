'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { useStoreIntelligence } from '@/lib/hooks/useIntelligence';
import { useAuthStore } from '@/lib/stores/auth';
import {
  briefingFromSnapshot,
  healthFromSnapshot,
  type DashboardWidgetSnapshot,
} from '@/lib/intelligence/dashboard-fallback';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Sparkles, TrendingUp, Package, AlertTriangle, Users, Target,
  Activity, ShoppingCart, ChevronRight, Loader2,
} from 'lucide-react';
import { getStoreGoals, saveStoreGoals } from '@/lib/intelligence/goals';
import { useTranslation } from '@/lib/i18n/useTranslation';

const HEALTH_COLORS = {
  excellent: 'text-blue-600 bg-blue-50 border-blue-200',
  good: 'text-indigo-600 bg-indigo-50 border-indigo-200',
  fair: 'text-amber-600 bg-amber-50 border-amber-200',
  critical: 'text-red-600 bg-red-50 border-red-200',
};

export function DailyBriefingCard({ snapshot }: { snapshot?: DashboardWidgetSnapshot }) {
  const { data, isLoading, isFetching } = useStoreIntelligence();
  const { currentStore, user } = useAuthStore();
  const { t, formatCurrency } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const briefing = data?.briefing ?? (snapshot ? briefingFromSnapshot(snapshot, user?.full_name, currency, t) : null);
  const enriching = isLoading && !!snapshot;

  if (!briefing) {
    return <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" aria-busy="true" />;
  }

  return (
    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-lg shadow-blue-200/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-blue-100 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> {t('intel.dailyBriefing')}
            {enriching && <Loader2 className="h-3 w-3 animate-spin opacity-70" aria-label="Updating insights" />}
          </p>
          <h2 className="text-xl font-bold mt-1">{briefing.greeting}</h2>
        </div>
        <Link href="/dashboard/intelligence" className="text-xs text-blue-100 hover:text-white flex items-center gap-0.5">
          {t('intel.fullHub')} <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {[
          { label: t('intel.sales'), value: fmt(briefing.summary.sales) },
          { label: t('intel.profit'), value: fmt(briefing.summary.profit) },
          { label: t('intel.expenses'), value: fmt(briefing.summary.expenses) },
          { label: t('intel.newCustomers'), value: String(briefing.summary.newCustomers) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-white/10 px-3 py-2">
            <p className="text-[10px] text-blue-100 uppercase">{label}</p>
            <p className="font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <ul className={cn('mt-4 space-y-1 text-sm text-blue-50', isFetching && !data && 'opacity-80')}>
        {briefing.recommendations.slice(0, 3).map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-blue-200">•</span> {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BusinessHealthCard({
  compact,
  snapshot,
}: {
  compact?: boolean;
  snapshot?: DashboardWidgetSnapshot;
}) {
  const { data, isLoading } = useStoreIntelligence();
  const { t } = useTranslation();
  const health = data?.health ?? (snapshot ? healthFromSnapshot(snapshot, t) : null);

  if (!health) {
    return <div className={cn('rounded-2xl bg-slate-100 animate-pulse', compact ? 'h-28' : 'h-48')} aria-busy="true" />;
  }
  const colors = HEALTH_COLORS[health.status];
  const HEALTH_LABEL: Record<string, string> = {
    excellent: t('intel.healthExcellent'),
    good: t('intel.healthGood'),
    fair: t('intel.healthFair'),
    critical: t('intel.healthCritical'),
  };

  return (
    <div className={cn('rounded-2xl border bg-white p-4 shadow-sm dark:bg-slate-900', colors.split(' ').slice(2).join(' '))}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('intel.businessHealth')}</p>
      <div className="flex items-end gap-3 mt-2">
        <span className={cn('text-4xl font-bold tabular-nums', colors.split(' ')[0])}>{health.score}</span>
        <span className="text-slate-400 text-lg mb-1">/100</span>
        <span className={cn('ml-auto text-xs font-bold uppercase px-2 py-1 rounded-full border', colors)}>
          {HEALTH_LABEL[health.status] ?? health.status}
        </span>
      </div>
      {!compact && (
        <div className="mt-4 space-y-2">
          {health.factors.map((f) => (
            <div key={f.label}>
              <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                <span>{f.label}</span>
                <span>{Math.round(f.score)}</span>
              </div>
              <Progress value={f.score} className="h-1.5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityTimelineCard({ limit = 8 }: { limit?: number }) {
  const { data, isLoading } = useStoreIntelligence();
  const { t } = useTranslation();
  if (isLoading || !data) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-600" /> {t('intel.activity')}
        </h3>
        <Link href="/dashboard/intelligence" className="text-xs text-blue-600 hover:underline">{t('intel.viewAll')}</Link>
      </div>
      <div className="space-y-3">
        {data.activity.slice(0, limit).map((ev) => (
          <div key={ev.id} className="flex gap-3 text-sm">
            <span className="text-[10px] text-slate-400 w-14 shrink-0 pt-0.5 tabular-nums">
              {format(new Date(ev.at), 'HH:mm')}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{ev.title}</p>
            </div>
          </div>
        ))}
        {data.activity.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">{t('intel.noRecentActivity')}</p>
        )}
      </div>
    </div>
  );
}

export function GoalsWidget({ monthRevenue }: { monthRevenue?: number }) {
  const { currentStore } = useAuthStore();
  const { t, formatCurrency } = useTranslation();
  const { data } = useStoreIntelligence();
  const [editing, setEditing] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const storeId = currentStore?.id ?? '';
  const goals = getStoreGoals(storeId);
  const currency = currentStore?.currency ?? 'USD';
  const target = goals.monthlyRevenue ?? 0;
  const current = data?.metrics.monthRevenue ?? monthRevenue ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  const save = () => {
    const n = parseFloat(goalInput);
    if (!isNaN(n) && n > 0) {
      saveStoreGoals(storeId, { ...goals, monthlyRevenue: n });
      setEditing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-violet-600" /> {t('intel.monthlyRevenueGoal')}
        </h3>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setGoalInput(String(target || '')); setEditing(!editing); }}>
          {editing ? t('intel.cancel') : t('intel.setGoal')}
        </Button>
      </div>
      {editing ? (
        <div className="flex gap-2">
          <input
            type="number"
            className="flex-1 rounded-lg border px-2 py-1 text-sm"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="10000"
          />
          <Button size="sm" onClick={save}>{t('intel.save')}</Button>
        </div>
      ) : target > 0 ? (
        <>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-500">{t('intel.percentComplete', { pct })}</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(current, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              {' / '}
              {formatCurrency(target, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </>
      ) : (
        <p className="text-xs text-slate-400">{t('intel.setGoalHint')}</p>
      )}
    </div>
  );
}

export function ExecutiveMetricsStrip() {
  const { data, isLoading } = useStoreIntelligence();
  const { currentStore } = useAuthStore();
  const { t, formatCurrency } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  if (isLoading || !data) return null;

  const items = [
    { label: t('intel.mtdRevenue'), value: fmt(data.metrics.monthRevenue), icon: TrendingUp },
    { label: t('intel.mtdProfit'), value: fmt(data.metrics.monthProfit), icon: Sparkles },
    { label: t('intel.cash'), value: fmt(data.metrics.cashBalance), icon: ShoppingCart },
    { label: t('intel.inventory'), value: fmt(data.metrics.inventoryValue), icon: Package },
    { label: t('intel.receivables'), value: fmt(data.metrics.receivables), icon: Users },
    { label: t('intel.growth'), value: data.metrics.growthRate !== null ? `${data.metrics.growthRate}%` : '—', icon: TrendingUp },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase font-semibold">
            <Icon className="h-3 w-3 text-blue-600" /> {label}
          </div>
          <p className="text-lg font-bold tabular-nums mt-0.5 text-slate-900">{value}</p>
        </div>
      ))}
    </div>
  );
}

export function AlertCountBadge() {
  const { data } = useStoreIntelligence();
  const count = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  if (!count) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 border-2 border-white flex items-center justify-center text-[9px] text-white font-bold">
      {count > 9 ? '9+' : count}
    </span>
  );
}
