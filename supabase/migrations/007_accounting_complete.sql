-- KULMIS ERP: audit logs, tax payable, FIFO, multi-currency, payroll,
-- account CRUD, period close, expense approval, bank accounts

-- ============================================================
-- SCHEMA
-- ============================================================
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS secondary_currency TEXT,
  ADD COLUMN IF NOT EXISTS inventory_cost_method TEXT DEFAULT 'average'
    CHECK (inventory_cost_method IN ('average', 'fifo'));

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE TABLE IF NOT EXISTS accounting_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_closed BOOLEAN DEFAULT false,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (store_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate DECIMAL(18,6) NOT NULL CHECK (rate > 0),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_cost_layers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_remaining DECIMAL(15,3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  source_type TEXT,
  source_id UUID
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role_title TEXT,
  base_salary DECIMAL(15,2) DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_amount DECIMAL(15,2) DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'paid', 'cancelled')),
  paid_at TIMESTAMPTZ,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  gross_pay DECIMAL(15,2) NOT NULL DEFAULT 0,
  deductions DECIMAL(15,2) DEFAULT 0,
  net_pay DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_store ON accounting_audit_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_layers_product ON inventory_cost_layers(store_id, product_id, received_at);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_store ON exchange_rates(store_id, effective_date DESC);

ALTER TABLE accounting_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_cost_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Store members can access accounting_audit_logs" ON accounting_audit_logs
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));
CREATE POLICY "Store members can access accounting_periods" ON accounting_periods
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));
CREATE POLICY "Store members can access exchange_rates" ON exchange_rates
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));
CREATE POLICY "Store members can access inventory_cost_layers" ON inventory_cost_layers
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));
CREATE POLICY "Store members can access employees" ON employees
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));
CREATE POLICY "Store members can access payroll_runs" ON payroll_runs
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));
CREATE POLICY "Store members can access payroll_items" ON payroll_items
  FOR ALL USING (
    payroll_run_id IN (SELECT id FROM payroll_runs WHERE user_has_store_access(auth.uid(), store_id))
  );

-- ============================================================
-- Bank accounts in default COA + backfill existing stores
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system) VALUES
  (p_store_id, '1000', 'Current Assets', 'asset', true),
  (p_store_id, '1100', 'Cash and Cash Equivalents', 'asset', true),
  (p_store_id, '1110', 'Cash on Hand', 'asset', true),
  (p_store_id, '1120', 'WAAFI Account', 'asset', true),
  (p_store_id, '1130', 'EVC Account', 'asset', true),
  (p_store_id, '1140', 'Sahal Account', 'asset', true),
  (p_store_id, '1150', 'Zaad Account', 'asset', true),
  (p_store_id, '1160', 'Salaam Bank', 'asset', true),
  (p_store_id, '1165', 'Premier Bank', 'asset', true),
  (p_store_id, '1170', 'Dahabshiil Bank', 'asset', true),
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

INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system)
SELECT s.id, v.code, v.name, 'asset', true
FROM stores s
CROSS JOIN (VALUES
  ('1160', 'Salaam Bank'),
  ('1165', 'Premier Bank'),
  ('1170', 'Dahabshiil Bank')
) AS v(code, name)
ON CONFLICT (store_id, code) DO NOTHING;

-- ============================================================
-- Payment method mapping (includes bank accounts)
-- ============================================================
CREATE OR REPLACE FUNCTION payment_method_account_code(p_method TEXT)
RETURNS TEXT AS $$
BEGIN
  CASE p_method
    WHEN 'waafi' THEN RETURN '1120';
    WHEN 'evc' THEN RETURN '1130';
    WHEN 'sahal' THEN RETURN '1140';
    WHEN 'zaad' THEN RETURN '1150';
    WHEN 'salaam' THEN RETURN '1160';
    WHEN 'premier' THEN RETURN '1165';
    WHEN 'dahabshiil' THEN RETURN '1170';
    WHEN 'credit' THEN RETURN '1200';
    ELSE RETURN '1110';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- Audit logging helper
