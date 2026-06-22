/**
 * POS cart helpers — prefer importing from `@/lib/units/engine` in new code.
 */
import type { CartItem, Customer, Product, ProductUnit } from '@/types';
import type { PriceTier, ProductSalesMode } from '@/lib/units/conversion';
import {
  defaultTierForSalesMode,
  maxSaleUnitQty,
  priceTiersForSalesMode,
  resolveTierPrice,
  toBaseQty,
} from '@/lib/units/conversion';
import { maxQtyInSaleUnit } from '@/lib/pos/stock';

export function cartLineKey(productId: string, saleUnitId?: string): string {
  return `${productId}:${saleUnitId ?? 'base'}`;
}

export function ensureCartLineKey(item: CartItem): CartItem {
  if (item.line_key) return item;
  return { ...item, line_key: cartLineKey(item.product_id, item.sale_unit_id) };
}

export function getDefaultPriceTier(
  customer: Customer | null,
  storeSettings: Record<string, unknown>,
): PriceTier {
  const customerTier = customer?.price_tier as PriceTier | undefined;
  if (customerTier) return customerTier;
  return (storeSettings.default_price_tier as PriceTier) ?? 'retail';
}

export function getEffectivePriceTier(
  product: Pick<Product, 'sales_mode'> | null | undefined,
  customer: Customer | null,
  storeSettings: Record<string, unknown>,
): PriceTier {
  const allowed = priceTiersForSalesMode(product?.sales_mode as ProductSalesMode | undefined);
  let tier = getDefaultPriceTier(customer, storeSettings);
  if (!allowed.includes(tier)) {
    tier = defaultTierForSalesMode(product?.sales_mode as ProductSalesMode | undefined);
  }
  return tier;
}

export function getSaleUnitsForProduct(product: Product): ProductUnit[] {
  const units = product.product_units ?? [];
  const saleUnits = units.filter((u) => {
    if (!u.is_purchase_unit) return true;
    if (u.is_default_sale) return true;
    // Bulk purchase units (e.g. Sack, Carton) are also sold at POS
    return (u.conversion_factor ?? 1) > 1;
  });
  if (saleUnits.length > 0) return saleUnits;
  if (units.length > 0) return [units.find((u) => u.is_default_sale) ?? units[0]];
  return [];
}

export function pickDefaultSaleUnit(product: Product): ProductUnit | null {
  const saleUnits = getSaleUnitsForProduct(product);
  return saleUnits.find((u) => u.is_default_sale) ?? saleUnits[0] ?? null;
}

/** Per-sale-unit price for a product (base price × conversion unless unit has explicit override). */
export function saleUnitPriceForProduct(
  product: Product,
  unit: ProductUnit,
  tier: PriceTier,
): number {
  return resolveTierPrice(
    unit,
    tier,
    {
      retail: product.selling_price,
      wholesale: product.wholesale_price,
      distributor: product.distributor_price,
    },
    unit.conversion_factor ?? 1,
  );
}

export function defaultSalePriceForProduct(product: Product, tier: PriceTier = 'retail'): number {
  const unit = pickDefaultSaleUnit(product);
  if (!unit) return product.selling_price;
  return saleUnitPriceForProduct(product, unit, tier);
}

export function buildCartItemFromProduct(
  product: Product,
  tier: PriceTier,
  saleUnit?: ProductUnit | null,
  cartItems: CartItem[] = [],
  quantity = 1,
  excludeLineKey?: string,
): CartItem | null {
  const unit = saleUnit ?? pickDefaultSaleUnit(product);
  if (!unit) return null;
  const conversion = unit.conversion_factor ?? 1;
  const allowsDecimal = unit.unit_type?.allows_decimal ?? false;
  const unitTypeId = unit.unit_type_id;
  const unitCode = unit.unit_type?.code;

  const unitPrice = resolveTierPrice(
    unit,
    tier,
    {
      retail: product.selling_price,
      wholesale: product.wholesale_price,
      distributor: product.distributor_price,
    },
    conversion,
  );

  const maxInUnit = maxQtyInSaleUnit(product, unit, cartItems, excludeLineKey);

  if (product.track_inventory && quantity > (maxInUnit ?? 0)) {
    return null;
  }

  const taxRate = product.is_taxable ? product.tax_rate : 0;

  return recalcCartItem(
    {
      line_key: cartLineKey(product.id, unitTypeId),
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      quantity,
      unit_price: unitPrice,
      cost_price: product.cost_price,
      discount_amount: 0,
      tax_rate: taxRate,
      tax_amount: 0,
      subtotal: 0,
      image_url: product.image_url,
      max_stock: maxInUnit,
      track_inventory: product.track_inventory,
      sale_unit_id: unitTypeId,
      sale_unit_code: unitCode,
      conversion_factor: conversion,
      allows_decimal: allowsDecimal,
      price_tier: tier,
    },
    quantity,
  );
}

