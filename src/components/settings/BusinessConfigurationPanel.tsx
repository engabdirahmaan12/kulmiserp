'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Building2, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { DataPanel } from '@/components/layout/PageShell';
import { btnPrimary } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { BusinessMode, PriceTier } from '@/lib/units/conversion';
import { BUSINESS_MODE_LABELS, PRICE_TIER_LABELS } from '@/lib/units/conversion';
import { UnitTypesManager } from '@/components/settings/UnitTypesManager';

const MODES: BusinessMode[] = ['retail_only', 'wholesale_only', 'wholesale_retail'];

export function BusinessConfigurationPanel() {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const settings = (currentStore?.settings ?? {}) as Record<string, unknown>;

  const [businessMode, setBusinessMode] = useState<BusinessMode>(
    (currentStore?.business_mode as BusinessMode) ?? 'retail_only',
  );
  const [defaultPriceTier, setDefaultPriceTier] = useState<PriceTier>(
    (settings.default_price_tier as PriceTier) ?? 'retail',
  );

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

  useEffect(() => {
    if (!currentStore?.id || unitTypes.length > 0) return;
    const supabase = createClient();
    void supabase.rpc('seed_store_unit_types', {
      p_store_id: currentStore.id,
      p_business_mode: currentStore.business_mode ?? 'retail_only',
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['unit-types', currentStore.id] });
    });
  }, [currentStore?.id, currentStore?.business_mode, unitTypes.length, queryClient]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data: modeResult, error: modeError } = await supabase.rpc('update_store_business_mode', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_business_mode: businessMode,
      });
      if (modeError) throw modeError;
      const payload = modeResult as { success?: boolean; error?: string };
      if (!payload?.success) throw new Error(payload?.error || 'Failed to update business mode');

      const { error: settingsError } = await supabase.rpc('update_store_invoice_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_settings: { default_price_tier: defaultPriceTier },
      });
      if (settingsError) throw settingsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['unit-types', currentStore?.id] });
      toast.success('Business configuration saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DataPanel className="p-6 space-y-6">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-blue-600" />
        Business Configuration
      </h3>

      <p className="text-sm text-slate-500">
        Choose how your store sells and tracks inventory. All stock is stored in base units (PCS, KG, etc.)
        with automatic conversion for cartons, packs, and other units.
      </p>

      <div className="space-y-3">
        <Label>Business Type</Label>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBusinessMode(mode)}
              className={cn(
                'rounded-xl border p-4 text-left transition-all',
                businessMode === mode
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <p className="font-medium text-slate-900">{BUSINESS_MODE_LABELS[mode]}</p>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'retail_only' && 'PCS, KG, Liter — decimal quantities for measurable goods'}
                {mode === 'wholesale_only' && 'Carton, Box, Sack — bulk distributor sales'}
                {mode === 'wholesale_retail' && 'Sell cartons and packs at the same time'}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label>Default POS price tier</Label>
        <Select value={defaultPriceTier} onValueChange={(v) => setDefaultPriceTier(v as PriceTier)}>
          <SelectTrigger className="rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PRICE_TIER_LABELS) as PriceTier[]).map((tier) => (
              <SelectItem key={tier} value={tier}>{PRICE_TIER_LABELS[tier]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500">Customer price tier overrides this when selected at checkout.</p>
      </div>

      <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <Scale className="h-4 w-4 text-violet-600" />
        Available unit types
      </div>

      <UnitTypesManager />

      <Button className={cn(btnPrimary, 'rounded-xl')} onClick={() => save()} disabled={isPending}>
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save Business Configuration
      </Button>
    </DataPanel>
  );
}
