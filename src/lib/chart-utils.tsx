'use client';

import { useLayoutEffect, useState, type ReactElement } from 'react';
import { ResponsiveContainer, type ResponsiveContainerProps } from 'recharts';
import { cn } from '@/lib/utils';

/** Avoid Recharts measuring before layout (width/height -1 warnings). */
export function SafeChartContainer({
  height,
  className,
  children,
  ...props
}: ResponsiveContainerProps & { className?: string; children: ReactElement }) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(true);
  }, []);

  const numericHeight = typeof height === 'number' ? height : undefined;
  const resolvedHeight = numericHeight ?? (height === '100%' ? '100%' : 120);

  return (
    <div
      className={cn('w-full min-w-0', className)}
      style={typeof resolvedHeight === 'number' ? { height: resolvedHeight } : { height: resolvedHeight }}
    >
      {ready ? (
        <ResponsiveContainer width="100%" height={height ?? numericHeight ?? 120} {...props} minWidth={0}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="h-full w-full rounded-lg bg-slate-50/80" aria-hidden />
      )}
    </div>
  );
}


// ─── Brand Palette ──────────────────────────────────────────────────────────
export const PALETTE = {
  blue:   '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  emerald:'#10b981',
  teal:   '#14b8a6',
  amber:  '#f59e0b',
  rose:   '#f43f5e',
  orange: '#f97316',
  sky:    '#0ea5e9',
  pink:   '#ec4899',
} as const;

export const CHART_COLORS = [
  PALETTE.blue,
  PALETTE.emerald,
  PALETTE.amber,
  PALETTE.violet,
  PALETTE.rose,
  PALETTE.teal,
  PALETTE.orange,
  PALETTE.sky,
  PALETTE.pink,
  PALETTE.indigo,
];

export const PM_COLORS: Record<string, string> = {
  CASH:  PALETTE.emerald,
  WAAFI: PALETTE.blue,
  EVC:   PALETTE.amber,
  SAHAL: PALETTE.violet,
  ZAAD:  PALETTE.rose,
  CARD:  PALETTE.teal,
};

// ─── Gradient Defs ───────────────────────────────────────────────────────────
export function GradientDefs() {
  return (
    <defs>
      {Object.entries(PALETTE).map(([name, color]) => (
        <linearGradient key={name} id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      ))}
      {Object.entries(PALETTE).map(([name, color]) => (
        <linearGradient key={`bar-${name}`} id={`bar-grad-${name}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="100%" stopColor={color} stopOpacity={0.75} />
        </linearGradient>
      ))}
    </defs>
  );
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
interface TooltipProps {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  formatter?: (val: number) => string;
}

export function ChartTooltip({ active, payload, label, formatter }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const fmt = formatter ?? ((v: number) => v.toLocaleString());
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 backdrop-blur-sm shadow-xl px-3.5 py-2.5 text-sm min-w-[130px]">
      {label && <p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color || PALETTE.blue }} />
          <span className="text-slate-600 text-xs">{p.name ?? 'Value'}</span>
          <span className="ml-auto font-bold text-slate-900">{fmt(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Chart Card ──────────────────────────────────────────────────────────────
interface ChartCardProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({ title, subtitle, action, className, children }: ChartCardProps) {
  return (
    <div className={cn('rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden', className)}>
      <div className="flex items-start justify-between px-5 pt-5 pb-4">
        <div>
          <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="px-1 pb-4">{children}</div>
    </div>
  );
}

// ─── Common axis props ────────────────────────────────────────────────────────
export const axisProps = {
  tick: { fontSize: 11, fill: '#94a3b8' },
  tickLine: false as const,
  axisLine: false as const,
};

export const gridProps = {
  strokeDasharray: '3 3',
  stroke: '#f1f5f9',
  vertical: false as const,
};

/** Center label for donut charts */
export function DonutCenter({
  total,
  label,
  fmt,
}: {
  total: number;
  label: string;
  fmt: (n: number) => string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <p className="text-lg font-bold text-slate-900 leading-none">{fmt(total)}</p>
      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

/** Pill toggle for chart views */
export function ChartViewToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl border border-slate-200 overflow-hidden text-xs font-semibold bg-slate-50/80">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 transition-all duration-200',
            value === opt.value
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
              : 'text-slate-500 hover:bg-white hover:text-slate-700'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ChartEmpty({ message = 'No data for this period' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-44 text-slate-400 text-sm pb-4 gap-2">
      <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
        <svg className="h-5 w-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3v18h18M7 16l4-4 4 4 4-6" />
        </svg>
      </div>
      {message}
    </div>
  );
}
