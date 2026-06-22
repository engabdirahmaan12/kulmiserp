-- KULMIS ERP Initial Schema
-- Multi-tenant SaaS with complete tenant isolation via RLS

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- STORES (Tenants)
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  email TEXT,
  phone TEXT,
  address TEXT,
  logo_url TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'Africa/Mogadishu',
  language TEXT NOT NULL DEFAULT 'en',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_status TEXT NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'expired', 'suspended', 'cancelled')),
  subscription_plan TEXT DEFAULT 'free_trial' CHECK (subscription_plan IN ('free_trial', 'basic', 'business', 'enterprise')),
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  subscription_ends_at TIMESTAMPTZ,
  grace_period_ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  invoice_prefix TEXT DEFAULT 'INV',
  invoice_counter INTEGER DEFAULT 1,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STORE USERS (User <-> Store relationship with roles)
-- ============================================================
CREATE TABLE IF NOT EXISTS store_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('owner', 'manager', 'cashier', 'accountant', 'purchase_officer')),
  custom_permissions JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, user_id)
);

-- ============================================================
-- USER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  preferred_language TEXT DEFAULT 'en',
  current_store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  is_super_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRODUCT CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  color TEXT DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  barcode TEXT,
  category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  brand TEXT,
  unit TEXT DEFAULT 'piece',
  cost_price DECIMAL(15,2) DEFAULT 0,
  selling_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  is_taxable BOOLEAN DEFAULT false,
  track_inventory BOOLEAN DEFAULT true,
  stock_quantity DECIMAL(15,3) DEFAULT 0,
  min_stock_level DECIMAL(15,3) DEFAULT 0,
  reorder_point DECIMAL(15,3) DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  variants JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, sku)
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  credit_limit DECIMAL(15,2) DEFAULT 0,
  balance DECIMAL(15,2) DEFAULT 0,
  total_purchases DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  balance DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SALES / INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  cashier_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'void', 'refunded', 'held')),
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  discount_type TEXT DEFAULT 'fixed' CHECK (discount_type IN ('fixed', 'percentage')),
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(15,2) DEFAULT 0,
  change_amount DECIMAL(15,2) DEFAULT 0,
  credit_amount DECIMAL(15,2) DEFAULT 0,
  payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'waafi', 'evc', 'sahal', 'zaad', 'credit', 'split')),
  payment_details JSONB DEFAULT '[]',
  notes TEXT,
  is_offline BOOLEAN DEFAULT false,
  offline_id TEXT,
  synced_at TIMESTAMPTZ,
  sale_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, invoice_number)
);

-- ============================================================
-- SALE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  cost_price DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PURCHASE ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'received', 'partial', 'cancelled')),
  subtotal DECIMAL(15,2) DEFAULT 0,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  paid_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  expected_date DATE,
  received_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, po_number)
);

-- ============================================================
-- PURCHASE ORDER ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
  received_quantity DECIMAL(15,3) DEFAULT 0,
  unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STOCK MOVEMENTS (Audit trail for inventory)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'purchase', 'adjustment', 'transfer_in', 'transfer_out', 'return')),
  quantity_change DECIMAL(15,3) NOT NULL,
  quantity_before DECIMAL(15,3) NOT NULL,
  quantity_after DECIMAL(15,3) NOT NULL,
  reference_id UUID,
  reference_type TEXT,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHART OF ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'cogs')),
  parent_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_system BOOLEAN DEFAULT false,
  balance DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, code)
);

-- ============================================================
-- JOURNAL ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_number TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  reference_id UUID,
  reference_type TEXT,
  is_auto BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- JOURNAL LINES (Double-entry)
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit_amount DECIMAL(15,2) DEFAULT 0,
  credit_amount DECIMAL(15,2) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  account_id UUID REFERENCES chart_of_accounts(id),
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  category TEXT,
  payment_method TEXT DEFAULT 'cash',
  reference TEXT,
  expense_date DATE DEFAULT CURRENT_DATE,
  receipt_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DEBT PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SUBSCRIPTION PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('waafi', 'evc', 'sahal', 'zaad')),
  phone_number TEXT,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'expired')),
  duration_months INTEGER DEFAULT 1,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS / ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_store_users_store_id ON store_users(store_id);
