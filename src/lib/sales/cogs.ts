/** COGS helpers — stock and cost_price are always in base units. */

export interface SaleItemCogsInput {
  quantity?: number | null;
  base_qty?: number | null;
  cost_price?: number | null;
}

export function saleItemBaseQty(item: SaleItemCogsInput): number {
  return Number(item.base_qty ?? item.quantity ?? 0);
}

export function saleItemCogs(item: SaleItemCogsInput): number {
  return saleItemBaseQty(item) * (Number(item.cost_price) || 0);
}

export function sumSaleItemsCogs(items: SaleItemCogsInput[]): number {
  return items.reduce((sum, item) => sum + saleItemCogs(item), 0);
}

export interface SaleItemRow extends SaleItemCogsInput {
  sale?: { sale_date?: string; status?: string } | null;
}

/** Sum COGS for sale line rows, optionally filtered by sale date prefix (yyyy-MM-dd). */
export function sumCogsForPeriod(items: SaleItemRow[], datePrefix?: string): number {
  return items.reduce((sum, item) => {
    const sale = item.sale;
    if (!sale || sale.status !== 'completed') return sum;
    if (datePrefix) {
      const d = sale.sale_date?.split('T')[0];
      if (d !== datePrefix) return sum;
    }
    return sum + saleItemCogs(item);
  }, 0);
}

/** Group COGS by sale date (yyyy-MM-dd). */
export function cogsByDate(items: SaleItemRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of items) {
    const sale = item.sale;
    if (!sale || sale.status !== 'completed') continue;
    const d = sale.sale_date?.split('T')[0];
    if (!d) continue;
    map[d] = (map[d] ?? 0) + saleItemCogs(item);
  }
  return map;
}
