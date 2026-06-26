export type UserRole = 'owner' | 'manager' | 'cashier' | 'accountant' | 'purchase_officer';

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';
export type SubscriptionPlan = 'free_trial' | 'basic' | 'business' | 'enterprise';

export type PaymentMethod = 'cash' | 'bank' | 'waafi' | 'evc' | 'sahal' | 'zaad' | 'premier_wallet' | 'cheque' | 'credit' | 'split' | 'customer_deposit' | (string & {});

export type SaleStatus = 'draft' | 'completed' | 'void' | 'refunded' | 'partially_refunded' | 'held';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs';

export interface Store {
  id: string;
  name: string;
  slug?: string;
  email?: string;
  phone?: string;
  address?: string;
  logo_url?: string;
  cover_url?: string;
  currency: string;
  secondary_currency?: string;
  inventory_cost_method?: 'average' | 'fifo' | 'lifo';
  fiscal_year_start_month?: number;
  coa_number_prefix?: string;
  auto_create_payment_accounts?: boolean;
  default_cash_account_id?: string;
  default_revenue_account_id?: string;
  default_expense_account_id?: string;
  timezone: string;
  language: string;
  owner_id?: string;
  subscription_status: SubscriptionStatus;
  subscription_plan: SubscriptionPlan;
  trial_ends_at?: string;
  subscription_ends_at?: string;
  grace_period_ends_at?: string;
  is_active: boolean;
  tax_rate: number;
  invoice_prefix: string;
  invoice_counter: number;
  purchase_prefix?: string;
  purchase_counter?: number;
  business_mode?: 'retail_only' | 'wholesale_only' | 'wholesale_retail';
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StoreUser {
  id: string;
  store_id: string;
  user_id: string;
  role: UserRole;
  custom_permissions: Record<string, boolean>;
  is_active: boolean;
  invited_by?: string;
  invited_at?: string;
  last_active_at?: string;
  created_at: string;
  user?: UserProfile;
}

export interface UserProfile {
  id: string;
  full_name?: string;
  avatar_url?: string;
  phone?: string;
  preferred_language: string;
  current_store_id?: string;
  is_super_admin: boolean;
  created_at: string;
  updated_at: string;
  email?: string;
}

export interface ProductCategory {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  parent_id?: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface UnitType {
  id: string;
  store_id: string;
  code: string;
  name: string;
  unit_kind: 'base' | 'retail' | 'wholesale' | 'both';
  allows_decimal: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_type_id: string;
  conversion_factor: number;
  is_purchase_unit: boolean;
  is_default_sale: boolean;
  barcode?: string | null;
  retail_price?: number | null;
  wholesale_price?: number | null;
  distributor_price?: number | null;
  unit_type?: UnitType;
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  category_id?: string;
  brand?: string;
  unit: string;
  base_unit_id?: string;
  cost_price: number;
  selling_price: number;
  wholesale_price?: number;
  distributor_price?: number;
  tax_rate: number;
  is_taxable: boolean;
  track_inventory: boolean;
  stock_quantity: number;
  min_stock_level: number;
  reorder_point: number;
  image_url?: string;
  is_active: boolean;
  sales_mode?: 'retail' | 'wholesale' | 'both';
  variants: ProductVariant[];
  discount_type?: 'percentage' | 'fixed' | null;
  discount_value?: number | null;
  discount_start?: string | null;
  discount_end?: string | null;
  created_at: string;
  updated_at: string;
  category?: ProductCategory;
  product_images?: ProductImage[];
  product_units?: ProductUnit[];
  base_unit?: UnitType;
  /** Virtual: populated by get_store_active_discounts RPC */
  active_discount?: {
    source: 'product' | 'promotion';
    discount_type: 'percentage' | 'fixed';
    discount_value: number;
    promotion_id?: string;
    promotion_name?: string;
  } | null;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  price: number;
  stock: number;
  attributes: Record<string, string>;
}

export interface ProductImage {
  id: string;
  store_id: string;
  product_id: string;
  image_url: string;
  thumbnail_url?: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  store_id: string;
  full_name: string;
  phone?: string;
  payment_phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  credit_limit: number;
  balance: number;
  deposit_balance: number;
  total_purchases: number;
  price_tier?: 'retail' | 'wholesale' | 'distributor';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerDeposit {
  id: string;
  store_id: string;
  customer_id: string;
  amount: number;
  type: 'deposit' | 'used' | 'refund';
  payment_method?: string;
  sale_id?: string;
  reference?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
}

export interface CustomerAdvance {
  id: string;
  store_id: string;
  customer_id: string;
  original_amount: number;
  outstanding_balance: number;
  status: 'outstanding' | 'partial' | 'settled';
  payment_method: string;
  notes?: string;
  reference?: string;
  due_date?: string;
  created_by?: string;
  created_at: string;
  payments?: CustomerAdvancePayment[];
}

export interface CustomerAdvancePayment {
  id: string;
  store_id: string;
  advance_id: string;
  customer_id: string;
  amount: number;
  payment_method: string;
  notes?: string;
  reference?: string;
  created_by?: string;
  created_at: string;
}

export interface FundTransfer {
  id: string;
  store_id: string;
  from_method: string;
  to_method: string;
  amount: number;
  reference?: string;
  notes?: string;
  transfer_date: string;
  created_by?: string;
  created_by_email?: string;
  created_at: string;
}

export interface CustomerStatementEntry {
  id: string;
  date: string;
  type: 'sale_credit' | 'sale_paid' | 'payment' | 'deposit_add' | 'deposit_used' | 'deposit_refund' | 'advance' | 'advance_repayment';
  description: string;
  amount: number;
  reference?: string;
}

export interface Supplier {
  id: string;
  store_id: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  store_id: string;
  invoice_number: string;
  customer_id?: string;
  cashier_id: string;
  status: SaleStatus;
  subtotal: number;
  discount_amount: number;
  discount_type: 'fixed' | 'percentage';
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  credit_amount: number;
  payment_method: PaymentMethod;
  payment_details: PaymentDetail[];
  notes?: string;
  is_offline: boolean;
  offline_id?: string;
  sale_date: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  items?: SaleItem[];
  cashier?: UserProfile;
}

export interface PaymentDetail {
  method: PaymentMethod;
  amount: number;
  reference?: string;
  phone?: string;
}

export interface SaleItem {
  id: string;
  store_id: string;
  sale_id: string;
  product_id?: string;
  product_name: string;
  product_sku?: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  discount_amount: number;
  tax_amount: number;
  subtotal: number;
  sale_unit_id?: string;
  sale_unit_code?: string;
  sale_unit_qty?: number;
  base_qty?: number;
  returned_base_qty?: number;
  price_tier?: 'retail' | 'wholesale' | 'distributor';
  product?: Product;
}

export interface CartItem {
  line_key: string;
  product_id: string;
  product_name: string;
  product_sku?: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  image_url?: string;
  max_stock?: number;
  track_inventory: boolean;
  sale_unit_id?: string;
  sale_unit_code?: string;
  conversion_factor?: number;
  base_qty?: number;
  allows_decimal?: boolean;
  price_tier?: 'retail' | 'wholesale' | 'distributor';
}

export interface PurchaseOrder {
  id: string;
  store_id: string;
  po_number: string;
  supplier_id?: string;
  created_by: string;
  status: 'draft' | 'pending' | 'received' | 'partial' | 'cancelled';
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  notes?: string;
  expected_date?: string;
  due_date?: string;
  received_date?: string;
  created_at: string;
  updated_at: string;
  supplier?: Supplier;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  store_id: string;
  purchase_order_id: string;
  product_id?: string;
  product_name: string;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  subtotal: number;
  purchase_unit_id?: string;
  purchase_unit_code?: string;
  purchase_unit_qty?: number;
  base_qty?: number;
  product?: Product;
}

export interface StockMovement {
  id: string;
  store_id: string;
  product_id: string;
  movement_type: 'sale' | 'purchase' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'return';
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  reference_id?: string;
  reference_type?: string;
  reason?: string;
  created_by?: string;
  created_at: string;
  product?: Product;
}

export interface Account {
  id: string;
  store_id: string;
  code: string;
  name: string;
  description?: string;
  account_type: AccountType;
  parent_id?: string;
  is_system: boolean;
  is_protected?: boolean;
  is_postable?: boolean;
  system_role?: string;
  balance: number;
  is_active: boolean;
  archived_at?: string;
  created_at: string;
  updated_at: string;
  children?: Account[];
}

export interface StorePaymentMethod {
  id: string;
  store_id: string;
  slug: string;
  label: string;
  account_id: string;
  account_number?: string | null;
  account_name?: string | null;
  description?: string | null;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  account?: Account;
}

export interface JournalEntry {
  id: string;
  store_id: string;
  entry_number: string;
  entry_date: string;
  description?: string;
  reference_id?: string;
  reference_type?: string;
  is_auto: boolean;
  is_locked: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  store_id: string;
  journal_entry_id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  description?: string;
  account?: Account;
}

export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface Expense {
  id: string;
  store_id: string;
  account_id?: string;
  amount: number;
  description: string;
  category?: string;
  payment_method: string;
  reference?: string;
  expense_date: string;
  receipt_url?: string;
  status?: ExpenseStatus;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_by?: string;
  created_at: string;
  account?: Account;
}

export interface AccountingAuditLog {
  id: string;
  store_id: string;
  user_id?: string;
  entity_type: string;
  entity_id?: string;
  action: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  created_at: string;
}

export type PeriodStatus = 'open' | 'closed' | 'reopened';

export interface PeriodArchive {
  total_sales: number;
  total_purchases: number;
  total_expenses: number;
  gross_profit: number;
  net_profit: number;
  total_ar: number;
  total_ap: number;
  journal_count: number;
  archived_at: string;
}

export interface AccountingPeriod {
  id: string;
  store_id: string;
  name: string;
  period_start: string;
  period_end: string;
  is_closed: boolean;
  status: PeriodStatus;
  closed_at?: string;
  closed_by?: string;
  reopened_at?: string;
  reopen_reason?: string;
  notes?: string;
  created_at: string;
  archive?: PeriodArchive | null;
}

export interface ExchangeRate {
  id: string;
  store_id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  created_by?: string;
  created_at: string;
}

export interface InventoryCostLayer {
  id: string;
  store_id: string;
  product_id: string;
  quantity_remaining: number;
  unit_cost: number;
  received_at: string;
  source_type?: string;
  source_id?: string;
  product?: Product;
}

export interface ProductCostHistory {
  id: string;
  store_id: string;
  product_id: string;
  event_type: 'purchase' | 'opening_balance' | 'adjustment' | 'method_change';
  purchase_qty: number;
  purchase_unit_cost: number;
  quantity_before: number;
  quantity_after: number;
  previous_average_cost: number;
  new_average_cost: number;
  supplier_id?: string;
  purchase_reference?: string;
  purchase_order_id?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  supplier?: { name: string } | null;
}

export interface Employee {
  id: string;
  store_id: string;
  full_name: string;
  phone?: string;
  role_title?: string;
  base_salary: number;
  payment_method: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PayrollRun {
  id: string;
  store_id: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  status: 'draft' | 'paid' | 'cancelled';
  paid_at?: string;
  journal_entry_id?: string;
  created_by?: string;
  created_at: string;
  items?: PayrollItem[];
}

export interface PayrollItem {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  gross_pay: number;
  deductions: number;
  net_pay: number;
  notes?: string;
  employee?: Employee;
}

export interface DebtPayment {
  id: string;
  store_id: string;
  customer_id: string;
  sale_id?: string;
  amount: number;
  payment_method: string;
  notes?: string;
  payment_date: string;
  created_by?: string;
  created_at: string;
  customer?: Customer;
}

export interface SubscriptionPayment {
  id: string;
  store_id: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  payment_method: 'waafi' | 'evc' | 'sahal' | 'zaad';
  phone_number?: string;
  transaction_id?: string;
  status: 'pending' | 'success' | 'failed' | 'expired';
  duration_months: number;
  paid_at?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  store_id: string;
  user_id?: string;
  type: string;
  title: string;
  message?: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface DashboardStats {
  today_sales_count: number;
  today_sales_amount: number;
  today_expenses: number;
  today_profit: number;
  month_revenue: number;
  month_profit: number;
  total_receivables: number;
  total_payables: number;
  low_stock_count: number;
  recent_sales: Sale[];
  top_products: TopProduct[];
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  quantity_sold: number;
  revenue: number;
}

export interface ReportFilter {
  date_from: string;
  date_to: string;
  store_id?: string;
  category_id?: string;
  cashier_id?: string;
  customer_id?: string;
  payment_method?: PaymentMethod;
}

export interface Permission {
  module: string;
  actions: ('read' | 'write' | 'delete')[];
}

export const ROLE_PERMISSIONS: Record<UserRole, Record<string, string[]>> = {
  owner: {
    pos: ['read', 'write', 'delete'],
    inventory: ['read', 'write', 'delete'],
    customers: ['read', 'write', 'delete'],
    accounting: ['read', 'write', 'delete'],
    reports: ['read', 'write', 'delete'],
    billing: ['read', 'write', 'delete'],
    settings: ['read', 'write', 'delete'],
    users: ['read', 'write', 'delete'],
    suppliers: ['read', 'write', 'delete'],
    purchases: ['read', 'write', 'delete'],
    expenses: ['read', 'write', 'delete'],
    payroll: ['read', 'write', 'delete'],
  },
  manager: {
    pos: ['read', 'write'],
    inventory: ['read', 'write', 'delete'],
    customers: ['read', 'write', 'delete'],
    accounting: ['read'],
    reports: ['read'],
    billing: [],
    settings: [],
    users: [],
    suppliers: ['read', 'write'],
    purchases: ['read', 'write'],
  },
  cashier: {
    pos: ['read', 'write'],
    inventory: ['read'],
    customers: ['read', 'write'],
    accounting: [],
    reports: [],
    billing: [],
    settings: [],
    users: [],
    suppliers: [],
    purchases: [],
  },
  accountant: {
    pos: [],
    inventory: [],
    customers: ['read'],
    accounting: ['read', 'write', 'delete'],
    reports: ['read'],
    billing: [],
    settings: [],
    users: [],
    suppliers: ['read'],
    purchases: ['read'],
  },
  purchase_officer: {
    pos: [],
    inventory: ['read', 'write'],
    customers: [],
    accounting: ['read'],
    reports: [],
    billing: [],
    settings: [],
    users: [],
    suppliers: ['read', 'write', 'delete'],
    purchases: ['read', 'write', 'delete'],
  },
};

export function hasPermission(
  role: UserRole,
  module: string,
  action: string,
  customPermissions?: Record<string, unknown>
): boolean {
  // Store Owner has full access to every business module
  if (role === 'owner') return true;

  if (customPermissions?.[`${module}:${action}`] !== undefined) {
    return customPermissions[`${module}:${action}`] as boolean;
  }
  const rolePerms = ROLE_PERMISSIONS[role];
  if (!rolePerms) return false;
  const modulePerms = rolePerms[module] || [];
  return modulePerms.includes(action);
}

export const SUBSCRIPTION_PLANS = {
  free_trial: { name: 'Free Trial', price: 0, duration: 14 },
  basic: { name: 'Basic', price: 29, duration: 30 },
  business: { name: 'Business', price: 79, duration: 30 },
  enterprise: { name: 'Enterprise', price: 199, duration: 30 },
};

// ── Promotions & Discounts ────────────────────────────────────
export interface Promotion {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  applies_to: 'all' | 'category' | 'product';
  category_ids?: string[] | null;
  product_ids?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  priority: number;
  min_order_amount?: number | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export type PromotionStatus = 'active' | 'scheduled' | 'expired' | 'inactive';

export function getPromotionStatus(p: Promotion): PromotionStatus {
  if (!p.is_active) return 'inactive';
  const now = new Date();
  if (p.start_date && new Date(p.start_date) > now) return 'scheduled';
  if (p.end_date && new Date(p.end_date) < now) return 'expired';
  return 'active';
}

export interface ActiveDiscount {
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  source?: string;
  status?: string;
}

export function computeDiscountedPrice(
  originalPrice: number,
  discountTypeOrObj: 'percentage' | 'fixed' | ActiveDiscount,
  discountValue?: number
): { discountedPrice: number; discountAmount: number } {
  let dtype: 'percentage' | 'fixed';
  let dvalue: number;
  if (typeof discountTypeOrObj === 'object') {
    dtype = discountTypeOrObj.discount_type;
    dvalue = discountTypeOrObj.discount_value;
  } else {
    dtype = discountTypeOrObj;
    dvalue = discountValue ?? 0;
  }
  const discountAmount =
    dtype === 'percentage'
      ? (originalPrice * dvalue) / 100
      : Math.min(dvalue, originalPrice);
  return {
    discountedPrice: Math.max(0, originalPrice - discountAmount),
    discountAmount,
  };
}

// ── Invoice Settings ──────────────────────────────────────────
export type InvoiceTheme = 'blue' | 'green' | 'purple' | 'dark' | 'custom';
export type InvoiceLayout = 'a4' | 'receipt' | 'compact';

export interface InvoiceSettings {
  theme?: InvoiceTheme;
  custom_color?: string;
  footer_message?: string;
  terms_and_conditions?: string;
  tax_number?: string;
  show_tax?: boolean;
  show_discount?: boolean;
  show_sku?: boolean;
  show_logo?: boolean;
  show_product_images?: boolean;
  layout?: InvoiceLayout;
}

export const PAYMENT_METHODS_LABELS: Record<string, string> = {
  cash:             'Cash',
  bank:             'Bank',
  waafi:            'WAAFI',
  evc:              'EVC Plus',
  sahal:            'Sahal',
  zaad:             'Zaad',
  premier_wallet:   'Premier Wallet',
  cheque:           'Cheque',
  credit:           'Credit',
  split:            'Split Payment',
  customer_deposit: 'Customer Deposit',
};
