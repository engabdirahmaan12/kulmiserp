'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Search, Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ExtendSubscriptionDialog } from '@/components/super-admin/ExtendSubscriptionDialog';
import { StoreGridCard, type StoreGridItem } from '@/components/super-admin/StoreGridCard';
import { StoreActionsMenu, type StoreActionTarget } from '@/components/super-admin/StoreActionsMenu';
import {
  sa, SaPageHeader, SaPanel, SaViewToggle, SaEmptyState, SaSkeletonGrid,
  SaStatusBadge, SaPlanBadge, StoreAvatar,
} from '@/components/super-admin/ui';
import { cn } from '@/lib/utils';

const VIEW_KEY = 'super-admin-stores-view';

export default function SuperAdminStoresPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useState<'list' | 'grid'>('grid');
  const [extendStore, setExtendStore] = useState<StoreActionTarget | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'list' || saved === 'grid') setView(saved);
  }, []);

  const setViewPersist = (v: 'list' | 'grid') => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const { data: stores, isLoading } = useQuery<StoreGridItem[]>({
    queryKey: ['super-admin-stores', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/super-admin/stores?${params}`);
      if (!res.ok) throw new Error('Failed');
      const json = await res.json() as { data: StoreGridItem[] };
      return json.data ?? [];
    },
  });

  const action = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/super-admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-stores'] });
      toast.success('Store updated');
    },
    onError: () => toast.error('Action failed'),
  });

  const impersonate = useMutation({
    mutationFn: async (storeId: string) => {
      const res = await fetch(`/api/super-admin/stores/${storeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'impersonate' }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ data: { magic_link: string; owner_email: string } }>;
    },
    onSuccess: (data) => {
      if (data.data.magic_link) {
        window.open(data.data.magic_link, '_blank');
        toast.success(`Impersonation link opened for ${data.data.owner_email}`);
      }
    },
    onError: () => toast.error('Impersonation failed'),
  });

  const resetPassword = useMutation({
    mutationFn: async (storeId: string) => {
      const res = await fetch(`/api/super-admin/stores/${storeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password' }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ data: { temporary_password: string } }>;
    },
    onSuccess: (data) => {
      toast.success(`Temporary password: ${data.data.temporary_password}`, { duration: 15000 });
    },
    onError: () => toast.error('Reset failed'),
  });

  const filtered = (stores ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.owner_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (s.email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const actionHandlers = {
    onExtend: setExtendStore,
    onSuspend: (id: string) => action.mutate({ store_id: id, action: 'suspend' }),
    onActivate: (id: string) => action.mutate({ store_id: id, action: 'activate' }),
    onFreeze: (id: string) => action.mutate({ store_id: id, action: 'freeze', freeze_reason: 'Frozen by admin' }),
    onImpersonate: (id: string) => impersonate.mutate(id),
    onResetPassword: (id: string) => resetPassword.mutate(id),
    onDisable: (id: string) => action.mutate({ store_id: id, action: 'disable' }),
  };

  return (
    <div>
      <SaPageHeader
        title="Store Management"
        description={`${filtered.length} store${filtered.length !== 1 ? 's' : ''} on the platform`}
        action={
          <>
            <SaViewToggle view={view} onChange={setViewPersist} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            className={cn(sa.input, 'pl-10')}
            placeholder="Search by store, owner, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className={cn(sa.input, 'w-44')}>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        view === 'grid' ? <SaSkeletonGrid /> : (
          <SaPanel className="py-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
          </SaPanel>
        )
      ) : !filtered.length ? (
        <SaPanel>
          <SaEmptyState title="No stores found" description="Try adjusting your search or filters." />
        </SaPanel>
      ) : view === 'grid' ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s, i) => (
            <StoreGridCard key={s.id} store={s} index={i} {...actionHandlers} />
          ))}
        </div>
      ) : (
        <SaPanel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-500">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider">Store</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider">Owner</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider hidden lg:table-cell">Country</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider">Plan</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider hidden md:table-cell">Expiry</th>
                  <th className="text-right px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr
                    key={s.id}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-200 sa-enter"
                    style={{ animationDelay: `${Math.min(i * 30, 200)}ms` }}
                  >
                    <td className="px-5 py-4">
                      <Link href={`/super-admin/stores/${s.id}`} className="flex items-center gap-3 group">
                        <StoreAvatar name={s.name} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-100 group-hover:text-indigo-300 transition-colors truncate">{s.name}</p>
                          <p className="text-xs text-slate-500 truncate">{s.email ?? s.phone ?? '—'}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-slate-300 truncate max-w-[140px]">{s.owner_name}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[140px]">{s.owner_email}</p>
                    </td>
                    <td className="px-4 py-4 text-slate-400 hidden lg:table-cell">{s.country ?? '—'}</td>
                    <td className="px-4 py-4"><SaPlanBadge plan={s.subscription_plan ?? null} /></td>
                    <td className="px-4 py-4"><SaStatusBadge status={s.subscription_status} /></td>
                    <td className="px-4 py-4 text-slate-400 text-xs hidden md:table-cell">
                      {s.subscription_ends_at ? new Date(s.subscription_ends_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <StoreActionsMenu store={s} {...actionHandlers} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SaPanel>
      )}

      {!isLoading && filtered.length > 0 && (
        <p className="text-center text-xs text-slate-600 mt-6 flex items-center justify-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Showing {filtered.length} of {stores?.length ?? 0} stores
        </p>
      )}

      {extendStore && (
        <ExtendSubscriptionDialog
          store={extendStore}
          open={!!extendStore}
          onClose={() => setExtendStore(null)}
        />
      )}
    </div>
  );
}
