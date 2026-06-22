import { buildCsv, downloadCsv, stampFilename, writeExcelWorkbook } from './spreadsheet';

type SaleRow = {
  invoice_number: string;
  sale_date: string;
  status: string;
  payment_method: string;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  customer?: { full_name?: string; phone?: string } | null;
  items?: {
    product_name?: string;
    sku?: string;
    quantity?: number;
    sale_unit_qty?: number;
    sale_unit_code?: string;
    base_qty?: number;
    unit_price?: number;
    subtotal?: number;
  }[];
};

function summaryRows(sales: SaleRow[]) {
  const headers = [
    'Invoice',
    'Date',
    'Customer',
    'Phone',
    'Payment',
    'Subtotal',
    'Tax',
    'Discount',
    'Total',
    'Status',
    'Items',
  ];
  const rows = sales.map((s) => [
    s.invoice_number,
    s.sale_date?.split('T')[0] ?? s.sale_date,
    s.customer?.full_name ?? 'Walk-in',
    s.customer?.phone ?? '',
    s.payment_method,
    s.subtotal ?? '',
    s.tax_amount ?? '',
    s.discount_amount ?? '',
    s.total_amount,
    s.status,
    s.items?.length ?? 0,
  ]);
  return { headers, rows };
}

function lineItemRows(sales: SaleRow[]) {
  const headers = ['Invoice', 'Date', 'Product', 'SKU', 'Sale Qty', 'Unit', 'Base Qty', 'Unit Price', 'Line Total'];
  const rows: (string | number)[][] = [];
  for (const s of sales) {
    for (const item of s.items ?? []) {
      rows.push([
        s.invoice_number,
        s.sale_date?.split('T')[0] ?? '',
        item.product_name ?? '',
        item.sku ?? '',
        item.sale_unit_qty ?? item.quantity ?? 0,
        item.sale_unit_code ?? '',
        item.base_qty ?? item.quantity ?? 0,
        item.unit_price ?? 0,
        item.subtotal ?? 0,
      ]);
    }
  }
  return { headers, rows };
}

export function exportSalesCsv(sales: SaleRow[], from: string, to: string) {
  if (!sales.length) return;
  const { headers, rows } = summaryRows(sales);
  downloadCsv(buildCsv(headers, rows), `sales-history-${from}-to-${to}.csv`);
}

export async function exportSalesExcel(sales: SaleRow[], from: string, to: string) {
  if (!sales.length) return;
  const summary = summaryRows(sales);
  const lines = lineItemRows(sales);
  await writeExcelWorkbook(
    [
      { name: 'Sales', rows: [summary.headers, ...summary.rows] },
      { name: 'Line Items', rows: lines.rows.length ? [lines.headers, ...lines.rows] : [['No line items']] },
    ],
    stampFilename(`sales-history-${from}-to-${to}`, 'xlsx'),
  );
}