CREATE INDEX IF NOT EXISTS idx_store_users_user_id ON store_users(user_id);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_store_id ON suppliers(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_store_id ON journal_entries(store_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal_id ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_store_id ON audit_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_notifications_store_id ON notifications(store_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's stores
CREATE OR REPLACE FUNCTION get_user_store_ids(p_user_id UUID)
RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT store_id FROM store_users 
    WHERE user_id = p_user_id AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if user belongs to a store
CREATE OR REPLACE FUNCTION user_has_store_access(p_user_id UUID, p_store_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM store_users 
    WHERE user_id = p_user_id AND store_id = p_store_id AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to get user role in store
CREATE OR REPLACE FUNCTION get_user_role_in_store(p_user_id UUID, p_store_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM store_users 
  WHERE user_id = p_user_id AND store_id = p_store_id AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- STORES RLS
CREATE POLICY "Users can view their own stores" ON stores
  FOR SELECT USING (user_has_store_access(auth.uid(), id) OR owner_id = auth.uid());

CREATE POLICY "Owner can update their store" ON stores
  FOR UPDATE USING (owner_id = auth.uid() OR get_user_role_in_store(auth.uid(), id) = 'owner');

CREATE POLICY "Anyone can insert stores" ON stores
  FOR INSERT WITH CHECK (true);

-- STORE USERS RLS
CREATE POLICY "Users can view store members" ON store_users
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Owners/managers can manage users" ON store_users
  FOR ALL USING (get_user_role_in_store(auth.uid(), store_id) IN ('owner', 'manager'));

CREATE POLICY "Users can see their own memberships" ON store_users
  FOR SELECT USING (user_id = auth.uid());

-- USER PROFILES RLS
CREATE POLICY "Users can view their own profile" ON user_profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can update their own profile" ON user_profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Users can insert their own profile" ON user_profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- Generic store-scoped RLS for all other tables
CREATE POLICY "Store members can access product_categories" ON product_categories
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access products" ON products
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access customers" ON customers
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access suppliers" ON suppliers
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access sales" ON sales
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access sale_items" ON sale_items
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access purchase_orders" ON purchase_orders
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access purchase_order_items" ON purchase_order_items
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access stock_movements" ON stock_movements
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access chart_of_accounts" ON chart_of_accounts
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access journal_entries" ON journal_entries
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access journal_lines" ON journal_lines
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access expenses" ON expenses
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access debt_payments" ON debt_payments
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access subscription_payments" ON subscription_payments
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access audit_logs" ON audit_logs
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "Store members can access notifications" ON notifications
  FOR ALL USING (user_has_store_access(auth.uid(), store_id) AND (user_id IS NULL OR user_id = auth.uid()));

-- ============================================================
-- DEFAULT CHART OF ACCOUNTS FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system) VALUES
  -- Assets
  (p_store_id, '1000', 'Current Assets', 'asset', true),
  (p_store_id, '1100', 'Cash and Cash Equivalents', 'asset', true),
  (p_store_id, '1110', 'Cash on Hand', 'asset', true),
  (p_store_id, '1120', 'WAAFI Account', 'asset', true),
  (p_store_id, '1130', 'EVC Account', 'asset', true),
  (p_store_id, '1140', 'Sahal Account', 'asset', true),
  (p_store_id, '1150', 'Zaad Account', 'asset', true),
  (p_store_id, '1200', 'Accounts Receivable', 'asset', true),
  (p_store_id, '1300', 'Inventory', 'asset', true),
  (p_store_id, '2000', 'Current Liabilities', 'liability', true),
  (p_store_id, '2100', 'Accounts Payable', 'liability', true),
  (p_store_id, '2200', 'Tax Payable', 'liability', true),
  (p_store_id, '3000', 'Owner Equity', 'equity', true),
  (p_store_id, '3100', 'Capital', 'equity', true),
  (p_store_id, '3200', 'Retained Earnings', 'equity', true),
  (p_store_id, '4000', 'Revenue', 'revenue', true),
  (p_store_id, '4100', 'Sales Revenue', 'revenue', true),
  (p_store_id, '5000', 'Cost of Goods Sold', 'cogs', true),
  (p_store_id, '5100', 'COGS - Products', 'cogs', true),
  (p_store_id, '6000', 'Operating Expenses', 'expense', true),
  (p_store_id, '6100', 'Rent Expense', 'expense', true),
  (p_store_id, '6200', 'Utilities Expense', 'expense', true),
  (p_store_id, '6300', 'Salaries Expense', 'expense', true),
  (p_store_id, '6400', 'Marketing Expense', 'expense', true),
  (p_store_id, '6500', 'Miscellaneous Expense', 'expense', true)
  ON CONFLICT (store_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- BILLING PAYMENTS (Somali payment gateways)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL CHECK (gateway IN ('waafi', 'evc', 'sahal', 'zaad')),
  phone_number TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  plan TEXT NOT NULL,
  months INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  transaction_ref TEXT UNIQUE,
  gateway_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_payments_owner_select" ON billing_payments
  FOR SELECT USING (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
    OR
    store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND role IN ('owner', 'manager'))
  );

CREATE POLICY "billing_payments_owner_insert" ON billing_payments
  FOR INSERT WITH CHECK (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
    OR
    store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND role IN ('owner'))
  );

-- ============================================================
-- ATOMIC STOCK DEDUCTION FOR SALES
-- ============================================================
CREATE OR REPLACE FUNCTION process_sale_stock(
  p_store_id UUID,
  p_sale_id UUID,
  p_items JSONB,
  p_cashier_id UUID
) RETURNS JSONB AS $$
DECLARE
  item RECORD;
  v_product RECORD;
  v_result JSONB := '{"success": true, "errors": []}'::JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL)
  LOOP
    SELECT * INTO v_product FROM products 
    WHERE id = item.product_id AND store_id = p_store_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
      v_result := jsonb_set(v_result, '{success}', 'false');
      v_result := jsonb_set(v_result, '{errors}', v_result->'errors' || jsonb_build_array('Product not found'));
      CONTINUE;
    END IF;
    
    IF v_product.track_inventory AND v_product.stock_quantity < item.quantity THEN
      v_result := jsonb_set(v_result, '{success}', 'false');
      v_result := jsonb_set(v_result, '{errors}', v_result->'errors' || jsonb_build_array(format('Insufficient stock for %s', v_product.name)));
      CONTINUE;
    END IF;
    
    IF v_product.track_inventory THEN
      INSERT INTO stock_movements (
        store_id, product_id, movement_type, quantity_change,
        quantity_before, quantity_after, reference_id, reference_type, created_by
      ) VALUES (
        p_store_id, item.product_id, 'sale', -item.quantity,
        v_product.stock_quantity, v_product.stock_quantity - item.quantity,
        p_sale_id, 'sale', p_cashier_id
      );
      
      UPDATE products 
      SET stock_quantity = stock_quantity - item.quantity, updated_at = NOW()
      WHERE id = item.product_id AND store_id = p_store_id;
    END IF;
  END LOOP;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
