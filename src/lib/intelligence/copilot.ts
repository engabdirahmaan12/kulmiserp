import type { CopilotResponse, ReportKind, StoreIntelligence } from './types';
import { generateBusinessReport, reportKindFromQuery } from './reports';

export function answerCopilotQuery(
  query: string,
  intel: StoreIntelligence,
  currency: string,
  storeName = 'Store',
): CopilotResponse {
  const q = query.toLowerCase().trim();
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  const reportKind = reportKindFromQuery(q);
  if (reportKind) {
    return {
      answer: generateBusinessReport(reportKind, intel, currency, storeName),
      actions: [{ label: 'Full reports', href: '/dashboard/reports' }],
      data: { reportKind },
    };
  }

  if (/inventory value|stock value|how much inventory/.test(q)) {
    return {
      answer: `Total inventory value at cost: ${fmt(intel.metrics.inventoryValue)}. ${intel.lowStockProducts.length} products are low or out of stock.`,
      actions: [
        { label: 'Inventory', href: '/dashboard/inventory' },
        { label: 'Valuation', href: '/dashboard/accounting' },
      ],
    };
  }

  if (/best customer|top customer/.test(q)) {
    const top = intel.customerSegments.slice(0, 5);
    const list = top.map((c) => `${c.name} (${fmt(c.totalPurchases)})`).join(', ');
    return {
      answer: top.length
        ? `Top customers by lifetime purchases: ${list}.`
        : 'No customer purchase history yet.',
      actions: [{ label: 'Customers', href: '/dashboard/customers' }],
    };
  }

  if (/predict|shortage|run out|stockout/.test(q)) {
    const items = intel.forecasts.slice(0, 5).map((f) => {
      const days = f.daysUntilStockout;
      return days !== null ? `${f.name} (~${days} days)` : f.name;
    });
    return {
      answer: items.length
        ? `Stock shortage risk: ${items.join('; ')}.`
        : 'No imminent stock shortages detected from recent sales velocity.',
      actions: [{ label: 'Create purchase', href: '/dashboard/purchase' }],
    };
  }

  if (/purchase|bought|supplier/.test(q) && /recent|last|today/.test(q)) {
    const list = intel.recentPurchases
      .slice(0, 4)
      .map((p) => `${p.poNumber} (${fmt(p.total)}, ${p.status})`)
      .join('; ');
    return {
      answer: list ? `Recent purchases: ${list}.` : 'No recent purchase orders.',
      actions: [{ label: 'Purchases', href: '/dashboard/purchase-history' }],
    };
  }

  if (/who owes|owe me|outstanding|pending debt/.test(q)) {
    const debtors = intel.debtSummary.topDebtors
      .slice(0, 4)
      .map((d) => `${d.name} (${fmt(d.balance)})`)
      .join(', ');
    return {
      answer: intel.debtSummary.customersWithBalance
        ? `${intel.debtSummary.customersWithBalance} customers owe a total of ${fmt(intel.metrics.receivables)}.${debtors ? ` Top: ${debtors}.` : ''}`
        : 'No outstanding customer balances.',
      actions: [{ label: 'Debts', href: '/dashboard/debts' }],
    };
  }

  if (/sell today|sales today|how much.*today/.test(q)) {
    return {
      answer: `Today's sales: ${fmt(intel.briefing.summary.sales)} across ${intel.briefing.summary.transactionCount} transactions. Estimated profit: ${fmt(intel.briefing.summary.profit)}.`,
      actions: [{ label: 'Sales history', href: '/dashboard/sales-history' }],
    };
  }

  if (/profit|margin|earn/.test(q) && /month|mtd|this/.test(q)) {
    return {
      answer: `This month net profit is ${fmt(intel.metrics.monthProfit)} on ${fmt(intel.metrics.monthRevenue)} revenue and ${fmt(intel.metrics.monthExpenses)} expenses.`,
      actions: [{ label: 'View P&L', href: '/dashboard/accounting' }, { label: 'Reports', href: '/dashboard/reports' }],
    };
  }

  if (/profit|sales|revenue/.test(q) && /today|daily/.test(q)) {
    return {
      answer: `Today's sales: ${fmt(intel.briefing.summary.sales)}. Estimated profit today: ${fmt(intel.briefing.summary.profit)}.`,
      actions: [{ label: 'Dashboard', href: '/dashboard' }],
    };
  }

  if (/best|top|perform/.test(q) && /product/.test(q)) {
    const top = intel.topProducts.slice(0, 5);
    const list = top.map((p) => `${p.name} (${fmt(p.revenue)})`).join(', ');
    return {
      answer: top.length
        ? `Best-selling products: ${list}.`
        : 'Not enough sales data yet to rank products.',
      actions: [{ label: 'Inventory', href: '/dashboard/inventory' }],
    };
  }

  if (/losing|loss|dead|slow/.test(q)) {
    const dead = intel.deadStock.slice(0, 3).map((d) => d.name).join(', ');
    return {
      answer: dead
        ? `Slow or dead stock: ${dead}. Consider discounts or promotions.`
        : 'No significant dead stock detected in the last 30+ days.',
      actions: [{ label: 'Intelligence hub', href: '/dashboard/intelligence' }],
    };
  }

  if (/reorder|restock|stock|low/.test(q)) {
    const items = intel.lowStockProducts.slice(0, 5).map((p) => `${p.name} (${p.stock} left)`);
    const forecast = intel.forecasts.slice(0, 3).map((f) => `${f.name} (~${f.daysUntilStockout ?? '?'} days)`);
    const parts = [
      items.length ? `Low stock: ${items.join('; ')}` : null,
      forecast.length ? `Reorder soon: ${forecast.join('; ')}` : null,
    ].filter(Boolean);
    return {
      answer: parts.length ? parts.join('. ') + '.' : 'No urgent reorder items right now.',
      actions: [{ label: 'Create purchase', href: '/dashboard/purchase' }],
    };
  }

  if (/debt|owe|receivable/.test(q)) {
    return {
      answer: `Total receivables: ${fmt(intel.metrics.receivables)}. ${intel.debtSummary.customersWithBalance} customers have outstanding balances.`,
      actions: [{ label: 'Debts', href: '/dashboard/debts' }],
    };
  }

  if (/health|score|status|check/.test(q)) {
    return {
      answer: `Business health score: ${intel.health.score}/100 (${intel.health.status}). ${intel.health.factors.map((f) => `${f.label}: ${Math.round(f.score)}`).join(' · ')}`,
      actions: [{ label: 'Intelligence hub', href: '/dashboard/intelligence' }],
    };
  }

  if (/compare|last month|growth|trend|increased|decreased/.test(q)) {
    const g = intel.metrics.growthRate;
    return {
      answer: g === null
        ? 'Not enough history to compare months yet.'
        : `Revenue is ${g >= 0 ? 'up' : 'down'} ${Math.abs(g)}% compared to last month (${fmt(intel.metrics.monthRevenue)} MTD). ${g >= 15 ? 'Strong growth — consider restocking top sellers.' : ''}`,
      actions: [{ label: 'Reports', href: '/dashboard/reports' }],
    };
  }

  if (/expense|spending|spent/.test(q)) {
    return {
      answer: `Month-to-date expenses: ${fmt(intel.metrics.monthExpenses)}. Today's expenses: ${fmt(intel.briefing.summary.expenses)}.`,
      actions: [{ label: 'Expenses', href: '/dashboard/expenses' }],
    };
  }

  return {
    answer: `I can help with sales, profit, inventory, debts, customers, reports, and business health for ${storeName}. Try: "How much did I sell today?" or "Generate a weekly report."`,
    actions: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Intelligence hub', href: '/dashboard/intelligence' },
    ],
  };
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
): CopilotResponse {
  return {
    answer: generateBusinessReport(kind, intel, currency, storeName),
    actions: [{ label: 'Export reports', href: '/dashboard/reports' }],
    data: { reportKind: kind },
  };
}
