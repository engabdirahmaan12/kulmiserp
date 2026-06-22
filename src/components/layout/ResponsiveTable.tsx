'use client';

import { cn } from '@/lib/utils';

/** Responsive table wrapper — horizontal scroll + sticky header on all breakpoints */
export function ResponsiveTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('w-full overflow-x-auto overscroll-x-contain -mx-1 px-1', className)}>
      <div className="min-w-0 w-full">{children}</div>
    </div>
  );
}

/** Mobile card list alternative — pass rows as cards below md breakpoint */
export function ResponsiveDataView({
  table,
  cards,
  className,
}: {
  table: React.ReactNode;
  cards: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="hidden md:block">{table}</div>
      <div className="md:hidden space-y-2">{cards}</div>
    </div>
  );
}
