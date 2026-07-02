import type { PaymentMethod } from '@/types';
import { getInvoiceLabels, getInvoiceTypeLabel } from '@/lib/i18n/invoice-labels';
import type { Locale } from '@/locales';

export type InvoiceType = 'pos' | 'custom' | 'purchase' | 'debt' | 'refund';
export type InvoiceTemplate = 'corporate' | 'retail' | 'thermal' | 'minimal';

export interface InvoiceLineItem {
  id?: string;
  name: string;
  sku?: string;
  image_url?: string;
  quantity: number;
  unit_code?: string;
  base_qty?: number;
  unit_price: number;
  discount_amount?: number;
  discount_pct?: number;
  tax_amount?: number;
  tax_rate?: number;
  subtotal: number;
  /** Price level applied to this line: retail / wholesale / vip / distributor. */
  price_tier?: string;
  /** Set when this line's price was manually overridden at checkout. */
  is_custom_price?: boolean;
}

/** Display qty with optional unit code and base-qty hint for multi-unit lines. */
export function formatInvoiceLineQty(item: Pick<InvoiceLineItem, 'quantity' | 'unit_code' | 'base_qty'>): string {
  const qty = item.quantity;
  if (item.unit_code) {
    const base = item.base_qty;
    const baseHint =
      base != null && Math.abs(base - qty) > 0.0001 ? ` (${base} base)` : '';
    return `${qty} ${item.unit_code}${baseHint}`;
  }
  return String(qty);
}

export interface InvoiceData {
  type: InvoiceType;
  template?: InvoiceTemplate;
  invoice_number: string;
  store_id?: string;
  store_name: string;
  store_address?: string;
  store_phone?: string;
  store_email?: string;
  store_website?: string;
  logo_url?: string;
  currency: string;
  date: string;
  cashier_name?: string;
  customer_name?: string;
  customer_id?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_email?: string;
  items: InvoiceLineItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  credit_amount: number;
  change_amount?: number;
  balance_due?: number;
  payment_method?: PaymentMethod | string;
  payment_label?: string;
  payment_status?: 'paid' | 'partial' | 'unpaid';
  status?: string;
  notes?: string;
  is_refund?: boolean;
  tax_number?: string;
  terms_and_conditions?: string;
  footer_message?: string;
}

export interface InvoiceDisplayOptions {
  showTax?: boolean;
  showDiscount?: boolean;
  showSku?: boolean;
  compact?: boolean;
  showLogo?: boolean;
  showProductImages?: boolean;
  showQr?: boolean;
  showBarcode?: boolean;
  theme?: import('@/types').InvoiceTheme;
  customColor?: string;
  footerMessage?: string;
  termsAndConditions?: string;
  taxNumber?: string;
  layout?: import('@/types').InvoiceLayout;
  template?: InvoiceTemplate;
  primaryColor?: string;
  accentColor?: string;
  /** PDF/print language */
  locale?: import('@/locales').Locale;
}

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  pos: 'POS Receipt',
  custom: 'Sales Invoice',
  purchase: 'Purchase Invoice',
  debt: 'Debt Invoice',
  refund: 'Refund Invoice',
};

