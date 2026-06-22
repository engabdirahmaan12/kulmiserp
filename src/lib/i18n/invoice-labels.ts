import type { Locale } from '@/locales';
import { translate } from './translate';
import type { InvoiceType } from '@/lib/invoice-utils';

export function getInvoiceLabels(locale: Locale) {
  return {
    invoice: translate(locale, 'invoice.invoice'),
    salesInvoice: translate(locale, 'invoice.salesInvoice'),
    purchaseInvoice: translate(locale, 'invoice.purchaseInvoice'),
    debtInvoice: translate(locale, 'invoice.debtInvoice'),
    refundInvoice: translate(locale, 'invoice.refundInvoice'),
    posReceipt: translate(locale, 'invoice.posReceipt'),
    customer: translate(locale, 'invoice.customer'),
    supplier: translate(locale, 'invoice.supplier'),
    walkIn: translate(locale, 'invoice.walkIn'),
    invoiceNumber: translate(locale, 'invoice.invoiceNumber'),
    invoiceDetails: translate(locale, 'invoice.invoiceDetails'),
    issueDate: translate(locale, 'invoice.issueDate'),
    dueDate: translate(locale, 'invoice.dueDate'),
    subtotal: translate(locale, 'invoice.subtotal'),
    tax: translate(locale, 'invoice.tax'),
    discount: translate(locale, 'invoice.discount'),
    total: translate(locale, 'invoice.total'),
    paid: translate(locale, 'invoice.paid'),
    balance: translate(locale, 'invoice.balance'),
    qty: translate(locale, 'invoice.qty'),
    unitPrice: translate(locale, 'invoice.unitPrice'),
    product: translate(locale, 'invoice.product'),
    sku: translate(locale, 'invoice.sku'),
    paymentMethod: translate(locale, 'invoice.paymentMethod'),
    thankYou: translate(locale, 'invoice.thankYou'),
    terms: translate(locale, 'invoice.terms'),
    billTo: translate(locale, 'invoice.billTo'),
    date: translate(locale, 'invoice.date'),
    time: translate(locale, 'invoice.time'),
    cashier: translate(locale, 'invoice.cashier'),
    item: translate(locale, 'invoice.item'),
    disc: translate(locale, 'invoice.disc'),
    change: translate(locale, 'invoice.change'),
    balanceDue: translate(locale, 'invoice.balanceDue'),
    verify: translate(locale, 'invoice.verify'),
    poweredBy: translate(locale, 'invoice.poweredBy'),
    statusPaid: translate(locale, 'invoice.statusPaid'),
    statusPartial: translate(locale, 'invoice.statusPartial'),
    statusUnpaid: translate(locale, 'invoice.statusUnpaid'),
    share: translate(locale, 'invoice.share'),
  };
}

export function getInvoiceTypeLabel(locale: Locale, type: InvoiceType): string {
  const map: Record<InvoiceType, string> = {
    pos: translate(locale, 'invoice.posReceipt'),
    custom: translate(locale, 'invoice.salesInvoice'),
    purchase: translate(locale, 'invoice.purchaseInvoice'),
    debt: translate(locale, 'invoice.debtInvoice'),
    refund: translate(locale, 'invoice.refundInvoice'),
  };
  return map[type] ?? translate(locale, 'invoice.invoice');
}
