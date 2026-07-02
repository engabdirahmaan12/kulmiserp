'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Tags, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { DataPanel } from '@/components/layout/PageShell';
import { btnPrimary } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import {
  getPosAllowPriceOverride,
  getPriceLevelsEnabled,
  getQuantityPricingEnabled,
} from '@/lib/pos/pricing';
import { UnitTypesManager } from '@/components/settings/UnitTypesManager';

/**
 * Replaces the old Retail/Wholesale/Business-Mode selector. Pricing is now a
 * property of each product and customer — every store sells the same way:
 * pick a product, pick a unit, enter a quantity, the system computes the
 * price. These toggles control which pricing *tools* are available, not
 * which "kind" of store this is.
 */
export function PricingConfigurationPanel() {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const settings = (currentStore?.settings ?? {}) as Record<string, unknown>;

  const [priceLevels, setPriceLevels] = useState(getPriceLevelsEnabled(settings));
  const [quantityPricing, setQuantityPricing] = useState(getQuantityPricingEnabled(settings));
  const [customPricing, setCustomPricing] = useState(getPosAllowPriceOverride(settings));

  const { data: unitTypes = [] } = useQuery({
    queryKey: ['unit-types', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('unit_types')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!currentStore,
  });

  // New/never-configured stores get a full retail+wholesale unit starter set —
  // there's no mode selection to gate this on anymore.
  useEffect(() => {
    if (!currentStore?.id || unitTypes.length > 0) return;
    const supabase = createClient();
    void supabase.rpc('seed_store_unit_types', {
      p_store_id: currentStore.id,
      p_business_mode: 'wholesale_retail',
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['unit-types', currentStore.id] });
    });
  }, [currentStore?.id, unitTypes.length, queryClient]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error: settingsError } = await supabase.rpc('update_store_invoice_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_settings: {
          pricing_enable_price_levels: priceLevels,
          pricing_enable_quantity_pricing: quantityPricing,
          pos_allow_price_override: customPricing,
        },
      });
      if (settingsError) throw settingsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      toast.success('Pricing configuration saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DataPanel className="p-6 space-y-6">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
        <Tags className="h-5 w-5 text-blue-600" />
        Pricing Configuration
      </h3>

      <p className="text-sm text-slate-500">
        Every product supports multiple units and multiple prices — Retail, Wholesale, VIP, and a
        manual Custom price at checkout. There&apos;s no store &quot;type&quot; to choose; the unit and quantity a
        cashier picks determines the price automatically.
      </p>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
        <div>
          <Label className="text-sm font-medium">Price Levels (Retail / Wholesale / VIP)</Label>
          <p className="text-xs text-slate-500 mt-1">
            Let customers and products be assigned a VIP price tier, on top of Retail and Wholesale.
          </p>
        </div>
        <Switch checked={priceLevels} onCheckedChange={setPriceLevels} />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
        <div>
          <Label className="text-sm font-medium">Quantity Pricing</Label>
          <p className="text-xs text-slate-500 mt-1">
            Automatic bulk-break prices, e.g. 1–9 KG = $1, 10–49 KG = $0.95, 50+ KG = $0.90.
            Configured per product, per unit.
          </p>
        </div>
        <Switch checked={quantityPricing} onCheckedChange={setQuantityPricing} />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50/40 p-4">
        <div>
          <Label className="text-sm font-medium text-violet-900">Custom Pricing at checkout</Label>
          <p className="text-xs text-violet-700/80 mt-1">
            Lets owners/managers retype a line&apos;s price at POS or Custom Invoice with a required
            reason — every override is saved (original price, new price, reason, who did it).
          </p>
        </div>
        <Switch checked={customPricing} onCheckedChange={setCustomPricing} />
      </div>

      <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <Scale className="h-4 w-4 text-violet-600" />
        Available unit types
      </div>

      <UnitTypesManager />

      <Button className={cn(btnPrimary, 'rounded-xl')} onClick={() => save()} disabled={isPending}>
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save Pricing Configuration
      </Button>
    </DataPanel>
  );
}
