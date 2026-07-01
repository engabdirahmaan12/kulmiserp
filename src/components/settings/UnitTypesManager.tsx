'use client';

import { useMemo, useState } from 'react';
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
import { Loader2, Plus, Trash2, ShoppingBag, Boxes, Sparkles, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { UnitType } from '@/types';

type UnitKind = 'base' | 'retail' | 'wholesale' | 'both';
type UnitCategory = 'retail' | 'wholesale' | 'special';

interface CatalogUnit {
  code: string;
  name: string;
  nameSo?: string;
  category: UnitCategory;
  unit_kind: UnitKind;
  allows_decimal: boolean;
  sort_order: number;
  description: string;
  examples: string;
}

/**
 * Full standard unit library a store can turn on/off. Grouped into the three
 * business categories (Retail / Wholesale / Special) with bilingual names so
 * owners recognize the unit regardless of which language they read best.
 */
const STANDARD_UNIT_CATALOG: CatalogUnit[] = [
  // ── Retail units (Tafaariiq) — normal selling, always usable as a stock/base unit ──
  { code: 'PCS',   name: 'Piece',       nameSo: 'Xabo',      category: 'retail', unit_kind: 'base', allows_decimal: false, sort_order: 10, description: 'Single item', examples: 'Phone, Bottle, Chair, Medicine' },
  { code: 'KG',    name: 'Kilogram',    nameSo: 'Kiilo',     category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 20, description: 'Weight measurement', examples: 'Sugar, Rice, Flour, Meat' },
  { code: 'GRAM',  name: 'Gram',        nameSo: 'Garaam',    category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 30, description: 'Small weight', examples: 'Spices, Medicine' },
  { code: 'LITER', name: 'Liter',       nameSo: 'Litir',     category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 40, description: 'Liquid measurement', examples: 'Oil, Milk, Fuel' },
  { code: 'ML',    name: 'Milliliter',  nameSo: 'Mililitir', category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 50, description: 'Small liquid measurement', examples: 'Medicine, Perfume' },
  { code: 'METER', name: 'Meter',       nameSo: 'Mitir',     category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 60, description: 'Length measurement', examples: 'Fabric, Pipe, Cable' },

  // ── Wholesale units (Jumlada) — bulk buying/selling ──
  { code: 'SACK',      name: 'Sack',      nameSo: 'Jawaan',    category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 110, description: 'Large bag', examples: 'Flour, Sugar, Rice' },
  { code: 'CARTON',    name: 'Carton',    nameSo: 'Kartoon',   category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 120, description: 'Box containing multiple items', examples: 'Pasta, Water, Soft drinks' },
  { code: 'BOX',       name: 'Box',       nameSo: 'Sanduuq',   category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 130, description: 'Package or box', examples: 'Medicine, Electronics' },
  { code: 'BAG',       name: 'Bag',       nameSo: 'Kiish',     category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 140, description: 'Bag', examples: 'Cement, Animal feed' },
  { code: 'PACKET',    name: 'Packet',    nameSo: 'Baakad',    category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 150, description: 'Small package', examples: 'Tea, Biscuits' },
  { code: 'BUNDLE',    name: 'Bundle',    nameSo: 'Xidhmo',    category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 160, description: 'Group of items tied together', examples: 'Wires, Rods' },
  { code: 'TRAY',      name: 'Tray',      nameSo: 'Saxaarad',  category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 170, description: 'Tray', examples: 'Eggs' },
  { code: 'DOZEN',     name: 'Dozen',     nameSo: 'Dersin',    category: 'wholesale', unit_kind: 'both',      allows_decimal: false, sort_order: 180, description: '12 pieces', examples: 'Eggs, Glasses' },
  { code: 'PALLET',    name: 'Pallet',    nameSo: 'Raso',      category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 190, description: 'Large wholesale pallet', examples: 'Cement, Water' },
  { code: 'CONTAINER', name: 'Container', nameSo: 'Konteenar', category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 200, description: 'Import container', examples: 'Imported products' },
  { code: 'CRATE',     name: 'Crate',                          category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 210, description: 'Crate of bottles or eggs', examples: 'Soft drinks, Eggs' },
  { code: 'BALE',      name: 'Bale',                           category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 220, description: 'Compressed bundle of goods', examples: 'Textiles, Clothes' },
  { code: 'ROLL',      name: 'Roll',                            category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 230, description: 'Rolled material', examples: 'Cable, Fabric, Rope' },

  // ── Special units — for pharmacies, water companies, hardware & spare parts ──
  { code: 'BOTTLE', name: 'Bottle', nameSo: 'Dhalo',  category: 'special', unit_kind: 'both', allows_decimal: false, sort_order: 310, description: 'Bottle — can be its own base unit (e.g. water companies)', examples: 'Water, Oil, Juice' },
  { code: 'CAN',     name: 'Can',    nameSo: 'Daasad', category: 'special', unit_kind: 'both', allows_decimal: false, sort_order: 320, description: 'Can', examples: 'Soft drinks, Paint' },
  { code: 'TABLET',  name: 'Tablet', nameSo: 'Kiniin', category: 'special', unit_kind: 'both', allows_decimal: false, sort_order: 330, description: 'Tablet or pill', examples: 'Medicine' },
  { code: 'TUBE',    name: 'Tube',   nameSo: 'Tuubo',  category: 'special', unit_kind: 'both', allows_decimal: false, sort_order: 340, description: 'Tube', examples: 'Toothpaste, Cream, Ointment' },
  { code: 'PAIR',    name: 'Pair',   nameSo: 'Labo',   category: 'special', unit_kind: 'both', allows_decimal: false, sort_order: 350, description: 'Two matching items', examples: 'Shoes, Gloves, Socks' },
  { code: 'SET',     name: 'Set',    nameSo: 'Qayb',   category: 'special', unit_kind: 'both', allows_decimal: false, sort_order: 360, description: 'Group of items sold together', examples: 'Tools, Dishes' },
];

const CATEGORY_SECTIONS: { key: UnitCategory; title: string; subtitleSo: string; icon: typeof ShoppingBag; accent: string }[] = [
  { key: 'retail',    title: 'Retail Units',    subtitleSo: 'Tafaariiq',   icon: ShoppingBag, accent: 'blue'    },
  { key: 'wholesale', title: 'Wholesale Units', subtitleSo: 'Jumlada',     icon: Boxes,        accent: 'violet'  },
  { key: 'special',   title: 'Special Units',   subtitleSo: 'Gaar ah',     icon: Sparkles,     accent: 'amber'   },
];

const ACCENT_CLASSES: Record<string, { border: string; bg: string; icon: string; badge: string }> = {
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50/40',   icon: 'text-blue-600',   badge: 'bg-blue-100 text-blue-700' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50/40', icon: 'text-violet-600', badge: 'bg-violet-100 text-violet-700' },
  amber:  { border: 'border-amber-200',  bg: 'bg-amber-50/40',  icon: 'text-amber-600',  badge: 'bg-amber-100 text-amber-700' },
};

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
    refetchOnMount: 'always',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['unit-types-all', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['unit-types', currentStore?.id] });
  };

  const byCode = new Map(units.map((u) => [u.code, u]));
  const customUnits = units.filter((u) => !STANDARD_UNIT_CATALOG.some((s) => s.code === u.code));
  const enabledStandardCount = STANDARD_UNIT_CATALOG.filter((c) => byCode.get(c.code)?.is_active).length;

  const byCategory = useMemo(() => {
    const map = new Map<UnitCategory, CatalogUnit[]>();
    for (const section of CATEGORY_SECTIONS) map.set(section.key, []);
    for (const cat of STANDARD_UNIT_CATALOG) map.get(cat.category)!.push(cat);
    return map;
  }, []);

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
        // Upsert (not insert) so a row seeded since the list was last fetched
        // is reactivated instead of colliding on (store_id, code).
        const { error } = await supabase.from('unit_types').upsert({
          store_id: currentStore!.id,
          code: cat.code,
          name: cat.name,
          unit_kind: cat.unit_kind,
          allows_decimal: cat.allows_decimal,
          sort_order: cat.sort_order,
          is_active: true,
        }, { onConflict: 'store_id,code' });
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
      {/* ── Standard units, grouped by business category ── */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-800">Standard units</p>
            <p className="text-xs text-slate-500">
              {enabledStandardCount} of {STANDARD_UNIT_CATALOG.length} enabled. Turn on the ones your store uses.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="rounded-lg shrink-0" onClick={enableAllStandard}>
            Enable all
          </Button>
        </div>

        {isLoading ? (
          <div className="h-40 rounded-lg bg-slate-50 animate-pulse" />
        ) : (
          <div className="space-y-5">
            {CATEGORY_SECTIONS.map((section) => {
              const accent = ACCENT_CLASSES[section.accent];
              const cats = byCategory.get(section.key) ?? [];
              const Icon = section.icon;
              return (
                <div key={section.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', accent.bg)}>
                      <Icon className={cn('h-3.5 w-3.5', accent.icon)} />
                    </span>
                    <h5 className="text-sm font-semibold text-slate-800">{section.title}</h5>
                    <span className="text-xs text-slate-400">({section.subtitleSo})</span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {cats.map((cat) => {
                      const existing = byCode.get(cat.code);
                      const enabled = !!existing?.is_active;
                      return (
                        <div
                          key={cat.code}
                          className={cn(
                            'flex items-start justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors',
                            enabled ? `${accent.border} ${accent.bg}` : 'border-slate-150 bg-slate-50/40',
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-slate-800">{cat.name}</span>
                              {cat.nameSo && <span className="text-xs text-slate-500">· {cat.nameSo}</span>}
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-500">{cat.code}</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">{cat.description}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">e.g. {cat.examples}</p>
                          </div>
                          <Switch
                            checked={enabled}
                            disabled={busyCode === cat.code}
                            className="shrink-0 mt-0.5"
                            onCheckedChange={(next) => toggleStandard({ cat, next })}
                          />
                        </div>
                      );
                    })}
                  </div>
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
        <div className="flex items-center gap-2">
          <PackagePlus className="h-4 w-4 text-slate-500" />
          <div>
            <p className="text-sm font-medium text-slate-800">Add a custom unit</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Not in the standard list? Add your own (e.g. Foosto, Qori, Bac, Rool, Xirmo).
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="FOOSTO" className="rounded-lg h-11 uppercase" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Foosto" className="rounded-lg h-11" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kind</Label>
            <Select value={unitKind} onValueChange={(v) => setUnitKind(v as UnitKind)}>
              <SelectTrigger className="rounded-lg h-11 w-full"><SelectValue /></SelectTrigger>
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
          className="h-11 rounded-lg"
          disabled={adding || !code.trim() || !name.trim()}
          onClick={() => addUnit()}
        >
          {adding ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
          Add custom unit
        </Button>
      </div>
    </div>
  );
}
