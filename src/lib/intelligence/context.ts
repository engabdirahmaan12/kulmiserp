import type { StoreIntelligence } from './types';

/** Compact JSON context for LLM — store-scoped only */
export function buildCopilotContext(
  intel: StoreIntelligence,
  storeName: string,
  currency: string,
  userName?: string,
): string {
  return JSON.stringify(
    {
      store: storeName,
      currency,
      user: userName ?? 'User',
      today: {
        sales: intel.briefing.summary.sales,
        profit: intel.briefing.summary.profit,
        expenses: intel.briefing.summary.expenses,
        transactions: intel.briefing.summary.transactionCount,
      },
      month: {
        revenue: intel.metrics.monthRevenue,
        expenses: intel.metrics.monthExpenses,
        profit: intel.metrics.monthProfit,
        growthPct: intel.metrics.growthRate,
      },
      health: {
        score: intel.health.score,
        status: intel.health.status,
        factors: intel.health.factors.map((f) => ({ label: f.label, score: Math.round(f.score) })),
      },
      inventory: {
        value: intel.metrics.inventoryValue,
        lowStockCount: intel.lowStockProducts.length,
        lowStock: intel.lowStockProducts.slice(0, 8),
        reorderSoon: intel.forecasts.slice(0, 6).map((f) => ({
          name: f.name,
          stock: f.currentStock,
          daysLeft: f.daysUntilStockout,
        })),
        deadStock: intel.deadStock.slice(0, 5).map((d) => d.name),
      },
      sales: {
        topProducts: intel.topProducts.slice(0, 8),
      },
      debts: {
        receivables: intel.metrics.receivables,
        payables: intel.metrics.payables,
        customersWithBalance: intel.debtSummary.customersWithBalance,
        overdueCount: intel.debtSummary.overdueCount,
        topDebtors: intel.debtSummary.topDebtors,
      },
      customers: {
        top: intel.customerSegments.slice(0, 8).map((c) => ({
          name: c.name,
          segment: c.segment,
          totalPurchases: c.totalPurchases,
          balance: c.balance,
        })),
      },
      recentPurchases: intel.recentPurchases.slice(0, 5),
      recommendations: intel.briefing.recommendations,
      alerts: intel.alerts.slice(0, 8).map((a) => ({ title: a.title, severity: a.severity })),
    },
    null,
    0,
  );
}
