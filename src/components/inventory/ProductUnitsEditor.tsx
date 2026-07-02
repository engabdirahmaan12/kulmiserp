'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Layers } from 'lucide-react';
import type { PriceTier, ProductUnitOption, QuantityPriceRow } from '@/lib/units/conversion';
import { PRICE_TIER_LABELS, profitAtUnit, toBaseUnitCost } from '@/lib/units/conversion';
import { toSelectItems } from '@/lib/ui/select-utils';
import type { UnitType } from '@/types';
import { cn } from '@/lib/utils';

function unitLabel(u: UnitType) {
  return `${u.name} (${u.code})`;
}

export interface ProductUnitsFormState {
  base_unit_id: string;
  purchase_unit_id: string;
  purchase_conversion: number;
  purchase_unit_cost: number;
  purchase_barcode?: string;
  retail_price: number;
  wholesale_price: number;
  distributor_price: number;
  vip_price: number;
  sale_units: ProductUnitOption[];
}

interface ProductUnitsEditorProps {
  unitTypes: UnitType[];
  value: ProductUnitsFormState;
  onChange: (next: ProductUnitsFormState) => void;
}

function emptySaleUnit(unitTypes: UnitType[], baseUnitId: string): ProductUnitOption {
  const pick = unitTypes.find((u) => u.id !== baseUnitId && u.unit_kind !== 'base') ?? unitTypes[0];
  return {
    unit_type_id: pick?.id ?? '',
    conversion_factor: 1,
    is_purchase_unit: false,
    is_default_sale: false,
    retail_price: null,
    wholesale_price: null,
    distributor_price: null,
    vip_price: null,
    quantity_prices: [],
    barcode: null,
  };
}

function emptyQuantityBreak(): QuantityPriceRow {
  return { price_tier: 'retail', min_qty: 1, max_qty: null, price: 0 };
}

const QTY_PRICE_TIERS: PriceTier[] = ['retail', 'wholesale', 'vip'];

