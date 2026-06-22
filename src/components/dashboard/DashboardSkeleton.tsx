import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-4">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-20 rounded-full" />
          <Skeleton className="h-6 w-56 rounded-lg" />
          <Skeleton className="h-2.5 w-36 rounded-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-xl" />
          <Skeleton className="h-8 w-24 rounded-xl" />
        </div>
      </div>

      {/* 8 KPI cards — unified grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[110px] rounded-2xl" />
        ))}
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[320px] rounded-2xl" />
          <Skeleton className="h-[240px] rounded-2xl" />
          <Skeleton className="h-[320px] rounded-2xl" />
        </div>
        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[172px] rounded-2xl" />
          <Skeleton className="h-[168px] rounded-2xl" />
          <Skeleton className="h-[188px] rounded-2xl" />
          <Skeleton className="h-[220px] rounded-2xl" />
          <Skeleton className="h-[200px] rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
