'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { UnitType } from '@/types';

type UnitKind = 'base' | 'retail' | 'wholesale' | 'both';

interface CatalogUnit {
  code: string;
  name: string;
  unit_kind: UnitKind;
  allows_decimal: boolean;
  sort_order: number;
}

/** The full library of standard units a store can enable. Mirrors the
 *  seed_store_unit_types() catalog plus a few common extras. */
const STANDARD_UNIT_CATALOG: CatalogUnit[] = [
  { code: 'PCS',    name: 'Piece',    unit_kind: 'base',      allows_decimal: false, sort_order: 1  },
  { code: 'KG',     name: 'Kilogram', unit_kind: 'base',      allows_decimal: true,  sort_order: 2  },
  { code: 'LITER',  name: 'Liter',    unit_kind: 'base',      allows_decimal: true,  sort_order: 3  },
  { code: 'METER',  name: 'Meter',    unit_kind: 'base',      allows_decimal: true,  sort_order: 4  },
  { code: 'GRAM',   name: 'Gram',     unit_kind: 'base',      allows_decimal: true,  sort_order: 5  },
  { code: 'PACK',   name: 'Pack',     unit_kind: 'retail',    allows_decimal: false, sort_order: 10 },
  { code: 'BOTTLE', name: 'Bottle',   unit_kind: 'retail',    allows_decimal: false, sort_order: 11 },
  { code: 'PAIR',   name: 'Pair',     unit_kind: 'retail',    allows_decimal: false, sort_order: 12 },
  { code: 'DOZEN',  name: 'Dozen',    unit_kind: 'both',      allows_decimal: false, sort_order: 13 },
  { code: 'CARTON', name: 'Carton',   unit_kind: 'wholesale', allows_decimal: false, sort_order: 20 },
  { code: 'BOX',    name: 'Box',      unit_kind: 'wholesale', allows_decimal: false, sort_order: 21 },
  { code: 'BUNDLE', name: 'Bundle',   unit_kind: 'wholesale', allows_decimal: false, sort_order: 22 },
  { code: 'SACK',   name: 'Sack',     unit_kind: 'wholesale', allows_decimal: true,  sort_order: 23 },
  { code: 'CRATE',  name: 'Crate',    unit_kind: 'wholesale', allows_decimal: false, sort_order: 24 },
  { code: 'BALE',   name: 'Bale',     unit_kind: 'wholesale', allows_decimal: false, sort_order: 25 },
  { code: 'ROLL',   name: 'Roll',     unit_kind: 'wholesale', allows_decimal: false, sort_order: 26 },
];

const KIND_BADGE: Record<UnitKind, string> = {
  base:      'bg-slate-100 text-slate-600',
  retail:    'bg-blue-100 text-blue-700',
  wholesale: 'bg-violet-100 text-violet-700',
  both:      'bg-emerald-100 text-emerald-700',
};

