'use client';

import { WifiOff, RefreshCw } from 'lucide-react';
import { btnPrimary } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export function OfflinePageClient() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center app-surface p-6 text-center">
      <div className="max-w-md rounded-2xl border border-slate-100 bg-white/95 backdrop-blur-sm shadow-lg shadow-slate-200/40 p-8 space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200/80">
          <WifiOff className="h-8 w-8 text-slate-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">You&apos;re Offline</h1>
        <p className="text-slate-500 text-sm leading-relaxed">
          No internet connection. The POS system continues to work offline — your sales will sync automatically when you reconnect.
        </p>
        <button
          onClick={() => window.location.reload()}
          className={cn(btnPrimary, 'mt-2 inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold')}
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}
