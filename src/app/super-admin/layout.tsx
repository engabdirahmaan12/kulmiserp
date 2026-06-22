'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity, Bell, Bot, Building2, CreditCard, LayoutDashboard,
  Loader2, LogOut, Shield, ShieldAlert, Store, FileText, Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { getPlatformRole, PLATFORM_ROLE_LABELS, type PlatformRole } from '@/lib/platform/roles';

const NAV = [
  { href: '/super-admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/super-admin/stores', label: 'Stores', icon: Building2 },
  { href: '/super-admin/plans', label: 'Plans', icon: CreditCard },
  { href: '/super-admin/payments', label: 'Payments', icon: Activity },
  { href: '/super-admin/ai', label: 'AI Management', icon: Bot },
  { href: '/super-admin/notifications', label: 'Alerts', icon: Bell },
  { href: '/super-admin/audit', label: 'Audit Logs', icon: FileText },
  { href: '/super-admin/security', label: 'Security', icon: Shield },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(pathname !== '/super-admin/login');
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState<PlatformRole | null>(null);
  const [email, setEmail] = useState('');
  const [hasStoreAccess, setHasStoreAccess] = useState(false);

  useEffect(() => {
    if (pathname === '/super-admin/login') return;

    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace('/super-admin/login');
        return;
      }
      const platformRole = getPlatformRole(user);
      if (!platformRole) {
        router.replace('/dashboard');
        return;
      }

      const [{ count: memberCount }, { count: ownedCount }] = await Promise.all([
        supabase.from('store_users').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_active', true),
        supabase.from('stores').select('*', { count: 'exact', head: true }).eq('owner_id', user.id),
      ]);

      setHasStoreAccess((memberCount ?? 0) > 0 || (ownedCount ?? 0) > 0);
      setRole(platformRole);
      setEmail(user.email ?? '');
      setAuthorized(true);
      setChecking(false);
    });
  }, [router, pathname]);

  if (pathname === '/super-admin/login') {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070b14]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-9 w-9 animate-spin text-indigo-400" />
          <p className="text-sm text-slate-500">Loading platform…</p>
        </div>
      </div>
    );
  }

  if (!authorized) return null;

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/super-admin/login');
  };

  return (
    <div className="flex min-h-screen bg-[#070b14] text-slate-100">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="absolute top-1/2 -left-32 h-80 w-80 rounded-full bg-violet-600/8 blur-3xl" />
        <div className="absolute bottom-0 right-1/3 h-64 w-64 rounded-full bg-cyan-600/5 blur-3xl" />
      </div>

      <aside className="relative z-10 w-[260px] shrink-0 border-r border-white/[0.06] bg-slate-950/70 backdrop-blur-2xl flex flex-col">
        <div className="px-5 py-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 shadow-lg shadow-indigo-500/25">
              <ShieldAlert className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-sm text-slate-50">Super Admin</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.15em] font-medium">KULMIS Platform</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Menu</p>
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/super-admin' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  active
                    ? 'bg-gradient-to-r from-indigo-600/90 to-violet-600/80 text-white shadow-lg shadow-indigo-600/20'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active && 'drop-shadow-sm')} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/[0.06] space-y-1.5">
          <div className="px-3 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-3 w-3 text-indigo-400" />
              <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wide">
                {role ? PLATFORM_ROLE_LABELS[role] : 'Platform'}
              </p>
            </div>
            <p className="text-xs text-slate-400 truncate">{email}</p>
          </div>
          {hasStoreAccess && (
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 transition-colors"
            >
              <Store className="h-4 w-4" /> Store Dashboard
            </Link>
          )}
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-auto">
        <div className="page-transition p-5 md:p-8 max-w-[1400px] mx-auto stagger-children">
          {children}
        </div>
      </main>
    </div>
  );
}