export function buildCartItemFromUnit(
  product: Product,
  unit: ProductUnit,
  tier: PriceTier,
  quantity = 1,
  discountAmount = 0,
  cartItems: CartItem[] = [],
  excludeLineKey?: string,
): CartItem | null {
  const conversion = unit.conversion_factor ?? 1;
  const allowsDecimal = unit.unit_type?.allows_decimal ?? false;
  const unitPrice = resolveTierPrice(
    unit,
    tier,
    {
      retail: product.selling_price,
      wholesale: product.wholesale_price,
      distributor: product.distributor_price,
    },
    conversion,
  );

  const maxInUnit = maxQtyInSaleUnit(product, unit, cartItems, excludeLineKey);

  if (product.track_inventory && quantity > (maxInUnit ?? 0)) {
    return null;
  }

  const taxRate = product.is_taxable ? product.tax_rate : 0;
  const item = recalcCartItem(
    {
      line_key: cartLineKey(product.id, unit.unit_type_id),
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      quantity,
      unit_price: unitPrice,
      cost_price: product.cost_price,
      discount_amount: discountAmount,
      tax_rate: taxRate,
      tax_amount: 0,
      subtotal: 0,
      image_url: product.image_url,
      max_stock: maxInUnit,
      track_inventory: product.track_inventory,
      sale_unit_id: unit.unit_type_id,
      sale_unit_code: unit.unit_type?.code,
      conversion_factor: conversion,
      allows_decimal: allowsDecimal,
      price_tier: tier,
    },
    quantity,
  );
  return item;
}

export function repriceCartItemForTier(item: CartItem, product: Product, tier: PriceTier): CartItem {
  const units = getSaleUnitsForProduct(product);
  const unit = units.find((u) => u.unit_type_id === item.sale_unit_id) ?? pickDefaultSaleUnit(product);
  if (!unit) return { ...item, price_tier: tier };

  const conversion = unit.conversion_factor ?? item.conversion_factor ?? 1;
  const unitPrice = resolveTierPrice(
    unit,
    tier,
    {
      retail: product.selling_price,
      wholesale: product.wholesale_price,
      distributor: product.distributor_price,
    },
    conversion,
  );

  return recalcCartItem(
    { ...item, unit_price: unitPrice, price_tier: tier, discount_amount: item.discount_amount },
    item.quantity,
  );
}

export function recalcCartItem(item: CartItem, quantity: number): CartItem {
  const conv = item.conversion_factor ?? 1;
  const base = toBaseQty(quantity, conv);
  const lineSubtotal = item.unit_price * quantity - item.discount_amount;
  const taxAmount = lineSubtotal * (item.tax_rate / 100);
  return {
    ...item,
    quantity,
    base_qty: base,
    tax_amount: taxAmount,
    subtotal: lineSubtotal + taxAmount,
  };
}

export function toSaleRpcItem(item: CartItem) {
  const conv = item.conversion_factor ?? 1;
  const saleQty = item.quantity;
  const baseQty = item.base_qty ?? toBaseQty(saleQty, conv);
  return {
    product_id: item.product_id,
    product_name: item.product_name,
    product_sku: item.product_sku,
    quantity: baseQty,
    sale_unit_qty: saleQty,
    base_qty: baseQty,
    sale_unit_id: item.sale_unit_id ?? null,
    sale_unit_code: item.sale_unit_code ?? null,
    price_tier: item.price_tier ?? 'retail',
    unit_price: item.unit_price,
    cost_price: item.cost_price,
    discount_amount: item.discount_amount,
    tax_amount: item.tax_amount * saleQty,
    subtotal: item.unit_price * saleQty - item.discount_amount,
  };
}
