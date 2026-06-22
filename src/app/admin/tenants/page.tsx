'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Tenant {
  id: string;
  name: string;
  email: string | null;
  subscription_plan: string | null;
  subscription_status: string;
  is_active: boolean;
  trial_ends_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  trial: 'bg-blue-100 text-blue-800',
  expired: 'bg-red-100 text-red-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export default function AdminTenantsPage() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: tenants, isLoading } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stores?limit=200');
      if (!res.ok) throw new Error('Failed to load tenants');
      const json = await res.json() as { data: Tenant[] };
      return json.data ?? [];
    },
  });

  const { mutate: toggleActive, isPending } = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const res = await fetch('/api/admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: id, is_active }),
      });
      if (!res.ok) throw new Error('Failed to update');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      toast.success(t('admin.toastTenantUpdated'));
    },
    onError: () => toast.error(t('admin.toastTenantError')),
  });

  const { mutate: setSubscription } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch('/api/admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: id, subscription_status: status }),
      });
      if (!res.ok) throw new Error('Failed to update');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      toast.success(t('admin.toastSubUpdated'));
    },
  });

  const filtered = (tenants ?? []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.tenantsTitle')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('admin.tenantsDesc')}</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t('admin.searchTenants')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colStore')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colPlan')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colStatus')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colActive')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colTrialEnds')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tenant) => (
                    <tr key={tenant.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground">{tenant.email ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 capitalize">{tenant.subscription_plan?.replace('_', ' ') ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[tenant.subscription_status] ?? ''}`}>
                          {tenant.subscription_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {tenant.is_active
                          ? <CheckCircle className="h-4 w-4 text-green-500" />
                          : <XCircle className="h-4 w-4 text-red-500" />}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={tenant.is_active ? 'destructive' : 'default'}
                            onClick={() => toggleActive({ id: tenant.id, is_active: !tenant.is_active })}
                            disabled={isPending}
                            className="h-7 text-xs"
                          >
                            {tenant.is_active ? t('admin.btnSuspend') : t('admin.btnActivate')}
                          </Button>
                          {tenant.subscription_status !== 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSubscription({ id: tenant.id, status: 'active' })}
                              className="h-7 text-xs"
                            >
                              {t('admin.btnSetActive')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-muted-foreground">{t('admin.noTenantsFound')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
