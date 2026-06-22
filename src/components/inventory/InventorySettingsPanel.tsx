'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { usePermission } from '@/lib/hooks/usePermission';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataPanel } from '@/components/layout/PageShell';
import { AlertTriangle, Layers, Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  COST_METHOD_OPTIONS,
  costMethodLabel,
  type InventoryCostMethod,
} from '@/lib/inventory/costing';
import { toSelectItems } from '@/lib/ui/select-utils';
import type { Store } from '@/types';

export function InventorySettingsPanel({ className }: { className?: string }) {
  const { currentStore, user, setCurrentStore } = useAuthStore();
  const { role } = usePermission();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'manager';

  const method = (currentStore?.inventory_cost_method || 'average') as InventoryCostMethod;

  const methodItems = toSelectItems(
    COST_METHOD_OPTIONS,
    (o) => o.value,
    (o) => o.label,
  );

  const { mutate: saveMethod, isPending } = useMutation({
    mutationFn: async (next: InventoryCostMethod) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_accounting_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_inventory_cost_method: next,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed to update');
      return next;
    },
    onSuccess: (next) => {
      if (currentStore) {
        setCurrentStore({ ...currentStore, inventory_cost_method: next } as Store);
      }
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      toast.success(`Costing method set to ${costMethodLabel(next)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentOption = COST_METHOD_OPTIONS.find((o) => o.value === method);

  return (
    <DataPanel className={cn('p-6 space-y-5', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">Inventory Costing</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Controls how purchase costs flow into inventory value and COGS on sales.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-4 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="space-y-2">
          <Label className="text-xs text-slate-500 uppercase tracking-wide">Costing method</Label>
          {canEdit ? (
            <Select
              value={method}
              items={methodItems}
              onValueChange={(v) => v && saveMethod(v as InventoryCostMethod)}
              disabled={isPending}
            >
              <SelectTrigger className="w-full max-w-md h-10">
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                {COST_METHOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm font-medium text-slate-900 dark:text-white">{costMethodLabel(method)}</p>
          )}
          {isPending && (
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </p>
          )}
        </div>

        {currentOption && (
          <p className="text-sm text-slate-600 dark:text-slate-400">{currentOption.description}</p>
        )}

        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            Changing the costing method affects <strong>future</strong> inventory calculations only.
            Historical cost records and purchase costs are never overwritten.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
          <p className="text-xs text-slate-500 mb-1">Current method</p>
          <p className="font-semibold text-slate-900 dark:text-white">{costMethodLabel(method)}</p>
        </div>
        <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
          <p className="text-xs text-slate-500 mb-1">Valuation formula</p>
          <p className="font-medium text-slate-800 dark:text-slate-200 text-xs">
            Inventory Value = Qty × Average Cost
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 p-4 space-y-2 dark:border-slate-800">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" /> Weighted average example
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          50 units @ $1.50 + purchase 100 @ $2.00 → new average{' '}
          <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">(50×1.50 + 100×2.00) ÷ 150 = $1.83</code>.
          All sales use $1.83 until the next purchase.
        </p>
      </div>

      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => window.open('/dashboard/accounting', '_self')}
        >
          Open inventory valuation report
        </Button>
      )}
    </DataPanel>
  );
}
