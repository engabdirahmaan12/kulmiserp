import type { InvoiceData } from '@/lib/invoice-utils';
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Store } from '@/types';

export function buildPurchaseInvoiceData(
  po: PurchaseOrder & { supplier?: Supplier | null },
  items: PurchaseOrderItem[],
  store: Store,
): InvoiceData {
  const paid = po.paid_amount ?? 0;
  const total = po.total_amount ?? 0;
  const balance = Math.max(0, total - paid);

  return {
    type: 'purchase',
    template: 'corporate',
    invoice_number: po.po_number,
    store_name: store.name,
    store_address: store.address,
    store_phone: store.phone,
    store_email: store.email,
    currency: store.currency,
    date: po.received_date ?? po.created_at,
    customer_name: po.supplier?.name ?? 'Supplier',
    customer_phone: po.supplier?.phone,
    customer_address: po.supplier?.address,
    items: items.map((item) => {
      const purchaseQty = item.purchase_unit_qty ?? item.quantity;
      const baseQty = item.base_qty ?? purchaseQty;
      return {
        id: item.id,
        name: item.product_name,
        quantity: purchaseQty,
        unit_code: item.purchase_unit_code,
        base_qty: baseQty !== purchaseQty ? baseQty : undefined,
        unit_price: item.unit_cost,
        subtotal: item.subtotal,
      };
    }),
    subtotal: po.subtotal ?? total,
    discount_amount: 0,
    tax_amount: po.tax_amount ?? 0,
    total_amount: total,
    paid_amount: paid,
    credit_amount: balance,
    balance_due: balance,
    payment_status: balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    status: po.status,
    notes: po.notes,
  };
}
