'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

/** Segment error boundary — must NOT render html/body (root layout stays mounted). */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[KULMIS] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="rounded-2xl border border-red-200 bg-white p-8 max-w-md w-full text-center shadow-sm">
        <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="text-sm text-slate-500 mt-2">
          An unexpected error occurred. Our team has been notified.
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400 mt-1 font-mono">Error ID: {error.digest}</p>
        )}
        <Button className="mt-6 w-full" onClick={reset}>
          Try again
        </Button>
        <a href="/dashboard" className="mt-3 block text-sm text-blue-600 hover:underline">
          Return to Dashboard
        </a>
      </div>
    </div>
  );
}
