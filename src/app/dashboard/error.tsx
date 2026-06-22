'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[KULMIS Dashboard] Error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="rounded-2xl border border-red-100 bg-red-50 p-8 max-w-md w-full text-center dark:border-red-900/30 dark:bg-red-950/20">
        <AlertTriangle className="h-9 w-9 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Page error</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          {error.message || 'An unexpected error occurred on this page.'}
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400 mt-1 font-mono">Ref: {error.digest}</p>
        )}
        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={() => window.location.href = '/dashboard'}>
            Dashboard
          </Button>
          <Button className="flex-1 gap-1.5" onClick={reset}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
