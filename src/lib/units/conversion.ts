export type BusinessMode = 'retail_only' | 'wholesale_only' | 'wholesale_retail';
export type PriceTier = 'retail' | 'wholesale' | 'distributor';
export type ProductSalesMode = 'retail' | 'wholesale' | 'both';

export interface UnitType {
  id: string;
  store_id: string;
  code: string;
  name: string;
  unit_kind: 'base' | 'retail' | 'wholesale' | 'both';
  allows_decimal: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface ProductUnitOption {
  id?: string;
  unit_type_id: string;
  code?: string;
  name?: string;
  allows_decimal?: boolean;
  conversion_factor: number;
  is_purchase_unit: boolean;
  is_default_sale: boolean;
  barcode?: string | null;
  retail_price?: number | null;
  wholesale_price?: number | null;
  distributor_price?: number | null;
}

/** Base units received/stocked per 1 of the given unit */
export function toBaseQty(unitQty: number, conversionFactor: number): number {
  const qty = Number(unitQty) || 0;
  const factor = Number(conversionFactor) || 1;
  return Math.round(qty * factor * 1000) / 1000;
}

/** Sale/purchase unit qty from base qty */
export function fromBaseQty(baseQty: number, conversionFactor: number): number {
  const qty = Number(baseQty) || 0;
  const factor = Number(conversionFactor) || 1;
  if (factor <= 0) return qty;
  return Math.round((qty / factor) * 1000) / 1000;
}

/** Cost per base unit from purchase unit cost */
export function toBaseUnitCost(purchaseUnitCost: number, conversionFactor: number): number {
  const cost = Number(purchaseUnitCost) || 0;
  const factor = Number(conversionFactor) || 1;
  if (factor <= 0) return cost;
  return Math.round((cost / factor) * 10000) / 10000;
}

/** True when a bulk unit row stores the base-unit price instead of a per-sale-unit price. */
function isLegacyBasePriceOnBulkUnit(
  stored: number | null | undefined,
  basePerUnit: number,
  factor: number,
): boolean {
  if (stored == null || factor <= 1) return false;
  return Math.abs(stored - basePerUnit) < 0.0001;
}

/**
 * Resolve per-sale-unit price for a tier.
 * Product fallbacks (selling_price, etc.) are always per BASE unit.
 * product_units prices, when set, are per that sale unit; when null, derive base × conversion.
 */
export function resolveTierPrice(
  unit: Pick<ProductUnitOption, 'retail_price' | 'wholesale_price' | 'distributor_price'>,
  tier: PriceTier,
  fallbacks?: { retail?: number; wholesale?: number; distributor?: number },
  conversionFactor = 1,
): number {
  const factor = Number(conversionFactor) || 1;
  const baseRetail = Number(fallbacks?.retail ?? 0);
  const baseWholesale = Number(fallbacks?.wholesale ?? baseRetail);
  const baseDistributor = Number(fallbacks?.distributor ?? baseWholesale);

  const derivedRetail = baseRetail * factor;
  const derivedWholesale = baseWholesale * factor;
  const derivedDistributor = baseDistributor * factor;

  const retail =
    unit.retail_price != null && !isLegacyBasePriceOnBulkUnit(unit.retail_price, baseRetail, factor)
      ? unit.retail_price
      : derivedRetail;
  const wholesale =
    unit.wholesale_price != null && !isLegacyBasePriceOnBulkUnit(unit.wholesale_price, baseWholesale, factor)
      ? unit.wholesale_price
      : derivedWholesale;
  const distributor =
    unit.distributor_price != null && !isLegacyBasePriceOnBulkUnit(unit.distributor_price, baseDistributor, factor)
      ? unit.distributor_price
      : derivedDistributor;

  if (tier === 'wholesale') return wholesale;
  if (tier === 'distributor') return distributor;
  return retail;
}

export function maxSaleUnitQty(stockBaseQty: number, conversionFactor: number, allowsDecimal: boolean): number {
  const max = fromBaseQty(stockBaseQty, conversionFactor);
  return allowsDecimal ? max : Math.floor(max);
}

export function formatUnitQty(qty: number, allowsDecimal: boolean): string {
  if (allowsDecimal) {
    return qty.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  return String(Math.round(qty));
}

export const BUSINESS_MODE_LABELS: Record<BusinessMode, string> = {
  retail_only: 'Retail Only',
  wholesale_only: 'Wholesale Only',
  wholesale_retail: 'Wholesale + Retail',
};

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  distributor: 'Distributor',
};

export const PRODUCT_SALES_MODE_LABELS: Record<ProductSalesMode, string> = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  both: 'Wholesale + Retail',
};

/** Price tiers allowed for a product based on its sales mode. */
export function priceTiersForSalesMode(mode: ProductSalesMode | undefined): PriceTier[] {
  if (mode === 'retail') return ['retail'];
  if (mode === 'wholesale') return ['wholesale', 'distributor'];
  return ['retail', 'wholesale', 'distributor'];
}

export function defaultTierForSalesMode(mode: ProductSalesMode | undefined): PriceTier {
  if (mode === 'wholesale') return 'wholesale';
  return 'retail';
}

/** Profit per sale unit and margin % from base-unit cost. */
export function profitAtUnit(
  saleUnitPrice: number,
  baseUnitCost: number,
  conversionFactor = 1,
): { profit: number; marginPct: number } {
  const cost = baseUnitCost * (Number(conversionFactor) || 1);
  const profit = Math.round((saleUnitPrice - cost) * 10000) / 10000;
  const marginPct = saleUnitPrice > 0 ? Math.round((profit / saleUnitPrice) * 10000) / 100 : 0;
  return { profit, marginPct };
}

/** Resolve display code for a product's base stock unit. */
export function productBaseUnitCode(
  product: {
    base_unit_id?: string | null;
    unit?: string;
    product_units?: Array<{
      unit_type_id: string;
      conversion_factor: number;
      unit_type?: { code?: string } | null;
    }>;
  },
): string {
  const units = product.product_units ?? [];
  const base =
    units.find((u) => u.unit_type_id === product.base_unit_id)
    ?? units.find((u) => u.conversion_factor === 1);
  return base?.unit_type?.code ?? product.unit ?? 'PCS';
}

/** Comma-separated stock in non-base units, e.g. "10 CARTON, 120 PACK". */
export function formatAlternateStockSummary(
  stockBase: number,
  baseUnitId: string | null | undefined,
  units: Array<{
    unit_type_id: string;
    conversion_factor: number;
    unit_type?: { code?: string; allows_decimal?: boolean } | null;
  }>,
): string {
  const alts = units.filter(
    (u) => u.unit_type_id !== baseUnitId && Number(u.conversion_factor) !== 1,
  );
  if (alts.length === 0) return '';
  return alts
    .map((u) => {
      const code = u.unit_type?.code ?? '?';
      const qty = fromBaseQty(stockBase, u.conversion_factor);
      const allowsDec = u.unit_type?.allows_decimal ?? false;
      return `${formatUnitQty(qty, allowsDec)} ${code}`;
    })
    .join(', ');
}
