import type { CopilotResponse, ReportKind, StoreIntelligence } from './types';
import { generateBusinessReport, reportKindFromQuery } from './reports';
import { isSomaliQuery } from './query-language';

export type CopilotLocale = 'en' | 'so' | 'ar';

/** Somali replies are used whenever the caller asks for 'so', or the query text
 *  itself is detected as Somali — so a Somali question always gets a Somali
 *  answer regardless of the app's currently-selected UI language. */
function resolveLocale(locale: CopilotLocale | undefined, query: string): 'en' | 'so' {
  if (locale === 'so' || isSomaliQuery(query)) return 'so';
  return 'en';
}

const ACTION_LABELS_SO: Record<string, string> = {
  'Full reports': 'Warbixinno buuxa',
  'Inventory': 'Alaabta',
  'Valuation': 'Qiimaynta Bakhaarka',
  'Customers': 'Macaamiisha',
  'Create purchase': 'Samee Iibsi',
  'Purchases': 'Iibsiga',
  'Debts': 'Deymaha',
  'Sales history': 'Taariikhda Iibka',
  'View P&L': 'Eeg Faa\'iidada & Khasaaraha',
  'Reports': 'Warbixinno',
  'Dashboard': 'Guddiga',
  'Intelligence hub': 'Xarunta Falanqaynta',
  'Export reports': 'Dhoofi Warbixinno',
  'Expenses': 'Kharashaadka',
};

function localizeActions(actions: CopilotResponse['actions'], locale: 'en' | 'so'): CopilotResponse['actions'] {
  if (locale !== 'so' || !actions) return actions;
  return actions.map((a) => ({ ...a, label: ACTION_LABELS_SO[a.label] ?? a.label }));
}

// ── Somali topic word-stems (\w* catches conjugations/suffixes so real
//    phrasing variety like "faa'iido/faaiido/faaiidada/faaiidad" or
//    "iibiyay/iibsaday/iibka" all match) ──────────────────────────────────
const SO = {
  today:      /maanta/,
  month:      /bisha\w*|bilka\w*|bishan/,
  lastMonth:  /bishii\s+hore|bisha\s+hore/,
  // Covers faa'iido / faaiido / faaiidada / faaidad and similar transliteration variants
  profit:     /faa.{0,2}id\w*|macaash\w*/,
  sales:      /iib\w*/,
  revenue:    /dakhli\w*/,
  expense:    /kharash\w*/,
  debt:       /deyn\w*|la\s+sugayo/,
  customer:   /macaamiil\w*|macmiil\w*/,
  inventory:  /bakhaar\w*|alaab\w*|stock\w*/,
  health:     /caafimaad\w*|xaalad\w*/,
  best:       /ugu\s+(fiican\w*|badan\w*|wanaagsan\w*|horeeya)/,
  low:        /yaraatay\w*|dhamaanaya\w*|dhamaad\w*|dhamay\w*/,
  reorder:    /dib\s*u\s*dalbo|dib\s*u\s*buuxi/,
  growth:     /koritaan\w*|kororka|hoos\s*u\s*dhac\w*/,
  slow:       /hakad\w*|aan\s+iibin/,
  purchase:   /iibsi\w*|iibso\w*/,
  supplier:   /alaab\w*\s+la\s+iibsaday/,
} as const;

