import type { CartItem } from '@/types';

export function getEffectiveUnitPrice(item: CartItem): number {
  if (item.quantity <= 0) return item.unit_price;
  const lineNet = item.unit_price * item.quantity - (item.discount_amount || 0);
  return lineNet / item.quantity;
}

export function isBelowCost(item: CartItem): boolean {
  const effective = getEffectiveUnitPrice(item);
  const factor = Number(item.conversion_factor) || 1;
  const baseUnitCostForLine = item.cost_price * factor;
  return effective < baseUnitCostForLine;
}

export function findBelowCostItems(items: CartItem[]): CartItem[] {
  return items.filter(isBelowCost);
}

export function getPosAllowBelowCost(settings: Record<string, unknown> | undefined): boolean {
  return settings?.pos_allow_below_cost_sales === true;
}

/** Whether cashiers may override a computed price at POS. Combined with a
 *  role check (owner/manager) at the call site — this setting alone doesn't
 *  grant the permission. */
export function getPosAllowPriceOverride(settings: Record<string, unknown> | undefined): boolean {
  return settings?.pos_allow_price_override === true;
}

/** Whether Price Levels (VIP tier) can be assigned to new customers/products.
 *  Defaults to on — VIP already ships and works; this is an opt-out. */
export function getPriceLevelsEnabled(settings: Record<string, unknown> | undefined): boolean {
  return settings?.pricing_enable_price_levels !== false;
}

/** Whether new Quantity/bulk-break price rows can be configured on a product.
 *  Defaults to on for the same reason as above. */
export function getQuantityPricingEnabled(settings: Record<string, unknown> | undefined): boolean {
  return settings?.pricing_enable_quantity_pricing !== false;
}

export function recalcLineSubtotal(
  quantity: number,
  unitPrice: number,
  discountAmount: number,
): number {
  return Math.max(0, quantity * unitPrice - discountAmount);
}