-- ============================================================
CREATE OR REPLACE FUNCTION log_accounting_audit(
  p_store_id UUID,
  p_user_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_action TEXT,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO accounting_audit_logs (store_id, user_id, entity_type, entity_id, action, old_values, new_values)
  VALUES (p_store_id, p_user_id, p_entity_type, p_entity_id, p_action, p_old_values, p_new_values);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Period lock check
-- ============================================================
CREATE OR REPLACE FUNCTION assert_period_open(p_store_id UUID, p_entry_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE store_id = p_store_id
      AND is_closed = true
      AND p_entry_date BETWEEN period_start AND period_end
  ) THEN
    RAISE EXCEPTION 'Accounting period is closed for date %', p_entry_date;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- FIFO cost consumption
-- ============================================================
CREATE OR REPLACE FUNCTION consume_fifo_cost(
  p_store_id UUID,
  p_product_id UUID,
  p_quantity DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  v_remaining DECIMAL := p_quantity;
  v_total_cost DECIMAL(15,2) := 0;
  v_layer RECORD;
  v_fallback DECIMAL(15,2);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN 0; END IF;

  FOR v_layer IN
    SELECT * FROM inventory_cost_layers
    WHERE store_id = p_store_id AND product_id = p_product_id AND quantity_remaining > 0
    ORDER BY received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_layer.quantity_remaining >= v_remaining THEN
      v_total_cost := v_total_cost + (v_remaining * v_layer.unit_cost);
      UPDATE inventory_cost_layers
      SET quantity_remaining = quantity_remaining - v_remaining
      WHERE id = v_layer.id;
      v_remaining := 0;
    ELSE
      v_total_cost := v_total_cost + (v_layer.quantity_remaining * v_layer.unit_cost);
      v_remaining := v_remaining - v_layer.quantity_remaining;
      UPDATE inventory_cost_layers SET quantity_remaining = 0 WHERE id = v_layer.id;
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    SELECT cost_price INTO v_fallback FROM products WHERE id = p_product_id;
    v_total_cost := v_total_cost + (v_remaining * COALESCE(v_fallback, 0));
  END IF;

  RETURN ROUND(v_total_cost, 2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- post_journal_entry: period lock + audit
-- ============================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_store_id UUID,
  p_description TEXT,
  p_reference_id UUID,
  p_reference_type TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_is_auto BOOLEAN DEFAULT true,
  p_entry_date DATE DEFAULT CURRENT_DATE
) RETURNS UUID AS $$
DECLARE
  v_entry_id UUID;
  v_entry_number TEXT;
  v_counter INTEGER;
  v_line RECORD;
  v_account_id UUID;
  v_debit DECIMAL(15,2);
  v_credit DECIMAL(15,2);
  v_total_debit DECIMAL(15,2) := 0;
  v_total_credit DECIMAL(15,2) := 0;
BEGIN
  PERFORM assert_period_open(p_store_id, p_entry_date);

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(account_code TEXT, debit DECIMAL, credit DECIMAL, description TEXT)
  LOOP
    v_total_debit := v_total_debit + COALESCE(v_line.debit, 0);
    v_total_credit := v_total_credit + COALESCE(v_line.credit, 0);
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.001 THEN
    RAISE EXCEPTION 'Journal entry not balanced: debit % != credit %', v_total_debit, v_total_credit;
  END IF;

  IF v_total_debit = 0 AND v_total_credit = 0 THEN
    RAISE EXCEPTION 'Journal entry must have non-zero amounts';
  END IF;

  SELECT journal_counter INTO v_counter FROM stores WHERE id = p_store_id FOR UPDATE;
  v_entry_number := 'JE-' || v_counter::TEXT;
  UPDATE stores SET journal_counter = v_counter + 1 WHERE id = p_store_id;

  INSERT INTO journal_entries (store_id, entry_number, entry_date, description, reference_id, reference_type, is_auto, created_by)
  VALUES (p_store_id, v_entry_number, p_entry_date, p_description, p_reference_id, p_reference_type, p_is_auto, p_created_by)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(account_code TEXT, debit DECIMAL, credit DECIMAL, description TEXT)
  LOOP
    v_account_id := get_account_id(p_store_id, v_line.account_code);
    IF v_account_id IS NULL THEN CONTINUE; END IF;
    v_debit := COALESCE(v_line.debit, 0);
    v_credit := COALESCE(v_line.credit, 0);
    IF v_debit = 0 AND v_credit = 0 THEN CONTINUE; END IF;
    INSERT INTO journal_lines (store_id, journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (p_store_id, v_entry_id, v_account_id, v_debit, v_credit, v_line.description);
    UPDATE chart_of_accounts
    SET balance = balance + v_debit - v_credit, updated_at = NOW()
    WHERE id = v_account_id;
  END LOOP;

  PERFORM log_accounting_audit(
    p_store_id, p_created_by, 'journal_entry', v_entry_id, 'posted',
    NULL, jsonb_build_object('entry_number', v_entry_number, 'description', p_description, 'reference_type', p_reference_type)
  );

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- COMPLETE POS SALE — tax payable + FIFO COGS
-- ============================================================
CREATE OR REPLACE FUNCTION complete_pos_sale(
  p_store_id UUID,
  p_cashier_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_subtotal DECIMAL,
  p_discount_amount DECIMAL,
  p_discount_type TEXT,
  p_tax_amount DECIMAL,
  p_total_amount DECIMAL,
  p_paid_amount DECIMAL,
  p_change_amount DECIMAL,
  p_credit_amount DECIMAL,
  p_payment_method TEXT,
  p_payment_details JSONB,
  p_notes TEXT
) RETURNS JSONB AS $$
DECLARE
  v_sale_id UUID;
  v_invoice_number TEXT;
  v_counter INTEGER;
  v_prefix TEXT;
  v_item RECORD;
  v_product RECORD;
  v_customer RECORD;
  v_journal_lines JSONB := '[]'::JSONB;
  v_payment_code TEXT;
  v_cogs_total DECIMAL(15,2) := 0;
  v_revenue DECIMAL(15,2);
  v_check RECORD;
  v_cost_method TEXT;
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');
  v_revenue := p_total_amount - COALESCE(p_tax_amount, 0);

  FOR v_check IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL, product_name TEXT)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_check.product_id AND store_id = p_store_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Product not found');
    END IF;
    IF v_product.track_inventory AND v_product.stock_quantity < v_check.quantity THEN
      RETURN jsonb_build_object('success', false, 'error', format('Insufficient stock for %s', v_product.name));
    END IF;
  END LOOP;

  IF p_credit_amount > 0 AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
    END IF;
    IF v_customer.credit_limit > 0 AND (v_customer.balance + p_credit_amount) > v_customer.credit_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Credit limit exceeded');
    END IF;
  END IF;

  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_invoice_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 5, '0');

  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, discount_type, tax_amount, total_amount,
    paid_amount, change_amount, credit_amount, payment_method, payment_details, notes, sale_date
  ) VALUES (
    p_store_id, v_invoice_number, p_customer_id, p_cashier_id, 'completed',
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount, p_change_amount, p_credit_amount, p_payment_method, p_payment_details, p_notes, NOW()
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, product_name TEXT, product_sku TEXT,
    quantity DECIMAL, unit_price DECIMAL, cost_price DECIMAL,
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL
  )
  LOOP
    INSERT INTO sale_items (
      store_id, sale_id, product_id, product_name, product_sku,
      quantity, unit_price, cost_price, discount_amount, tax_amount, subtotal
    ) VALUES (
      p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku,
      v_item.quantity, v_item.unit_price, v_item.cost_price, v_item.discount_amount, v_item.tax_amount, v_item.subtotal
    );
    IF v_cost_method = 'fifo' THEN
      v_cogs_total := v_cogs_total + consume_fifo_cost(p_store_id, v_item.product_id, v_item.quantity);
    ELSE
      v_cogs_total := v_cogs_total + (COALESCE(v_item.cost_price, 0) * v_item.quantity);
    END IF;
  END LOOP;

  PERFORM process_sale_stock(p_store_id, v_sale_id, (
    SELECT jsonb_agg(jsonb_build_object('product_id', x.product_id, 'quantity', x.quantity))
    FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL)
  ), p_cashier_id);

  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET
      balance = balance + p_credit_amount,
      total_purchases = total_purchases + p_total_amount,
      updated_at = NOW()
    WHERE id = p_customer_id;
  END IF;

  IF v_revenue > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', v_revenue, 'description', 'Sales revenue')
    );
  END IF;

  IF COALESCE(p_tax_amount, 0) > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2200', 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable')
    );
  END IF;

  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_payment_method);
    IF p_payment_method = 'credit' THEN v_payment_code := '1110'; END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;

  IF p_credit_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;

  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '5100', 'debit', v_cogs_total, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', v_invoice_number, 'total', p_total_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PROCESS SALE REFUND — proportional tax reversal
