'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, ShieldAlert, Store } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { navActive } from '@/lib/ui-classes';

const NAV_GROUPS = [
  {
    label: 'Platform',
    items: [
      { href: '/admin', label: 'Overview & Health' },
      { href: '/admin/tenants', label: 'Stores & Activation' },
      { href: '/admin/users', label: 'Platform Users' },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { href: '/admin/billing', label: 'Plans, Trials & Billing' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/logs', label: 'Platform Audit Logs' },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [hasStoreAccess, setHasStoreAccess] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      const isSuperAdmin = user.app_metadata?.role === 'super_admin';
      if (!isSuperAdmin) {
        router.replace('/dashboard');
        return;
      }

      const [{ count: memberCount }, { count: ownedCount }] = await Promise.all([
        supabase
          .from('store_users')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_active', true),
        supabase
          .from('stores')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', user.id),
      ]);

      setHasStoreAccess((memberCount ?? 0) > 0 || (ownedCount ?? 0) > 0);
      setAuthorized(true);
      setChecking(false);
    });
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center app-surface">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="flex min-h-screen bg-slate-100/80">
      <aside className="w-64 border-r border-slate-200/80 bg-white/95 backdrop-blur-xl flex flex-col shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-100">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-blue-200/40">
            <ShieldAlert className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="font-bold text-sm text-slate-900">Platform Admin</span>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">KULMIS ERP</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'block px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                        active
                          ? navActive
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-100 space-y-1">
          {hasStoreAccess ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <Store className="h-4 w-4" />
              Store Dashboard
            </Link>
          ) : (
            <p className="px-3 py-2 text-xs text-slate-400 leading-relaxed">
              Platform operators manage stores here — not day-to-day POS or inventory.
            </p>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-auto app-surface">
        <div className="page-transition p-4 md:p-6 max-w-screen-2xl mx-auto stagger-children">
          {children}
        </div>
      </main>
    </div>
  );
}
