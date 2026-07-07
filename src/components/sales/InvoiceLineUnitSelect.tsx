'use client';

import { useMemo } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Product } from '@/types';
import { getSaleUnitsForProduct } from '@/lib/units/engine';
import { isGenericPieceUnit } from '@/lib/invoice-utils';
import { toSelectItems } from '@/lib/ui/select-utils';
import { cn } from '@/lib/utils';

interface InvoiceLineUnitSelectProps {
  product: Product;
  value: string | undefined;
  onChange: (unitTypeId: string) => void;
  className?: string;
  compact?: boolean;
}

export function InvoiceLineUnitSelect({
  product,
  value,
  onChange,
  className,
  compact,
}: InvoiceLineUnitSelectProps) {
  const units = getSaleUnitsForProduct(product);

  const unitItems = useMemo(
    () => toSelectItems(
      units,
      (u) => u.unit_type_id,
      (u) => u.unit_type?.code ?? u.unit_type?.name ?? 'Unit',
    ),
    [units],
  );

  if (units.length <= 1) {
    const code = units[0]?.unit_type?.code ?? product.unit;
    // Simple / single-piece products carry no meaningful unit — show a dash.
    if (isGenericPieceUnit(code)) {
      return <span className={cn('text-[10px] text-slate-400', className)}>—</span>;
    }
    return (
      <span className={cn('text-[10px] font-medium text-slate-500 uppercase', className)}>
        {code}
      </span>
    );
  }

  return (
    <Select
      items={unitItems}
      value={value ?? units[0]?.unit_type_id}
      onValueChange={(v) => v && onChange(v)}
    >
      <SelectTrigger
        className={cn(
          compact ? 'h-8 text-xs' : 'h-9',
          'min-w-[4rem] max-w-[7rem] font-semibold uppercase',
          className,
        )}
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