-- ============================================================
CREATE OR REPLACE FUNCTION process_sale_refund(
  p_store_id UUID,
  p_sale_id UUID,
  p_user_id UUID,
  p_refund_items JSONB,
  p_refund_amount DECIMAL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
  v_product RECORD;
  v_before DECIMAL;
  v_after DECIMAL;
  v_refund_invoice TEXT;
  v_counter INTEGER;
  v_prefix TEXT;
  v_refund_sale_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_cogs_total DECIMAL(15,2) := 0;
  v_tax_refund DECIMAL(15,2) := 0;
  v_revenue_refund DECIMAL(15,2);
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.status = 'refunded' THEN RETURN jsonb_build_object('success', false, 'error', 'Already refunded'); END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_refund_items) AS x(
    sale_item_id UUID, product_id UUID, quantity DECIMAL, cost_price DECIMAL, subtotal DECIMAL
  )
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
      IF FOUND AND v_product.track_inventory THEN
        v_before := v_product.stock_quantity;
        v_after := v_before + v_item.quantity;
        UPDATE products SET stock_quantity = v_after, updated_at = NOW() WHERE id = v_item.product_id;
        INSERT INTO stock_movements (
          store_id, product_id, movement_type, quantity_change,
          quantity_before, quantity_after, reference_id, reference_type, reason, created_by
        ) VALUES (
          p_store_id, v_item.product_id, 'return', v_item.quantity,
          v_before, v_after, p_sale_id, 'sale_refund', p_reason, p_user_id
        );
        INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
        VALUES (p_store_id, v_item.product_id, v_item.quantity, COALESCE(v_item.cost_price, 0), 'sale_refund', p_sale_id);
      END IF;
    END IF;
    v_cogs_total := v_cogs_total + (COALESCE(v_item.cost_price, 0) * v_item.quantity);
  END LOOP;

  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_refund_invoice := COALESCE(v_prefix, 'INV') || '-RF-' || LPAD(v_counter::TEXT, 5, '0');

  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, tax_amount, total_amount,
    paid_amount, credit_amount, payment_method, notes, sale_date
  ) VALUES (
    p_store_id, v_refund_invoice, v_sale.customer_id, p_user_id, 'refunded',
    p_refund_amount, 0, 0, -p_refund_amount,
    -p_refund_amount, 0, v_sale.payment_method, 'Refund for ' || v_sale.invoice_number || ': ' || COALESCE(p_reason, ''),
    NOW()
  ) RETURNING id INTO v_refund_sale_id;

  UPDATE sales SET status = 'refunded', updated_at = NOW() WHERE id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL AND v_sale.credit_amount > 0 THEN
    UPDATE customers SET
      balance = GREATEST(0, balance - LEAST(v_sale.credit_amount, p_refund_amount)),
      updated_at = NOW()
    WHERE id = v_sale.customer_id;
  END IF;

  IF v_sale.total_amount > 0 AND COALESCE(v_sale.tax_amount, 0) > 0 THEN
    v_tax_refund := ROUND((p_refund_amount / v_sale.total_amount) * v_sale.tax_amount, 2);
  END IF;
  v_revenue_refund := p_refund_amount - v_tax_refund;

  IF v_revenue_refund > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '4100', 'debit', v_revenue_refund, 'credit', 0, 'description', 'Sales refund')
    );
  END IF;
  IF v_tax_refund > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2200', 'debit', v_tax_refund, 'credit', 0, 'description', 'Tax payable reversal')
    );
  END IF;

  v_journal_lines := v_journal_lines || jsonb_build_array(
    jsonb_build_object('account_code', payment_method_account_code(v_sale.payment_method), 'debit', 0, 'credit', p_refund_amount, 'description', 'Refund payment')
  );

  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1300', 'debit', v_cogs_total, 'credit', 0, 'description', 'Inventory return'),
      jsonb_build_object('account_code', '5100', 'debit', 0, 'credit', v_cogs_total, 'description', 'COGS reversal')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Refund ' || v_sale.invoice_number, v_refund_sale_id, 'sale_refund', p_user_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true, 'refund_invoice', v_refund_invoice, 'refund_sale_id', v_refund_sale_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RECEIVE PO — FIFO cost layers