export function ProductUnitsEditor({ unitTypes, value, onChange }: ProductUnitsEditorProps) {
  const baseUnits = useMemo(() => {
    const bases = unitTypes.filter((u) => u.unit_kind === 'base' || u.unit_kind === 'both');
    return bases.length > 0 ? bases : unitTypes;
  }, [unitTypes]);
  const otherUnits = useMemo(
    () => unitTypes.filter((u) => u.unit_kind !== 'base'),
    [unitTypes],
  );

  const baseUnitItems = useMemo(
    () => toSelectItems(baseUnits, (u) => u.id, unitLabel),
    [baseUnits],
  );
  const allUnitItems = useMemo(
    () => toSelectItems(unitTypes, (u) => u.id, unitLabel),
    [unitTypes],
  );
  const otherUnitItems = useMemo(
    () => toSelectItems(otherUnits, (u) => u.id, unitLabel),
    [otherUnits],
  );

  const baseCostPreview = toBaseUnitCost(value.purchase_unit_cost, value.purchase_conversion);
  const retailProfit = profitAtUnit(value.retail_price, baseCostPreview, 1);
  const wholesaleProfit = profitAtUnit(value.wholesale_price, baseCostPreview, 1);

  const update = (patch: Partial<ProductUnitsFormState>) => onChange({ ...value, ...patch });

  const baseUnitType = unitTypes.find((u) => u.id === value.base_unit_id);
  const baseUnitCode = baseUnitType?.code ?? 'base';

  const updateSaleUnit = (index: number, patch: Partial<ProductUnitOption>) => {
    let sale_units = value.sale_units.map((u, i) => (i === index ? { ...u, ...patch } : u));
    if (patch.is_default_sale) {
      sale_units = sale_units.map((u, i) => (i === index ? u : { ...u, is_default_sale: false }));
    }
    update({ sale_units });
  };

  const addSaleUnit = () => {
    update({ sale_units: [...value.sale_units, emptySaleUnit(unitTypes, value.base_unit_id)] });
  };

  const removeSaleUnit = (index: number) => {
    update({ sale_units: value.sale_units.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-5 rounded-xl border border-slate-200 p-4 bg-slate-50/50">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Units & Pricing</h4>
        <p className="text-xs text-slate-500 mt-0.5">
          Inventory is always tracked in the base unit. Other units convert automatically.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Base unit *</Label>
          <Select
            items={baseUnitItems}
            value={value.base_unit_id}
            onValueChange={(v) => update({ base_unit_id: v ?? '' })}
          >
            <SelectTrigger className="rounded-xl h-11">
              <SelectValue placeholder="Select base unit" />
            </SelectTrigger>
            <SelectContent>
              {baseUnitItems.map((item) => (
                <SelectItem key={item.value} value={item.value} label={String(item.label)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Purchase unit</Label>
          <Select
            items={allUnitItems}
            value={value.purchase_unit_id}
            onValueChange={(v) => update({ purchase_unit_id: v ?? '' })}
          >
            <SelectTrigger className="rounded-xl h-11">
              <SelectValue placeholder="Same as base" />
            </SelectTrigger>
            <SelectContent>
              {allUnitItems.map((item) => (
                <SelectItem key={item.value} value={item.value} label={String(item.label)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Conversion (base per 1 purchase unit)</Label>
          <Input
            type="number"
            min={0.000001}
            step="any"
            className="rounded-xl h-11"
            value={value.purchase_conversion}
            onChange={(e) => update({ purchase_conversion: Number(e.target.value) || 1 })}
          />
          <p className="text-xs text-slate-500">Example: 1 Carton = 24 PCS → enter 24</p>
        </div>

        <div className="space-y-1.5">
          <Label>Cost per purchase unit</Label>
          <Input
            type="number"
            min={0}
            step="any"
            className="rounded-xl h-11"
            value={value.purchase_unit_cost}
            onChange={(e) => update({ purchase_unit_cost: Number(e.target.value) || 0 })}
          />
        </div>

        {value.purchase_unit_id && value.purchase_unit_id !== value.base_unit_id && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Purchase unit barcode</Label>
            <Input
              className="rounded-xl h-11 font-mono text-sm"
              placeholder="Scan or type (optional)"
              value={value.purchase_barcode ?? ''}
              onChange={(e) => update({ purchase_barcode: e.target.value })}
            />
            <p className="text-xs text-slate-500">POS can scan this to add the product in the purchase unit (e.g. Sack).</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-xs text-emerald-900 grid gap-1 sm:grid-cols-2">
        <p>
          <span className="font-medium">Retail profit:</span>{' '}
          {retailProfit.profit.toFixed(2)} ({retailProfit.marginPct.toFixed(1)}% margin)
        </p>
        <p>
          <span className="font-medium">Wholesale profit:</span>{' '}
          {wholesaleProfit.profit.toFixed(2)} ({wholesaleProfit.marginPct.toFixed(1)}% margin)
        </p>
        <p className="sm:col-span-2 text-emerald-700">
          Base unit cost: {baseCostPreview.toFixed(4)} — used for COGS, inventory valuation, and profit
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Retail price (default sale)</Label>
          <Input
            type="number"
            min={0}
            step="any"
            className="rounded-xl h-11"
            value={value.retail_price}
            onChange={(e) => update({ retail_price: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Wholesale price</Label>
          <Input
            type="number"
            min={0}
            step="any"
            className="rounded-xl h-11"
            value={value.wholesale_price}
            onChange={(e) => update({ wholesale_price: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-violet-700">VIP price</Label>
          <Input
            type="number"
            min={0}
            step="any"
            className="rounded-xl h-11 border-violet-200"
            value={value.vip_price}
            onChange={(e) => update({ vip_price: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Distributor price</Label>
          <Input
            type="number"
            min={0}
            step="any"
            className="rounded-xl h-11"
            value={value.distributor_price}
            onChange={(e) => update({ distributor_price: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Sale units</Label>
            <p className="text-xs text-slate-500 mt-0.5">
              Units customers can buy in POS (e.g. KG, Sack, Pack). Base unit: {baseUnitCode}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={addSaleUnit}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add sale unit
          </Button>
        </div>

        {value.sale_units.length === 0 && (
          <p className="text-xs text-slate-400 italic px-1">
            Base unit ({baseUnitCode}) is sold by default. Add Sack, Pack, Carton, etc. with their own prices.
          </p>
        )}

        {value.sale_units.map((su, index) => {
          const breaks = su.quantity_prices ?? [];
          const updateBreak = (bIndex: number, patch: Partial<QuantityPriceRow>) => {
            const next = breaks.map((b, i) => (i === bIndex ? { ...b, ...patch } : b));
            updateSaleUnit(index, { quantity_prices: next });
          };
          const addBreak = () => updateSaleUnit(index, { quantity_prices: [...breaks, emptyQuantityBreak()] });
          const removeBreak = (bIndex: number) =>
            updateSaleUnit(index, { quantity_prices: breaks.filter((_, i) => i !== bIndex) });

          return (
            <div key={index} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="grid gap-3 sm:grid-cols-9 items-end">
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">Unit name</Label>
                  <Select
                    items={allUnitItems}
                    value={su.unit_type_id}
                    onValueChange={(v) => updateSaleUnit(index, { unit_type_id: v ?? '' })}
                  >
                    <SelectTrigger className="rounded-lg h-10">
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {allUnitItems.map((item) => (
                        <SelectItem key={item.value} value={item.value} label={String(item.label)}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">= {baseUnitCode} qty</Label>
                  <Input
                    type="number"
                    min={0.000001}
                    step="any"
                    className="rounded-lg h-10"
                    value={su.conversion_factor}
                    onChange={(e) => updateSaleUnit(index, { conversion_factor: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Retail</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="rounded-lg h-10"
                    value={su.retail_price ?? ''}
                    onChange={(e) => updateSaleUnit(index, { retail_price: Number(e.target.value) || null })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Wholesale</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="rounded-lg h-10"
                    value={su.wholesale_price ?? ''}
                    onChange={(e) => updateSaleUnit(index, { wholesale_price: Number(e.target.value) || null })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-violet-700">VIP</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="rounded-lg h-10 border-violet-200"
                    value={su.vip_price ?? ''}
                    onChange={(e) => updateSaleUnit(index, { vip_price: Number(e.target.value) || null })}
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">Barcode</Label>
                  <Input
                    className="rounded-lg h-10 font-mono text-xs"
                    placeholder="Optional"
                    value={su.barcode ?? ''}
                    onChange={(e) => updateSaleUnit(index, { barcode: e.target.value.trim() || null })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default</Label>
                  <Button
                    type="button"
                    variant={su.is_default_sale ? 'default' : 'outline'}
                    size="sm"
                    className="h-10 w-full rounded-lg text-xs"
                    onClick={() => updateSaleUnit(index, { is_default_sale: true })}
                  >
                    {su.is_default_sale ? 'Default' : 'Set default'}
                  </Button>
                </div>
              </div>

              {/* Quantity / bulk-break pricing for this unit */}
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Layers className="h-3.5 w-3.5 text-slate-400" />
                    Quantity pricing
                    <span className="text-slate-400 font-normal">(optional bulk-break prices for this unit)</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addBreak}>
                    <Plus className="h-3 w-3 mr-1" /> Add break
                  </Button>
                </div>
                {breaks.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">
                    e.g. 1–9 = {su.retail_price ?? (value.retail_price || 0)}, 10–49 = lower price, 50+ = lowest price
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {breaks.map((b, bIndex) => (
                      <div key={bIndex} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 items-end">
                        <div className="space-y-0.5">
                          {bIndex === 0 && <Label className="text-[10px] text-slate-500">Min qty</Label>}
                          <Input
                            type="number"
                            min={0.001}
                            step="any"
                            className="h-8 text-xs"
                            value={b.min_qty}
                            onChange={(e) => updateBreak(bIndex, { min_qty: Number(e.target.value) || 0.001 })}
                          />
                        </div>
                        <div className="space-y-0.5">
                          {bIndex === 0 && <Label className="text-[10px] text-slate-500">Max qty</Label>}
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="and above"
                            className="h-8 text-xs"
                            value={b.max_qty ?? ''}
                            onChange={(e) => updateBreak(bIndex, { max_qty: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-0.5">
                          {bIndex === 0 && <Label className="text-[10px] text-slate-500">Tier</Label>}
                          <Select
                            value={b.price_tier}
                            onValueChange={(v) => v && updateBreak(bIndex, { price_tier: v as PriceTier })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {QTY_PRICE_TIERS.map((t) => (
                                <SelectItem key={t} value={t}>{PRICE_TIER_LABELS[t]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-0.5">
                          {bIndex === 0 && <Label className="text-[10px] text-slate-500">Price</Label>}
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            className="h-8 text-xs"
                            value={b.price}
                            onChange={(e) => updateBreak(bIndex, { price: Number(e.target.value) || 0 })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 text-red-400', bIndex === 0 && 'mt-4')}
                          onClick={() => removeBreak(bIndex)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" className="text-red-500 h-8 text-xs" onClick={() => removeSaleUnit(index)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove this unit
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function defaultProductUnitsState(unitTypes: UnitType[]): ProductUnitsFormState {
  const baseCandidates = unitTypes.filter((u) => u.unit_kind === 'base' || u.unit_kind === 'both');
  const pcs =
    baseCandidates.find((u) => u.code === 'PCS')
    ?? baseCandidates[0]
    ?? unitTypes.find((u) => u.code === 'PCS')
    ?? unitTypes[0];
  return {
    base_unit_id: pcs?.id ?? '',
    purchase_unit_id: pcs?.id ?? '',
    purchase_conversion: 1,
    purchase_unit_cost: 0,
    purchase_barcode: '',
    retail_price: 0,
    wholesale_price: 0,
    distributor_price: 0,
    vip_price: 0,
    sale_units: [],
  };
}
