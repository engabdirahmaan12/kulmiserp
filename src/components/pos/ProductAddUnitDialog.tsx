'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { CartItem, Product, ProductUnit } from '@/types';
import type { PriceTier } from '@/lib/units/conversion';
import { formatUnitQty, resolveTierPrice, toBaseQty } from '@/lib/units/conversion';
import { buildCartItemFromUnit, getSaleUnitsForProduct } from '@/lib/pos/units';
import { maxQtyInSaleUnit } from '@/lib/pos/stock';
import { toSelectItems } from '@/lib/ui/select-utils';

interface ProductAddUnitDialogProps {
  open: boolean;
  product: Product | null;
  tier: PriceTier;
  cartItems: CartItem[];
  currency: string;
  onClose: () => void;
  onAdd: (item: CartItem) => boolean;
}

export function ProductAddUnitDialog({
  open,
  product,
  tier,
  cartItems,
  currency,
  onClose,
  onAdd,
}: ProductAddUnitDialogProps) {
  const saleUnits = useMemo(() => (product ? getSaleUnitsForProduct(product) : []), [product]);

  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('1');

  useEffect(() => {
    if (!open || !product) return;
    const defaultUnit = saleUnits.find((u) => u.is_default_sale) ?? saleUnits[0];
    setUnitId(defaultUnit?.unit_type_id ?? '');
    setQuantity('1');
  }, [open, product, saleUnits]);

  const selectedUnit = saleUnits.find((u) => u.unit_type_id === unitId) ?? saleUnits[0];
  const allowsDecimal = selectedUnit?.unit_type?.allows_decimal ?? false;
  const baseCode =
    product?.product_units?.find((u) => u.unit_type_id === product.base_unit_id)?.unit_type?.code
    ?? saleUnits.find((u) => u.conversion_factor === 1)?.unit_type?.code
    ?? product?.unit
    ?? 'PCS';

  const unitItems = useMemo(
    () => toSelectItems(
      saleUnits,
      (u) => u.unit_type_id,
      (u) => `${u.unit_type?.name ?? u.unit_type?.code ?? 'Unit'} (= ${u.conversion_factor} ${baseCode})`,
    ),
    [saleUnits, baseCode],
  );

  const tierPrice = selectedUnit && product
    ? resolveTierPrice(
        selectedUnit,
        tier,
        {
          retail: product.selling_price,
          wholesale: product.wholesale_price,
          distributor: product.distributor_price,
        },
        selectedUnit.conversion_factor ?? 1,
      )
    : 0;
  const parsedQty = allowsDecimal ? parseFloat(quantity) : parseInt(quantity, 10);
  const qtyValid = Number.isFinite(parsedQty) && parsedQty > 0;
  const basePreview = qtyValid && selectedUnit
    ? toBaseQty(parsedQty, selectedUnit.conversion_factor ?? 1)
    : 0;

  const maxInUnit = product && selectedUnit
    ? maxQtyInSaleUnit(product, selectedUnit, cartItems)
    : undefined;

  const handleAdd = () => {
    if (!product || !selectedUnit || !qtyValid) return;
    const item = buildCartItemFromUnit(product, selectedUnit, tier, parsedQty, 0, cartItems);
    if (!item) return;
    const ok = onAdd(item);
    if (ok) onClose();
  };

  if (!product) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Stock: {formatUnitQty(product.stock_quantity, true)} {baseCode} (base unit)
          </p>

          <div className="space-y-1.5">
            <Label>Sale unit</Label>
            <Select items={unitItems} value={unitId} onValueChange={(v) => setUnitId(v ?? '')}>
              <SelectTrigger className="rounded-xl h-11 w-full">
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                {unitItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} label={String(item.label)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={allowsDecimal ? 0.001 : 1}
              step={allowsDecimal ? 'any' : 1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="rounded-xl h-11 text-center font-semibold text-lg"
              autoFocus
            />
            {maxInUnit !== undefined && (
              <p className="text-xs text-slate-500">
                Max available: {formatUnitQty(maxInUnit, allowsDecimal)} {selectedUnit?.unit_type?.code}
              </p>
            )}
          </div>

          {qtyValid && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
              <p className="text-slate-700">
                = <span className="font-semibold">{formatUnitQty(basePreview, true)} {baseCode}</span> base units
              </p>
              {selectedUnit && (
                <p className="text-xs text-slate-500 mt-1">
                  Unit price: {fmt(tierPrice)}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!qtyValid || (maxInUnit !== undefined && parsedQty > maxInUnit)}
              className="bg-teal-600 hover:bg-teal-700 text-white rounded-xl"
            >
              Add to cart
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
