import type { Product, ProductUnit } from '@/types';
import { buildCsv, downloadCsv, stampFilename, writeExcelWorkbook } from './spreadsheet';
import { formatAlternateStockSummary, productBaseUnitCode } from '@/lib/units/conversion';

type InventoryProduct = Product & {
  category?: { name: string; color: string } | null;
  brand?: string | null;
  base_unit_code?: string;
  product_units?: (ProductUnit & { unit_type?: { code?: string; allows_decimal?: boolean } | null })[];
};

function productRows(products: InventoryProduct[]) {
  const headers = [
    'Name',
    'SKU',
    'Brand',
    'Category',
    'Base Unit',
    'Cost Price (base)',
    'Sell Price',
    'Stock Qty (base)',
    'Stock (other units)',
    'Min Stock (base)',
    'Reorder Point',
    'Stock Value',
    'Active',
    'Track Inventory',
  ];
  const rows = products.map((p) => {
    const baseCode = p.base_unit_code ?? productBaseUnitCode(p);
    const altStock = p.product_units?.length
      ? formatAlternateStockSummary(p.stock_quantity ?? 0, p.base_unit_id, p.product_units)
      : '';
    return [
      p.name,
      p.sku ?? '',
      p.brand ?? '',
      p.category?.name ?? '',
      baseCode,
      p.cost_price ?? 0,
      p.selling_price ?? 0,
      p.stock_quantity ?? 0,
      altStock,
      p.min_stock_level ?? 0,
      p.reorder_point ?? 0,
      (p.stock_quantity ?? 0) * (p.cost_price ?? 0),
      p.is_active ? 'Yes' : 'No',
      p.track_inventory ? 'Yes' : 'No',
    ];
  });  return { headers, rows };
}

export function exportProductsCsv(products: InventoryProduct[], filename?: string) {
  if (!products.length) return;
  const { headers, rows } = productRows(products);
  downloadCsv(buildCsv(headers, rows), filename ?? stampFilename('inventory-products', 'csv'));
}

export async function exportProductsExcel(products: InventoryProduct[], filename?: string) {
  if (!products.length) return;
  const { headers, rows } = productRows(products);
  await writeExcelWorkbook(
    [{ name: 'Products', rows: [headers, ...rows] }],
    filename ?? stampFilename('inventory-products', 'xlsx'),
  );
}
