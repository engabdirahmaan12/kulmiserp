'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  type InvoiceData,
  type InvoiceDisplayOptions,
  type InvoiceTemplate,
  fmtMoney,
  generateInvoiceQrDataUrl,
  buildWhatsAppInvoiceText,
  printInvoiceHtml,
  printThermalHtml,
  formatInvoiceLineQty,
} from '@/lib/invoice-utils';
import { getInvoiceLabels, getInvoiceTypeLabel } from '@/lib/i18n/invoice-labels';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  MessageSquare, Printer, Download, Eye, EyeOff, Maximize2, Tag,
  Receipt, Building2, Leaf, Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvoiceTheme } from '@/types';

interface InvoiceDocumentProps {
  data: InvoiceData;
  id?: string;
  options?: InvoiceDisplayOptions;
  showControls?: boolean;
  /** Sidebar / sheet preview — tighter layout and cleaner toolbar */
  variant?: 'page' | 'panel';
  className?: string;
}

// ── Theme definitions ──────────────────────────────────────
const THEMES: Record<InvoiceTheme, {
  headerBg: string;
  headerText: string;
  accentText: string;
  accentBorder: string;
  totalText: string;
  tableHead: string;
  tableHeadText: string;
}> = {
  blue: {
    headerBg:    'bg-gradient-to-r from-blue-800 to-blue-600',
    headerText:  'text-white',
    accentText:  'text-blue-700',
    accentBorder:'border-blue-600',
    totalText:   'text-blue-700',
    tableHead:   'bg-blue-700',
    tableHeadText:'text-white',
  },
  green: {
    headerBg:    'bg-gradient-to-r from-emerald-800 to-teal-600',
    headerText:  'text-white',
    accentText:  'text-emerald-700',
    accentBorder:'border-emerald-600',
    totalText:   'text-emerald-700',
    tableHead:   'bg-emerald-700',
    tableHeadText:'text-white',
  },
  purple: {
    headerBg:    'bg-gradient-to-r from-violet-800 to-purple-600',
    headerText:  'text-white',
    accentText:  'text-violet-700',
    accentBorder:'border-violet-600',
    totalText:   'text-violet-700',
    tableHead:   'bg-violet-700',
    tableHeadText:'text-white',
  },
  dark: {
    headerBg:    'bg-gradient-to-r from-slate-900 to-slate-700',
    headerText:  'text-white',
    accentText:  'text-slate-800',
    accentBorder:'border-slate-700',
    totalText:   'text-slate-900',
    tableHead:   'bg-slate-800',
    tableHeadText:'text-white',
  },
  custom: {
    headerBg:    'bg-gradient-to-r from-teal-800 to-teal-600',
    headerText:  'text-white',
    accentText:  'text-teal-700',
    accentBorder:'border-teal-600',
    totalText:   'text-teal-700',
    tableHead:   'bg-teal-700',
    tableHeadText:'text-white',
  },
};

const THEME_DOTS: Record<InvoiceTheme, string> = {
  blue:   'bg-blue-600',
  green:  'bg-emerald-600',
  purple: 'bg-violet-600',
  dark:   'bg-slate-800',
  custom: 'bg-teal-600',
};

const TEMPLATE_INFO: Record<InvoiceTemplate, { label: string; icon: React.ElementType; description: string }> = {
  corporate: { label: 'Corporate', icon: Building2, description: 'Full A4 invoice with header, customer section, table' },
  retail:    { label: 'Retail',    icon: Tag,       description: 'Retail-focused with product emphasis' },
  thermal:   { label: 'Thermal',   icon: Receipt,   description: 'Narrow POS receipt (80mm)' },
  minimal:   { label: 'Minimal',   icon: Leaf,      description: 'Clean minimal design' },
};

const STATUS_BADGE: Record<string, string> = {
  paid:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  unpaid:  'bg-red-100 text-red-700 border-red-200',
  pending: 'bg-blue-100 text-blue-700 border-blue-200',
};

