'use client';

import { cn } from '@/lib/utils';
import { statGradient } from '@/lib/ui-classes';

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'p-4 md:p-6 space-y-5 max-w-screen-2xl mx-auto min-h-full max-w-full overflow-x-hidden stagger-children',
        className
      )}
    >
      {children}
    </div>
  );
}

export function PageFilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-100 bg-white/90 backdrop-blur-sm shadow-sm p-3 md:p-4 transition-all duration-300',
        className
      )}
    >
      {children}
    </div>
  );
}

export function DataPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden transition-all duration-300',
        className
      )}
    >
      {children}
    </div>
  );
}

export function StatStrip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3', className)}>
      {children}
    </div>
  );
}

export function StatChip({
  label,
  value,
  sub,
  accent = 'blue',
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'blue' | 'emerald' | 'violet' | 'orange' | 'red' | 'slate';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl p-4 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5',
        statGradient(accent),
        className
      )}
    >
      <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-white/10 blur-xl" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/80">{label}</p>
      <p className="text-xl md:text-2xl font-bold text-white mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-[11px] text-white/70 mt-0.5">{sub}</p>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Icon className="h-7 w-7 text-slate-400" />
        </div>
      )}
      <p className="text-base font-semibold text-slate-700">{title}</p>
      {description && (
        <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