export function UnitTypesManager() {
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unitKind, setUnitKind] = useState<UnitKind>('both');
  const [allowsDecimal, setAllowsDecimal] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  // Full list (active + inactive) for management
  const { data: units = [], isLoading } = useQuery({
    queryKey: ['unit-types-all', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('unit_types')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as UnitType[];
    },
    enabled: !!currentStore,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['unit-types-all', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['unit-types', currentStore?.id] });
  };

  const byCode = new Map(units.map((u) => [u.code, u]));
  const customUnits = units.filter((u) => !STANDARD_UNIT_CATALOG.some((s) => s.code === u.code));
  const enabledStandardCount = STANDARD_UNIT_CATALOG.filter((c) => byCode.get(c.code)?.is_active).length;

  // Enable/disable a standard catalog unit (insert if missing, else flip is_active)
  const { mutate: toggleStandard } = useMutation({
    mutationFn: async ({ cat, next }: { cat: CatalogUnit; next: boolean }) => {
      setBusyCode(cat.code);
      const supabase = createClient();
      const existing = byCode.get(cat.code);
      if (existing) {
        const { error } = await supabase.from('unit_types').update({ is_active: next }).eq('id', existing.id);
        if (error) throw error;
      } else if (next) {
        const { error } = await supabase.from('unit_types').insert({
          store_id: currentStore!.id,
          code: cat.code,
          name: cat.name,
          unit_kind: cat.unit_kind,
          allows_decimal: cat.allows_decimal,
          sort_order: cat.sort_order,
          is_active: true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { refresh(); },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyCode(null),
  });

  // Enable/disable any existing unit (used for custom units)
  const { mutate: toggleActive } = useMutation({
    mutationFn: async ({ unit, next }: { unit: UnitType; next: boolean }) => {
      setBusyCode(unit.code);
      const supabase = createClient();
      const { error } = await supabase.from('unit_types').update({ is_active: next }).eq('id', unit.id);
      if (error) throw error;
    },
    onSuccess: () => { refresh(); },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyCode(null),
  });

  // Delete a custom unit (blocked by FK if used by products)
  const { mutate: deleteUnit } = useMutation({
    mutationFn: async (unit: UnitType) => {
      setBusyCode(unit.code);
      const supabase = createClient();
      const { error } = await supabase.from('unit_types').delete().eq('id', unit.id);
      if (error) {
        if (error.code === '23503') {
          throw new Error(`"${unit.code}" is used by products — disable it instead of deleting.`);
        }
        throw error;
      }
    },
    onSuccess: () => { refresh(); toast.success('Unit removed'); },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyCode(null),
  });

  // Add a brand-new custom unit
  const { mutate: addUnit, isPending: adding } = useMutation({
    mutationFn: async () => {
      const trimmedCode = code.trim().toUpperCase().replace(/\s+/g, '_');
      const trimmedName = name.trim();
      if (!trimmedCode || !trimmedName) throw new Error('Code and name are required');
      if (units.some((u) => u.code === trimmedCode)) {
        throw new Error(`Unit code "${trimmedCode}" already exists`);
      }
      const supabase = createClient();
      const maxSort = units.reduce((m, u) => Math.max(m, u.sort_order ?? 0), 0);
      const { error } = await supabase.from('unit_types').insert({
        store_id: currentStore!.id,
        code: trimmedCode,
        name: trimmedName,
        unit_kind: unitKind,
        allows_decimal: allowsDecimal,
        sort_order: maxSort + 1,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success('Custom unit added');
      setCode(''); setName(''); setAllowsDecimal(false); setUnitKind('both');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enableAllStandard = () => {
    STANDARD_UNIT_CATALOG.forEach((cat) => {
      const existing = byCode.get(cat.code);
      if (!existing || !existing.is_active) toggleStandard({ cat, next: true });
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Standard units ── */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-violet-600" />
            <div>
              <p className="text-sm font-medium text-slate-800">Standard units</p>
              <p className="text-xs text-slate-500">
                {enabledStandardCount} of {STANDARD_UNIT_CATALOG.length} enabled. Turn on the ones your store uses.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="rounded-lg shrink-0" onClick={enableAllStandard}>
            Enable all
          </Button>
        </div>

        {isLoading ? (
          <div className="h-20 rounded-lg bg-slate-50 animate-pulse" />
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {STANDARD_UNIT_CATALOG.map((cat) => {
              const existing = byCode.get(cat.code);
              const enabled = !!existing?.is_active;
              return (
                <div
                  key={cat.code}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-2 transition-colors',
                    enabled ? 'border-violet-200 bg-violet-50/40' : 'border-slate-150 bg-slate-50/40',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{cat.code}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_BADGE[cat.unit_kind])}>
                        {cat.unit_kind}
                      </span>
                      {cat.allows_decimal && <span className="text-[10px] text-slate-400">decimal</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{cat.name}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={busyCode === cat.code}
                    onCheckedChange={(next) => toggleStandard({ cat, next })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Custom units ── */}
      {customUnits.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4 space-y-2">
          <p className="text-sm font-medium text-slate-800">Your custom units</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {customUnits.map((u) => (
              <div
                key={u.id}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3 py-2',
                  u.is_active ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-150 bg-slate-50/40',
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{u.code}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_BADGE[u.unit_kind])}>
                      {u.unit_kind}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{u.name}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={u.is_active}
                    disabled={busyCode === u.code}
                    onCheckedChange={(next) => toggleActive({ unit: u, next })}
                  />
                  <button
                    type="button"
                    onClick={() => deleteUnit(u)}
                    disabled={busyCode === u.code}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    aria-label="Delete unit"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add custom unit ── */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-slate-800">Add a custom unit</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Create a store-specific unit not in the standard list (e.g. TRAY, DRUM).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TRAY" className="rounded-lg h-10 uppercase" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tray" className="rounded-lg h-10" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kind</Label>
            <Select value={unitKind} onValueChange={(v) => setUnitKind(v as UnitKind)}>
              <SelectTrigger className="rounded-lg h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="base">Base (stock unit)</SelectItem>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pb-1">
            <Switch checked={allowsDecimal} onCheckedChange={setAllowsDecimal} id="unit-decimal" />
            <Label htmlFor="unit-decimal" className="text-xs cursor-pointer">Allow decimals</Label>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-lg"
          disabled={adding || !code.trim() || !name.trim()}
          onClick={() => addUnit()}
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
          Add custom unit
        </Button>
      </div>
    </div>
  );
}