export function fmtMoney(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function fmtNum(amount: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

export function buildWhatsAppInvoiceText(data: InvoiceData): string {
  const lines = [
    `*${data.store_name}*`,
    data.store_phone ? `📞 ${data.store_phone}` : '',
    ``,
    `*${INVOICE_TYPE_LABELS[data.type]}*`,
    `Invoice #: ${data.invoice_number}`,
    `Date: ${new Date(data.date).toLocaleDateString()}`,
    data.cashier_name ? `Cashier: ${data.cashier_name}` : '',
    data.customer_name ? `Customer: ${data.customer_name}` : '',
    ``,
    `*Items:*`,
    ...data.items.map((it) => `• ${it.name} ×${formatInvoiceLineQty(it)} = ${fmtMoney(it.subtotal, data.currency)}`),
    ``,
    `Subtotal: ${fmtMoney(data.subtotal, data.currency)}`,
    data.discount_amount > 0 ? `Discount: -${fmtMoney(data.discount_amount, data.currency)}` : '',
    data.tax_amount > 0 ? `Tax: ${fmtMoney(data.tax_amount, data.currency)}` : '',
    `*Total: ${fmtMoney(data.total_amount, data.currency)}*`,
    data.paid_amount > 0 ? `Paid: ${fmtMoney(data.paid_amount, data.currency)}` : '',
    data.credit_amount > 0 ? `Credit/Debt: ${fmtMoney(data.credit_amount, data.currency)}` : '',
    data.balance_due && data.balance_due > 0 ? `Balance Due: ${fmtMoney(data.balance_due, data.currency)}` : '',
    data.change_amount && data.change_amount > 0 ? `Change: ${fmtMoney(data.change_amount, data.currency)}` : '',
    data.payment_label ? `Payment: ${data.payment_label}` : '',
    ``,
    data.footer_message || `Thank you for your business! 🙏`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Public verification URL encoded in the invoice QR. Includes the store id
 *  so the lookup is unambiguous (invoice numbers repeat across stores). */
export function buildInvoiceVerifyUrl(data: InvoiceData): string {
  const base = 'https://kulmiserp.com/verify';
  return data.store_id
    ? `${base}/${data.store_id}/${encodeURIComponent(data.invoice_number)}`
    : `${base}/${encodeURIComponent(data.invoice_number)}`;
}

/** QR code pointing to public verification URL */
export async function generateInvoiceQrDataUrl(data: InvoiceData): Promise<string> {
  const QRCode = await import('qrcode');
  return QRCode.toDataURL(buildInvoiceVerifyUrl(data), { width: 128, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
}

/** Generate a print-quality HTML document and open in a new window */
export async function printInvoiceHtml(data: InvoiceData, options: InvoiceDisplayOptions = {}) {
  const qrDataUrl = await generateInvoiceQrDataUrl(data).catch(() => null);
  const html = buildInvoiceHtml(data, options, qrDataUrl);
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 500);
}

/** Generate a print-quality HTML document for thermal receipt */
export async function printThermalHtml(data: InvoiceData, options: InvoiceDisplayOptions = {}) {
  const qrDataUrl = await generateInvoiceQrDataUrl(data).catch(() => null);
  const html = buildThermalHtml(data, options, qrDataUrl);
  const w = window.open('', '_blank', 'width=400,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 500);
}

function getTemplateColors(opts: InvoiceDisplayOptions): { primary: string; header: string; accent: string } {
  const custom = opts.primaryColor || opts.customColor;
  const theme = opts.theme ?? 'blue';
  const map: Record<string, { primary: string; header: string; accent: string }> = {
    blue:   { primary: '#1d4ed8', header: '#1e3a8a', accent: '#3b82f6' },
    green:  { primary: '#059669', header: '#065f46', accent: '#10b981' },
    purple: { primary: '#7c3aed', header: '#4c1d95', accent: '#8b5cf6' },
    dark:   { primary: '#1e293b', header: '#0f172a', accent: '#334155' },
    custom: { primary: custom || '#0d9488', header: custom || '#0f766e', accent: custom || '#14b8a6' },
  };
  return map[theme] ?? map.blue;
}

/** Build a complete standalone HTML invoice document with inline styles */
export function buildInvoiceHtml(data: InvoiceData, options: InvoiceDisplayOptions = {}, qrDataUrl: string | null = null): string {
  const locale: Locale = options.locale ?? 'en';
  const L = getInvoiceLabels(locale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const typeLabel = getInvoiceTypeLabel(locale, data.type);
  const colors = getTemplateColors(options);
  const template = options.template ?? data.template ?? 'corporate';
  const showSku = options.showSku !== false;
  const showDiscount = options.showDiscount !== false;
  const showTax = options.showTax !== false;
  const showLogo = options.showLogo !== false;
  const balanceDue = data.balance_due ?? Math.max(0, data.credit_amount || data.total_amount - data.paid_amount);
  const fmt = (n: number) => fmtMoney(n, data.currency);
  const dateStr = new Date(data.date).toLocaleString('en-US', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const paymentStatus = data.payment_status ?? (balanceDue > 0 ? 'partial' : 'paid');

  const logoHtml = (showLogo && data.logo_url)
    ? `<img src="${data.logo_url}" alt="Logo" style="height:84px;width:84px;border-radius:16px;object-fit:cover;border:3px solid rgba(255,255,255,0.35);box-shadow:0 4px 12px rgba(0,0,0,0.18);" />`
    : `<div style="height:84px;width:84px;border-radius:16px;background:rgba(255,255,255,0.2);border:3px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:900;color:white;box-shadow:0 4px 12px rgba(0,0,0,0.18);">${data.store_name.charAt(0)}</div>`;

  const statusColor = paymentStatus === 'paid' ? '#16a34a' : paymentStatus === 'partial' ? '#d97706' : '#dc2626';
  const statusBg = paymentStatus === 'paid' ? '#f0fdf4' : paymentStatus === 'partial' ? '#fffbeb' : '#fef2f2';
  const statusLabel = paymentStatus === 'paid' ? 'PAID' : paymentStatus === 'partial' ? 'PARTIAL' : 'UNPAID';

  const itemRows = data.items.map((item, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    const discAmt = item.discount_amount ?? 0;
    const taxAmt = item.tax_amount ?? 0;
    return `
      <tr style="background:${bg};">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:600;color:#0f172a;font-size:13px;">${escHtml(item.name)}</div>
          ${showSku && item.sku ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px;">SKU: ${escHtml(item.sku)}</div>` : ''}
        </td>
        <td style="padding:10px 12px;text-align:center;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;">${escHtml(formatInvoiceLineQty(item))}</td>
        <td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;">${fmt(item.unit_price)}</td>
        ${showDiscount ? `<td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e2e8f0;color:#dc2626;font-size:12px;">${discAmt > 0 ? `-${fmt(discAmt)}` : '—'}</td>` : ''}
        ${showTax ? `<td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px;">${taxAmt > 0 ? fmt(taxAmt) : '—'}</td>` : ''}
        <td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;font-size:13px;">${fmt(item.subtotal)}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(data.invoice_number)} - ${escHtml(data.store_name)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; background: #fff; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
<div style="max-width:794px;margin:0 auto;background:#fff;min-height:1123px;position:relative;">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,${colors.header} 0%,${colors.primary} 100%);padding:34px 40px;display:flex;justify-content:space-between;align-items:center;gap:24px;">
    <div style="display:flex;align-items:center;gap:20px;min-width:0;">
      ${logoHtml}
      <div style="min-width:0;">
        <div style="font-size:30px;font-weight:900;color:#fff;letter-spacing:-0.5px;line-height:1.1;">${escHtml(data.store_name)}</div>
        ${data.store_address ? `<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:6px;">${escHtml(data.store_address)}</div>` : ''}
        ${data.store_phone ? `<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:2px;">📞 ${escHtml(data.store_phone)}</div>` : ''}
        ${data.store_email ? `<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:2px;">✉ ${escHtml(data.store_email)}</div>` : ''}
        ${data.tax_number ?? options.taxNumber ? `<div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:4px;">Tax ID: ${escHtml(data.tax_number ?? options.taxNumber ?? '')}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:5px 14px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.95);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;">${escHtml(typeLabel)}</div>
      <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">${escHtml(data.invoice_number)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:5px;">${escHtml(dateStr)}</div>
      ${data.cashier_name ? `<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Cashier: ${escHtml(data.cashier_name)}</div>` : ''}
      <div style="margin-top:10px;">
        <span style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor}33;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;letter-spacing:0.5px;">${statusLabel}</span>
      </div>
    </div>
  </div>

  <!-- CUSTOMER + META ROW -->
  <div style="display:flex;gap:16px;padding:24px 40px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
    ${data.customer_name ? `
    <div style="flex:1;background:#fff;border-radius:10px;border:1px solid #e2e8f0;padding:16px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">Bill To</div>
      <div style="font-size:15px;font-weight:700;color:#0f172a;">${escHtml(data.customer_name)}</div>
      ${data.customer_id ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">ID: ${escHtml(data.customer_id)}</div>` : ''}
      ${data.customer_phone ? `<div style="font-size:12px;color:#475569;margin-top:3px;">📞 ${escHtml(data.customer_phone)}</div>` : ''}
      ${data.customer_email ? `<div style="font-size:12px;color:#475569;">✉ ${escHtml(data.customer_email)}</div>` : ''}
      ${data.customer_address ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px;">${escHtml(data.customer_address)}</div>` : ''}
    </div>` : '<div style="flex:1;"></div>'}
    <div style="flex:1;background:#fff;border-radius:10px;border:1px solid #e2e8f0;padding:16px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">${escHtml(L.invoiceDetails)}</div>
      <table style="width:100%;font-size:12px;">
        <tr>
          <td style="color:#64748b;padding:2px 0;">Invoice #</td>
          <td style="text-align:right;font-weight:600;color:#0f172a;">${escHtml(data.invoice_number)}</td>
        </tr>
        <tr>
          <td style="color:#64748b;padding:2px 0;">Date</td>
          <td style="text-align:right;font-weight:600;color:#0f172a;">${new Date(data.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        </tr>
        <tr>
          <td style="color:#64748b;padding:2px 0;">Time</td>
          <td style="text-align:right;font-weight:600;color:#0f172a;">${new Date(data.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>
        ${data.cashier_name ? `<tr><td style="color:#64748b;padding:2px 0;">Cashier</td><td style="text-align:right;font-weight:600;color:#0f172a;">${escHtml(data.cashier_name)}</td></tr>` : ''}
        <tr>
          <td style="color:#64748b;padding:2px 0;">Status</td>
          <td style="text-align:right;"><span style="color:${statusColor};font-weight:700;">${statusLabel}</span></td>
        </tr>
      </table>
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <div style="padding:24px 40px;">
    <table style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
      <thead>
        <tr style="background:${colors.primary};">
          <th style="padding:12px;text-align:left;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:0.5px;">Product</th>
          <th style="padding:12px;text-align:center;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:0.5px;width:60px;">Qty</th>
          <th style="padding:12px;text-align:right;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:0.5px;width:100px;">Unit Price</th>
          ${showDiscount ? `<th style="padding:12px;text-align:right;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:0.5px;width:80px;">Discount</th>` : ''}
          ${showTax ? `<th style="padding:12px;text-align:right;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:0.5px;width:80px;">Tax</th>` : ''}
          <th style="padding:12px;text-align:right;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:0.5px;width:100px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- TOTALS + QR ROW -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:0 40px 24px;">
    <!-- Totals -->
    <div style="width:260px;margin-left:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#475569;">${escHtml(L.subtotal)}</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#475569;">${fmt(data.subtotal)}</td>
        </tr>
        ${showDiscount && data.discount_amount > 0 ? `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#dc2626;">Discount</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#dc2626;">-${fmt(data.discount_amount)}</td>
        </tr>` : ''}
        ${showTax && data.tax_amount > 0 ? `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#475569;">Tax</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#475569;">${fmt(data.tax_amount)}</td>
        </tr>` : ''}
        <tr style="border-top:2px solid ${colors.primary};">
          <td style="padding:10px 0 6px;font-size:16px;font-weight:900;color:#0f172a;">${data.is_refund ? 'Refund Total' : 'Grand Total'}</td>
          <td style="padding:10px 0 6px;font-size:18px;font-weight:900;text-align:right;color:${colors.primary};">${fmt(data.total_amount)}</td>
        </tr>
      </table>
    </div>

    ${qrDataUrl ? `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-right:auto;padding:0 24px;">
      <img src="${qrDataUrl}" alt="QR" style="width:90px;height:90px;border:1px solid #e2e8f0;border-radius:8px;" />
      <div style="font-size:9px;color:#94a3b8;text-align:center;">Scan to verify</div>
      <div style="font-size:8px;color:#cbd5e1;text-align:center;">kulmiserp.com/verify</div>
    </div>` : ''}
  </div>

  <!-- PAYMENT SUMMARY -->
  <div style="margin:0 40px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px;">Payment Summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${data.payment_label ? `
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:#64748b;">Payment Method</span>
        <span style="font-weight:600;color:#0f172a;">${escHtml(data.payment_label)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:#64748b;">Amount Paid</span>
        <span style="font-weight:600;color:#16a34a;">${fmt(data.paid_amount)}</span>
      </div>
      ${data.change_amount && data.change_amount > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:#64748b;">Change Returned</span>
        <span style="font-weight:600;color:#0f172a;">${fmt(data.change_amount)}</span>
      </div>` : ''}
      ${data.credit_amount > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:#64748b;">Credit / On Account</span>
        <span style="font-weight:600;color:#d97706;">${fmt(data.credit_amount)}</span>
      </div>` : ''}
      ${balanceDue > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;border-top:1px solid #e2e8f0;padding-top:8px;grid-column:1/-1;">
        <span style="color:#dc2626;">Balance Due</span>
        <span style="color:#dc2626;">${fmt(balanceDue)}</span>
      </div>` : ''}
    </div>
  </div>

  ${data.notes ? `
  <div style="margin:0 40px 20px;padding:12px;background:#fefce8;border:1px solid #fef08a;border-radius:8px;font-size:12px;color:#713f12;">
    <strong>Notes:</strong> ${escHtml(data.notes)}
  </div>` : ''}

  <!-- FOOTER -->
  <div style="margin:0 40px;padding:20px 0;border-top:1px solid #e2e8f0;text-align:center;">
    <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:4px;">
      ${escHtml(data.footer_message ?? options.footerMessage ?? 'Thank you for your business!')}
    </div>
    ${options.termsAndConditions ?? data.terms_and_conditions ? `
    <div style="font-size:10px;color:#94a3b8;margin-top:6px;max-width:500px;margin-left:auto;margin-right:auto;line-height:1.5;">
      ${escHtml(options.termsAndConditions ?? data.terms_and_conditions ?? '')}
    </div>` : ''}
    ${data.store_phone || data.store_email ? `
    <div style="font-size:11px;color:#64748b;margin-top:8px;">
      ${data.store_phone ? `📞 ${escHtml(data.store_phone)}` : ''}
      ${data.store_phone && data.store_email ? ' · ' : ''}
      ${data.store_email ? `✉ ${escHtml(data.store_email)}` : ''}
    </div>` : ''}
    <div style="font-size:10px;color:#cbd5e1;margin-top:8px;">Powered by KULMIS ERP · kulmiserp.com</div>
  </div>

</div>
</body>
</html>`;
}

/** Build thermal receipt HTML (narrow ~80mm) */
export function buildThermalHtml(data: InvoiceData, options: InvoiceDisplayOptions = {}, qrDataUrl: string | null = null): string {
  const fmt = (n: number) => fmtNum(n);
  const showSku = options.showSku !== false;
  const balanceDue = data.balance_due ?? Math.max(0, data.credit_amount || data.total_amount - data.paid_amount);
  const currency = data.currency || 'USD';

  const itemRows = data.items.map((item) => `
    <tr>
      <td style="padding:4px 0;font-size:12px;">${escHtml(item.name)}${showSku && item.sku ? `<br/><span style="font-size:10px;color:#666;">${escHtml(item.sku)}</span>` : ''}</td>
      <td style="padding:4px 0;font-size:12px;text-align:center;">${escHtml(formatInvoiceLineQty(item))}</td>
      <td style="padding:4px 0;font-size:12px;text-align:right;">${fmt(item.unit_price)}</td>
      <td style="padding:4px 0;font-size:12px;text-align:right;font-weight:700;">${fmt(item.subtotal)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Receipt ${escHtml(data.invoice_number)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; background: #fff; width: 72mm; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="center" style="margin-bottom:8px;">
    <div style="font-size:16px;font-weight:900;">${escHtml(data.store_name)}</div>
    ${data.store_address ? `<div style="font-size:10px;">${escHtml(data.store_address)}</div>` : ''}
    ${data.store_phone ? `<div style="font-size:10px;">${escHtml(data.store_phone)}</div>` : ''}
    ${data.tax_number ?? options.taxNumber ? `<div style="font-size:10px;">TIN: ${escHtml(data.tax_number ?? options.taxNumber ?? '')}</div>` : ''}
  </div>
  <div class="divider"></div>
  <div style="font-size:11px;">
    <div>Invoice: <strong>${escHtml(data.invoice_number)}</strong></div>
    <div>Date: ${new Date(data.date).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
    ${data.cashier_name ? `<div>Cashier: ${escHtml(data.cashier_name)}</div>` : ''}
    ${data.customer_name ? `<div>Customer: ${escHtml(data.customer_name)}</div>` : ''}
  </div>
  <div class="divider"></div>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr style="border-bottom:1px dashed #000;">
        <th style="text-align:left;font-size:11px;padding:2px 0;">Item</th>
        <th style="text-align:center;font-size:11px;width:30px;">Qty</th>
        <th style="text-align:right;font-size:11px;width:50px;">Price</th>
        <th style="text-align:right;font-size:11px;width:55px;">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="divider"></div>
  <table style="width:100%;font-size:12px;">
    <tr>
      <td>Subtotal:</td>
      <td style="text-align:right;">${currency} ${fmt(data.subtotal)}</td>
    </tr>
    ${data.discount_amount > 0 ? `<tr><td>Discount:</td><td style="text-align:right;">-${currency} ${fmt(data.discount_amount)}</td></tr>` : ''}
    ${data.tax_amount > 0 ? `<tr><td>Tax:</td><td style="text-align:right;">${currency} ${fmt(data.tax_amount)}</td></tr>` : ''}
    <tr style="border-top:1px solid #000;font-size:15px;font-weight:900;">
      <td>TOTAL:</td>
      <td style="text-align:right;">${currency} ${fmt(data.total_amount)}</td>
    </tr>
    <tr><td>Paid (${escHtml(data.payment_label || 'Cash')}):</td><td style="text-align:right;">${currency} ${fmt(data.paid_amount)}</td></tr>
    ${data.change_amount && data.change_amount > 0 ? `<tr><td>Change:</td><td style="text-align:right;">${currency} ${fmt(data.change_amount)}</td></tr>` : ''}
    ${balanceDue > 0 ? `<tr style="font-weight:700;color:#b91c1c;"><td>Balance Due:</td><td style="text-align:right;">${currency} ${fmt(balanceDue)}</td></tr>` : ''}
  </table>
  ${qrDataUrl ? `
  <div class="divider"></div>
  <div class="center"><img src="${qrDataUrl}" style="width:80px;height:80px;" /><br/><span style="font-size:9px;">Scan to verify</span></div>` : ''}
  <div class="divider"></div>
  <div class="center" style="font-size:11px;">
    <div>${escHtml(data.footer_message ?? 'Thank you for your business!')}</div>
    <div style="font-size:9px;margin-top:4px;">Powered by KULMIS ERP</div>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Legacy PDF download using jsPDF (kept for compatibility, use printInvoiceHtml for best quality) */
export async function downloadInvoicePdfFromData(
  data: InvoiceData,
  filename: string,
  options: InvoiceDisplayOptions = {}
) {
  // Use print-to-PDF approach via new window for best quality
  await printInvoiceHtml(data, options);
}
