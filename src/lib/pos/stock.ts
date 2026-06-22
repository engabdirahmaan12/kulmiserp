import type { CartItem, Product, ProductUnit } from '@/types';
import { maxSaleUnitQty, toBaseQty } from '@/lib/units/conversion';
import { getSaleUnitsForProduct, pickDefaultSaleUnit } from '@/lib/pos/units';

/** Base units already reserved in cart for a product (optionally excluding one line). */
export function cartBaseQtyReserved(
  cartItems: CartItem[],
  productId: string,
  excludeLineKey?: string,
): number {
  return cartItems
    .filter((i) => i.product_id === productId && i.line_key !== excludeLineKey)
    .reduce(
      (sum, i) => sum + (i.base_qty ?? toBaseQty(i.quantity, i.conversion_factor ?? 1)),
      0,
    );
}

/** Remaining base stock after cart reservations. */
export function remainingBaseStock(
  product: Product,
  cartItems: CartItem[],
  excludeLineKey?: string,
): number {
  if (!product.track_inventory) return Number.POSITIVE_INFINITY;
  const reserved = cartBaseQtyReserved(cartItems, product.id, excludeLineKey);
  return Math.max(0, product.stock_quantity - reserved);
}

/** Max sale-unit qty allowed given cart reservations. */
export function maxQtyInSaleUnit(
  product: Product,
  unit: ProductUnit,
  cartItems: CartItem[],
  excludeLineKey?: string,
): number | undefined {
  if (!product.track_inventory) return undefined;
  const remaining = remainingBaseStock(product, cartItems, excludeLineKey);
  const allowsDecimal = unit.unit_type?.allows_decimal ?? false;
  return maxSaleUnitQty(remaining, unit.conversion_factor ?? 1, allowsDecimal);
}

/** Recompute max_stock on each cart line from shared base inventory. */
export function refreshCartStockLimits(items: CartItem[], products: Product[]): CartItem[] {
  const productMap = new Map(products.map((p) => [p.id, p]));
  return items.map((item) => {
    const product = productMap.get(item.product_id);
    if (!product?.track_inventory) return { ...item, max_stock: undefined };
    const units = getSaleUnitsForProduct(product);
    const unit =
      units.find((u) => u.unit_type_id === item.sale_unit_id) ?? pickDefaultSaleUnit(product);
    if (!unit) return item;
    const maxInUnit = maxQtyInSaleUnit(product, unit, items, item.line_key);
    return { ...item, max_stock: maxInUnit };
  });
}

/** Returns error message if cart exceeds available base stock. */
export function validateCartStock(items: CartItem[], products: Product[]): string | null {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const totals = new Map<string, number>();

  for (const item of items) {
    const base = item.base_qty ?? toBaseQty(item.quantity, item.conversion_factor ?? 1);
    totals.set(item.product_id, (totals.get(item.product_id) ?? 0) + base);
  }

  for (const [productId, totalBase] of totals) {
    const product = productMap.get(productId);
    if (!product?.track_inventory) continue;
    if (totalBase > product.stock_quantity + 0.0001) {
      const code = product.product_units?.find((u) => u.conversion_factor === 1)?.unit_type?.code
        ?? product.unit
        ?? 'base';
      return `Insufficient stock for ${product.name} (need ${totalBase.toFixed(3)} ${code}, have ${product.stock_quantity})`;
    }
  }
  return null;
}
