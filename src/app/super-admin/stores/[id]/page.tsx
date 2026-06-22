'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Package, ShoppingCart, Receipt, Users, Bot, HardDrive,
  Calendar, Mail, Phone, Globe, MapPin, Clock, DollarSign, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ExtendSubscriptionDialog } from '@/components/super-admin/ExtendSubscriptionDialog';
import {
  SaPanel, SaStatusBadge, SaPlanBadge, StoreAvatar, sa,
} from '@/components/super-admin/ui';
import { cn } from '@/lib/utils';

export default function SuperAdminStoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showExtend, setShowExtend] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-store', id],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/stores/${id}`);
      if (!res.ok) throw new Error('Not found');
      return res.json() as Promise<{
        data: {
          store: Record<string, unknown>;
          owner: Record<string, unknown>;
          plan: Record<string, unknown> | null;
          usage: Record<string, number>;
          members: Array<{ role: string; user_profiles?: { full_name?: string } }>;
        };
      }>;
    },
    enabled: !!id,
  });

  const storeAction = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/super-admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: id, ...payload }),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-store', id] });
      toast.success('Store updated');
    },
    onError: () => toast.error('Action failed'),
  });

  const action = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/super-admin/stores/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-store', id] });
      if (vars.action === 'impersonate') toast.success('Impersonation link opened');
      else toast.success('Updated');
    },
    onError: () => toast.error('Action failed'),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm text-slate-500">Loading store…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <SaPanel className="p-12 text-center">
        <p className="text-slate-400">Store not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/super-admin/stores')}>
          Back to stores
        </Button>
      </SaPanel>
    );
  }

  const { store, owner, plan, usage, members } = data.data;
  const fmt = (n: number) => n?.toLocaleString?.() ?? '0';
  const storeName = store.name as string;
  const isActive = store.is_active as boolean;

  const usageStats = [
    { icon: Package, label: 'Products', value: fmt(usage.products_count), color: 'text-indigo-400' },
    { icon: ShoppingCart, label: 'Sales', value: fmt(usage.sales_count), color: 'text-emerald-400' },
    { icon: Receipt, label: 'Purchases', value: fmt(usage.purchases_count), color: 'text-sky-400' },
    { icon: Receipt, label: 'Invoices', value: fmt(usage.invoices_count), color: 'text-violet-400' },
    { icon: Users, label: 'Team', value: fmt(members.length || usage.users_count), color: 'text-orange-400' },
    { icon: HardDrive, label: 'Storage', value: `${((Number(store.storage_bytes) || 0) / 1024 / 1024).toFixed(1)} MB`, color: 'text-cyan-400' },
    { icon: Bot, label: 'AI Requests', value: fmt(usage.ai_requests_month), color: 'text-fuchsia-400' },
    { icon: Sparkles, label: 'AI Tokens', value: fmt(usage.ai_tokens_month), color: 'text-pink-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <button
          type="button"
          onClick={() => router.push('/super-admin/stores')}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Back to stores
        </button>

        <div className="flex flex-1 items-center gap-4 min-w-0">
          <StoreAvatar name={storeName} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-50 tracking-tight truncate">{storeName}</h1>
              <SaStatusBadge status={store.subscription_status as string} />
              <SaPlanBadge plan={store.subscription_plan as string} />
            </div>
            <p className="text-slate-400 text-sm truncate">{owner.email as string}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 bg-white/[0.03] hover:bg-indigo-600/15 hover:border-indigo-500/40 text-slate-200"
            onClick={() => setShowExtend(true)}
          >
            Extend
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 bg-white/[0.03] hover:bg-violet-600/15 hover:border-violet-500/40 text-slate-200"
            onClick={() => action.mutate({ action: 'impersonate' })}
          >
            Impersonate
          </Button>
          {isActive ? (
            <Button size="sm" variant="destructive" onClick={() => storeAction.mutate({ action: 'suspend' })}>
              Suspend
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500"
              onClick={() => action.mutate({ action: 'reactivate' })}
            >
              Activate
            </Button>
          )}
        </div>
      </div>

      {/* Revenue strip */}
      <SaPanel className="p-4 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/25">
            <DollarSign className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Revenue</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">${Number(usage.revenue ?? 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
        <div>
          <p className="text-xs text-slate-500">AI cost (month)</p>
          <p className="text-sm font-medium text-slate-300 tabular-nums">${Number(usage.ai_cost_month ?? 0).toFixed(4)}</p>
        </div>
        <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
        <div>
          <p className="text-xs text-slate-500">AI enabled</p>
          <p className="text-sm font-medium text-slate-300">{(store.ai_enabled as boolean) ? 'Yes' : 'No'}</p>
        </div>
      </SaPanel>

      {/* Info cards */}
      <div className="grid md:grid-cols-2 gap-5">
        <SaPanel className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <h2 className="font-semibold text-slate-100">Store Information</h2>
          </div>
          <div className="p-5 space-y-1">
            <InfoRow icon={Users} label="Owner" value={owner.full_name as string} />
            <InfoRow icon={Mail} label="Email" value={owner.email as string} />
            <InfoRow icon={Phone} label="Phone" value={(store.phone as string) ?? (owner.phone as string) ?? '—'} />
            <InfoRow icon={Globe} label="Country" value={(store.country as string) ?? '—'} />
            <InfoRow icon={MapPin} label="Address" value={(store.address as string) ?? '—'} />
            <InfoRow icon={Calendar} label="Created" value={new Date(store.created_at as string).toLocaleString()} />
            <InfoRow icon={Clock} label="Last Login" value={owner.last_sign_in ? new Date(owner.last_sign_in as string).toLocaleString() : '—'} />
          </div>
        </SaPanel>

        <SaPanel className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <h2 className="font-semibold text-slate-100">Subscription</h2>
          </div>
          <div className="p-5 space-y-1">
            <InfoRow icon={Sparkles} label="Plan" value={store.subscription_plan as string} badge="plan" />
            <InfoRow icon={Calendar} label="Expires" value={store.subscription_ends_at ? new Date(store.subscription_ends_at as string).toLocaleDateString() : '—'} />
            <InfoRow icon={Calendar} label="Trial Ends" value={store.trial_ends_at ? new Date(store.trial_ends_at as string).toLocaleDateString() : '—'} />
            {plan && (
              <>
                <InfoRow icon={Users} label="Max Users" value={plan.max_users != null ? String(plan.max_users) : 'Unlimited'} />
                <InfoRow icon={Package} label="Max Products" value={plan.max_products != null ? String(plan.max_products) : 'Unlimited'} />
              </>
            )}
          </div>
        </SaPanel>
      </div>

      {/* Usage stats */}
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Usage Statistics</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {usageStats.map((s, i) => (
            <div
              key={s.label}
              className={cn(sa.panel, sa.panelHover, 'p-4 sa-enter')}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <s.icon className={cn('h-5 w-5 mb-2', s.color)} />
              <p className="text-xl font-bold text-slate-50 tabular-nums">{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Team */}
      <SaPanel className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="font-semibold text-slate-100">Team Members</h2>
          <span className="text-xs text-slate-500">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        </div>
        {members.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-500">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider">Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5 text-slate-200">{m.user_profiles?.full_name ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-400 capitalize">
                        {m.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center py-10 text-slate-500 text-sm">No team members found</p>
        )}
      </SaPanel>

      {showExtend && (
        <ExtendSubscriptionDialog
          store={{ id: id!, name: storeName, subscription_plan: store.subscription_plan as string }}
          open={showExtend}
          onClose={() => setShowExtend(false)}
        />
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  badge?: 'plan';
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <Icon className="h-4 w-4 text-slate-600 shrink-0" />
      <span className="text-sm text-slate-500 w-28 shrink-0">{label}</span>
      <span className="text-sm text-slate-200 flex-1 text-right truncate">
        {badge === 'plan' ? <SaPlanBadge plan={value} /> : value}
      </span>
    </div>
  );
}
