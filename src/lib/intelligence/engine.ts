import { createClient } from '@/lib/supabase/client';
import type { Store } from '@/types';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { fetchStoreAlerts } from './alerts';
import { saleItemCogs } from '@/lib/sales/cogs';
import type {
  ActivityEvent,
  BusinessHealth,
  CustomerSegment,
  CustomerSegmentRow,
  DailyBriefing,
  DeadStockItem,
  ForecastItem,
  PurchaseRecommendation,
  StoreIntelligence,
} from './types';

function healthStatus(score: number): BusinessHealth['status'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'critical';
}

/** Optional translator threaded from the UI so generated insight text is localized. */
export type IntelTranslator = (key: string, params?: Record<string, string | number>) => string;
const identityT: IntelTranslator = (key) => key;

function computeHealth(params: {
  revenueGrowth: number | null;
  profitMargin: number;
  lowStockRatio: number;
  debtRatio: number;
  cashFlowPositive: boolean;
}, t: IntelTranslator = identityT): BusinessHealth {
  const factors = [
    { label: t('intel.factorRevenueGrowth'), score: params.revenueGrowth === null ? 70 : Math.min(100, Math.max(0, 50 + params.revenueGrowth)), weight: 0.25 },
    { label: t('intel.factorProfitability'), score: Math.min(100, Math.max(0, params.profitMargin * 2)), weight: 0.25 },
    { label: t('intel.factorInventoryHealth'), score: Math.max(0, 100 - params.lowStockRatio * 100), weight: 0.2 },
    { label: t('intel.factorDebtRatio'), score: Math.max(0, 100 - params.debtRatio * 100), weight: 0.15 },
    { label: t('intel.factorCashFlow'), score: params.cashFlowPositive ? 90 : 40, weight: 0.15 },
  ];
  const score = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  return { score, status: healthStatus(score), factors };
}

function segmentCustomer(
  totalPurchases: number,
  createdAt: string,
  lastPurchaseDays: number | null,
  avgSpend: number,
): CustomerSegment {
  const daysSinceJoin = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (daysSinceJoin <= 30 && totalPurchases < avgSpend * 2) return 'new';
  if (lastPurchaseDays !== null && lastPurchaseDays > 60) return 'at_risk';
  if (totalPurchases >= avgSpend * 3) return 'vip';
  return 'regular';
}

