'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { SplashLoader } from '@/components/layout/SplashLoader';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isLoading, isInitialized, user, currentStore } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isInitialized || user) return;
    const id = window.setTimeout(() => router.replace('/login'), 0);
    return () => window.clearTimeout(id);
  }, [isInitialized, user, router]);

  if (!isInitialized || isLoading) {
    return <SplashLoader isLoading={true} />;
  }

  if (!user) {
    return <SplashLoader isLoading={true} />;
  }

  // Show billing banner when subscription is expired/suspended/cancelled,
  // or when on trial but the trial period has already ended.
  const isExpired = (() => {
    if (!currentStore) return false;
    const { subscription_status, trial_ends_at } = currentStore;
    if (subscription_status === 'active') return false;
    if (subscription_status === 'trial') {
      return trial_ends_at ? new Date(trial_ends_at) < new Date() : false;
    }
    return true; // expired | suspended | cancelled
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100/80">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex">
        <Sidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Sidebar
          isCollapsed={false}
          onToggle={() => setMobileSidebarOpen(false)}
        />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Navbar
          onMenuClick={() => setMobileSidebarOpen(true)}
          title={currentStore?.name}
        />

        {isExpired && (
          <div className="bg-red-600 text-white text-center py-2 text-sm px-4">
            Your subscription has expired.{' '}
            <a href="/dashboard/billing" className="underline font-semibold">
              Renew now to continue using KULMIS ERP
            </a>
          </div>
        )}

        <main className="flex-1 overflow-auto app-surface">
          <div className="page-transition h-full min-h-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
