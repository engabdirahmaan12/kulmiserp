'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { PlanFormDialog } from '@/components/super-admin/PlanFormDialog';

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_usd: number;
  billing_cycle: string;
  max_users: number | null;
  max_products: number | null;
  ai_monthly_requests: number | null;
  ai_monthly_tokens: number | null;
  reports_access: boolean;
  accounting_access: boolean;
  inventory_access: boolean;
  is_active: boolean;
  features: string[];
}

export default function SuperAdminPlansPage() {
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useQuery<Plan[]>({
    queryKey: ['super-admin-plans'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/plans');
      if (!res.ok) throw new Error('Failed');
      const json = await res.json() as { data: Plan[] };
      return json.data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (plan: Plan) => {
      const res = await fetch('/api/super-admin/plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: plan.id, is_active: !plan.is_active }),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-plans'] });
      toast.success('Plan updated');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Plan Management</h1>
          <p className="text-slate-400 text-sm mt-1">Configure subscription plans and feature limits</p>
        </div>
        <Button onClick={() => setCreating(true)} className="bg-indigo-600 hover:bg-indigo-500">
          <Plus className="h-4 w-4 mr-1" /> Create Plan
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans?.map((plan) => (
            <Card key={plan.id} className={`border-slate-800 bg-slate-900/60 ${!plan.is_active ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg text-slate-100">{plan.name}</CardTitle>
                    <p className="text-xs text-slate-500 mt-0.5">{plan.slug}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditing(plan)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-3xl font-bold text-indigo-400">
                  ${plan.price_usd}
                  <span className="text-sm text-slate-500 font-normal">/{plan.billing_cycle}</span>
                </p>
                {plan.description && <p className="text-xs text-slate-400">{plan.description}</p>}
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>Users: {plan.max_users ?? 'Unlimited'}</li>
                  <li>Products: {plan.max_products ?? 'Unlimited'}</li>
                  <li>AI requests/mo: {plan.ai_monthly_requests ?? 'Unlimited'}</li>
                  <li>Reports: {plan.reports_access ? '✓' : '✗'} · Accounting: {plan.accounting_access ? '✓' : '✗'} · Inventory: {plan.inventory_access ? '✓' : '✗'}</li>
                </ul>
                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <span className="text-xs text-slate-500">Active</span>
                  <Switch checked={plan.is_active} onCheckedChange={() => toggleActive.mutate(plan)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <PlanFormDialog
          plan={editing}
          open={creating || !!editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
