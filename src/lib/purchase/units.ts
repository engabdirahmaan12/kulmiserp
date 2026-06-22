import type { Product } from '@/types';
import { toBaseQty, toBaseUnitCost } from '@/lib/units/conversion';

export interface PurchaseLineUnitState {
  purchase_unit_id: string;
  purchase_unit_code: string;
  conversion_factor: number;
  allows_decimal: boolean;
}

export function getPurchaseUnitForProduct(product: Product): PurchaseLineUnitState | null {
  const units = getPurchaseUnitsForProduct(product);
  const purchase = units[0];
  if (!purchase) return null;
  return {
    purchase_unit_id: purchase.unit_type_id,
    purchase_unit_code: purchase.unit_type?.code ?? 'PCS',
    conversion_factor: purchase.conversion_factor || 1,
    allows_decimal: purchase.unit_type?.allows_decimal ?? false,
  };
}

/** All units valid for PO entry (purchase units, or all configured units) */
export function getPurchaseUnitsForProduct(product: Product) {
  const units = product.product_units ?? [];
  if (units.length === 0) return [];
  const purchaseOnly = units.filter((u) => u.is_purchase_unit);
  return purchaseOnly.length > 0 ? purchaseOnly : units;
}

export function purchaseUnitCostForProduct(product: Product, unit: { conversion_factor?: number }) {
  const conv = unit.conversion_factor ?? 1;
  return Math.round((product.cost_price ?? 0) * conv * 100) / 100;
}

export function lineStateFromPurchaseUnit(
  product: Product,
  unit: NonNullable<Product['product_units']>[number],
): PurchaseLineUnitState {
  return {
    purchase_unit_id: unit.unit_type_id,
    purchase_unit_code: unit.unit_type?.code ?? 'PCS',
    conversion_factor: unit.conversion_factor || 1,
    allows_decimal: unit.unit_type?.allows_decimal ?? false,
  };
}

/** Default purchase unit cost from product (per purchase unit) */
export function defaultPurchaseUnitCost(product: Product): number {
  const pu = getPurchaseUnitForProduct(product);
  return purchaseUnitCostForProduct(product, { conversion_factor: pu?.conversion_factor ?? 1 });
}

export function computePurchaseLineBase(
  purchaseQty: number,
  unitCostPerPurchase: number,
  conversionFactor: number,
) {
  const baseQty = toBaseQty(purchaseQty, conversionFactor);
  const baseUnitCost = toBaseUnitCost(unitCostPerPurchase, conversionFactor);
  const lineTotal = purchaseQty * unitCostPerPurchase;
  return { baseQty, baseUnitCost, lineTotal };
}

export function formatPurchaseLineHint(
  purchaseQty: number,
  conversionFactor: number,
  baseUnitCost: number,
  baseCode = 'base',
): string {
  const { baseQty } = computePurchaseLineBase(purchaseQty, 0, conversionFactor);
  return `→ ${baseQty} ${baseCode} @ ${baseUnitCost.toFixed(4)}/unit`;
}
