import type { BusinessHealth, DailyBriefing } from './types';

type Translator = (key: string, params?: Record<string, string | number>) => string;
const identityT: Translator = (key) => key;

/** Metrics already loaded by the main dashboard query — used while intelligence hydrates. */
export interface DashboardWidgetSnapshot {
  today_revenue: number;
  today_profit: number;
  today_expenses: number;
  month_revenue: number;
  month_expenses: number;
  month_profit: number;
  profit_margin: number;
  total_receivables: number;
  revenue_delta: number;
  low_stock_count: number;
}

function greetingForHour(hour: number, t: Translator): string {
  if (hour < 12) return t('dashboard.greetingMorning');
  if (hour < 17) return t('dashboard.greetingAfternoon');
  return t('dashboard.greetingEvening');
}

export function briefingFromSnapshot(
  snapshot: DashboardWidgetSnapshot,
  userName?: string,
  currency = 'USD',
  t: Translator = identityT,
): DailyBriefing {
  const firstName = userName?.split(' ')[0] ?? t('intel.there');
  const recommendations: string[] = [];

  if (snapshot.total_receivables > 0) {
    recommendations.push(
      t('intel.recFollowUpDebts', { amount: `${currency} ${Math.round(snapshot.total_receivables).toLocaleString()}` }),
    );
  }
  if (snapshot.revenue_delta > 0) {
    recommendations.push(t('intel.recSalesUpYesterday', { pct: snapshot.revenue_delta }));
  }
  if (snapshot.low_stock_count > 0) {
    recommendations.push(t('intel.recNeedRestock', { count: snapshot.low_stock_count }));
  }
  if (!recommendations.length) {
    recommendations.push(t('intel.recSmooth'));
  }

  return {
    greeting: t('intel.briefingGreeting', { greeting: greetingForHour(new Date().getHours(), t), name: firstName }),
    summary: {
      sales: snapshot.today_revenue,
      profit: snapshot.today_profit,
      expenses: snapshot.today_expenses,
      newCustomers: 0,
      transactionCount: 0,
    },
    recommendations,
    revenueChangePct: snapshot.revenue_delta,
  };
}

export function healthFromSnapshot(snapshot: DashboardWidgetSnapshot, t: Translator = identityT): BusinessHealth {
  const lowStockRatio = snapshot.low_stock_count > 0 ? Math.min(1, snapshot.low_stock_count / 10) : 0;
  const debtRatio = snapshot.month_revenue > 0 ? snapshot.total_receivables / snapshot.month_revenue : 0;
  const revenueGrowth = snapshot.revenue_delta;

  const factors = [
    {
      label: t('intel.factorRevenueGrowth'),
      score: revenueGrowth === 0 ? 70 : Math.min(100, Math.max(0, 50 + revenueGrowth)),
      weight: 0.25,
    },
    {
      label: t('intel.factorProfitability'),
      score: Math.min(100, Math.max(0, snapshot.profit_margin * 2)),
      weight: 0.25,
    },
    {
      label: t('intel.factorInventoryHealth'),
      score: Math.max(0, 100 - lowStockRatio * 100),
      weight: 0.2,
    },
    {
      label: t('intel.factorDebtRatio'),
      score: Math.max(0, 100 - debtRatio * 100),
      weight: 0.15,
    },
    {
      label: t('intel.factorCashFlow'),
      score: snapshot.month_profit >= 0 ? 90 : 40,
      weight: 0.15,
    },
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  const status =
    score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'critical';

  return { score, status, factors };
}
