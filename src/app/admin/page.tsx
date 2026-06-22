'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Users, CreditCard, Activity, TrendingUp } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface AdminStats {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  expiredTenants: number;
  totalUsers: number;
}

interface RecentStore {
  id: string;
  name: string;
  email: string | null;
  subscription_plan: string | null;
  subscription_status: string;
  created_at: string;
}

function StatCard({ title, value, icon: Icon, color }: {
  title: string; value: number; icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) throw new Error('Failed to load stats');
      const json = await res.json() as { data: AdminStats };
      return {
        totalTenants: json.data.totalTenants,
        activeTenants: json.data.activeTenants,
        trialTenants: json.data.trialTenants,
        expiredTenants: json.data.expiredTenants,
        totalUsers: json.data.totalUsers,
      };
    },
  });

  const { data: recentStores } = useQuery<RecentStore[]>({
    queryKey: ['admin-recent-stores'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stores?limit=10');
      if (!res.ok) return [];
      const json = await res.json() as { data: RecentStore[] };
      return json.data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const STATUS_BADGE: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trial: 'bg-blue-100 text-blue-800',
    expired: 'bg-red-100 text-red-800',
    suspended: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.overviewTitle')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('admin.overviewDesc')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title={t('admin.statTotalTenants')} value={stats?.totalTenants ?? 0} icon={Building2} color="bg-blue-500" />
        <StatCard title={t('admin.statActive')} value={stats?.activeTenants ?? 0} icon={Activity} color="bg-green-500" />
        <StatCard title={t('admin.statOnTrial')} value={stats?.trialTenants ?? 0} icon={TrendingUp} color="bg-purple-500" />
        <StatCard title={t('admin.statExpired')} value={stats?.expiredTenants ?? 0} icon={CreditCard} color="bg-red-500" />
        <StatCard title={t('admin.statTotalUsers')} value={stats?.totalUsers ?? 0} icon={Users} color="bg-orange-500" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.recentTenants')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">{t('admin.colStoreName')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('admin.colEmail')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('admin.colPlan')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('admin.colStatus')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('admin.colCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {recentStores?.map((store) => (
                  <tr key={store.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{store.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{store.email ?? '—'}</td>
                    <td className="px-4 py-3 capitalize">{store.subscription_plan?.replace('_', ' ') ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[store.subscription_status] ?? ''}`}>
                        {store.subscription_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(store.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {!recentStores?.length && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">{t('admin.noTenants')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
