'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Loader2, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { DataPanel } from '@/components/layout/PageShell';
import { btnPrimary, inputSoft } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { getPosAllowBelowCost, getPosAllowPriceOverride } from '@/lib/pos/pricing';

export function PosSettingsPanel() {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const settings = (currentStore?.settings ?? {}) as Record<string, unknown>;

  const [allowBelowCost, setAllowBelowCost] = useState(getPosAllowBelowCost(settings));
  const [allowPriceOverride, setAllowPriceOverride] = useState(getPosAllowPriceOverride(settings));
  const [purchasePrefix, setPurchasePrefix] = useState(currentStore?.purchase_prefix ?? 'PUR');

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error: settingsError } = await supabase.rpc('update_store_invoice_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_settings: {
          pos_allow_below_cost_sales: allowBelowCost,
          pos_allow_price_override: allowPriceOverride,
        },
      });
      if (settingsError) throw settingsError;

      const { error: storeError } = await supabase
        .from('stores')
        .update({ purchase_prefix: purchasePrefix || 'PUR' })
        .eq('id', currentStore!.id);
      if (storeError) throw storeError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      toast.success('POS settings saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DataPanel className="p-6 space-y-6">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
        <ShoppingCart className="h-5 w-5 text-blue-600" />
        POS Settings
      </h3>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
        <div>
          <Label className="text-sm font-medium">Allow below-cost sales</Label>
          <p className="text-xs text-slate-500 mt-1">
            When off, cashiers cannot sell below product cost. Store owner only.
          </p>
        </div>
        <Switch checked={allowBelowCost} onCheckedChange={setAllowBelowCost} />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50/40 p-4">
        <div>
          <Label className="text-sm font-medium text-violet-900">Allow price override at checkout</Label>
          <p className="text-xs text-violet-700/80 mt-1">
            Lets owners/managers retype a line's price at POS with a required reason —
            every override is saved (original price, new price, reason, who did it).
          </p>
        </div>
        <Switch checked={allowPriceOverride} onCheckedChange={setAllowPriceOverride} />
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label>Purchase invoice prefix</Label>
        <Input
          value={purchasePrefix}
          onChange={(e) => setPurchasePrefix(e.target.value.toUpperCase())}
          placeholder="PUR"
          className={inputSoft}
          maxLength={8}
        />
        <p className="text-xs text-slate-500">Example: PUR-2026-00001</p>
      </div>

      <Button className={cn(btnPrimary, 'rounded-xl')} onClick={() => save()} disabled={isPending}>
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save POS Settings
      </Button>
    </DataPanel>
  );
}