-- ============================================================
CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_store_id UUID,
  p_po_id UUID,
  p_user_id UUID,
  p_paid_amount DECIMAL DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash'
) RETURNS JSONB AS $$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_product RECORD;
  v_before DECIMAL;
  v_after DECIMAL;
  v_new_cost DECIMAL;
  v_ap_amount DECIMAL;
  v_journal_lines JSONB := '[]'::JSONB;
  v_payment_code TEXT;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PO not found'); END IF;
  IF v_po.status IN ('received', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PO already closed');
  END IF;

  FOR v_item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;

    SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_before := v_product.stock_quantity;
    v_after := v_before + v_item.quantity;

    IF v_after > 0 AND v_item.quantity > 0 THEN
      v_new_cost := ((v_before * v_product.cost_price) + (v_item.quantity * v_item.unit_cost)) / v_after;
    ELSE
      v_new_cost := v_item.unit_cost;
    END IF;

    UPDATE products SET
      stock_quantity = v_after,
      cost_price = ROUND(v_new_cost, 2),
      updated_at = NOW()
    WHERE id = v_item.product_id;

    INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
    VALUES (p_store_id, v_item.product_id, v_item.quantity, v_item.unit_cost, 'purchase_order', p_po_id);

    INSERT INTO stock_movements (
      store_id, product_id, movement_type, quantity_change,
      quantity_before, quantity_after, reference_id, reference_type, reason, created_by
    ) VALUES (
      p_store_id, v_item.product_id, 'purchase', v_item.quantity,
      v_before, v_after, p_po_id, 'purchase_order', 'PO receive ' || v_po.po_number, p_user_id
    );

    UPDATE purchase_order_items SET received_quantity = v_item.quantity WHERE id = v_item.id;
  END LOOP;

  v_ap_amount := v_po.total_amount - p_paid_amount;

  UPDATE purchase_orders SET
    status = 'received',
    received_date = CURRENT_DATE,
    paid_amount = p_paid_amount,
    updated_at = NOW()
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL AND v_ap_amount > 0 THEN
    UPDATE suppliers SET balance = balance + v_ap_amount, updated_at = NOW() WHERE id = v_po.supplier_id;
  END IF;

  v_journal_lines := v_journal_lines || jsonb_build_array(
    jsonb_build_object('account_code', '1300', 'debit', v_po.total_amount, 'credit', 0, 'description', 'Inventory purchase')
  );

  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_payment_method);
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_paid_amount, 'description', 'Purchase payment')
    );
  END IF;

  IF v_ap_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', v_ap_amount, 'description', 'Accounts payable')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Purchase ' || v_po.po_number, p_po_id, 'purchase_order', p_user_id, v_journal_lines);

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'ap_amount', v_ap_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Expense recording with approval workflow
-- ============================================================
CREATE OR REPLACE FUNCTION record_expense(
  p_store_id UUID,
  p_user_id UUID,
  p_description TEXT,
  p_amount DECIMAL,
  p_category TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash',
  p_expense_date DATE DEFAULT CURRENT_DATE,
  p_reference TEXT DEFAULT NULL,
  p_receipt_url TEXT DEFAULT NULL,
  p_auto_approve BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_expense_id UUID;
  v_expense_code TEXT;
  v_payment_code TEXT;
  v_account_id UUID;
  v_journal_lines JSONB;
  v_role TEXT;
  v_status TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  PERFORM assert_period_open(p_store_id, p_expense_date);

  v_status := CASE
    WHEN p_auto_approve OR v_role IN ('owner', 'manager') THEN 'approved'
    ELSE 'pending'
  END;

  v_expense_code := expense_category_account_code(p_category);
  v_payment_code := payment_method_account_code(p_payment_method);
  v_account_id := get_account_id(p_store_id, v_expense_code);

  INSERT INTO expenses (
    store_id, account_id, amount, description, category,
    payment_method, reference, expense_date, receipt_url, created_by, status,
    approved_by, approved_at
  ) VALUES (
    p_store_id, v_account_id, p_amount, p_description, p_category,
    p_payment_method, p_reference, p_expense_date, p_receipt_url, p_user_id, v_status,
    CASE WHEN v_status = 'approved' THEN p_user_id END,
    CASE WHEN v_status = 'approved' THEN NOW() END
  ) RETURNING id INTO v_expense_id;

  IF v_status = 'approved' THEN
    v_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_expense_code, 'debit', p_amount, 'credit', 0, 'description', p_description),
      jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_amount, 'description', 'Expense payment')
    );
    PERFORM post_journal_entry(
      p_store_id, 'Expense: ' || p_description, v_expense_id, 'expense', p_user_id, v_journal_lines, true, p_expense_date
    );
  END IF;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'expense', v_expense_id,
    CASE WHEN v_status = 'approved' THEN 'created_and_posted' ELSE 'submitted_for_approval' END,
    NULL, jsonb_build_object('amount', p_amount, 'status', v_status)
  );

  RETURN jsonb_build_object('success', true, 'expense_id', v_expense_id, 'status', v_status);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION approve_expense(
  p_store_id UUID,
  p_user_id UUID,
  p_expense_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_expense RECORD;
  v_expense_code TEXT;
  v_payment_code TEXT;
  v_journal_lines JSONB;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owner/manager can approve expenses');
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Expense not found'); END IF;
  IF v_expense.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'Expense is not pending'); END IF;

  PERFORM assert_period_open(p_store_id, v_expense.expense_date);

  v_expense_code := expense_category_account_code(v_expense.category);
  v_payment_code := payment_method_account_code(v_expense.payment_method);

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_expense_code, 'debit', v_expense.amount, 'credit', 0, 'description', v_expense.description),
    jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', v_expense.amount, 'description', 'Expense payment')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Expense: ' || v_expense.description, v_expense.id, 'expense', p_user_id, v_journal_lines, true, v_expense.expense_date
  );

  UPDATE expenses SET status = 'approved', approved_by = p_user_id, approved_at = NOW(), updated_at = NOW()
  WHERE id = p_expense_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'expense', p_expense_id, 'approved', NULL, NULL);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_expense(
  p_store_id UUID,
  p_user_id UUID,
  p_expense_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owner/manager can reject expenses');
  END IF;

  UPDATE expenses SET
    status = 'rejected',
    rejection_reason = p_reason,
    approved_by = p_user_id,
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_expense_id AND store_id = p_store_id AND status = 'pending';

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Pending expense not found'); END IF;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'expense', p_expense_id, 'rejected', NULL, jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Chart of accounts CRUD
-- ============================================================
CREATE OR REPLACE FUNCTION create_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_account_type TEXT,
  p_parent_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_id UUID;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_code IS NULL OR trim(p_code) = '' OR p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Code and name are required');
  END IF;

  INSERT INTO chart_of_accounts (store_id, code, name, account_type, parent_id, is_system, is_active)
  VALUES (p_store_id, trim(p_code), trim(p_name), p_account_type, p_parent_id, false, true)
  RETURNING id INTO v_id;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'chart_of_account', v_id, 'created',
    NULL, jsonb_build_object('code', p_code, 'name', p_name, 'account_type', p_account_type)
  );

  RETURN jsonb_build_object('success', true, 'account_id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Account code already exists');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID,
  p_name TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;

  UPDATE chart_of_accounts SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    parent_id = COALESCE(p_parent_id, parent_id),
    updated_at = NOW()
  WHERE id = p_account_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'chart_of_account', p_account_id, 'updated', NULL, jsonb_build_object('name', p_name));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION deactivate_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;
  IF v_account.is_system THEN RETURN jsonb_build_object('success', false, 'error', 'System accounts cannot be deactivated'); END IF;
  IF v_account.balance <> 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Account must have zero balance'); END IF;

  UPDATE chart_of_accounts SET is_active = false, updated_at = NOW() WHERE id = p_account_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'chart_of_account', p_account_id, 'deactivated', NULL, NULL);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Period close
