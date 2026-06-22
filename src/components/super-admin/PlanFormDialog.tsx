'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

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
}

interface Props {
  plan: Plan | null;
  open: boolean;
  onClose: () => void;
}

export function PlanFormDialog({ plan, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    slug: plan?.slug ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price_usd: plan?.price_usd ?? 0,
    billing_cycle: plan?.billing_cycle ?? 'monthly',
    max_users: plan?.max_users ?? '',
    max_products: plan?.max_products ?? '',
    ai_monthly_requests: plan?.ai_monthly_requests ?? '',
    ai_monthly_tokens: plan?.ai_monthly_tokens ?? '',
    reports_access: plan?.reports_access ?? true,
    accounting_access: plan?.accounting_access ?? true,
    inventory_access: plan?.inventory_access ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...(plan ? { id: plan.id } : {}),
        slug: form.slug,
        name: form.name,
        description: form.description || null,
        price_usd: Number(form.price_usd),
        billing_cycle: form.billing_cycle,
        max_users: form.max_users === '' ? null : Number(form.max_users),
        max_products: form.max_products === '' ? null : Number(form.max_products),
        ai_monthly_requests: form.ai_monthly_requests === '' ? null : Number(form.ai_monthly_requests),
        ai_monthly_tokens: form.ai_monthly_tokens === '' ? null : Number(form.ai_monthly_tokens),
        reports_access: form.reports_access,
        accounting_access: form.accounting_access,
        inventory_access: form.inventory_access,
      };
      const res = await fetch('/api/super-admin/plans', {
        method: plan ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-plans'] });
      toast.success(plan ? 'Plan updated' : 'Plan created');
      onClose();
    },
    onError: () => toast.error('Save failed'),
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => set('slug', e.target.value)} className="bg-slate-800 border-slate-700" disabled={!!plan} /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
          </div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} className="bg-slate-800 border-slate-700" rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Price (USD)</Label><Input type="number" value={form.price_usd} onChange={(e) => set('price_usd', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
            <div><Label>Billing Cycle</Label><Input value={form.billing_cycle} onChange={(e) => set('billing_cycle', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Max Users</Label><Input type="number" placeholder="Unlimited" value={form.max_users} onChange={(e) => set('max_users', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
            <div><Label>Max Products</Label><Input type="number" placeholder="Unlimited" value={form.max_products} onChange={(e) => set('max_products', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>AI Requests/mo</Label><Input type="number" placeholder="Unlimited" value={form.ai_monthly_requests} onChange={(e) => set('ai_monthly_requests', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
            <div><Label>AI Tokens/mo</Label><Input type="number" placeholder="Unlimited" value={form.ai_monthly_tokens} onChange={(e) => set('ai_monthly_tokens', e.target.value)} className="bg-slate-800 border-slate-700" /></div>
          </div>
          <div className="flex gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.reports_access} onCheckedChange={(v) => set('reports_access', v)} /> Reports</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.accounting_access} onCheckedChange={(v) => set('accounting_access', v)} /> Accounting</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.inventory_access} onCheckedChange={(v) => set('inventory_access', v)} /> Inventory</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save Plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
