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
import { Loader2, Plus, Trash2, ShoppingBag, Boxes, PackagePlus, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { UnitType } from '@/types';

type UnitKind = 'base' | 'retail' | 'wholesale' | 'both';
type UnitCategory = 'retail' | 'wholesale';

interface CatalogUnit {
  code: string;
  /** Somali name — the primary name seeded into the store's unit_types row.
   *  Owners can rename this to whatever term they actually use. */
  name: string;
  nameEn?: string;
  category: UnitCategory;
  unit_kind: UnitKind;
  allows_decimal: boolean;
  sort_order: number;
  description: string;
  examples: string;
}

/**
 * Full Somali-first business unit catalog a store can turn on/off.
 * Halbeegyada Tafaariiqda (Retail) + Halbeegyada Jumlada (Wholesale).
 * Every store owner can rename any enabled unit if they know it by a
 * different word — see the pencil/edit action on each row.
 */
const STANDARD_UNIT_CATALOG: CatalogUnit[] = [
  // ── Halbeegyada Tafaariiqda (Retail Units) ──
  { code: 'PCS',     name: 'Xabbo',       nameEn: 'Piece',      category: 'retail', unit_kind: 'base', allows_decimal: false, sort_order: 10,  description: 'Single item', examples: 'Phone, Bottle, Chair, Medicine' },
  { code: 'KG',      name: 'Kiilo',       nameEn: 'Kilogram',   category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 20,  description: 'Weight measurement', examples: 'Sugar, Rice, Flour, Meat' },
  { code: 'GRAM',    name: 'Garaam',      nameEn: 'Gram',       category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 30,  description: 'Small weight', examples: 'Spices, Medicine' },
  { code: 'LITER',   name: 'Litir',       nameEn: 'Liter',      category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 40,  description: 'Liquid measurement', examples: 'Oil, Milk, Fuel' },
  { code: 'ML',      name: 'Millilitir',  nameEn: 'Milliliter', category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 50,  description: 'Small liquid measurement', examples: 'Medicine, Perfume' },
  { code: 'METER',   name: 'Mitir',       nameEn: 'Meter',      category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 60,  description: 'Length measurement', examples: 'Fabric, Pipe, Cable' },
  { code: 'YARD',    name: 'Yard',        nameEn: 'Yard',       category: 'retail', unit_kind: 'base', allows_decimal: true,  sort_order: 70,  description: 'Length measurement', examples: 'Fabric, Rope' },
  { code: 'BOTTLE',  name: 'Dhalo',       nameEn: 'Bottle',     category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 80,  description: 'Bottle — can be its own base unit (e.g. water companies)', examples: 'Water, Oil, Juice' },
  { code: 'BAAKAD',  name: 'Baakad',      nameEn: 'Packet',     category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 90,  description: 'Small package', examples: 'Tea, Biscuits' },
  { code: 'XIRMO',   name: 'Xirmo',       nameEn: 'Bundle',     category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 100, description: 'Small bundle or pack', examples: 'Vegetables, Small goods' },
  { code: 'XIDHMO',  name: 'Xidhmo',      nameEn: 'Tied bundle',category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 110, description: 'Small tied bundle', examples: 'Herbs, Vegetable bunch' },
  { code: 'GASACAD', name: 'Gasacad',     nameEn: 'Tin/Can',    category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 120, description: 'Small tin or can', examples: 'Tomato paste, Canned food' },
  { code: 'TUBE',    name: 'Tuubo',       nameEn: 'Tube',       category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 130, description: 'Tube', examples: 'Toothpaste, Cream, Ointment' },
  { code: 'KOOB',    name: 'Koob',        nameEn: 'Cup/Glass',  category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 140, description: 'Cup or glass measure', examples: 'Tea, Rice, Grain' },
  { code: 'PAIR',    name: 'Labo',        nameEn: 'Pair',       category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 150, description: 'Two matching items', examples: 'Shoes, Gloves, Socks' },
  { code: 'SET',     name: 'Qayb',        nameEn: 'Set',        category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 160, description: 'Group of items sold together', examples: 'Tools, Dishes' },
  { code: 'CALEEN',  name: 'Caleen',      nameEn: 'Sheet/Leaf', category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 170, description: 'Single sheet', examples: 'Paper, Metal sheet' },
  { code: 'XAASHI',  name: 'Xaashi',      nameEn: 'Sheet',      category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 180, description: 'Sheet of paper or material', examples: 'Paper, Cardboard' },
  { code: 'REAM',    name: 'Ream',        nameEn: 'Ream',       category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 190, description: '500 sheets of paper', examples: 'Printing paper' },
  { code: 'QORI',    name: 'Qori',        nameEn: 'Stick/Rod',  category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 200, description: 'Single stick or rod', examples: 'Matchsticks, Wooden dowels' },
  { code: 'TABLET',  name: 'Kiniin',      nameEn: 'Tablet',     category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 210, description: 'Tablet or pill', examples: 'Medicine' },
  { code: 'CAN',     name: 'Daasad',      nameEn: 'Can',        category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 220, description: 'Can', examples: 'Soft drinks, Paint' },
  { code: 'DOZEN',   name: 'Dersin',      nameEn: 'Dozen',      category: 'retail', unit_kind: 'both', allows_decimal: false, sort_order: 230, description: '12 pieces', examples: 'Eggs, Glasses' },

  // ── Halbeegyada Jumlada (Wholesale Units) ──
  { code: 'JOONYAD',      name: 'Joonyad',      nameEn: 'Jute sack',   category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 310, description: 'Large woven/jute sack', examples: 'Grain, Flour, Sugar' },
  { code: 'KARTOON',      name: 'Kartoon',      nameEn: 'Carton',      category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 320, description: 'Box containing multiple items', examples: 'Pasta, Water, Soft drinks' },
  { code: 'KARTOON_WEYN', name: 'Kartoon Weyn', nameEn: 'Big Carton',  category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 330, description: 'Large carton', examples: 'Bulk goods' },
  { code: 'SANDUUQ',      name: 'Sanduuq',      nameEn: 'Box',         category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 340, description: 'Package or box', examples: 'Medicine, Electronics' },
  { code: 'JAWAAN',       name: 'Jawaan',       nameEn: 'Sack',        category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 350, description: 'Large bag', examples: 'Flour, Sugar, Rice' },
  { code: 'KIISH',        name: 'Kiish',        nameEn: 'Bag',         category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 360, description: 'Bag', examples: 'Cement, Animal feed' },
  { code: 'DOOSAN',       name: 'Doosan',       nameEn: 'Large sack',  category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 370, description: 'Large sack', examples: 'Grain, Charcoal' },
  { code: 'XIRMO_WEYN',   name: 'Xirmo Weyn',   nameEn: 'Big Bundle',  category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 380, description: 'Large bundle', examples: 'Wires, Rods, Textiles' },
  { code: 'ROLL',         name: 'Roll',         nameEn: 'Roll',        category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 390, description: 'Rolled material', examples: 'Cable, Fabric, Rope' },
  { code: 'BUNDLE',       name: 'Bundle',       nameEn: 'Bundle',      category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 400, description: 'Group of items tied together', examples: 'Wires, Rods' },
  { code: 'BALE',         name: 'Bale',         nameEn: 'Bale',        category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 410, description: 'Compressed bundle of goods', examples: 'Textiles, Clothes' },
  { code: 'PALLET',       name: 'Pallet',       nameEn: 'Pallet',      category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 420, description: 'Large wholesale pallet', examples: 'Cement, Water' },
  { code: 'FOOSTO',       name: 'Foosto',       nameEn: 'Drum/Barrel', category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 430, description: 'Plastic drum or barrel', examples: 'Water, Oil, Fuel' },
  { code: 'DRUM',         name: 'Drum',         nameEn: 'Drum',        category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 440, description: 'Metal drum', examples: 'Oil, Chemicals' },
  { code: 'WEEL',         name: 'Weel',         nameEn: 'Container',   category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 450, description: 'Large container or vessel', examples: 'Water, Grain' },
  { code: 'CAAG_WEYN',    name: 'Caag Weyn',    nameEn: 'Big Tin',     category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 460, description: 'Big tin/can', examples: 'Cooking oil, Ghee' },
  { code: 'DHALO_WEYN',   name: 'Dhalo Weyn',   nameEn: 'Big Bottle',  category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 470, description: 'Large bottle', examples: 'Water, Oil' },
  { code: 'CONTAINER',    name: 'Koonteenar',   nameEn: 'Container',   category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 480, description: 'Import container', examples: 'Imported products' },
  { code: 'SAAQ',         name: 'Saaq',         nameEn: 'Sack',        category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 490, description: 'Sack/bag', examples: 'Grain, Charcoal' },
  { code: 'SARIIBAD',     name: 'Sariibad',     nameEn: 'Woven sack',  category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 500, description: 'Large woven sack', examples: 'Grain, Beans' },
  { code: 'TRAY',         name: 'Saxaarad',     nameEn: 'Tray',        category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 510, description: 'Tray', examples: 'Eggs' },
  { code: 'CRATE',        name: 'Crate',        nameEn: 'Crate',       category: 'wholesale', unit_kind: 'wholesale', allows_decimal: false, sort_order: 520, description: 'Crate of bottles or eggs', examples: 'Soft drinks, Eggs' },
];

const CATEGORY_SECTIONS: { key: UnitCategory; title: string; subtitleSo: string; icon: typeof ShoppingBag; accent: string }[] = [
  { key: 'retail',    title: 'Retail Units',    subtitleSo: 'Halbeegyada Tafaariiqda', icon: ShoppingBag, accent: 'blue'   },
  { key: 'wholesale', title: 'Wholesale Units', subtitleSo: 'Halbeegyada Jumlada',     icon: Boxes,       accent: 'violet' },
];

const ACCENT_CLASSES: Record<string, { border: string; bg: string; icon: string }> = {
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50/40',   icon: 'text-blue-600'   },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50/40', icon: 'text-violet-600' },
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

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

  // Rename any unit (standard or custom) — owners can call it whatever their business uses
  const { mutate: renameUnit, isPending: renaming } = useMutation({
    mutationFn: async ({ unit, newName }: { unit: UnitType; newName: string }) => {
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name cannot be empty');
      const supabase = createClient();
      const { error } = await supabase.from('unit_types').update({ name: trimmed }).eq('id', unit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success('Unit renamed');
      setEditingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
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

  const startEdit = (unit: UnitType) => {
    setEditingId(unit.id);
    setEditName(unit.name);
  };

  const commitEdit = (unit: UnitType) => {
    if (editName.trim() === unit.name) { setEditingId(null); return; }
    renameUnit({ unit, newName: editName });
  };

  return (
    <div className="space-y-4">
      {/* ── Standard units, grouped by business category ── */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-800">Standard units</p>
            <p className="text-xs text-slate-500">
              {enabledStandardCount} of {STANDARD_UNIT_CATALOG.length} enabled. Turn on the ones your store uses —
              tap the pencil to rename any unit to the word you actually use.
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
                    <h5 className="text-sm font-semibold text-slate-800">{section.subtitleSo}</h5>
                    <span className="text-xs text-slate-400">({section.title})</span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {cats.map((cat) => {
                      const existing = byCode.get(cat.code);
                      const enabled = !!existing?.is_active;
                      const isEditing = existing && editingId === existing.id;
                      const displayName = existing?.name ?? cat.name;
                      return (
                        <div
                          key={cat.code}
                          className={cn(
                            'flex items-start justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors',
                            enabled ? `${accent.border} ${accent.bg}` : 'border-slate-150 bg-slate-50/40',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit(existing);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  className="h-8 text-sm"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  disabled={renaming}
                                  onClick={() => commitEdit(existing)}
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
                                  aria-label="Save name"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
                                  aria-label="Cancel"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-semibold text-slate-800">{displayName}</span>
                                {cat.nameEn && cat.nameEn.toLowerCase() !== displayName.toLowerCase() && (
                                  <span className="text-xs text-slate-500">({cat.nameEn})</span>
                                )}
                                {existing && (
                                  <button
                                    type="button"
                                    onClick={() => startEdit(existing)}
                                    className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                    aria-label="Rename unit"
                                    title="Rename this unit"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            )}
                            <p className="text-xs text-slate-500 mt-0.5">{cat.description}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">e.g. {cat.examples}</p>
                          </div>
                          {!isEditing && (
                            <Switch
                              checked={enabled}
                              disabled={busyCode === cat.code}
                              className="shrink-0 mt-0.5"
                              onCheckedChange={(next) => toggleStandard({ cat, next })}
                            />
                          )}
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
            {customUnits.map((u) => {
              const isEditing = editingId === u.id;
              return (
                <div
                  key={u.id}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-2',
                    u.is_active ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-150 bg-slate-50/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(u);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="h-8 text-sm"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={renaming}
                          onClick={() => commitEdit(u)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
                          aria-label="Save name"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
                          aria-label="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-800">{u.name}</span>
                          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_BADGE[u.unit_kind])}>
                            {u.unit_kind}
                          </span>
                          <button
                            type="button"
                            onClick={() => startEdit(u)}
                            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                            aria-label="Rename unit"
                            title="Rename this unit"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 truncate">{u.code}</p>
                      </>
                    )}
                  </div>
                  {!isEditing && (
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
                  )}
                </div>
              );
            })}
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
              Not in the standard list? Add your own (e.g. Bac, Xirmo Gaar ah).
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BAC" className="rounded-lg h-11 uppercase" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bac" className="rounded-lg h-11" />
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
