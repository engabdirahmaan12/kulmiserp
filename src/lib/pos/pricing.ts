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

export function recalcLineSubtotal(
  quantity: number,
  unitPrice: number,
  discountAmount: number,
): number {
  return Math.max(0, quantity * unitPrice - discountAmount);
}
