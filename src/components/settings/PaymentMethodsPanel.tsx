'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Wallet, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { DataPanel } from '@/components/layout/PageShell';
import { btnPrimary } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

const GROUP_LABELS: Record<string, string> = {
  cash: 'Cash & Bank',
  mobile: 'Mobile Money',
  other: 'Other',
};

const GROUP_OPTIONS: { value: 'cash' | 'mobile' | 'other'; label: string }[] = [
  { value: 'cash', label: 'Cash & Bank' },
  { value: 'mobile', label: 'Mobile Money' },
  { value: 'other', label: 'Other' },
];

function methodGroup(slug: string, category?: string | null): string {
  if (category) return category;
  return slug === 'cash' || slug === 'bank' || slug === 'cheque' ? 'cash' : 'mobile';
}

export function PaymentMethodsPanel() {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: methods = [], isLoading } = useStorePaymentMethods({ includeInactive: true });
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<'cash' | 'mobile' | 'other'>('mobile');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['store-payment-methods', currentStore?.id] });

  const { mutate: addMethod, isPending: isAdding } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_custom_payment_method', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_label: newLabel.trim(),
        p_category: newCategory,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to add payment method');
    },
    onSuccess: () => {
      toast.success('Payment method added');
      setNewLabel('');
      setNewCategory('mobile');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { mutate: toggleActive } = useMutation({
    mutationFn: async ({ id, label, isActive }: { id: string; label: string; isActive: boolean }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_payment_method', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_method_id: id,
        p_label: label,
        p_is_active: isActive,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to update payment method');
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DataPanel className="p-6 space-y-6">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
        <Wallet className="h-5 w-5 text-blue-600" />
        Payment Methods
      </h3>

      <p className="text-sm text-slate-500">
        These are the payment method choices shown at POS checkout and Custom Invoice. Add as many
        as you need — no accounting setup required.
      </p>

      <div className="space-y-2">
        {isLoading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : (
          methods.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">{m.label}</Label>
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-slate-100 text-slate-500 px-2 py-0.5">
                    {GROUP_LABELS[methodGroup(m.slug, m.category)] ?? 'Other'}
                  </span>
                </div>
                {m.is_system && (
                  <p className="text-xs text-slate-400 mt-1">Default method</p>
                )}
              </div>
              <Switch
                checked={m.is_active}
                onCheckedChange={(checked) =>
                  toggleActive({ id: m.id, label: m.label, isActive: checked })
                }
                disabled={m.slug === 'cash'}
              />
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-2 pt-2 border-t border-slate-100">
        <div className="flex-1">
          <Label className="text-sm font-medium">Add payment method</Label>
          <Input
            className="mt-1"
            placeholder="e.g. Salaam Bank"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLabel.trim()) addMethod();
            }}
          />
        </div>
        <div className="sm:w-44">
          <Label className="text-sm font-medium">Group</Label>
          <select
            className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as 'cash' | 'mobile' | 'other')}
          >
            {GROUP_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
        <Button
          className={cn(btnPrimary, 'rounded-xl')}
          onClick={() => addMethod()}
          disabled={isAdding || !newLabel.trim()}
        >
          {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add
        </Button>
      </div>
    </DataPanel>
  );
}
