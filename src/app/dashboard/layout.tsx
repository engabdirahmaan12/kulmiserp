'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { SplashLoader } from '@/components/layout/SplashLoader';
import { useAuth } from '@/lib/hooks/useAuth';
import { CommandPalette, useCommandPalette } from '@/components/intelligence/CommandPalette';
import { KulmisAiCopilot } from '@/components/ai/KulmisAiCopilot';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();
  const { isLoading, isInitialized, user, currentStore, stores } = useAuth();
  const { t, isRtl } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (!isInitialized || user) return;
    const id = window.setTimeout(() => router.replace('/login'), 0);
    return () => window.clearTimeout(id);
  }, [isInitialized, user, router]);

  // Platform-only super admins belong on /admin, not store operations
  useEffect(() => {
    if (!isInitialized || !user) return;
    if (stores.length > 0 || currentStore) return;

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (authUser?.app_metadata?.role === 'super_admin' || authUser?.app_metadata?.platform_role) {
        router.replace('/super-admin');
      }
    });
  }, [isInitialized, user, stores, currentStore, router]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileSidebarOpen]);

  if (!isInitialized || isLoading) {
    return <SplashLoader isLoading={true} />;
  }

  if (!user) {
    return <SplashLoader isLoading={true} />;
  }

  const isExpired =
    currentStore &&
    currentStore.subscription_status !== 'active' &&
    currentStore.subscription_status !== 'trial';

  const isTrialExpired =
    currentStore &&
    currentStore.subscription_status === 'trial' &&
    currentStore.trial_ends_at &&
    new Date(currentStore.trial_ends_at) < new Date();

  const isBlocked = isExpired || isTrialExpired;

  return (
    <div suppressHydrationWarning className="flex h-[100dvh] overflow-hidden bg-slate-50">
      <div className="hidden lg:flex shrink-0">
        <Suspense fallback={null}>
          <Sidebar
            isCollapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </Suspense>
      </div>

      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'fixed inset-y-0 z-50 lg:hidden transition-transform duration-300 ease-out',
          isRtl ? 'right-0' : 'left-0',
          mobileSidebarOpen
            ? 'translate-x-0'
            : isRtl
              ? 'translate-x-full'
              : '-translate-x-full',
        )}
      >
        <Suspense fallback={null}>
          <Sidebar
            isCollapsed={false}
            onToggle={() => setMobileSidebarOpen(false)}
            showMobileClose
          />
        </Suspense>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Navbar
          onMenuClick={() => setMobileSidebarOpen(true)}
          title={currentStore?.name}
          onOpenCommand={() => setCommandOpen(true)}
        />

        {isBlocked && (
          <div className="bg-red-600 text-white text-center py-2 text-sm px-4 shrink-0">
            {t('subscription.expiredBanner')}{' '}
            <a href="/dashboard/billing" className="underline font-semibold">
              {t('subscription.renewLink')}
            </a>
          </div>
        )}

        <main className="flex-1 overflow-auto overflow-x-hidden app-surface">
          {isBlocked ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
              <div className="rounded-2xl border border-red-200 bg-red-50 p-8 max-w-md w-full dark:border-red-900/40 dark:bg-red-950/20">
                <div className="text-4xl mb-3">🔒</div>
                <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">Subscription Required</h2>
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  Your subscription has expired. Renew to continue using KULMIS ERP.
                </p>
                <a
                  href="/dashboard/billing"
                  className="mt-5 inline-block rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                >
                  Renew Subscription →
                </a>
              </div>
            </div>
          ) : (
            <div className="page-transition h-full min-h-0 max-w-full">{children}</div>
          )}
        </main>
        {commandOpen ? (
          <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        ) : null}
        <KulmisAiCopilot />
      </div>
    </div>
  );
}
