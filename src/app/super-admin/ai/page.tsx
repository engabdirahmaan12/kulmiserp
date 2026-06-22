'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Bot, Zap, Coins, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SaPageHeader, SaPanel, SaStatCard, sa } from '@/components/super-admin/ui';
import { cn } from '@/lib/utils';

export default function SuperAdminAiPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-ai'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/ai');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{
        data: {
          settings: { enabled?: boolean; default_monthly_requests?: number; default_monthly_tokens?: number };
          summary: { requests: number; tokens: number; cost: number; active_stores: number; stores_using_ai: number };
          top_stores: Array<{ store_id: string; name: string; requests: number; tokens: number; cost: number }>;
        };
      }>;
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/super-admin/ai', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-ai'] });
      toast.success('AI settings updated');
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  const settings = data?.data.settings ?? {};
  const summary = data?.data.summary;

  return (
    <div>
      <SaPageHeader
        title="AI Management"
        description="Global AI features, usage limits, and cost tracking across all stores"
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <SaStatCard title="Requests (Month)" value={summary?.requests ?? 0} icon={Bot} gradient="from-fuchsia-500 to-pink-600" />
        <SaStatCard title="Tokens Used" value={`${((summary?.tokens ?? 0) / 1000).toFixed(1)}k`} icon={Zap} gradient="from-violet-500 to-purple-600" />
        <SaStatCard title="Est. Cost" value={`$${(summary?.cost ?? 0).toFixed(4)}`} icon={Coins} gradient="from-amber-500 to-orange-600" />
        <SaStatCard title="Stores Using AI" value={summary?.stores_using_ai ?? 0} icon={Store} gradient="from-cyan-500 to-blue-600" />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <SaPanel className="lg:col-span-2 p-6">
          <h2 className="font-semibold text-slate-100 mb-1">Global AI Settings</h2>
          <p className="text-xs text-slate-500 mb-6">Platform-wide defaults for all stores</p>

          <div className="space-y-5">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div>
                <Label className="text-slate-200">Enable AI Platform-wide</Label>
                <p className="text-xs text-slate-500 mt-0.5">Allow stores to use AI copilot</p>
              </div>
              <Switch
                checked={settings.enabled !== false}
                onCheckedChange={(v) => updateSettings.mutate({ global_enabled: v })}
              />
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Default Monthly Requests</Label>
              <Input
                type="number"
                defaultValue={settings.default_monthly_requests ?? 500}
                className={cn(sa.input, 'mt-1.5')}
                onBlur={(e) => updateSettings.mutate({ default_monthly_requests: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Default Monthly Tokens</Label>
              <Input
                type="number"
                defaultValue={settings.default_monthly_tokens ?? 500000}
                className={cn(sa.input, 'mt-1.5')}
                onBlur={(e) => updateSettings.mutate({ default_monthly_tokens: Number(e.target.value) })}
              />
            </div>
          </div>
        </SaPanel>

        <SaPanel className="lg:col-span-3 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <h2 className="font-semibold text-slate-100">Top AI Consumers</h2>
            <p className="text-xs text-slate-500 mt-0.5">This month</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-500">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider">Store</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">Requests</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">Tokens</th>
                  <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wider">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data?.data.top_stores.map((s, i) => (
                  <tr key={s.store_id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-slate-300">{s.name}</span>
                      {i === 0 && s.requests > 0 && (
                        <span className="ml-2 text-[10px] text-fuchsia-400 font-medium">Top</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-400 tabular-nums">{s.requests}</td>
                    <td className="px-4 py-3.5 text-right text-slate-400 tabular-nums">{s.tokens.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right text-slate-400 tabular-nums">${s.cost.toFixed(4)}</td>
                  </tr>
                ))}
                {!data?.data.top_stores.length && (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-slate-500">No AI usage this month</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SaPanel>
      </div>
    </div>
  );
}
