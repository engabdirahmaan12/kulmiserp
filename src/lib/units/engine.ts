/**
 * Central multi-unit engine — single source for conversion, pricing, and sale-line payloads.
 * All modules (POS, Custom Invoice, Returns, Reports) should use these helpers.
 */
import type { CartItem, Product, ProductUnit, SaleItem } from '@/types';
import type { PriceTier } from '@/lib/units/conversion';
import { toBaseQty } from '@/lib/units/conversion';
import {
  buildCartItemFromUnit,
  defaultSalePriceForProduct,
  getSaleUnitsForProduct,
  pickDefaultSaleUnit,
  saleUnitPriceForProduct,
  toSaleRpcItem,
} from '@/lib/pos/units';

export {
  toBaseQty,
  fromBaseQty,
  resolveTierPrice,
  maxSaleUnitQty,
  profitAtUnit,
  productBaseUnitCode,
  formatAlternateStockSummary,
} from '@/lib/units/conversion';
export type { QuantityPriceRow } from '@/lib/units/conversion';
export { resolveQuantityPrice } from '@/lib/units/quantityPricing';

export {
  getSaleUnitsForProduct,
  pickDefaultSaleUnit,
  buildCartItemFromProduct,
  buildCartItemFromUnit,
  saleUnitPriceForProduct,
  defaultSalePriceForProduct,
  toSaleRpcItem,
  getEffectivePriceTier,
} from '@/lib/pos/units';

export { validateCartStock, maxQtyInSaleUnit, remainingBaseStock } from '@/lib/pos/stock';
export { getPurchaseUnitsForProduct, computePurchaseLineBase } from '@/lib/purchase/units';
export { saleItemBaseQty, saleItemCogs } from '@/lib/sales/cogs';

/** Canonical sale line fields shared across POS, custom invoice, drafts, and RPC. */
export interface SaleLineCore {
  product_id?: string;
  product_name: string;
  product_sku?: string;
  /** Quantity in the selected sale unit */
  sale_unit_qty: number;
  /** Always base units — used for inventory & COGS */
  base_qty: number;
  sale_unit_id?: string | null;
  sale_unit_code?: string | null;
  conversion_factor: number;
  unit_price: number;
  cost_price: number;
  discount_amount: number;
  tax_amount: number;
  subtotal: number;
  price_tier?: PriceTier;
  /** Set when a manual price override was applied — audit trail. */
  original_unit_price?: number | null;
  price_override_reason?: string | null;
  price_overridden_by?: string | null;
}

export function lineBaseQty(saleUnitQty: number, conversionFactor: number): number {
  return toBaseQty(saleUnitQty, conversionFactor);
}

export function buildSaleLineFromProduct(
  product: Product,
  tier: PriceTier,
  saleUnitQty = 1,
  discountAmount = 0,
  saleUnit?: ProductUnit | null,
): SaleLineCore | null {
  const unit = saleUnit ?? pickDefaultSaleUnit(product);
  if (!unit) return null;
  const cart = buildCartItemFromUnit(product, unit, tier, saleUnitQty, discountAmount);
  if (!cart) return null;
  return cartItemToSaleLine(cart);
}

export function cartItemToSaleLine(item: CartItem): SaleLineCore {
  const conv = item.conversion_factor ?? 1;
  const saleQty = item.quantity;
  const base = item.base_qty ?? toBaseQty(saleQty, conv);
  const lineNet = item.unit_price * saleQty - (item.discount_amount || 0);
  return {
    product_id: item.product_id,
    product_name: item.product_name,
    product_sku: item.product_sku,
    sale_unit_qty: saleQty,
    base_qty: base,
    sale_unit_id: item.sale_unit_id ?? null,
    sale_unit_code: item.sale_unit_code ?? null,
    conversion_factor: conv,
    unit_price: item.unit_price,
    cost_price: item.cost_price,
    discount_amount: item.discount_amount || 0,
    tax_amount: item.tax_amount,
    subtotal: lineNet + item.tax_amount,
    price_tier: item.price_tier,
    original_unit_price: item.original_unit_price ?? null,
    price_override_reason: item.price_override_reason ?? null,
    price_overridden_by: item.price_overridden_by ?? null,
  };
}