export async function fetchStoreIntelligence(store: Store, userName?: string, t: IntelTranslator = identityT): Promise<StoreIntelligence> {
  const supabase = createClient();
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

  const [
    todaySalesRes, monthSalesRes, lastMonthSalesRes,
    todayExpRes, monthExpRes,
    customersRes, productsRes, saleItemsRes,
    suppliersRes, recentSalesRes, recentExpRes,
    accountsRes, newCustomersRes, recentPurchasesRes,
  ] = await Promise.all([
    supabase.from('sales').select('total_amount, id').eq('store_id', store.id).eq('status', 'completed').gte('sale_date', today),
    supabase.from('sales').select('total_amount').eq('store_id', store.id).eq('status', 'completed').gte('sale_date', monthStart),
    supabase.from('sales').select('total_amount').eq('store_id', store.id).eq('status', 'completed').gte('sale_date', lastMonthStart).lte('sale_date', lastMonthEnd),
    supabase.from('expenses').select('amount').eq('store_id', store.id).gte('expense_date', today),
    supabase.from('expenses').select('amount').eq('store_id', store.id).gte('expense_date', monthStart),
    supabase.from('customers').select('id, full_name, total_purchases, balance, created_at').eq('store_id', store.id).eq('is_active', true),
    supabase.from('products').select('id, name, stock_quantity, min_stock_level, cost_price, track_inventory').eq('store_id', store.id).eq('is_active', true),
    supabase.from('sale_items').select('product_id, product_name, quantity, base_qty, sale_unit_qty, subtotal, cost_price, sale:sales(sale_date, status)').eq('store_id', store.id).limit(5000),
    supabase.from('suppliers').select('balance').eq('store_id', store.id),
    supabase.from('sales').select('id, invoice_number, total_amount, sale_date').eq('store_id', store.id).eq('status', 'completed').order('sale_date', { ascending: false }).limit(15),
    supabase.from('expenses').select('id, description, amount, expense_date').eq('store_id', store.id).order('expense_date', { ascending: false }).limit(10),
    supabase.from('chart_of_accounts').select('code, balance').eq('store_id', store.id).eq('is_active', true),
    supabase.from('customers').select('id').eq('store_id', store.id).gte('created_at', today),
    supabase
      .from('purchase_orders')
      .select('po_number, total_amount, status, created_at')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const todaySales = (todaySalesRes.data ?? []).reduce((s, r) => s + r.total_amount, 0);
  const monthRevenue = (monthSalesRes.data ?? []).reduce((s, r) => s + r.total_amount, 0);
  const lastMonthRevenue = (lastMonthSalesRes.data ?? []).reduce((s, r) => s + r.total_amount, 0);
  const todayExpenses = (todayExpRes.data ?? []).reduce((s, r) => s + r.amount, 0);
  const monthExpenses = (monthExpRes.data ?? []).reduce((s, r) => s + r.amount, 0);

  const todayCogs = (saleItemsRes.data ?? []).reduce((s, item) => {
    const sale = item.sale as { sale_date?: string; status?: string } | null;
    if (!sale || sale.status !== 'completed') return s;
    const d = sale.sale_date?.split('T')[0];
    if (d !== today) return s;
    return s + saleItemCogs(item);
  }, 0);
  const monthCogs = (saleItemsRes.data ?? []).reduce((s, item) => {
    const sale = item.sale as { sale_date?: string; status?: string } | null;
    if (!sale || sale.status !== 'completed') return s;
    const d = sale.sale_date?.split('T')[0];
    if (!d || d < monthStart) return s;
    return s + saleItemCogs(item);
  }, 0);
  const monthProfit = monthRevenue - monthCogs - monthExpenses;

  const customers = customersRes.data ?? [];
  const products = productsRes.data ?? [];
  const saleItems = saleItemsRes.data ?? [];
  const accounts = accountsRes.data ?? [];

  const cashBalance = accounts
    .filter((a) => ['1110', '1120', '1130', '1140', '1150', '1160', '1165', '1170'].includes(a.code))
    .reduce((s, a) => s + (a.balance ?? 0), 0);
  const receivables = accounts.find((a) => a.code === '1200')?.balance ?? customers.reduce((s, c) => s + (c.balance ?? 0), 0);
  const payables = accounts.find((a) => a.code === '2100')?.balance ?? (suppliersRes.data ?? []).reduce((s, r) => s + (r.balance ?? 0), 0);
  const inventoryValue = products
    .filter((p) => p.track_inventory)
    .reduce((s, p) => s + (p.stock_quantity ?? 0) * (p.cost_price ?? 0), 0);

  const growthRate = lastMonthRevenue > 0
    ? Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
    : monthRevenue > 0 ? 100 : null;

  const velocityMap = new Map<string, { qty: number; lastSale: Date | null }>();
  const productSales = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const item of saleItems) {
    const sale = item.sale as { sale_date?: string; status?: string } | null;
    if (!sale || sale.status !== 'completed') continue;
    const pid = item.product_id ?? item.product_name;
    const cur = velocityMap.get(pid) ?? { qty: 0, lastSale: null };
    cur.qty += Number(item.base_qty ?? item.quantity ?? 0);
    const d = sale.sale_date ? new Date(sale.sale_date) : null;
    if (d && (!cur.lastSale || d > cur.lastSale)) cur.lastSale = d;
    velocityMap.set(pid, cur);

    const salesRow = productSales.get(pid) ?? {
      name: item.product_name ?? 'Unknown',
      quantity: 0,
      revenue: 0,
    };
    salesRow.quantity += Number(item.base_qty ?? item.quantity ?? 0);
    salesRow.revenue += item.subtotal ?? 0;
    productSales.set(pid, salesRow);
  }

  const topProducts = [...productSales.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const trackedProducts = products.filter((p) => p.track_inventory);
  const lowStockProducts = trackedProducts
    .filter((p) => (p.stock_quantity ?? 0) <= (p.min_stock_level ?? 0))
    .map((p) => ({
      name: p.name,
      stock: p.stock_quantity ?? 0,
      minLevel: p.min_stock_level ?? 0,
    }))
    .slice(0, 12);
  const lowStockCount = lowStockProducts.length;
  const lowStockRatio = trackedProducts.length ? lowStockCount / trackedProducts.length : 0;

  const deadStock: DeadStockItem[] = products
    .filter((p) => p.track_inventory && (p.stock_quantity ?? 0) > 0)
    .map((p) => {
      const v = velocityMap.get(p.id);
      const daysSince = v?.lastSale
        ? Math.floor((now.getTime() - v.lastSale.getTime()) / 86400000)
        : 999;
      return {
        productId: p.id,
        name: p.name,
        stock: p.stock_quantity ?? 0,
        daysSinceLastSale: daysSince,
        recommendation: (daysSince >= 90 ? 'discontinue' : daysSince >= 60 ? 'promotion' : 'discount') as DeadStockItem['recommendation'],
      };
    })
    .filter((p) => p.daysSinceLastSale >= 30)
    .sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale)
    .slice(0, 10);

  const forecasts: ForecastItem[] = trackedProducts
    .map((p) => {
      const v = velocityMap.get(p.id);
      const dailyVelocity = (v?.qty ?? 0) / 30;
      const stock = p.stock_quantity ?? 0;
      const daysUntilStockout = dailyVelocity > 0 ? Math.floor(stock / dailyVelocity) : null;
      return {
        productId: p.id,
        name: p.name,
        currentStock: stock,
        dailyVelocity,
        daysUntilStockout,
        suggestedReorderQty: dailyVelocity > 0 ? Math.ceil(dailyVelocity * 30) : 0,
      };
    })
    .filter((f) => f.dailyVelocity > 0 && (f.daysUntilStockout === null || f.daysUntilStockout <= 21))
    .sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999))
    .slice(0, 10);

  const purchaseRecommendations: PurchaseRecommendation[] = forecasts.map((f, i) => ({
    productId: f.productId,
    name: f.name,
    reason: f.daysUntilStockout !== null ? `Runs out in ~${f.daysUntilStockout} days` : 'Maintain stock levels',
    suggestedQty: f.suggestedReorderQty,
    priority: 10 - i,
  }));

  const avgSpend = customers.length
    ? customers.reduce((s, c) => s + (c.total_purchases ?? 0), 0) / customers.length
    : 0;

  const customerSegments: CustomerSegmentRow[] = customers
    .map((c) => ({
      id: c.id,
      name: c.full_name,
      segment: segmentCustomer(c.total_purchases ?? 0, c.created_at, null, avgSpend),
      totalPurchases: c.total_purchases ?? 0,
      balance: c.balance ?? 0,
      lastPurchaseDays: null,
    }))
    .sort((a, b) => b.totalPurchases - a.totalPurchases)
    .slice(0, 50);

  const hour = now.getHours();
  const greeting = hour < 12 ? t('dashboard.greetingMorning') : hour < 17 ? t('dashboard.greetingAfternoon') : t('dashboard.greetingEvening');
  const firstName = userName?.split(' ')[0] ?? t('intel.there');

  const recommendations: string[] = [];
  if (forecasts[0]) recommendations.push(t('intel.recRestock', { name: forecasts[0].name }));
  if (receivables > 0) recommendations.push(t('intel.recFollowUpDebts', { amount: `${store.currency ?? 'USD'} ${receivables.toFixed(0)}` }));
  if (growthRate !== null && growthRate > 0) recommendations.push(t('intel.recRevenueUp', { pct: growthRate }));
  if (deadStock[0]) recommendations.push(t('intel.recReviewSlowMover', { name: deadStock[0].name }));
  if (!recommendations.length) recommendations.push(t('intel.recSmooth'));

  const briefing: DailyBriefing = {
    greeting: t('intel.briefingGreeting', { greeting, name: firstName }),
    summary: {
      sales: todaySales,
      profit: todaySales - todayCogs - todayExpenses,
      expenses: todayExpenses,
      newCustomers: newCustomersRes.data?.length ?? 0,
      transactionCount: todaySalesRes.data?.length ?? 0,
    },
    recommendations,
    revenueChangePct: growthRate,
  };

  const health = computeHealth({
    revenueGrowth: growthRate,
    profitMargin: monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0,
    lowStockRatio,
    debtRatio: monthRevenue > 0 ? receivables / monthRevenue : 0,
    cashFlowPositive: monthProfit >= 0,
  }, t);

  const activity: ActivityEvent[] = [
    ...(recentSalesRes.data ?? []).map((s) => ({
      id: `sale_${s.id}`,
      type: 'sale' as const,
      title: `Invoice ${s.invoice_number} completed`,
      amount: s.total_amount,
      at: s.sale_date,
    })),
    ...(recentExpRes.data ?? []).map((e) => ({
      id: `exp_${e.id}`,
      type: 'expense' as const,
      title: e.description || 'Expense recorded',
      amount: e.amount,
      at: e.expense_date,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20);

  const alerts = await fetchStoreAlerts(store);

  const recentPurchases = (recentPurchasesRes.data ?? []).map((po) => ({
    poNumber: po.po_number,
    total: po.total_amount ?? 0,
    date: po.created_at?.split('T')[0] ?? '',
    status: po.status ?? 'draft',
  }));

  const debtSummary = {
    customersWithBalance: customers.filter((c) => (c.balance ?? 0) > 0).length,
    overdueCount: alerts.filter((a) => a.type === 'overdue_debt' && a.severity === 'error').length,
    topDebtors: customers
      .filter((c) => (c.balance ?? 0) > 0)
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
      .slice(0, 5)
      .map((c) => ({ name: c.full_name, balance: c.balance ?? 0 })),
  };

  return {
    briefing,
    health,
    alerts,
    deadStock,
    forecasts,
    purchaseRecommendations,
    customerSegments,
    activity,
    topProducts,
    lowStockProducts,
    recentPurchases,
    debtSummary,
    metrics: {
      monthRevenue,
      monthProfit,
      monthExpenses,
      cashBalance,
      inventoryValue,
      receivables,
      payables,
      growthRate,
    },
  };
}