-- ============================================================
CREATE OR REPLACE FUNCTION create_accounting_period(
  p_store_id UUID,
  p_user_id UUID,
  p_name TEXT,
  p_period_start DATE,
  p_period_end DATE
) RETURNS JSONB AS $$
DECLARE
  v_id UUID;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_period_end < p_period_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'End date must be after start date');
  END IF;

  INSERT INTO accounting_periods (store_id, name, period_start, period_end)
  VALUES (p_store_id, p_name, p_period_start, p_period_end)
  RETURNING id INTO v_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'accounting_period', v_id, 'created', NULL,
    jsonb_build_object('name', p_name, 'period_start', p_period_start, 'period_end', p_period_end));

  RETURN jsonb_build_object('success', true, 'period_id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Period already exists for these dates');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION close_accounting_period(
  p_store_id UUID,
  p_user_id UUID,
  p_period_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_period RECORD;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_period FROM accounting_periods WHERE id = p_period_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Period not found'); END IF;
  IF v_period.is_closed THEN RETURN jsonb_build_object('success', false, 'error', 'Period already closed'); END IF;

  UPDATE accounting_periods SET is_closed = true, closed_at = NOW(), closed_by = p_user_id
  WHERE id = p_period_id;

  UPDATE journal_entries SET is_locked = true
  WHERE store_id = p_store_id
    AND entry_date BETWEEN v_period.period_start AND v_period.period_end;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'accounting_period', p_period_id, 'closed', NULL, NULL);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Exchange rates + store settings
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_exchange_rate(
  p_store_id UUID,
  p_user_id UUID,
  p_from_currency TEXT,
  p_to_currency TEXT,
  p_rate DECIMAL,
  p_effective_date DATE DEFAULT CURRENT_DATE
) RETURNS JSONB AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid rate');
  END IF;

  INSERT INTO exchange_rates (store_id, from_currency, to_currency, rate, effective_date, created_by)
  VALUES (p_store_id, upper(p_from_currency), upper(p_to_currency), p_rate, p_effective_date, p_user_id)
  RETURNING id INTO v_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'exchange_rate', v_id, 'created',
    NULL, jsonb_build_object('from', p_from_currency, 'to', p_to_currency, 'rate', p_rate));

  RETURN jsonb_build_object('success', true, 'rate_id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_store_accounting_settings(
  p_store_id UUID,
  p_user_id UUID,
  p_secondary_currency TEXT DEFAULT NULL,
  p_inventory_cost_method TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE stores SET
    secondary_currency = COALESCE(NULLIF(trim(p_secondary_currency), ''), secondary_currency),
    inventory_cost_method = COALESCE(p_inventory_cost_method, inventory_cost_method),
    updated_at = NOW()
  WHERE id = p_store_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'store', p_store_id, 'settings_updated', NULL,
    jsonb_build_object('secondary_currency', p_secondary_currency, 'inventory_cost_method', p_inventory_cost_method));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Payroll
