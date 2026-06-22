'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const PosSystem = dynamic(() => import('@/components/pos/PosSystem'), {
  loading: () => (
    <div className="flex h-full">
      <div className="flex-1 p-4 space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      </div>
      <div className="hidden md:flex w-80 lg:w-96 border-l flex-col p-4 gap-4">
        <Skeleton className="h-12 w-full" />
        <div className="flex-1 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  ),
  ssr: false,
});

export default function PosPage() {
  return (
    <div className="h-full overflow-hidden">
      <Suspense>
        <PosSystem />
      </Suspense>
    </div>
  );
}
