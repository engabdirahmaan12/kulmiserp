'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { CartItem, Product, ProductUnit } from '@/types';
import { getEffectiveUnitPrice, isBelowCost } from '@/lib/pos/pricing';
import { buildCartItemFromUnit, getSaleUnitsForProduct } from '@/lib/pos/units';
import type { PriceTier, ProductSalesMode } from '@/lib/units/conversion';
import { PRICE_TIER_LABELS, priceTiersForSalesMode, toBaseQty } from '@/lib/units/conversion';
import { usePosStore } from '@/lib/stores/pos';
import { maxQtyInSaleUnit } from '@/lib/pos/stock';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { toSelectItems } from '@/lib/ui/select-utils';

interface CartItemEditModalProps {
  open: boolean;
  item: CartItem | null;
  product: Product | null;
  allowBelowCost: boolean;
  currency: string;
  onClose: () => void;
  onReplace: (oldLineKey: string, newItem: CartItem) => void;
}

export function CartItemEditModal({
  open,
  item,
  product,
  allowBelowCost,
  currency,
  onClose,
  onReplace,
}: CartItemEditModalProps) {
  const { t } = useTranslation();
  const cartItems = usePosStore((s) => s.items);
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [discount, setDiscount] = useState('0');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [priceTier, setPriceTier] = useState<PriceTier>('retail');

  const { data: saleUnitsRpc } = useQuery({
    queryKey: ['product-sale-units', item?.product_id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_product_sale_units', {
        p_product_id: item!.product_id,
      });
      if (error) throw error;
      return data as {
        success: boolean;
        units: Array<{
          unit_type_id: string;
          code: string;
          name: string;
          allows_decimal: boolean;
          conversion_factor: number;
          retail_price: number;
          wholesale_price?: number;
          distributor_price?: number;
        }>;
      };
    },
    enabled: open && !!item?.product_id && !product?.product_units?.length,
  });

  const saleUnits = useMemo((): ProductUnit[] => {
    if (product?.product_units?.length) {
      return getSaleUnitsForProduct(product).map((u) => ({
        ...u,
        unit_type: u.unit_type ?? {
          id: u.unit_type_id,
          store_id: product.store_id,
          code: u.unit_type?.code ?? item?.sale_unit_code ?? 'PCS',
          name: u.unit_type?.name ?? item?.sale_unit_code ?? 'Unit',
          unit_kind: 'base',
          allows_decimal: u.unit_type?.allows_decimal ?? false,
          sort_order: 0,
          is_active: true,
        },
      }));
    }
    if (!saleUnitsRpc?.units?.length) return [];
    return saleUnitsRpc.units.map((u) => ({
      id: '',
      product_id: item!.product_id,
      unit_type_id: u.unit_type_id,
      conversion_factor: u.conversion_factor,
      is_purchase_unit: false,
      is_default_sale: false,
      retail_price: u.retail_price,
      wholesale_price: u.wholesale_price,
      distributor_price: u.distributor_price,
      unit_type: {
        id: u.unit_type_id,
        store_id: '',
        code: u.code,
        name: u.name,
        unit_kind: 'base',
        allows_decimal: u.allows_decimal,
        sort_order: 0,
        is_active: true,
      },
    }));
  }, [product, saleUnitsRpc, item]);

  const allowedTiers = useMemo(
    () => priceTiersForSalesMode(product?.sales_mode as ProductSalesMode | undefined),
    [product?.sales_mode],
  );

  const selectedUnit = saleUnits.find((u) => u.unit_type_id === selectedUnitId) ?? saleUnits[0];
  const allowsDecimal = selectedUnit?.unit_type?.allows_decimal ?? item?.allows_decimal ?? false;

  const saleUnitItems = useMemo(
    () => toSelectItems(
      saleUnits,
      (u) => u.unit_type_id,
      (u) => `${u.unit_type?.name ?? u.unit_type?.code ?? 'Unit'} (= ${u.conversion_factor} base)`,
    ),
    [saleUnits],
  );

  const tierItems = useMemo(
    () => toSelectItems(allowedTiers, (tier) => tier, (tier) => PRICE_TIER_LABELS[tier]),
    [allowedTiers],
  );

  useEffect(() => {
    if (!item) return;
    setQuantity(String(item.quantity));
    setUnitPrice(String(item.unit_price));
    setDiscount(String(item.discount_amount || 0));
    setSelectedUnitId(item.sale_unit_id ?? saleUnits[0]?.unit_type_id ?? '');
    setPriceTier((item.price_tier as PriceTier) ?? 'retail');
  }, [item, saleUnits]);

  useEffect(() => {
    if (!product || !selectedUnit || !item) return;
    const rebuilt = buildCartItemFromUnit(
      product,
      selectedUnit,
      priceTier,
      1,
      0,
      cartItems,
      item.line_key,
    );
    if (rebuilt) setUnitPrice(String(rebuilt.unit_price));
  }, [selectedUnitId, priceTier, product?.id, selectedUnit?.unit_type_id, cartItems, item?.line_key]);

  const maxStockInUnit = useMemo(() => {
    if (!product || !selectedUnit || !item) return undefined;
    return maxQtyInSaleUnit(product, selectedUnit, cartItems, item.line_key);
  }, [product, selectedUnit, cartItems, item?.line_key]);

  if (!item) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const handleSave = () => {
    const qty = allowsDecimal
      ? Math.max(0.001, parseFloat(quantity) || 0)
      : Math.max(1, parseInt(quantity, 10) || 1);
    const price = Math.max(0, parseFloat(unitPrice) || 0);
    const disc = Math.max(0, parseFloat(discount) || 0);

    if (!product || !selectedUnit) {
      toast.error('Product data unavailable');
      return;
    }

    if (
      product.track_inventory &&
      maxStockInUnit !== undefined &&
      qty > maxStockInUnit
    ) {
      toast.error(t('pos.onlyInStock', { count: maxStockInUnit }));
      return;
    }

    let next = buildCartItemFromUnit(
      product,
      selectedUnit,
      priceTier,
      qty,
      disc,
      cartItems,
      item.line_key,
    );
    if (!next) {
      toast.error(t('pos.onlyInStock', { count: item.max_stock ?? 0 }));
      return;
    }

    next = { ...next, unit_price: price, discount_amount: disc };
    next = {
      ...next,
      subtotal: qty * price - disc + (qty * price - disc) * (next.tax_rate / 100),
      tax_amount: ((qty * price - disc) * (next.tax_rate / 100)),
      base_qty: toBaseQty(qty, next.conversion_factor ?? 1),
    };

    if (!allowBelowCost && isBelowCost(next)) {
      toast.error(t('pos.belowCostSaleError'));
      return;
    }

    onReplace(item.line_key, next);
    onClose();
  };

  const previewEffective = getEffectiveUnitPrice({
    ...item,
    quantity: allowsDecimal ? parseFloat(quantity) || 1 : parseInt(quantity, 10) || 1,
    unit_price: parseFloat(unitPrice) || 0,
    discount_amount: parseFloat(discount) || 0,
    subtotal: 0,
  });

  const basePreview = selectedUnit
    ? toBaseQty(parseFloat(quantity) || 1, selectedUnit.conversion_factor)
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pos.editLineItem')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-900">{item.product_name}</p>
          <p className="text-xs text-slate-500">
            {t('pos.cost', { amount: `${currency} ${fmt(item.cost_price)}` })} / base unit
          </p>

          {saleUnits.length > 1 && (
            <div className="space-y-1.5">
              <Label>Sale unit</Label>
              <Select
                items={saleUnitItems}
                value={selectedUnitId}
                onValueChange={(v) => setSelectedUnitId(v ?? '')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  {saleUnitItems.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} label={String(opt.label)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Price tier</Label>
            <Select
              items={tierItems}
              value={priceTier}
              onValueChange={(v) => v && setPriceTier(v as PriceTier)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tierItems.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} label={String(opt.label)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t('pos.quantity')}</Label>
              <Input
                type="number"
                min={allowsDecimal ? 0.001 : 1}
                step={allowsDecimal ? 'any' : 1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="text-center font-semibold"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t('pos.salePrice', { currency })}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
          </div>

          {basePreview !== null && selectedUnit && (
            <p className="text-xs text-emerald-700">
              Stock impact: {basePreview} base units
            </p>
          )}

          <div className="space-y-1.5">
            <Label>{t('pos.lineDiscount', { currency })}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>

          <p className="text-xs text-slate-500">
            {t('pos.effectiveUnitPrice', { amount: `${currency} ${fmt(previewEffective)}` })}
          </p>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {t('pos.cancel')}
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              {t('pos.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
