'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Building2, Users, CreditCard, Bot, TrendingUp, Activity,
  AlertTriangle, Sparkles, ArrowRight,
} from 'lucide-react';
import {
  SaPageHeader, SaPanel, SaStatCard, SaStatusBadge, SaPlanBadge, StoreAvatar,
} from '@/components/super-admin/ui';

interface DashboardStats {
  total_stores: number;
  active_stores: number;
  trial_stores: number;
  expired_stores: number;
  suspended_stores: number;
  new_stores_today: number;
  total_users: number;
  active_subscriptions: number;
  monthly_revenue: number;
  ai_requests_month: number;
  ai_tokens_month: number;
}

export default function SuperAdminDashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['super-admin-stats'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/stats');
      if (!res.ok) throw new Error('Failed');
      const json = await res.json() as { data: DashboardStats };
      return json.data;
    },
    refetchInterval: 60_000,
  });

  const { data: recentStores } = useQuery({
    queryKey: ['super-admin-recent-stores'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/stores?limit=6');
      if (!res.ok) return [];
      const json = await res.json() as { data: Array<Record<string, string>> };
      return json.data ?? [];
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ['super-admin-alerts'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/notifications?unread=true');
      if (!res.ok) return [];
      const json = await res.json() as { data: Array<{ id: string; title: string; severity: string; message?: string }> };
      return json.data?.slice(0, 5) ?? [];
    },
  });

  return (
    <div>
      <SaPageHeader
        title="Platform Dashboard"
        description="Real-time overview of stores, revenue, subscriptions, and system health"
      />

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-900/40 border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
          <SaStatCard title="Total Stores" value={stats?.total_stores ?? 0} icon={Building2} gradient="from-indigo-500 to-violet-600" />
          <SaStatCard title="Active Stores" value={stats?.active_stores ?? 0} icon={Activity} gradient="from-emerald-500 to-teal-600" />
          <SaStatCard title="Trial Stores" value={stats?.trial_stores ?? 0} icon={Sparkles} gradient="from-violet-500 to-purple-600" />
          <SaStatCard title="Expired" value={stats?.expired_stores ?? 0} icon={AlertTriangle} gradient="from-red-500 to-rose-600" />
          <SaStatCard title="New Today" value={stats?.new_stores_today ?? 0} icon={TrendingUp} gradient="from-cyan-500 to-blue-600" />
          <SaStatCard title="Monthly Revenue" value={`$${Number(stats?.monthly_revenue ?? 0).toLocaleString()}`} icon={CreditCard} gradient="from-green-500 to-emerald-600" />
          <SaStatCard title="Subscriptions" value={stats?.active_subscriptions ?? 0} icon={CreditCard} gradient="from-blue-500 to-indigo-600" />
          <SaStatCard title="Total Users" value={stats?.total_users ?? 0} icon={Users} gradient="from-orange-500 to-amber-600" />
          <SaStatCard
            title="AI Usage"
            value={(stats?.ai_requests_month ?? 0).toLocaleString()}
            sub={`${((stats?.ai_tokens_month ?? 0) / 1000).toFixed(1)}k tokens this month`}
            icon={Bot}
            gradient="from-fuchsia-500 to-pink-600"
          />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <SaPanel>
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <h2 className="font-semibold text-slate-100">Recent Stores</h2>
            <Link href="/super-admin/stores" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recentStores?.map((s) => (
              <Link
                key={s.id}
                href={`/super-admin/stores/${s.id}`}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors group"
              >
                <StoreAvatar name={s.name as string} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">{s.name}</p>
                  <p className="text-xs text-slate-500 truncate">{s.owner_email ?? s.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <SaPlanBadge plan={s.subscription_plan as string} />
                  <SaStatusBadge status={s.subscription_status as string} />
                </div>
              </Link>
            ))}
            {!recentStores?.length && (
              <p className="text-center py-10 text-slate-500 text-sm">No stores yet</p>
            )}
          </div>
        </SaPanel>

        <SaPanel>
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <h2 className="font-semibold text-slate-100">Platform Alerts</h2>
            <Link href="/super-admin/notifications" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="p-4 space-y-2.5">
            {alerts?.length ? alerts.map((a) => (
              <div
                key={a.id}
                className={`rounded-xl border p-3.5 transition-colors ${
                  a.severity === 'critical' ? 'border-red-500/25 bg-red-500/8' :
                  a.severity === 'warning' ? 'border-amber-500/25 bg-amber-500/8' :
                  'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <p className="text-sm font-medium text-slate-200">{a.title}</p>
                {a.message && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{a.message}</p>}
              </div>
            )) : (
              <p className="text-sm text-slate-500 py-10 text-center">No unread alerts — all clear</p>
            )}
          </div>
        </SaPanel>
      </div>
    </div>
  );
}
