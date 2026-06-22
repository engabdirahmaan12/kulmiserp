'use client';

import { cn } from '@/lib/utils';
import { LayoutGrid, LayoutList } from 'lucide-react';
import { PLAN_SLUG_LABELS, STORE_STATUS_LABELS } from '@/lib/platform/roles';

/* ── Design tokens ───────────────────────────────────────────── */
export const sa = {
  panel: 'rounded-2xl border border-white/[0.06] bg-slate-900/40 backdrop-blur-xl shadow-xl shadow-black/20',
  panelHover: 'hover:border-indigo-500/20 hover:shadow-indigo-500/5 transition-all duration-300 ease-out',
  input: 'bg-slate-950/60 border-white/[0.08] text-slate-100 placeholder:text-slate-500 focus-visible:border-indigo-500/50 focus-visible:ring-indigo-500/20 rounded-xl h-10',
  muted: 'text-slate-400',
  heading: 'text-slate-50 font-semibold tracking-tight',
};

export const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25',
  trial: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25',
  expired: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/25',
  suspended: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25',
  disabled: 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25',
  cancelled: 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25',
};

export function SaStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center text-[11px] font-medium px-2.5 py-0.5 rounded-full', STATUS_STYLES[status] ?? STATUS_STYLES.disabled)}>
      {STORE_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function SaPlanBadge({ plan }: { plan: string | null }) {
  const label = PLAN_SLUG_LABELS[plan ?? ''] ?? plan ?? '—';
  return (
    <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/20">
      {label}
    </span>
  );
}

export function SaPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-50 tracking-tight">{title}</h1>
        {description && <p className="text-slate-400 text-sm mt-1.5 max-w-xl">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

export function SaPanel({
  children,
  className,
  noPadding,
}: {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <div className={cn(sa.panel, !noPadding && 'p-0', className)}>
      {children}
    </div>
  );
}

export function SaStatCard({
  title,
  value,
  sub,
  icon: Icon,
  gradient,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  gradient: string;
}) {
  return (
    <div className={cn(sa.panel, sa.panelHover, 'p-5 group')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl md:text-3xl font-bold text-slate-50 tabular-nums tracking-tight">{value}</p>
          <p className="text-sm text-slate-400 mt-1">{title}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <div className={cn('p-3 rounded-xl shrink-0 bg-gradient-to-br shadow-lg transition-transform duration-300 group-hover:scale-105', gradient)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}

export function SaEmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="h-14 w-14 rounded-2xl bg-slate-800/80 flex items-center justify-center mb-4 ring-1 ring-white/5">
        <LayoutGrid className="h-6 w-6 text-slate-500" />
      </div>
      <p className="text-slate-300 font-medium">{title}</p>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
    </div>
  );
}

export function SaViewToggle({
  view,
  onChange,
}: {
  view: 'list' | 'grid';
  onChange: (v: 'list' | 'grid') => void;
}) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-slate-950/80 border border-white/[0.06]">
      <button
        type="button"
        onClick={() => onChange('list')}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
          view === 'list' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : 'text-slate-400 hover:text-slate-200',
        )}
      >
        <LayoutList className="h-3.5 w-3.5" /> List
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
          view === 'grid' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : 'text-slate-400 hover:text-slate-200',
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" /> Grid
      </button>
    </div>
  );
}

export function StoreAvatar({ name }: { name: string }) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const hues = ['from-indigo-500 to-violet-600', 'from-cyan-500 to-blue-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600'];
  const hue = hues[name.charCodeAt(0) % hues.length];
  return (
    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-lg', hue)}>
      {initial}
    </div>
  );
}

export function SaSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(sa.panel, 'p-5 animate-pulse')} style={{ animationDelay: `${i * 60}ms` }}>
          <div className="flex gap-3">
            <div className="h-11 w-11 rounded-xl bg-slate-800" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-slate-800" />
              <div className="h-3 w-1/2 rounded bg-slate-800/70" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
