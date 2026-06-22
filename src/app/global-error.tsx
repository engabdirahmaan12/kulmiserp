'use client';

import { useEffect } from 'react';

/** Root layout error boundary — only this file may render html/body. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[KULMIS] Root layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-50">
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="rounded-2xl border border-red-200 bg-white p-8 max-w-md w-full text-center shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-500 mt-2">
              A critical error occurred. Please refresh the page.
            </p>
            {error.digest && (
              <p className="text-xs text-slate-400 mt-1 font-mono">Error ID: {error.digest}</p>
            )}
            <button
              type="button"
              className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              onClick={reset}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