export function answerCopilotQuery(
  query: string,
  intel: StoreIntelligence,
  currency: string,
  storeName = 'Store',
  locale?: CopilotLocale,
): CopilotResponse {
  const q = query.toLowerCase().trim();
  const isSo = resolveLocale(locale, query) === 'so';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  const reportKind = reportKindFromQuery(q);
  if (reportKind) {
    return {
      answer: generateBusinessReport(reportKind, intel, currency, storeName, isSo ? 'so' : 'en'),
      actions: localizeActions([{ label: 'Full reports', href: '/dashboard/reports' }], isSo ? 'so' : 'en'),
      data: { reportKind },
    };
  }

  const build = (answer: string, actions: CopilotResponse['actions']): CopilotResponse => ({
    answer,
    actions: localizeActions(actions, isSo ? 'so' : 'en'),
  });

  if (/inventory value|stock value|how much inventory/.test(q) || (SO.inventory.test(q) && /qiime|qiimo/.test(q))) {
    return build(
      isSo
        ? `Qiimaha guud ee bakhaarka (kharashka): ${fmt(intel.metrics.inventoryValue)}. ${intel.lowStockProducts.length} alaabo ayaa yaraaday ama dhamaaday.`
        : `Total inventory value at cost: ${fmt(intel.metrics.inventoryValue)}. ${intel.lowStockProducts.length} products are low or out of stock.`,
      [
        { label: 'Inventory', href: '/dashboard/inventory' },
        { label: 'Valuation', href: '/dashboard/accounting' },
      ],
    );
  }

  if (/best customer|top customer/.test(q) || (SO.customer.test(q) && SO.best.test(q))) {
    const top = intel.customerSegments.slice(0, 5);
    const list = top.map((c) => `${c.name} (${fmt(c.totalPurchases)})`).join(', ');
    return build(
      top.length
        ? isSo
          ? `Macaamiisha ugu iibka badan: ${list}.`
          : `Top customers by lifetime purchases: ${list}.`
        : isSo
          ? 'Wali taariikh iibsi macmiil oo la haysto ma jirto.'
          : 'No customer purchase history yet.',
      [{ label: 'Customers', href: '/dashboard/customers' }],
    );
  }

  if (/predict|shortage|run out|stockout/.test(q) || (SO.inventory.test(q) && SO.low.test(q) && /khatar\w*/.test(q))) {
    const items = intel.forecasts.slice(0, 5).map((f) => {
      const days = f.daysUntilStockout;
      if (days === null) return f.name;
      return isSo ? `${f.name} (~${days} maalmood)` : `${f.name} (~${days} days)`;
    });
    return build(
      items.length
        ? isSo
          ? `Khatarta alaab-dhamaad: ${items.join('; ')}.`
          : `Stock shortage risk: ${items.join('; ')}.`
        : isSo
          ? 'Khatar alaab-dhamaad oo dhow lama arag xagga xawaaraha iibka dhawaan.'
          : 'No imminent stock shortages detected from recent sales velocity.',
      [{ label: 'Create purchase', href: '/dashboard/purchase' }],
    );
  }

  if ((/purchase|bought|supplier/.test(q) && /recent|last|today/.test(q)) || (SO.purchase.test(q) && (SO.today.test(q) || /dhawaan/.test(q)))) {
    const list = intel.recentPurchases
      .slice(0, 4)
      .map((p) => `${p.poNumber} (${fmt(p.total)}, ${p.status})`)
      .join('; ');
    return build(
      list
        ? (isSo ? `Iibsiyada dhawaan: ${list}.` : `Recent purchases: ${list}.`)
        : (isSo ? 'Wax dalab iibsi ah oo dhawaan ah ma jiraan.' : 'No recent purchase orders.'),
      [{ label: 'Purchases', href: '/dashboard/purchase-history' }],
    );
  }

  if (/who owes|owe me|outstanding|pending debt/.test(q) || (SO.debt.test(q) && (SO.customer.test(q) || /yaa/.test(q)))) {
    const debtors = intel.debtSummary.topDebtors
      .slice(0, 4)
      .map((d) => `${d.name} (${fmt(d.balance)})`)
      .join(', ');
    return build(
      intel.debtSummary.customersWithBalance
        ? isSo
          ? `${intel.debtSummary.customersWithBalance} macaamiil ayaa i leh wadar ${fmt(intel.metrics.receivables)}.${debtors ? ` Kuwa ugu waaweyn: ${debtors}.` : ''}`
          : `${intel.debtSummary.customersWithBalance} customers owe a total of ${fmt(intel.metrics.receivables)}.${debtors ? ` Top: ${debtors}.` : ''}`
        : (isSo ? 'Ma jiraan deymo macaamiil oo hadhay.' : 'No outstanding customer balances.'),
      [{ label: 'Debts', href: '/dashboard/debts' }],
    );
  }

  // Profit/sales/revenue for a specific period — check TODAY vs THIS MONTH
  // before the generic branches so "faa'iidada maanta" / "iibka maanta"
  // always resolves correctly regardless of phrasing or verb used.
  const asksProfitOrSales = /profit|sales|revenue|margin|earn/.test(q) || SO.profit.test(q) || SO.sales.test(q) || SO.revenue.test(q);
  const asksToday = /today|daily/.test(q) || SO.today.test(q);
  const asksThisMonth = /month|mtd|this/.test(q) || SO.month.test(q);

  if (asksProfitOrSales && asksToday) {
    return build(
      isSo
        ? `Iibka maanta: ${fmt(intel.briefing.summary.sales)}. Faa'iidada maanta la qiyaasay: ${fmt(intel.briefing.summary.profit)}.`
        : `Today's sales: ${fmt(intel.briefing.summary.sales)}. Estimated profit today: ${fmt(intel.briefing.summary.profit)}.`,
      [{ label: 'Dashboard', href: '/dashboard' }],
    );
  }

  if (asksProfitOrSales && asksThisMonth) {
    return build(
      isSo
        ? `Faa'iidada saafiga ah ee bishan waa ${fmt(intel.metrics.monthProfit)}, dakhliga ${fmt(intel.metrics.monthRevenue)} iyo kharashaadka ${fmt(intel.metrics.monthExpenses)}.`
        : `This month net profit is ${fmt(intel.metrics.monthProfit)} on ${fmt(intel.metrics.monthRevenue)} revenue and ${fmt(intel.metrics.monthExpenses)} expenses.`,
      [{ label: 'View P&L', href: '/dashboard/accounting' }, { label: 'Reports', href: '/dashboard/reports' }],
    );
  }

  if (/sell today|sales today|how much.*today/.test(q) || (SO.sales.test(q) && asksToday)) {
    return build(
      isSo
        ? `Iibka maanta: ${fmt(intel.briefing.summary.sales)} oo ay ka mid yihiin ${intel.briefing.summary.transactionCount} dhaqdhaqaaq. Faa'iidada la qiyaasay: ${fmt(intel.briefing.summary.profit)}.`
        : `Today's sales: ${fmt(intel.briefing.summary.sales)} across ${intel.briefing.summary.transactionCount} transactions. Estimated profit: ${fmt(intel.briefing.summary.profit)}.`,
      [{ label: 'Sales history', href: '/dashboard/sales-history' }],
    );
  }

  // Bare profit/sales question with no period specified — default to today's snapshot.
  if (asksProfitOrSales) {
    return build(
      isSo
        ? `Iibka maanta: ${fmt(intel.briefing.summary.sales)}. Faa'iidada maanta la qiyaasay: ${fmt(intel.briefing.summary.profit)}.`
        : `Today's sales: ${fmt(intel.briefing.summary.sales)}. Estimated profit today: ${fmt(intel.briefing.summary.profit)}.`,
      [{ label: 'Dashboard', href: '/dashboard' }],
    );
  }

  if ((/best|top|perform/.test(q) && /product/.test(q)) || (SO.best.test(q) && (SO.sales.test(q) || /alaab\w*|badeecad\w*/.test(q)))) {
    const top = intel.topProducts.slice(0, 5);
    const list = top.map((p) => `${p.name} (${fmt(p.revenue)})`).join(', ');
    return build(
      top.length
        ? (isSo ? `Alaabta ugu iibka badan: ${list}.` : `Best-selling products: ${list}.`)
        : (isSo ? 'Xog iib ku filan lama helin si loo kala saaro alaabta.' : 'Not enough sales data yet to rank products.'),
      [{ label: 'Inventory', href: '/dashboard/inventory' }],
    );
  }

  if (/losing|loss|dead|slow/.test(q) || SO.slow.test(q)) {
    const dead = intel.deadStock.slice(0, 3).map((d) => d.name).join(', ');
    return build(
      dead
        ? (isSo ? `Alaabta gaabis/hakad ku jirta: ${dead}. Fiirso in aad dhimis ku samayso ama dallacaad u sameyso.` : `Slow or dead stock: ${dead}. Consider discounts or promotions.`)
        : (isSo ? 'Alaab muhiim ah oo hakad ku jirta 30+ maalmood lagama arag.' : 'No significant dead stock detected in the last 30+ days.'),
      [{ label: 'Intelligence hub', href: '/dashboard/intelligence' }],
    );
  }

  if (/reorder|restock|stock|low/.test(q) || SO.reorder.test(q) || (SO.inventory.test(q) && SO.low.test(q))) {
    const items = intel.lowStockProducts.slice(0, 5).map((p) => (isSo ? `${p.name} (${p.stock} haray)` : `${p.name} (${p.stock} left)`));
    const forecast = intel.forecasts.slice(0, 3).map((f) => (isSo ? `${f.name} (~${f.daysUntilStockout ?? '?'} maalmood)` : `${f.name} (~${f.daysUntilStockout ?? '?'} days)`));
    const parts = [
      items.length ? (isSo ? `Alaab yaraatay: ${items.join('; ')}` : `Low stock: ${items.join('; ')}`) : null,
      forecast.length ? (isSo ? `Dib u dalbo dhawaan: ${forecast.join('; ')}` : `Reorder soon: ${forecast.join('; ')}`) : null,
    ].filter(Boolean);
    return build(
      parts.length ? parts.join('. ') + '.' : (isSo ? 'Hadda alaab degdeg loo dalbanayo ma jirto.' : 'No urgent reorder items right now.'),
      [{ label: 'Create purchase', href: '/dashboard/purchase' }],
    );
  }

  if (/debt|owe|receivable/.test(q) || SO.debt.test(q)) {
    return build(
      isSo
        ? `Wadarta lacagta la sugayo: ${fmt(intel.metrics.receivables)}. ${intel.debtSummary.customersWithBalance} macaamiil ayaa hadhay.`
        : `Total receivables: ${fmt(intel.metrics.receivables)}. ${intel.debtSummary.customersWithBalance} customers have outstanding balances.`,
      [{ label: 'Debts', href: '/dashboard/debts' }],
    );
  }

  if (/health|score|status|check/.test(q) || SO.health.test(q)) {
    return build(
      isSo
        ? `Dhibcaha caafimaadka ganacsiga: ${intel.health.score}/100 (${intel.health.status}). ${intel.health.factors.map((f) => `${f.label}: ${Math.round(f.score)}`).join(' · ')}`
        : `Business health score: ${intel.health.score}/100 (${intel.health.status}). ${intel.health.factors.map((f) => `${f.label}: ${Math.round(f.score)}`).join(' · ')}`,
      [{ label: 'Intelligence hub', href: '/dashboard/intelligence' }],
    );
  }

  if (/compare|last month|growth|trend|increased|decreased/.test(q) || SO.growth.test(q) || SO.lastMonth.test(q)) {
    const g = intel.metrics.growthRate;
    return build(
      g === null
        ? (isSo ? 'Taariikh ku filan lama haysto si loo barbardhigo bilaha.' : 'Not enough history to compare months yet.')
        : isSo
          ? `Dakhligu waa ${g >= 0 ? 'kor u kacay' : 'hoos u dhacay'} ${Math.abs(g)}% marka la barbardhigo bisha hore (${fmt(intel.metrics.monthRevenue)} bishan). ${g >= 15 ? 'Koritaan xoog leh — fiirso in aad dib u buuxiso alaabta ugu iibka badan.' : ''}`
          : `Revenue is ${g >= 0 ? 'up' : 'down'} ${Math.abs(g)}% compared to last month (${fmt(intel.metrics.monthRevenue)} MTD). ${g >= 15 ? 'Strong growth — consider restocking top sellers.' : ''}`,
      [{ label: 'Reports', href: '/dashboard/reports' }],
    );
  }

  if (/expense|spending|spent/.test(q) || SO.expense.test(q)) {
    return build(
      isSo
        ? `Kharashaadka bishan ilaa hadda: ${fmt(intel.metrics.monthExpenses)}. Kharashka maanta: ${fmt(intel.briefing.summary.expenses)}.`
        : `Month-to-date expenses: ${fmt(intel.metrics.monthExpenses)}. Today's expenses: ${fmt(intel.briefing.summary.expenses)}.`,
      [{ label: 'Expenses', href: '/dashboard/expenses' }],
    );
  }

  return build(
    isSo
      ? `Waan kaa caawin karaa iibka, faa'iidada, bakhaarka, deymaha, macaamiisha, warbixinnada, iyo caafimaadka ganacsiga ee ${storeName}. Isku day: "Immisa ayaan maanta iibiyay?" ama "Samee warbixin toddobaadle."`
      : `I can help with sales, profit, inventory, debts, customers, reports, and business health for ${storeName}. Try: "How much did I sell today?" or "Generate a weekly report."`,
    [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Intelligence hub', href: '/dashboard/intelligence' },
    ],
  );
}

export function quickActionQuery(action: string): string {
  const map: Record<string, string> = {
    report: 'Generate a monthly business report',
    inventory: 'Analyze my inventory and low stock items',
    debts: 'Who owes me money and what are my receivables?',
    customers: 'Who are my best customers?',
    expenses: 'Analyze my expenses this month',
    health: 'Run a business health check',
  };
  return map[action] ?? action;
}

export function runQuickReport(
  kind: ReportKind,
  intel: StoreIntelligence,
  currency: string,
  storeName: string,
  locale?: CopilotLocale,
): CopilotResponse {
  const isSo = locale === 'so';
  return {
    answer: generateBusinessReport(kind, intel, currency, storeName, isSo ? 'so' : 'en'),
    actions: localizeActions([{ label: 'Export reports', href: '/dashboard/reports' }], isSo ? 'so' : 'en'),
    data: { reportKind: kind },
  };
}
