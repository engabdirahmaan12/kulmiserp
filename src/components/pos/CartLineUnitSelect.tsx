'use client';

import { useMemo } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { CartItem, Customer, Product } from '@/types';
import { buildCartItemFromUnit, getDefaultPriceTier, getSaleUnitsForProduct } from '@/lib/pos/units';
import { isGenericPieceUnit } from '@/lib/invoice-utils';
import { toSelectItems } from '@/lib/ui/select-utils';
import { cn } from '@/lib/utils';

interface CartLineUnitSelectProps {
  item: CartItem;
  product: Product | null;
  cartItems: CartItem[];
  customer: Customer | null;
  storeSettings: Record<string, unknown>;
  onUnitChange: (oldLineKey: string, newItem: CartItem) => void;
  className?: string;
}

export function CartLineUnitSelect({
  item,
  product,
  cartItems,
  customer,
  storeSettings,
  onUnitChange,
  className,
}: CartLineUnitSelectProps) {
  const units = product ? getSaleUnitsForProduct(product) : [];

  const unitItems = useMemo(
    () => toSelectItems(
      units,
      (u) => u.unit_type_id,
      (u) => u.unit_type?.code ?? u.unit_type?.name ?? 'Unit',
    ),
    [units],
  );

  if (units.length <= 1) {
    // Simple / single-piece products carry no meaningful unit — show nothing.
    if (isGenericPieceUnit(item.sale_unit_code)) return null;
    return (
      <span className={cn('text-[10px] font-medium text-slate-500 uppercase', className)}>
        {item.sale_unit_code}
      </span>
    );
  }

  const handleChange = (unitTypeId: string | null) => {
    if (!unitTypeId || !product || unitTypeId === item.sale_unit_id) return;
    const unit = units.find((u) => u.unit_type_id === unitTypeId);
    if (!unit) return;
    const tier = item.price_tier ?? getDefaultPriceTier(customer, storeSettings);
    const next = buildCartItemFromUnit(
      product,
      unit,
      tier,
      item.quantity,
      item.discount_amount,
      cartItems,
      item.line_key,
    );
    if (next) onUnitChange(item.line_key, next);
  };

  return (
    <Select
      items={unitItems}
      value={item.sale_unit_id ?? units[0]?.unit_type_id}
      onValueChange={handleChange}
    >
      <SelectTrigger
        className={cn('h-6 min-w-[3.5rem] max-w-[6rem] text-[10px] font-semibold uppercase px-1.5 rounded-md border-slate-200', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder="Unit" />
      </SelectTrigger>
      <SelectContent>
        {unitItems.map((opt) => {
          const u = units.find((unit) => unit.unit_type_id === opt.value);
          return (
            <SelectItem key={opt.value} value={opt.value} label={String(opt.label)} className="text-xs">
              {u?.unit_type?.name ?? opt.label} ({u?.conversion_factor ?? 1} base)
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
