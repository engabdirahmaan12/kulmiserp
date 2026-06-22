'use client';

import { memo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Printer,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/* ─── Page header (Prato-style) ─────────────────────────────────────────── */

export function ReportPageHeader({
  title,
  description,
  greeting,
  actions,
  className,
}: {
  title: string;
  description?: string;
  greeting?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {greeting && (
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-0.5">{greeting}</p>
        )}
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight dark:text-white">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-slate-500 mt-1 max-w-2xl dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/* ─── Export actions ────────────────────────────────────────────────────── */

export function ReportExportActions({
  onExportCsv,
  onExportExcel,
  onExportSummary,
  onExportProducts,
  onExportLineItems,
  summaryLabel = 'Full summary (Excel)',
  onPrint,
  disabled,
  showAiLink = true,
  showPrintButton = true,
}: {
  onExportCsv?: () => void;
  onExportExcel?: () => void;
  onExportSummary?: () => void;
  onExportProducts?: () => void;
  onExportLineItems?: () => void;
  summaryLabel?: string;
  onPrint?: () => void;
  disabled?: boolean;
  showAiLink?: boolean;
  showPrintButton?: boolean;
}) {
  const hasExport = !!(onExportCsv || onExportExcel || onExportSummary || onExportProducts || onExportLineItems || onPrint);

  return (
    <div className="flex items-center gap-2">
      {showPrintButton && onPrint && (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onPrint}
          className="h-8 rounded-full border-slate-200 bg-white gap-1.5 hidden sm:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      )}
      {hasExport && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileText className="h-3.5 w-3.5" />
            Export
            <ChevronDown className="h-3 w-3 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 rounded-xl">
            {onExportCsv && (
              <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4" /> CSV
              </DropdownMenuItem>
            )}
            {onExportExcel && (
              <DropdownMenuItem onClick={onExportExcel} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </DropdownMenuItem>
            )}
            {onExportSummary && (
              <DropdownMenuItem onClick={onExportSummary} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" /> {summaryLabel}
              </DropdownMenuItem>
            )}
            {onExportProducts && (
              <DropdownMenuItem onClick={onExportProducts} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" /> Products CSV
              </DropdownMenuItem>
            )}
            {onExportLineItems && (
              <DropdownMenuItem onClick={onExportLineItems} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" /> Line items CSV
              </DropdownMenuItem>
            )}
            {onPrint && (
              <DropdownMenuItem onClick={onPrint} className="gap-2 cursor-pointer">
                <Printer className="h-4 w-4" /> Print
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {showAiLink && (
        <Link
          href="/dashboard/ai-insights"
          className="inline-flex h-8 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 px-3.5 text-sm font-medium text-white gap-1.5 shadow-sm shadow-blue-600/20 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Insights
        </Link>
      )}
    </div>
  );
}

/* ─── Filter strip ──────────────────────────────────────────────────────── */

export function ReportFilterStrip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky top-0 z-20 rounded-2xl border border-slate-100 bg-white/95 backdrop-blur-md shadow-sm p-3 md:p-4',
        'dark:border-slate-800 dark:bg-slate-900/95',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─── Tab navigation ────────────────────────────────────────────────────── */

export function ReportTabBar({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-slate-100 pb-px dark:border-slate-800',
        className,
      )}
    >
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            'relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
            active === id
              ? 'border-blue-600 text-blue-600 dark:border-teal-400 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─── Mini sparkline ────────────────────────────────────────────────────── */

function MiniSparkline({ data, color = '#3b82f6' }: { data: number[]; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 64;
  const h = 24;
  const points = data
    .map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className="opacity-80 shrink-0" aria-hidden>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/* ─── KPI card ──────────────────────────────────────────────────────────── */

const KPI_ACCENTS = {
  blue: {
    icon: 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400',
    spark: '#3b82f6',
    border: 'hover:border-blue-200 dark:hover:border-blue-800',
  },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
    spark: '#10b981',
    border: 'hover:border-emerald-200 dark:hover:border-emerald-800',
  },
  orange: {
    icon: 'bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400',
    spark: '#f97316',
    border: 'hover:border-orange-200 dark:hover:border-orange-800',
  },
  violet: {
    icon: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
    spark: '#8b5cf6',
    border: 'hover:border-violet-200 dark:hover:border-violet-800',
  },
  teal: {
    icon: 'bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400',
    spark: '#14b8a6',
    border: 'hover:border-teal-200 dark:hover:border-teal-800',
  },
  rose: {
    icon: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    spark: '#f43f5e',
    border: 'hover:border-rose-200 dark:hover:border-rose-800',
  },
} as const;

export type KpiAccent = keyof typeof KPI_ACCENTS;

export const ReportKpiCard = memo(function ReportKpiCard({
  label,
  value,
  sub,
  delta,
  icon: Icon,
  accent = 'blue',
  sparkline,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  icon: React.ElementType;
  accent?: KpiAccent;
  sparkline?: number[];
  loading?: boolean;
}) {
  const styles = KPI_ACCENTS[accent];

  return (
    <div
      className={cn(
        'group relative flex h-full min-h-[132px] flex-col rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        'dark:border-slate-800 dark:bg-slate-900/80',
        styles.border,
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0', styles.icon)}>
          <Icon className="h-4 w-4" />
        </div>
        {delta !== undefined && (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold',
              delta >= 0
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400',
            )}
          >
            {delta >= 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(delta)}%
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-7 w-24 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800" />
      ) : (
        <p className="text-lg lg:text-xl font-bold text-slate-900 tracking-tight tabular-nums truncate dark:text-white">
          {value}
        </p>
      )}
      <p className="text-[11px] font-medium text-slate-500 mt-0.5 truncate dark:text-slate-400">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5 truncate dark:text-slate-500">{sub}</p>}

      <div className="mt-auto pt-2 min-h-[26px]">
        {sparkline && sparkline.length > 1 && (
          <MiniSparkline data={sparkline} color={styles.spark} />
        )}
      </div>
    </div>
  );
});

export function ReportKpiGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 auto-rows-fr',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─── Widget card shell ─────────────────────────────────────────────────── */

export function ReportWidget({
  title,
  subtitle,
  action,
  children,
  className,
  menu,
  fill,
  compact,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  menu?: boolean;
  /** Stretch to fill grid cell height */
  fill?: boolean;
  /** Tighter padding for chart widgets */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden',
        'dark:border-slate-800 dark:bg-slate-900/80',
        fill && 'h-full flex flex-col',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-50 shrink-0 dark:border-slate-800/80">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 text-sm leading-tight dark:text-white">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate dark:text-slate-500">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {action}
          {menu && (
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:hover:bg-slate-800"
              aria-label="More options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div
        className={cn(
          fill && 'flex-1 flex flex-col min-h-0',
          compact ? 'px-3 pb-3 pt-1' : 'px-4 pb-4 pt-2',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Data table with sticky header ─────────────────────────────────────── */

export function ReportTableShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden',
        'dark:border-slate-800 dark:bg-slate-900/80',
        className,
      )}
    >
      <div className="overflow-x-auto max-h-[min(70vh,640px)] overflow-y-auto">{children}</div>
    </div>
  );
}

export const reportTableHead =
  'text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap sticky top-0 bg-slate-50/95 backdrop-blur-sm z-10 dark:bg-slate-900/95 dark:text-slate-500';

export const reportTableHeadRight = cn(reportTableHead, 'text-right');

/* ─── Floating AI shortcut (legacy — use global KulmisAiCopilot) ─────────── */

export function ReportAiFloating() {
  return null;
}

/* ─── Accounting statement table ────────────────────────────────────────── */

export function ReportStatementTable({
  title,
  rows,
  fmt,
}: {
  title: string;
  rows: { label: string; value: number; cls?: string; indent?: boolean }[];
  fmt: (n: number) => string;
}) {
  return (
    <ReportWidget title={title} menu>
      <div className="divide-y divide-slate-50 dark:divide-slate-800 text-sm -mx-1">
        {rows.map(({ label, value, cls, indent }) => (
          <div
            key={label}
            className={cn(
              'flex justify-between items-center px-2 py-3',
              cls,
            )}
          >
            <span className={cn(indent && 'pl-3 text-slate-400 dark:text-slate-500')}>
              {label.trim()}
            </span>
            <span className="font-mono tabular-nums font-medium">{fmt(value)}</span>
          </div>
        ))}
      </div>
    </ReportWidget>
  );
}
