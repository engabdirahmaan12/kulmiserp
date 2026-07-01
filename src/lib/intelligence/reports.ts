import type { ReportKind, StoreIntelligence } from './types';

function fmt(currency: string, n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export function generateBusinessReport(
  kind: ReportKind,
  intel: StoreIntelligence,
  currency: string,
  storeName: string,
  locale: 'en' | 'so' = 'en',
): string {
  const isSo = locale === 'so';
  const lines: string[] = [];
  const divider = '─'.repeat(40);
  const date = new Date().toLocaleDateString(isSo ? 'so-SO' : 'en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  lines.push(`KULMIS ERP — ${storeName}`);
  lines.push(`${reportTitle(kind, locale)} · ${date}`);
  lines.push(divider);

  switch (kind) {
    case 'daily':
      if (isSo) {
        lines.push(`Iibka Maanta: ${fmt(currency, intel.briefing.summary.sales)}`);
        lines.push(`Faa'iidada Maanta: ${fmt(currency, intel.briefing.summary.profit)}`);
        lines.push(`Kharashka Maanta: ${fmt(currency, intel.briefing.summary.expenses)}`);
        lines.push(`Dhaqdhaqaaqyada: ${intel.briefing.summary.transactionCount}`);
        lines.push(`Macaamiil Cusub: ${intel.briefing.summary.newCustomers}`);
        if (intel.topProducts[0]) {
          lines.push(`Alaabta Ugu Iibka Badan: ${intel.topProducts[0].name} (${fmt(currency, intel.topProducts[0].revenue)})`);
        }
      } else {
        lines.push(`Today's Sales: ${fmt(currency, intel.briefing.summary.sales)}`);
        lines.push(`Today's Profit: ${fmt(currency, intel.briefing.summary.profit)}`);
        lines.push(`Today's Expenses: ${fmt(currency, intel.briefing.summary.expenses)}`);
        lines.push(`Transactions: ${intel.briefing.summary.transactionCount}`);
        lines.push(`New Customers: ${intel.briefing.summary.newCustomers}`);
        if (intel.topProducts[0]) {
          lines.push(`Top Product: ${intel.topProducts[0].name} (${fmt(currency, intel.topProducts[0].revenue)})`);
        }
      }
      break;

    case 'weekly':
    case 'monthly':
      if (isSo) {
        lines.push(`Dakhliga (Bishan): ${fmt(currency, intel.metrics.monthRevenue)}`);
        lines.push(`Kharashaadka (Bishan): ${fmt(currency, intel.metrics.monthExpenses)}`);
        lines.push(`Faa'iidada Saafiga ah (Bishan): ${fmt(currency, intel.metrics.monthProfit)}`);
        if (intel.metrics.growthRate !== null) {
          lines.push(`Koritaanka marka la barbardhigo bisha hore: ${intel.metrics.growthRate >= 0 ? '+' : ''}${intel.metrics.growthRate}%`);
        }
        lines.push(`Haraaga Lacagta: ${fmt(currency, intel.metrics.cashBalance)}`);
        lines.push('');
        lines.push('Alaabta Ugu Iibka Badan:');
        intel.topProducts.slice(0, 5).forEach((p, i) => {
          lines.push(`  ${i + 1}. ${p.name} — ${fmt(currency, p.revenue)} (${p.quantity} la iibiyay)`);
        });
      } else {
        lines.push(`Revenue (MTD): ${fmt(currency, intel.metrics.monthRevenue)}`);
        lines.push(`Expenses (MTD): ${fmt(currency, intel.metrics.monthExpenses)}`);
        lines.push(`Net Profit (MTD): ${fmt(currency, intel.metrics.monthProfit)}`);
        if (intel.metrics.growthRate !== null) {
          lines.push(`Growth vs Last Month: ${intel.metrics.growthRate >= 0 ? '+' : ''}${intel.metrics.growthRate}%`);
        }
        lines.push(`Cash Balance: ${fmt(currency, intel.metrics.cashBalance)}`);
        lines.push('');
        lines.push('Top Products:');
        intel.topProducts.slice(0, 5).forEach((p, i) => {
          lines.push(`  ${i + 1}. ${p.name} — ${fmt(currency, p.revenue)} (${p.quantity} sold)`);
        });
      }
      break;

    case 'inventory':
      if (isSo) {
        lines.push(`Qiimaha Bakhaarka: ${fmt(currency, intel.metrics.inventoryValue)}`);
        lines.push(`Alaabta Yaraatay: ${intel.lowStockProducts.length}`);
        intel.lowStockProducts.slice(0, 8).forEach((p) => {
          lines.push(`  • ${p.name}: ${p.stock} haray (ugu yaraan ${p.minLevel})`);
        });
        lines.push('');
        lines.push('Talooyinka Dib-u-dalbashada:');
        intel.forecasts.slice(0, 5).forEach((f) => {
          lines.push(
            `  • ${f.name}: ~${f.daysUntilStockout ?? '?'} maalmood ayaa haray, waxaa lagula talinayaa ${Math.ceil(f.suggestedReorderQty)} xabbo`,
          );
        });
      } else {
        lines.push(`Inventory Value: ${fmt(currency, intel.metrics.inventoryValue)}`);
        lines.push(`Low Stock Items: ${intel.lowStockProducts.length}`);
        intel.lowStockProducts.slice(0, 8).forEach((p) => {
          lines.push(`  • ${p.name}: ${p.stock} left (min ${p.minLevel})`);
        });
        lines.push('');
        lines.push('Reorder Recommendations:');
        intel.forecasts.slice(0, 5).forEach((f) => {
          lines.push(
            `  • ${f.name}: ~${f.daysUntilStockout ?? '?'} days left, suggest ${Math.ceil(f.suggestedReorderQty)} units`,
          );
        });
      }
      break;

    case 'debt':
      if (isSo) {
        lines.push(`Wadarta Lacagta La Sugayo: ${fmt(currency, intel.metrics.receivables)}`);
        lines.push(`Waajibaadka La Bixin Doono: ${fmt(currency, intel.metrics.payables)}`);
        lines.push(`Macaamiisha Deynta Leh: ${intel.debtSummary.customersWithBalance}`);
        lines.push(`Diiwaanada Dib U Dhacay: ${intel.debtSummary.overdueCount}`);
        lines.push('');
        lines.push('Deymaha Ugu Waaweyn:');
        intel.debtSummary.topDebtors.forEach((d) => {
          lines.push(`  • ${d.name}: ${fmt(currency, d.balance)}`);
        });
      } else {
        lines.push(`Total Receivables: ${fmt(currency, intel.metrics.receivables)}`);
        lines.push(`Payables: ${fmt(currency, intel.metrics.payables)}`);
        lines.push(`Customers with Balance: ${intel.debtSummary.customersWithBalance}`);
        lines.push(`Overdue Records: ${intel.debtSummary.overdueCount}`);
        lines.push('');
        lines.push('Top Debtors:');
        intel.debtSummary.topDebtors.forEach((d) => {
          lines.push(`  • ${d.name}: ${fmt(currency, d.balance)}`);
        });
      }
      break;

    case 'profit':
      if (isSo) {
        lines.push(`Dakhliga Bishan: ${fmt(currency, intel.metrics.monthRevenue)}`);
        lines.push(`Kharashaadka Bishan: ${fmt(currency, intel.metrics.monthExpenses)}`);
        lines.push(`Faa'iidada Saafiga ah: ${fmt(currency, intel.metrics.monthProfit)}`);
        lines.push(
          `Saamiga Faa'iidada: ${
            intel.metrics.monthRevenue > 0
              ? `${Math.round((intel.metrics.monthProfit / intel.metrics.monthRevenue) * 100)}%`
              : 'Lama heli karo'
          }`,
        );
        lines.push(`Faa'iidada Maanta: ${fmt(currency, intel.briefing.summary.profit)}`);
      } else {
        lines.push(`Month Revenue: ${fmt(currency, intel.metrics.monthRevenue)}`);
        lines.push(`Month Expenses: ${fmt(currency, intel.metrics.monthExpenses)}`);
        lines.push(`Net Profit: ${fmt(currency, intel.metrics.monthProfit)}`);
        lines.push(
          `Profit Margin: ${
            intel.metrics.monthRevenue > 0
              ? `${Math.round((intel.metrics.monthProfit / intel.metrics.monthRevenue) * 100)}%`
              : 'N/A'
          }`,
        );
        lines.push(`Today's Profit: ${fmt(currency, intel.briefing.summary.profit)}`);
      }
      break;

    case 'health':
      if (isSo) {
        lines.push(`Dhibcaha Caafimaadka Ganacsiga: ${intel.health.score}/100 (${intel.health.status})`);
        lines.push('');
        lines.push('Arrimaha Caafimaadka:');
        intel.health.factors.forEach((f) => {
          lines.push(`  • ${f.label}: ${Math.round(f.score)}/100`);
        });
        lines.push('');
        lines.push('Talooyinka:');
        intel.briefing.recommendations.forEach((r) => lines.push(`  • ${r}`));
      } else {
        lines.push(`Business Health Score: ${intel.health.score}/100 (${intel.health.status})`);
        lines.push('');
        lines.push('Health Factors:');
        intel.health.factors.forEach((f) => {
          lines.push(`  • ${f.label}: ${Math.round(f.score)}/100`);
        });
        lines.push('');
        lines.push('Recommendations:');
        intel.briefing.recommendations.forEach((r) => lines.push(`  • ${r}`));
      }
      break;
  }

  lines.push(divider);
  lines.push(isSo ? 'Waxaa soo saaray KULMIS AI Copilot' : 'Generated by KULMIS AI Copilot');
  return lines.join('\n');
}

function reportTitle(kind: ReportKind, locale: 'en' | 'so' = 'en'): string {
  const titlesEn: Record<ReportKind, string> = {
    daily: 'Daily Business Report',
    weekly: 'Weekly Business Report',
    monthly: 'Monthly Business Report',
    inventory: 'Inventory Report',
    debt: 'Debt & Receivables Report',
    profit: 'Profit Report',
    health: 'Business Health Report',
  };
  const titlesSo: Record<ReportKind, string> = {
    daily: 'Warbixinta Ganacsiga Maalinlaha ah',
    weekly: 'Warbixinta Ganacsiga Toddobaadlaha ah',
    monthly: 'Warbixinta Ganacsiga Bishii',
    inventory: 'Warbixinta Bakhaarka',
    debt: 'Warbixinta Deymaha & Lacagta La Sugayo',
    profit: 'Warbixinta Faa\'iidada',
    health: 'Warbixinta Caafimaadka Ganacsiga',
  };
  return (locale === 'so' ? titlesSo : titlesEn)[kind];
}

export function reportKindFromQuery(query: string): ReportKind | null {
  const q = query.toLowerCase();
  const hasReportWord = /report|warbixin/.test(q);
  if (!hasReportWord) return null;
  if (/daily|today|maalinlaha|maanta/.test(q)) return 'daily';
  if (/weekly|week|toddobaad/.test(q)) return 'weekly';
  if (/monthly|month|bisha|bilka|bishii/.test(q)) return 'monthly';
  if (/inventory|bakhaar/.test(q)) return 'inventory';
  if (/debt|deyn/.test(q)) return 'debt';
  if (/profit|faa'iido|faaiido|macaash/.test(q)) return 'profit';
  return null;
}