export function saleLineToRpcPayload(line: SaleLineCore) {
  return {
    product_id: line.product_id ?? null,
    product_name: line.product_name,
    product_sku: line.product_sku ?? null,
    quantity: line.base_qty,
    sale_unit_qty: line.sale_unit_qty,
    base_qty: line.base_qty,
    sale_unit_id: line.sale_unit_id ?? null,
    sale_unit_code: line.sale_unit_code ?? null,
    price_tier: line.price_tier ?? 'retail',
    unit_price: line.unit_price,
    cost_price: line.cost_price,
    discount_amount: line.discount_amount,
    tax_amount: line.tax_amount,
    subtotal: line.unit_price * line.sale_unit_qty - line.discount_amount,
    original_unit_price: line.original_unit_price ?? null,
    price_override_reason: line.price_override_reason ?? null,
    price_overridden_by: line.price_overridden_by ?? null,
  };
}

export function saleLineToDraftRow(
  storeId: string,
  saleId: string,
  line: SaleLineCore,
) {
  return {
    store_id: storeId,
    sale_id: saleId,
    product_id: line.product_id ?? null,
    product_name: line.product_name,
    product_sku: line.product_sku ?? null,
    quantity: line.base_qty,
    unit_price: line.unit_price,
    cost_price: line.cost_price,
    discount_amount: line.discount_amount,
    tax_amount: line.tax_amount,
    subtotal: line.subtotal,
    sale_unit_id: line.sale_unit_id ?? null,
    sale_unit_code: line.sale_unit_code ?? null,
    sale_unit_qty: line.sale_unit_qty,
    base_qty: line.base_qty,
    price_tier: line.price_tier ?? 'retail',
    original_unit_price: line.original_unit_price ?? null,
    price_override_reason: line.price_override_reason ?? null,
    price_overridden_by: line.price_overridden_by ?? null,
  };
}

export function dbSaleItemToSaleLine(row: SaleItem): SaleLineCore {
  const saleQty = Number(row.sale_unit_qty ?? row.quantity ?? 0);
  const base = Number(row.base_qty ?? row.quantity ?? 0);
  const conv = saleQty > 0 ? base / saleQty : 1;
  return {
    product_id: row.product_id ?? undefined,
    product_name: row.product_name,
    product_sku: row.product_sku ?? undefined,
    sale_unit_qty: saleQty,
    base_qty: base,
    sale_unit_id: row.sale_unit_id ?? null,
    sale_unit_code: row.sale_unit_code ?? null,
    conversion_factor: conv,
    unit_price: Number(row.unit_price) || 0,
    cost_price: Number(row.cost_price) || 0,
    discount_amount: Number(row.discount_amount) || 0,
    tax_amount: Number(row.tax_amount) || 0,
    subtotal: Number(row.subtotal) || 0,
    price_tier: (row.price_tier as PriceTier) ?? 'retail',
    original_unit_price: row.original_unit_price ?? null,
    price_override_reason: row.price_override_reason ?? null,
    price_overridden_by: row.price_overridden_by ?? null,
  };
}

export function repriceSaleLineUnit(
  product: Product,
  line: Pick<SaleLineCore, 'sale_unit_id' | 'sale_unit_qty' | 'discount_amount' | 'price_tier'>,
  tier: PriceTier = line.price_tier ?? 'retail',
): Partial<SaleLineCore> | null {
  const units = getSaleUnitsForProduct(product);
  const unit = units.find((u) => u.unit_type_id === line.sale_unit_id) ?? pickDefaultSaleUnit(product);
  if (!unit) return null;
  const unitPrice = saleUnitPriceForProduct(product, unit, tier, line.sale_unit_qty);
  const conv = unit.conversion_factor ?? 1;
  const base = toBaseQty(line.sale_unit_qty, conv);
  const lineNet = unitPrice * line.sale_unit_qty - line.discount_amount;
  const taxRate = product.is_taxable ? product.tax_rate : 0;
  const taxAmount = lineNet * (taxRate / 100);
  return {
    sale_unit_id: unit.unit_type_id,
    sale_unit_code: unit.unit_type?.code ?? null,
    conversion_factor: conv,
    base_qty: base,
    unit_price: unitPrice,
    cost_price: product.cost_price,
    tax_amount: taxAmount,
    subtotal: lineNet + taxAmount,
    price_tier: tier,
  };
}
