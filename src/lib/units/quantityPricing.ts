import type { PriceTier, QuantityPriceRow } from './conversion';

/**
 * Finds the tightest matching quantity/bulk-break price for a cart line.
 * Matched in the sale unit's own counting (e.g. "50+ KG"), not base units —
 * that's how a cashier keys in quantity. Returns null when no breakpoint
 * applies, so the caller falls back to the tier-resolved price.
 */
export function resolveQuantityPrice(
  quantityPrices: QuantityPriceRow[] | undefined,
  tier: PriceTier,
  qty: number,
): number | null {
  if (!quantityPrices || quantityPrices.length === 0) return null;

  const matches = quantityPrices.filter(
    (row) =>
      row.price_tier === tier &&
      qty >= row.min_qty &&
      (row.max_qty == null || qty <= row.max_qty),
  );
  if (matches.length === 0) return null;

  // Tightest/highest bracket wins if multiple somehow overlap.
  const best = matches.reduce((a, b) => (b.min_qty > a.min_qty ? b : a));
  return best.price;
}
