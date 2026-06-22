export type CustomerSegment = 'vip' | 'regular' | 'new' | 'at_risk';

export interface StoreAlert {
  id: string;
  type: 'low_stock' | 'out_of_stock' | 'dead_stock' | 'overdue_debt' | 'expiring_subscription' | 'unpaid_invoice';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  metadata?: Record<string, unknown>;
}

export interface DeadStockItem {
  productId: string;
  name: string;
  stock: number;
  daysSinceLastSale: number;
  recommendation: 'discount' | 'promotion' | 'discontinue';
}

export interface ForecastItem {
  productId: string;
  name: string;
  currentStock: number;
  dailyVelocity: number;
  daysUntilStockout: number | null;
  suggestedReorderQty: number;
}

export interface PurchaseRecommendation {
  productId: string;
  name: string;
  reason: string;
  suggestedQty: number;
  priority: number;
}

export interface CustomerSegmentRow {
  id: string;
  name: string;
  segment: CustomerSegment;
  totalPurchases: number;
  balance: number;
  lastPurchaseDays: number | null;
}

export interface ActivityEvent {
  id: string;
  type: 'sale' | 'expense' | 'product' | 'purchase' | 'payment';
  title: string;
  subtitle?: string;
  amount?: number;
  at: string;
}

export interface BusinessHealth {
  score: number;
  status: 'critical' | 'fair' | 'good' | 'excellent';
  factors: { label: string; score: number; weight: number }[];
}

export interface DailyBriefing {
  greeting: string;
  summary: {
    sales: number;
    profit: number;
    expenses: number;
    newCustomers: number;
    transactionCount: number;
  };
  recommendations: string[];
  revenueChangePct: number | null;
}

export interface TopProductRow {
  name: string;
  quantity: number;
  revenue: number;
}

export interface LowStockRow {
  name: string;
  stock: number;
  minLevel: number;
}

export interface RecentPurchaseRow {
  poNumber: string;
  total: number;
  date: string;
  status: string;
}

export interface DebtSummary {
  customersWithBalance: number;
  overdueCount: number;
  topDebtors: { name: string; balance: number }[];
}

export interface StoreIntelligence {
  briefing: DailyBriefing;
  health: BusinessHealth;
  alerts: StoreAlert[];
  deadStock: DeadStockItem[];
  forecasts: ForecastItem[];
  purchaseRecommendations: PurchaseRecommendation[];
  customerSegments: CustomerSegmentRow[];
  activity: ActivityEvent[];
  topProducts: TopProductRow[];
  lowStockProducts: LowStockRow[];
  recentPurchases: RecentPurchaseRow[];
  debtSummary: DebtSummary;
  metrics: {
    monthRevenue: number;
    monthProfit: number;
    monthExpenses: number;
    cashBalance: number;
    inventoryValue: number;
    receivables: number;
    payables: number;
    growthRate: number | null;
  };
}

export type ReportKind =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'inventory'
  | 'debt'
  | 'profit'
  | 'health';

export interface CopilotResponse {
  answer: string;
  actions?: { label: string; href: string }[];
  data?: Record<string, unknown>;
}

export interface GlobalSearchResult {
  id: string;
  type: 'product' | 'customer' | 'supplier' | 'sale' | 'purchase' | 'expense';
  title: string;
  subtitle?: string;
  href: string;
}
