import type { Product } from '@/types';
import { getSaleUnitsForProduct } from '@/lib/units/engine';

export interface BarcodeScanHit {
  product: Product;
  /** When set, scan matched a specific sale unit barcode */
  saleUnitId?: string;
}

export type BarcodeLookup = Map<string, BarcodeScanHit>;

/** Build O(1) barcode/SKU index — product + per-unit barcodes */
export function buildBarcodeIndex(products: Product[]): BarcodeLookup {
  const map = new Map<string, BarcodeScanHit>();

  const put = (code: string | null | undefined, hit: BarcodeScanHit) => {
    const key = code?.trim().toLowerCase();
    if (!key) return;
    if (!map.has(key)) map.set(key, hit);
  };

  for (const p of products) {
    put(p.barcode, { product: p });
    put(p.sku, { product: p });

    for (const unit of getSaleUnitsForProduct(p)) {
      const unitBarcode = unit.barcode?.trim();
      if (unitBarcode) {
        put(unitBarcode, { product: p, saleUnitId: unit.unit_type_id });
      }
    }
  }

  return map;
}

export function findProductByScan(index: BarcodeLookup, code: string): BarcodeScanHit | undefined {
  const key = code.trim().toLowerCase();
  return index.get(key);
}

/** @deprecated use findProductByScan */
export function findProductByScanLegacy(index: BarcodeLookup, code: string): Product | undefined {
  return findProductByScan(index, code)?.product;
}

export const BARCODE_MIN_LENGTH = 3;