function TemplatePicker({
  value,
  onChange,
}: {
  value: InvoiceTemplate;
  onChange: (template: InvoiceTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-medium hover:bg-muted"
      >
        <Maximize2 className="h-3 w-3" />
        {TEMPLATE_INFO[value].label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {(Object.entries(TEMPLATE_INFO) as [InvoiceTemplate, typeof TEMPLATE_INFO[InvoiceTemplate]][]).map(([key, info]) => (
            <button
              key={key}
              type="button"
              onClick={() => { onChange(key); setOpen(false); }}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50',
                value === key && 'bg-slate-50',
              )}
            >
              <info.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <div>
                <div className="text-sm font-medium">{info.label}</div>
                <div className="text-xs text-slate-400">{info.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────
export function InvoiceDocument({
  data,
  id = 'kulmis-invoice',
  options: initialOptions,
  showControls = true,
  variant = 'page',
  className,
}: InvoiceDocumentProps) {
  const isPanel = variant === 'panel';
  const { locale, isRtl, formatDate, t } = useTranslation();
  const L = getInvoiceLabels(locale);
  const typeLabel = getInvoiceTypeLabel(locale, data.type);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [opts, setOpts] = useState<InvoiceDisplayOptions>({
    showTax: true,
    showDiscount: true,
    showSku: false,
    showLogo: true,
    showQr: true,
    compact: isPanel,
    theme: 'blue',
    template: 'corporate',
    ...initialOptions,
  });

  useEffect(() => {
    generateInvoiceQrDataUrl(data).then(setQrUrl).catch(() => setQrUrl(null));
  }, [data]);

  const handlePrint = useCallback(async () => {
    const printOpts = { ...opts, locale };
    if (opts.template === 'thermal') {
      await printThermalHtml(data, printOpts);
    } else {
      await printInvoiceHtml(data, printOpts);
    }
  }, [data, opts, locale]);

  const handlePdf = useCallback(async () => {
    await printInvoiceHtml(data, { ...opts, locale });
  }, [data, opts, locale]);

  const shareWhatsApp = useCallback(() => {
    const text = encodeURIComponent(buildWhatsAppInvoiceText(data));
    const phone = data.customer_phone?.replace(/[^0-9]/g, '');
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
  }, [data]);

  const theme = opts.theme ?? 'blue';
  const tc = THEMES[theme] ?? THEMES.blue;
  const balanceDue = data.balance_due ?? Math.max(0, data.credit_amount || data.total_amount - data.paid_amount);
  const paymentStatus = data.payment_status ?? (balanceDue > 0 ? 'partial' : 'paid');
  const statusLabel =
    paymentStatus === 'paid' ? L.statusPaid : paymentStatus === 'partial' ? L.statusPartial : L.statusUnpaid;

  return (
    <div className={cn('space-y-3', className)} dir={isRtl ? 'rtl' : 'ltr'}>
      {showControls && (
        <div className={cn(
          'no-print rounded-xl border border-slate-200 bg-slate-50/80',
          isPanel ? 'p-3 space-y-2.5' : 'flex flex-wrap items-center gap-2 p-0 border-0 bg-transparent',
        )}>
          {/* Primary actions */}
          <div className={cn('flex gap-2', isPanel && 'grid grid-cols-3')}>
            <Button title="Print or save as PDF" variant="outline" size="sm"
              className={cn('gap-1.5 text-xs', isPanel ? 'h-9 justify-center bg-white' : 'h-8')}
              onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5" />
              {isPanel ? <span>{t('common.print')}</span> : <>{t('common.print')}</>}
            </Button>
            <Button title="Download PDF" variant="outline" size="sm"
              className={cn('gap-1.5 text-xs', isPanel ? 'h-9 justify-center bg-white' : 'h-8')}
              onClick={handlePdf}>
              <Download className="h-3.5 w-3.5" />
              PDF
            </Button>
            <Button title="Share via WhatsApp" variant="outline" size="sm"
              className={cn('gap-1.5 text-xs text-green-700 border-green-200 hover:bg-green-50', isPanel ? 'h-9 justify-center bg-white' : 'h-8')}
              onClick={shareWhatsApp}>
              <MessageSquare className="h-3.5 w-3.5" />
              {isPanel ? <span>{L.share}</span> : <>{L.share}</>}
            </Button>
          </div>

          {/* Display toggles + template + theme */}
          <div className={cn(
            'flex flex-wrap items-center gap-1.5',
            isPanel && 'pt-2 border-t border-slate-200/80',
          )}>
            <Button variant={opts.showSku ? 'secondary' : 'ghost'} size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOpts((o) => ({ ...o, showSku: !o.showSku }))}>
              {opts.showSku ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}SKU
            </Button>
            <Button variant={opts.showTax ? 'secondary' : 'ghost'} size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOpts((o) => ({ ...o, showTax: !o.showTax }))}>{L.tax}
            </Button>
            <Button variant={opts.showDiscount ? 'secondary' : 'ghost'} size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOpts((o) => ({ ...o, showDiscount: !o.showDiscount }))}>{L.discount}
            </Button>
            <TemplatePicker
              value={opts.template ?? 'corporate'}
              onChange={(template) => setOpts((o) => ({ ...o, template }))}
            />
            <div className={cn('flex items-center gap-1', isPanel ? 'ml-auto' : 'ml-auto')}>
              {!isPanel && <Palette className="h-3.5 w-3.5 text-slate-400" />}
              {(Object.entries(THEME_DOTS) as [InvoiceTheme, string][]).map(([t, dot]) => (
                <button
                  key={t}
                  title={t}
                  type="button"
                  onClick={() => setOpts((o) => ({ ...o, theme: t }))}
                  className={cn(
                    'h-5 w-5 rounded-full border-2 transition-all',
                    dot,
                    opts.theme === t ? 'border-slate-900 scale-110 shadow' : 'border-transparent opacity-70 hover:opacity-100',
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Invoice Body ── */}
      {opts.template === 'thermal' ? (
        <ThermalLayout data={data} opts={opts} qrUrl={qrUrl} balanceDue={balanceDue} id={id} compact={isPanel} L={L} typeLabel={typeLabel} formatDate={formatDate} statusLabel={statusLabel} paymentStatus={paymentStatus} />
      ) : opts.template === 'minimal' ? (
        <MinimalLayout data={data} opts={opts} qrUrl={qrUrl} tc={tc} balanceDue={balanceDue} id={id} paymentStatus={paymentStatus} statusLabel={statusLabel} compact={isPanel} L={L} typeLabel={typeLabel} formatDate={formatDate} />
      ) : (
        <CorporateLayout data={data} opts={opts} qrUrl={qrUrl} tc={tc} balanceDue={balanceDue} id={id} paymentStatus={paymentStatus} statusLabel={statusLabel} compact={isPanel} L={L} typeLabel={typeLabel} formatDate={formatDate} />
      )}
    </div>
  );
}

// ── Shared helper ──────────────────────────────────────────
function fmt(n: number, currency = 'USD') {
  return fmtMoney(n, currency);
}

type InvoiceLabels = ReturnType<typeof getInvoiceLabels>;

// ── CORPORATE / RETAIL template ─────────────────────────────
function CorporateLayout({
  data, opts, qrUrl, tc, balanceDue, id, paymentStatus, statusLabel, compact = false,
  L, typeLabel, formatDate,
}: {
  data: InvoiceData;
  opts: InvoiceDisplayOptions;
  qrUrl: string | null;
  tc: typeof THEMES.blue;
  balanceDue: number;
  id: string;
  paymentStatus: string;
  statusLabel: string;
  compact?: boolean;
  L: InvoiceLabels;
  typeLabel: string;
  formatDate: (date: Date | string, pattern?: string) => string;
}) {
  const currency = data.currency || 'USD';
  const pad = compact ? 'px-4' : 'px-8';
  return (
    <div
      id={id}
      className={cn(
        'mx-auto bg-white border border-slate-200 overflow-hidden w-full print:shadow-none print:rounded-none print:border-0',
        compact ? 'rounded-xl shadow-sm' : 'rounded-2xl shadow-md max-w-[210mm]',
      )}
    >
      {/* ── Header ── */}
      <div className={cn('text-white', tc.headerBg, compact ? 'px-4 py-4' : 'px-8 py-7')}>
        <div className={cn('flex gap-4', compact ? 'flex-col' : 'items-center justify-between gap-6')}>
          <div className={cn('flex min-w-0', compact ? 'items-start gap-3' : 'items-center gap-5')}>
            {opts.showLogo !== false && data.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.logo_url} alt="" className={cn('rounded-2xl object-cover border-2 border-white/35 shadow-lg shrink-0', compact ? 'h-12 w-12' : 'h-20 w-20')} />
            ) : (
              <div className={cn('rounded-2xl bg-white/20 border-2 border-white/35 flex items-center justify-center font-black shrink-0 shadow-lg', compact ? 'h-12 w-12 text-2xl' : 'h-20 w-20 text-4xl')}>
                {data.store_name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className={cn('font-black tracking-tight truncate leading-tight', compact ? 'text-xl' : 'text-3xl')}>{data.store_name}</h2>
              {data.store_address && <p className={cn('text-white/80 mt-1 line-clamp-2', compact ? 'text-xs' : 'text-sm')}>{data.store_address}</p>}
              {data.store_phone && <p className={cn('text-white/80', compact ? 'text-xs' : 'text-sm mt-0.5')}>📞 {data.store_phone}</p>}
              {!compact && data.store_email && <p className="text-white/80 text-sm mt-0.5">✉ {data.store_email}</p>}
              {!compact && (data.tax_number ?? opts.taxNumber) && (
                <p className="text-white/55 text-[11px] mt-1">Tax ID: {data.tax_number ?? opts.taxNumber}</p>
              )}
            </div>
          </div>
          <div className={cn(compact ? 'flex items-center justify-between gap-2 pt-1 border-t border-white/20' : 'text-right shrink-0')}>
            <div>
              <span className="inline-block rounded-full bg-white/20 border border-white/30 text-[10px] font-black px-3 py-1 uppercase tracking-widest">
                {typeLabel}
              </span>
              <p className={cn('font-black mt-1.5 tracking-tight', compact ? 'text-xl' : 'text-3xl')}>{data.invoice_number}</p>
              <p className={cn('text-white/70 mt-0.5', compact ? 'text-xs' : 'text-sm')}>
                {formatDate(data.date)}
                {' · '}
                {new Date(data.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <Badge className={cn('border text-[10px] font-bold shrink-0', !compact && 'mt-2 text-xs px-3 py-1', STATUS_BADGE[paymentStatus])}>
              {statusLabel}
            </Badge>
          </div>
        </div>
      </div>

      {/* ── Customer + Invoice Info strip ── */}
      <div className={cn('bg-slate-50 border-b border-slate-100', pad, compact ? 'py-3 grid grid-cols-1 gap-3' : 'py-5 grid grid-cols-2 gap-4')}>
        {/* Bill To */}
        {data.customer_name ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{L.billTo}</p>
            <p className="font-bold text-slate-900 text-base">{data.customer_name}</p>
            {data.customer_id && <p className="text-xs text-slate-500">ID: {data.customer_id}</p>}
            {data.customer_phone && <p className="text-sm text-slate-600 mt-0.5">📞 {data.customer_phone}</p>}
            {data.customer_email && <p className="text-sm text-slate-600">✉ {data.customer_email}</p>}
            {data.customer_address && <p className="text-xs text-slate-400 mt-0.5">{data.customer_address}</p>}
          </div>
        ) : (
          <div />
        )}
        {/* Invoice details */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{L.invoiceDetails}</p>
          <table className="w-full text-sm">
            <tbody>
              {[
                [L.invoiceNumber.replace('#', ''), data.invoice_number],
                [L.date, formatDate(data.date)],
                [L.time, new Date(data.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })],
                ...(data.cashier_name ? [[L.cashier, data.cashier_name]] : []),
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="py-0.5 text-slate-500 pr-4">{label}</td>
                  <td className="py-0.5 font-semibold text-slate-900 text-right">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Items table ── */}
      <div className={cn(pad, compact ? 'py-3' : 'py-6')}>
        <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className={cn('text-left', tc.tableHead)}>
              <th className={cn('py-2 text-[10px] font-bold uppercase tracking-wide rounded-l-lg', compact ? 'px-2' : 'px-4 py-3', tc.tableHeadText)}>{L.product}</th>
              <th className={cn('py-2 text-[10px] font-bold uppercase tracking-wide text-center w-10', compact ? 'px-1' : 'px-3 py-3', tc.tableHeadText)}>{L.qty}</th>
              <th className={cn('py-2 text-[10px] font-bold uppercase tracking-wide text-right w-20', compact ? 'px-1' : 'px-3 py-3', tc.tableHeadText)}>{L.unitPrice}</th>
              {opts.showDiscount && (
                <th className={cn('py-2 text-[10px] font-bold uppercase tracking-wide text-right w-16', compact ? 'px-1' : 'px-3 py-3', tc.tableHeadText)}>{L.disc}</th>
              )}
              {opts.showTax && !compact && (
                <th className={cn('px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-right w-20', tc.tableHeadText)}>{L.tax}</th>
              )}
              <th className={cn('py-2 text-[10px] font-bold uppercase tracking-wide text-right w-20 rounded-r-lg', compact ? 'px-2' : 'px-4 py-3', tc.tableHeadText)}>{L.total}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((item, i) => (
              <tr key={item.id ?? i} className={cn('transition-colors', i % 2 === 1 && 'bg-slate-50/60')}>
                <td className={compact ? 'px-2 py-2' : 'px-4 py-3'}>
                  <p className={cn('font-semibold text-slate-900', compact && 'text-xs')}>{item.name}</p>
                  {opts.showSku && item.sku && (
                    <p className="text-[10px] text-slate-400 mt-0.5">SKU: {item.sku}</p>
                  )}
                </td>
                <td className={cn('text-center text-slate-600', compact ? 'px-1 py-2 text-xs' : 'px-3 py-3')}>{formatInvoiceLineQty(item)}</td>
                <td className={cn('text-right text-slate-600 tabular-nums', compact ? 'px-1 py-2 text-xs' : 'px-3 py-3')}>
                  {fmt(item.unit_price, currency)}
                </td>
                {opts.showDiscount && (
                  <td className={cn('text-right tabular-nums', compact ? 'px-1 py-2 text-xs' : 'px-3 py-3')}>
                    {(item.discount_amount ?? 0) > 0 ? (
                      <span className="text-red-500">-{fmt(item.discount_amount!, currency)}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                )}
                {opts.showTax && !compact && (
                  <td className="px-3 py-3 text-right text-slate-500 tabular-nums">
                    {(item.tax_amount ?? 0) > 0 ? fmt(item.tax_amount!, currency) : <span className="text-slate-300">—</span>}
                  </td>
                )}
                <td className={cn('text-right font-bold text-slate-900 tabular-nums', compact ? 'px-2 py-2 text-xs' : 'px-4 py-3')}>
                  {fmt(item.subtotal, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Totals + QR row ── */}
      <div className={cn('flex gap-4 pb-4', pad, compact ? 'flex-col-reverse items-stretch' : 'items-start justify-between pb-6')}>
        {/* QR code */}
        {opts.showQr !== false && qrUrl ? (
          <div className={cn('flex flex-col items-center gap-1', compact && 'mx-auto')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="QR" className={cn('rounded-lg border border-slate-200', compact ? 'h-16 w-16' : 'h-24 w-24 shadow-sm')} />
            <p className="text-[9px] text-slate-400 text-center">{L.verify}</p>
          </div>
        ) : !compact ? <div /> : null}

        <div className={cn('space-y-1.5', compact ? 'w-full' : 'min-w-[220px]')}>
          <TotalRow label={L.subtotal} value={fmt(data.subtotal, currency)} />
          {opts.showDiscount && data.discount_amount > 0 && (
            <TotalRow label={L.discount} value={`-${fmt(data.discount_amount, currency)}`} valueClass="text-red-600" />
          )}
          {opts.showTax && data.tax_amount > 0 && (
            <TotalRow label={L.tax} value={fmt(data.tax_amount, currency)} />
          )}
          <div className={cn('flex justify-between items-center border-t-2 pt-2', tc.accentBorder)}>
            <span className="text-base font-black text-slate-900">{L.total}</span>
            <span className={cn('text-xl font-black tabular-nums', tc.totalText)}>
              {fmt(data.total_amount, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Payment Summary ── */}
      <div className={cn('rounded-xl bg-slate-50 border border-slate-200 p-3 mb-4', compact ? `mx-4` : 'mx-8 mb-6 p-4')}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Payment Summary</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {data.payment_label && (
            <PaymentRow label="Payment Method" value={data.payment_label} />
          )}
          <PaymentRow label="Amount Paid" value={fmt(data.paid_amount, currency)} valueClass="text-emerald-700 font-bold" />
          {data.change_amount && data.change_amount > 0 && (
            <PaymentRow label="Change Returned" value={fmt(data.change_amount, currency)} />
          )}
          {data.credit_amount > 0 && (
            <PaymentRow label="On Account / Credit" value={fmt(data.credit_amount, currency)} valueClass="text-amber-700" />
          )}
          {balanceDue > 0 && (
            <div className="col-span-2 flex justify-between border-t border-slate-200 pt-2 mt-1">
              <span className="font-bold text-red-700">{L.balanceDue}</span>
              <span className="font-black text-red-700 text-base tabular-nums">{fmt(balanceDue, currency)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Notes ── */}
      {data.notes && (
        <div className={cn('rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900', compact ? 'mx-4 mb-3' : 'mx-8 mb-5')}>
          <strong>Note:</strong> {data.notes}
        </div>
      )}

      {/* ── Footer ── */}
      <div className={cn('border-t border-slate-100 py-4 text-center space-y-1', compact ? 'mx-4' : 'mx-8 py-5')}>
        <p className="text-sm font-semibold text-slate-800">
          {data.footer_message ?? opts.footerMessage ?? L.thankYou}
        </p>
        {(data.terms_and_conditions ?? opts.termsAndConditions) && (
          <p className="text-[10px] text-slate-400 max-w-md mx-auto leading-relaxed mt-1">
            {data.terms_and_conditions ?? opts.termsAndConditions}
          </p>
        )}
        {(data.store_phone || data.store_email) && (
          <p className="text-xs text-slate-500 mt-1">
            {data.store_phone && `📞 ${data.store_phone}`}
            {data.store_phone && data.store_email && ' · '}
            {data.store_email && `✉ ${data.store_email}`}
          </p>
        )}
        <p className="text-[10px] text-slate-300 mt-2">{L.poweredBy}</p>
      </div>
    </div>
  );
}

// ── MINIMAL template ───────────────────────────────────────
function MinimalLayout({
  data, opts, qrUrl, tc, balanceDue, id, paymentStatus, statusLabel, compact = false,
  L, typeLabel, formatDate,
}: {
  data: InvoiceData;
  opts: InvoiceDisplayOptions;
  qrUrl: string | null;
  tc: typeof THEMES.blue;
  balanceDue: number;
  id: string;
  paymentStatus: string;
  statusLabel: string;
  compact?: boolean;
  L: InvoiceLabels;
  typeLabel: string;
  formatDate: (date: Date | string, pattern?: string) => string;
}) {
  const currency = data.currency || 'USD';
  const pad = compact ? 'px-5' : 'px-10';
  return (
    <div
      id={id}
      className={cn(
        'mx-auto bg-white border border-slate-200 overflow-hidden w-full',
        compact ? 'rounded-xl shadow-sm' : 'rounded-2xl shadow-md max-w-[210mm]',
      )}
    >
      <div className={cn('h-1.5 w-full', tc.tableHead)} />
      <div className={cn(pad, compact ? 'pt-5 pb-4' : 'pt-10 pb-8')}>
        <div className={cn('flex gap-4 mb-6', compact ? 'flex-col' : 'justify-between items-start mb-10')}>
          <div className="min-w-0">
            {opts.showLogo !== false && data.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.logo_url} alt="" className={cn('rounded-lg object-cover mb-2', compact ? 'h-10 w-10' : 'h-12 w-12 mb-3')} />
            ) : null}
            <h2 className={cn('font-black text-slate-900 truncate', compact ? 'text-lg' : 'text-2xl')}>{data.store_name}</h2>
            {data.store_address && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{data.store_address}</p>}
            {data.store_phone && <p className="text-xs text-slate-500">{data.store_phone}</p>}
          </div>
          <div className={compact ? 'flex items-center justify-between gap-2' : 'text-right shrink-0'}>
            <div>
              <p className={cn('text-[10px] font-bold uppercase tracking-widest mb-0.5', tc.accentText)}>{typeLabel}</p>
              <p className={cn('font-black text-slate-900', compact ? 'text-lg' : 'text-2xl')}>{data.invoice_number}</p>
              <p className="text-xs text-slate-500 mt-0.5">{formatDate(data.date)}</p>
            </div>
            <Badge className={cn('border text-[10px] shrink-0', STATUS_BADGE[paymentStatus])}>
              {statusLabel}
            </Badge>
          </div>
        </div>

        {data.customer_name && (
          <div className={cn('mb-5 p-3 rounded-lg bg-slate-50 border-l-4 border-slate-300', compact && 'mb-4')}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{L.billTo}</p>
            <p className="font-bold text-slate-900 text-sm">{data.customer_name}</p>
            {data.customer_phone && <p className="text-xs text-slate-600">{data.customer_phone}</p>}
          </div>
        )}

        <div className="overflow-x-auto -mx-1 px-1 mb-5">
        <table className="w-full text-sm min-w-[360px]">
          <thead>
            <tr className="border-b-2 border-slate-900">
              <th className="text-left py-2 font-bold text-slate-700 uppercase text-[10px] tracking-wide">{L.item}</th>
              <th className="text-center py-2 font-bold text-slate-700 uppercase text-[10px] tracking-wide w-10">{L.qty}</th>
              <th className="text-right py-2 font-bold text-slate-700 uppercase text-[10px] tracking-wide w-20">{L.unitPrice}</th>
              <th className="text-right py-2 font-bold text-slate-700 uppercase text-[10px] tracking-wide w-20">{L.total}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((item, i) => (
              <tr key={item.id ?? i}>
                <td className={cn('py-2', compact && 'text-xs')}>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  {opts.showSku && item.sku && <p className="text-[10px] text-slate-400">{item.sku}</p>}
                </td>
                <td className={cn('text-center text-slate-600', compact ? 'py-2 text-xs' : 'py-3')}>{formatInvoiceLineQty(item)}</td>
                <td className={cn('text-right text-slate-600 tabular-nums', compact ? 'py-2 text-xs' : 'py-3')}>{fmt(item.unit_price, currency)}</td>
                <td className={cn('text-right font-bold tabular-nums', compact ? 'py-2 text-xs' : 'py-3')}>{fmt(item.subtotal, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className={cn('flex gap-4', compact ? 'flex-col-reverse' : 'justify-between items-start gap-8')}>
          <div className={compact ? 'mx-auto' : ''}>
            {opts.showQr !== false && qrUrl && (
              <div className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt="QR" className={cn('border rounded', compact ? 'h-16 w-16' : 'h-20 w-20')} />
                <span className="text-[9px] text-slate-400">{L.verify}</span>
              </div>
            )}
          </div>
          <div className={cn(compact ? 'w-full' : 'min-w-[200px]')}>
            <TotalRow label={L.subtotal} value={fmt(data.subtotal, currency)} />
            {opts.showDiscount && data.discount_amount > 0 && <TotalRow label={L.discount} value={`-${fmt(data.discount_amount, currency)}`} valueClass="text-red-600" />}
            {opts.showTax && data.tax_amount > 0 && <TotalRow label={L.tax} value={fmt(data.tax_amount, currency)} />}
            <div className={cn('flex justify-between font-black mt-2 pt-2 border-t-2', compact ? 'text-base' : 'text-lg mt-3 pt-3', tc.accentBorder)}>
              <span>{L.total}</span>
              <span className={tc.totalText}>{fmt(data.total_amount, currency)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── THERMAL template ───────────────────────────────────────
function ThermalLayout({
  data, opts, qrUrl, balanceDue, id, compact = false,
  L, typeLabel, formatDate, statusLabel, paymentStatus,
}: {
  data: InvoiceData;
  opts: InvoiceDisplayOptions;
  qrUrl: string | null;
  balanceDue: number;
  id: string;
  compact?: boolean;
  L: InvoiceLabels;
  typeLabel: string;
  formatDate: (date: Date | string, pattern?: string) => string;
  statusLabel: string;
  paymentStatus: string;
}) {
  const currency = data.currency || 'USD';
  return (
    <div
      id={id}
      className={cn(
        'mx-auto bg-white border border-slate-200 shadow-sm font-mono text-xs',
        compact ? 'rounded-xl w-full' : '',
      )}
      style={{ maxWidth: compact ? '100%' : '320px', padding: compact ? '10px' : '12px' }}
    >
      {/* Store header */}
      <div className="text-center mb-3">
        <p className="text-sm font-black">{data.store_name}</p>
        {data.store_address && <p className="text-[10px] text-slate-600">{data.store_address}</p>}
        {data.store_phone && <p className="text-[10px] text-slate-600">{data.store_phone}</p>}
        {(data.tax_number ?? opts.taxNumber) && <p className="text-[10px] text-slate-500">TIN: {data.tax_number ?? opts.taxNumber}</p>}
      </div>
      <div className="border-t border-dashed border-slate-300 my-2" />

      {/* Meta */}
      <div className="text-[10px] mb-2 space-y-0.5">
        <div className="flex justify-between">
          <span>{L.invoice}:</span>
          <span className="font-bold">{data.invoice_number}</span>
        </div>
        <div className="flex justify-between">
          <span>{L.date}:</span>
          <span>{formatDate(data.date)}</span>
        </div>
        {data.cashier_name && <div className="flex justify-between"><span>{L.cashier}:</span><span>{data.cashier_name}</span></div>}
        {data.customer_name && <div className="flex justify-between"><span>{L.customer}:</span><span>{data.customer_name}</span></div>}
      </div>
      <div className="border-t border-dashed border-slate-300 my-2" />

      {/* Items */}
      <table className="w-full text-[10px] mb-2">
        <thead>
          <tr className="border-b border-slate-300">
            <th className="text-left py-1">{L.item}</th>
            <th className="text-center w-8">{L.qty}</th>
            <th className="text-right w-16">{L.unitPrice}</th>
            <th className="text-right w-16">{L.total}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i} className="border-b border-dotted border-slate-200">
              <td className="py-1">{item.name}</td>
              <td className="text-center">{formatInvoiceLineQty(item)}</td>
              <td className="text-right tabular-nums">{fmtMoney(item.unit_price, currency).replace('$', '')}</td>
              <td className="text-right font-bold tabular-nums">{fmtMoney(item.subtotal, currency).replace('$', '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed border-slate-300 my-2" />

      {/* Totals */}
      <div className="text-[11px] space-y-1">
        <div className="flex justify-between"><span>{L.subtotal}:</span><span className="tabular-nums">{currency} {data.subtotal.toFixed(2)}</span></div>
        {data.discount_amount > 0 && <div className="flex justify-between text-red-600"><span>{L.discount}:</span><span>-{currency} {data.discount_amount.toFixed(2)}</span></div>}
        {data.tax_amount > 0 && <div className="flex justify-between"><span>{L.tax}:</span><span className="tabular-nums">{currency} {data.tax_amount.toFixed(2)}</span></div>}
        <div className="flex justify-between font-black text-sm border-t border-slate-400 pt-1">
          <span>{L.total.toUpperCase()}:</span><span className="tabular-nums">{currency} {data.total_amount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between"><span>{L.paid} ({data.payment_label ?? 'Cash'}):</span><span className="tabular-nums">{currency} {data.paid_amount.toFixed(2)}</span></div>
        {data.change_amount && data.change_amount > 0 && <div className="flex justify-between"><span>{L.change}:</span><span className="tabular-nums">{currency} {data.change_amount.toFixed(2)}</span></div>}
        {balanceDue > 0 && <div className="flex justify-between font-bold text-red-600"><span>{L.balanceDue}:</span><span className="tabular-nums">{currency} {balanceDue.toFixed(2)}</span></div>}
      </div>
      <div className="border-t border-dashed border-slate-300 my-2" />

      {/* Status */}
      <div className="text-center mb-2">
        <Badge className={cn('border text-[10px]', STATUS_BADGE[paymentStatus])}>
          {statusLabel}
        </Badge>
      </div>

      {/* QR */}
      {opts.showQr !== false && qrUrl && (
        <div className="flex flex-col items-center my-2 gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="QR" className="h-20 w-20" />
          <span className="text-[9px] text-slate-400">{L.verify}</span>
        </div>
      )}
      <div className="border-t border-dashed border-slate-300 my-2" />

      {/* Footer */}
      <div className="text-center text-[10px] text-slate-600">
        <p className="font-semibold">{data.footer_message ?? L.thankYou}</p>
        <p className="text-[9px] text-slate-400 mt-1">{L.poweredBy}</p>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────
function TotalRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={cn('tabular-nums font-medium', valueClass ?? 'text-slate-900')}>{value}</span>
    </div>
  );
}

function PaymentRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <>
      <span className="text-slate-500">{label}</span>
      <span className={cn('text-right tabular-nums', valueClass ?? 'font-semibold text-slate-900')}>{value}</span>
    </>
  );
}
