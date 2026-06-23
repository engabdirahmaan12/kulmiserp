'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthBootstrap } from '@/components/auth/AuthBootstrap';
import { I18nProvider } from '@/components/i18n/I18nProvider';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false} disableTransitionOnChange>
        <TooltipProvider delay={0}>
          <I18nProvider>
            <AuthBootstrap>
              <div suppressHydrationWarning className="contents">
                {children}
              </div>
            </AuthBootstrap>
          </I18nProvider>
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
