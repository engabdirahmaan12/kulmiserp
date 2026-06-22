import type { AccountingPeriod, PeriodArchive } from '@/types';

export function fmtMoney(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
}

// ── CSV export ─────────────────────────────────────────────
export function exportPeriodCsv(period: AccountingPeriod, archive: PeriodArchive, currency = 'USD') {
  const rows = [
    ['KULMIS ERP — Period Report'],
    ['Period', period.name],
    ['Start', period.period_start],
    ['End', period.period_end],
    ['Status', period.status.toUpperCase()],
    ['Generated', new Date().toLocaleString()],
    [],
    ['Metric', 'Amount'],
    ['Total Sales', fmtMoney(archive.total_sales, currency)],
    ['Total Purchases', fmtMoney(archive.total_purchases, currency)],
    ['Total Expenses', fmtMoney(archive.total_expenses, currency)],
    ['Gross Profit', fmtMoney(archive.gross_profit, currency)],
    ['Net Profit', fmtMoney(archive.net_profit, currency)],
    ['Accounts Receivable (AR)', fmtMoney(archive.total_ar, currency)],
    ['Accounts Payable (AP)', fmtMoney(archive.total_ap, currency)],
    ['Journal Entries', String(archive.journal_count)],
  ];

  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  downloadBlob(csv, `${period.name.replace(/\s+/g, '_')}_report.csv`, 'text/csv');
}

// ── Excel (.xlsx via xlsx library) ────────────────────────
export async function exportPeriodExcel(period: AccountingPeriod, archive: PeriodArchive, currency = 'USD') {
  const { utils, writeFileXLSX } = await import('xlsx');

  const summaryData = [
    ['KULMIS ERP — Period Report'],
    [],
    ['Period', period.name],
    ['Start Date', period.period_start],
    ['End Date', period.period_end],
    ['Status', period.status.toUpperCase()],
    ['Generated', new Date().toLocaleString()],
    [],
    ['Metric', 'Amount'],
    ['Total Sales', archive.total_sales],
    ['Total Purchases', archive.total_purchases],
    ['Total Expenses', archive.total_expenses],
    ['Gross Profit', archive.gross_profit],
    ['Net Profit', archive.net_profit],
    ['Accounts Receivable', archive.total_ar],
    ['Accounts Payable', archive.total_ap],
    ['Journal Entries', archive.journal_count],
  ];

  const ws = utils.aoa_to_sheet(summaryData);

  // Column widths
  ws['!cols'] = [{ wch: 30 }, { wch: 20 }];

  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Period Summary');

  writeFileXLSX(wb, `${period.name.replace(/\s+/g, '_')}_report.xlsx`);
}

// ── PDF export ────────────────────────────────────────────
export async function exportPeriodPdf(period: AccountingPeriod, archive: PeriodArchive, storeName: string, currency = 'USD') {
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, pageW, 35, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(storeName, 14, 15);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Accounting Period Report — ${period.name}`, 14, 24);
  doc.text(new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }), 14, 31);

  y = 50;
  doc.setTextColor(15, 23, 42);

  // Period info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Period Details', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(`Start: ${period.period_start}   End: ${period.period_end}`, 14, y);
  y += 5;
  const statusLabel = period.status === 'open' ? 'OPEN' : period.status === 'closed' ? 'CLOSED' : 'REOPENED';
  doc.text(`Status: ${statusLabel}`, 14, y);
  y += 12;

  // KPIs
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Financial Summary', 14, y);
  y += 8;

  const rows: [string, number, string][] = [
    ['Total Sales', archive.total_sales, 'revenue'],
    ['Total Purchases', archive.total_purchases, 'cost'],
    ['Total Expenses', archive.total_expenses, 'cost'],
    ['Gross Profit', archive.gross_profit, archive.gross_profit >= 0 ? 'profit' : 'loss'],
    ['Net Profit', archive.net_profit, archive.net_profit >= 0 ? 'profit' : 'loss'],
    ['Accounts Receivable', archive.total_ar, 'neutral'],
    ['Accounts Payable', archive.total_ap, 'neutral'],
  ];

  doc.setFontSize(10);
  for (const [label, value, type] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(label, 14, y);

    doc.setFont('helvetica', 'bold');
    if (type === 'profit') doc.setTextColor(5, 150, 105);
    else if (type === 'loss') doc.setTextColor(220, 38, 38);
    else if (type === 'revenue') doc.setTextColor(37, 99, 235);
    else doc.setTextColor(15, 23, 42);

    doc.text(fmtMoney(value, currency), pageW - 14, y, { align: 'right' });
    doc.setTextColor(226, 232, 240);
    doc.line(14, y + 2, pageW - 14, y + 2);
    doc.setTextColor(15, 23, 42);
    y += 10;
  }

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Journal Entries: ${archive.journal_count}`, 14, y);

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.setFillColor(248, 250, 252);
  doc.rect(0, footerY - 5, pageW, 20, 'F');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Generated by KULMIS ERP — Accounting Period Report', pageW / 2, footerY, { align: 'center' });

  doc.save(`${period.name.replace(/\s+/g, '_')}_report.pdf`);
}

// ── Util: download blob ────────────────────────────────────
function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