-- ============================================================
CREATE OR REPLACE FUNCTION create_payroll_run(
  p_store_id UUID,
  p_user_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_items JSONB
) RETURNS JSONB AS $$
DECLARE
  v_run_id UUID;
  v_item RECORD;
  v_total DECIMAL(15,2) := 0;
  v_net DECIMAL(15,2);
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  PERFORM assert_period_open(p_store_id, p_period_end);

  INSERT INTO payroll_runs (store_id, period_start, period_end, status, created_by)
  VALUES (p_store_id, p_period_start, p_period_end, 'draft', p_user_id)
  RETURNING id INTO v_run_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    employee_id UUID, gross_pay DECIMAL, deductions DECIMAL, notes TEXT
  )
  LOOP
    v_net := COALESCE(v_item.gross_pay, 0) - COALESCE(v_item.deductions, 0);
    IF v_net < 0 THEN v_net := 0; END IF;
    INSERT INTO payroll_items (payroll_run_id, employee_id, gross_pay, deductions, net_pay, notes)
    VALUES (v_run_id, v_item.employee_id, COALESCE(v_item.gross_pay, 0), COALESCE(v_item.deductions, 0), v_net, v_item.notes);
    v_total := v_total + v_net;
  END LOOP;

  UPDATE payroll_runs SET total_amount = v_total WHERE id = v_run_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'payroll_run', v_run_id, 'created', NULL,
    jsonb_build_object('total', v_total, 'period_start', p_period_start, 'period_end', p_period_end));

  RETURN jsonb_build_object('success', true, 'payroll_run_id', v_run_id, 'total_amount', v_total);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION process_payroll_run(
  p_store_id UUID,
  p_user_id UUID,
  p_payroll_run_id UUID,
  p_payment_method TEXT DEFAULT 'cash'
) RETURNS JSONB AS $$
DECLARE
  v_run RECORD;
  v_payment_code TEXT;
  v_journal_lines JSONB;
  v_entry_id UUID;
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_run FROM payroll_runs WHERE id = p_payroll_run_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payroll run not found'); END IF;
  IF v_run.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'Payroll already processed'); END IF;
  IF v_run.total_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Payroll total must be greater than zero'); END IF;

  PERFORM assert_period_open(p_store_id, v_run.period_end);

  v_payment_code := payment_method_account_code(p_payment_method);
  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', '6300', 'debit', v_run.total_amount, 'credit', 0, 'description', 'Payroll salaries'),
    jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', v_run.total_amount, 'description', 'Payroll payment')
  );

  v_entry_id := post_journal_entry(
    p_store_id,
    'Payroll ' || to_char(v_run.period_start, 'YYYY-MM-DD') || ' to ' || to_char(v_run.period_end, 'YYYY-MM-DD'),
    p_payroll_run_id, 'payroll', p_user_id, v_journal_lines, true, v_run.period_end
  );

  UPDATE payroll_runs SET status = 'paid', paid_at = NOW(), journal_entry_id = v_entry_id WHERE id = p_payroll_run_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'payroll_run', p_payroll_run_id, 'paid', NULL,
    jsonb_build_object('total', v_run.total_amount));

  RETURN jsonb_build_object('success', true, 'journal_entry_id', v_entry_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
