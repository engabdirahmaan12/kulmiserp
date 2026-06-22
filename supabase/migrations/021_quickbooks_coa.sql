-- QuickBooks-style COA: 7 core accounts only, default account settings, expense resolution

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS default_cash_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_revenue_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_expense_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

-- ============================================================
-- 7 protected core accounts for new stores (no preset expense accounts)
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
DECLARE
  v_cash_id UUID;
  v_revenue_id UUID;
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_protected, is_postable, system_role, is_active) VALUES
  (p_store_id, '1000', 'Cash', 'asset', true, true, true, 'cash', true),
  (p_store_id, '1200', 'Accounts Receivable', 'asset', true, true, true, 'accounts_receivable', true),
  (p_store_id, '1100', 'Inventory', 'asset', true, true, true, 'inventory', true),
  (p_store_id, '2000', 'Accounts Payable', 'liability', true, true, true, 'accounts_payable', true),
  (p_store_id, '3000', 'Owner Equity', 'equity', true, true, true, 'owner_capital', true),
  (p_store_id, '4000', 'Sales Revenue', 'revenue', true, true, true, 'sales_revenue', true),
  (p_store_id, '5100', 'Cost of Goods Sold', 'cogs', true, true, true, 'cogs', true)
  ON CONFLICT (store_id, code) DO NOTHING;

  SELECT id INTO v_cash_id FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

  SELECT id INTO v_revenue_id FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = 'sales_revenue' LIMIT 1;

  IF v_cash_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM store_payment_methods WHERE store_id = p_store_id AND slug = 'cash'
  ) THEN
    INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
    VALUES (p_store_id, 'cash', 'Cash', v_cash_id, true, 0)
    ON CONFLICT (store_id, slug) DO NOTHING;
  END IF;

  UPDATE stores SET
    default_cash_account_id = COALESCE(default_cash_account_id, v_cash_id),
    default_revenue_account_id = COALESCE(default_revenue_account_id, v_revenue_id)
  WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill default account pointers for existing stores
UPDATE stores s SET
  default_cash_account_id = (
    SELECT id FROM chart_of_accounts WHERE store_id = s.id AND system_role = 'cash' AND is_active = true LIMIT 1
  )
WHERE default_cash_account_id IS NULL;

UPDATE stores s SET
  default_revenue_account_id = (
    SELECT id FROM chart_of_accounts WHERE store_id = s.id AND system_role = 'sales_revenue' AND is_active = true LIMIT 1
  )
WHERE default_revenue_account_id IS NULL;

UPDATE stores s SET
  default_expense_account_id = (
    SELECT id FROM chart_of_accounts
    WHERE store_id = s.id AND system_role = 'general_expenses' AND is_active = true LIMIT 1
  )
WHERE default_expense_account_id IS NULL;

CREATE OR REPLACE FUNCTION coa_default_expense_code(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT coa.code INTO v_code
  FROM stores s
  JOIN chart_of_accounts coa ON coa.id = s.default_expense_account_id
  WHERE s.id = p_store_id AND coa.is_active = true
  LIMIT 1;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  v_code := coa_code(p_store_id, 'general_expenses');
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  SELECT code INTO v_code FROM chart_of_accounts
  WHERE store_id = p_store_id AND account_type = 'expense' AND is_active = true AND is_postable = true AND system_role IS NULL
  ORDER BY code LIMIT 1;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  RETURN coa_code(p_store_id, 'cogs');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION coa_default_cash_code(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT coa.code INTO v_code
  FROM stores s
  JOIN chart_of_accounts coa ON coa.id = s.default_cash_account_id
  WHERE s.id = p_store_id AND coa.is_active = true
  LIMIT 1;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  RETURN coa_code(p_store_id, 'cash');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION coa_default_revenue_code(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT coa.code INTO v_code
  FROM stores s
  JOIN chart_of_accounts coa ON coa.id = s.default_revenue_account_id
  WHERE s.id = p_store_id AND coa.is_active = true
  LIMIT 1;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  RETURN coa_code(p_store_id, 'sales_revenue');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION expense_category_account_code(p_store_id UUID, p_category TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN coa_default_expense_code(p_store_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_store_accounting_settings(
  p_store_id UUID,
  p_user_id UUID,
  p_secondary_currency TEXT DEFAULT NULL,
  p_inventory_cost_method TEXT DEFAULT NULL,
  p_fiscal_year_start_month INT DEFAULT NULL,
  p_coa_number_prefix TEXT DEFAULT NULL,
  p_auto_create_payment_accounts BOOLEAN DEFAULT NULL,
  p_default_cash_account_id UUID DEFAULT NULL,
  p_default_revenue_account_id UUID DEFAULT NULL,
  p_default_expense_account_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_old_method TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_inventory_cost_method IS NOT NULL AND p_inventory_cost_method NOT IN ('average', 'fifo', 'lifo') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid costing method');
  END IF;

  IF p_fiscal_year_start_month IS NOT NULL AND (p_fiscal_year_start_month < 1 OR p_fiscal_year_start_month > 12) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fiscal year start month must be 1-12');
  END IF;

  IF p_default_cash_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_default_cash_account_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid default cash account');
  END IF;

  IF p_default_revenue_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_default_revenue_account_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid default revenue account');
  END IF;

  IF p_default_expense_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_default_expense_account_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid default expense account');
  END IF;

  SELECT inventory_cost_method INTO v_old_method FROM stores WHERE id = p_store_id;

  UPDATE stores SET
    secondary_currency = COALESCE(NULLIF(trim(p_secondary_currency), ''), secondary_currency),
    inventory_cost_method = COALESCE(p_inventory_cost_method, inventory_cost_method),
    fiscal_year_start_month = COALESCE(p_fiscal_year_start_month, fiscal_year_start_month),
    coa_number_prefix = COALESCE(p_coa_number_prefix, coa_number_prefix),
    auto_create_payment_accounts = COALESCE(p_auto_create_payment_accounts, auto_create_payment_accounts),
    default_cash_account_id = COALESCE(p_default_cash_account_id, default_cash_account_id),
    default_revenue_account_id = COALESCE(p_default_revenue_account_id, default_revenue_account_id),
    default_expense_account_id = COALESCE(p_default_expense_account_id, default_expense_account_id),
    updated_at = NOW()
  WHERE id = p_store_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'store', p_store_id, 'settings_updated', NULL,
    jsonb_build_object(
      'secondary_currency', p_secondary_currency,
      'inventory_cost_method', p_inventory_cost_method,
      'default_cash_account_id', p_default_cash_account_id,
      'default_revenue_account_id', p_default_revenue_account_id,
      'default_expense_account_id', p_default_expense_account_id
    ));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Payment method: optional skip account creation
CREATE OR REPLACE FUNCTION create_store_payment_method(
  p_store_id UUID,
  p_user_id UUID,
  p_slug TEXT,
  p_label TEXT,
  p_account_code TEXT DEFAULT NULL,
  p_create_account BOOLEAN DEFAULT true,
  p_link_account_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_slug TEXT := lower(regexp_replace(trim(p_slug), '\s+', '_', 'g'));
  v_code TEXT;
  v_account_id UUID;
  v_cash_parent UUID;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF v_slug = '' OR trim(p_label) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Slug and label are required');
  END IF;

  IF EXISTS (SELECT 1 FROM store_payment_methods WHERE store_id = p_store_id AND slug = v_slug) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method already exists');
  END IF;

  IF NOT COALESCE(p_create_account, true) THEN
    IF p_link_account_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Select an account to link or enable account creation');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts WHERE id = p_link_account_id AND store_id = p_store_id AND is_active = true AND account_type = 'asset'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid asset account to link');
    END IF;
    v_account_id := p_link_account_id;
    SELECT code INTO v_code FROM chart_of_accounts WHERE id = v_account_id;
  ELSE
    v_code := COALESCE(NULLIF(trim(p_account_code), ''), suggest_payment_account_code(p_store_id));
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE store_id = p_store_id AND lower(code) = lower(v_code)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Account number already exists.');
    END IF;

    SELECT id INTO v_cash_parent FROM chart_of_accounts WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

    INSERT INTO chart_of_accounts (store_id, code, name, account_type, parent_id, is_system, is_protected, is_postable, is_active)
    VALUES (p_store_id, normalize_account_code(v_code), trim(p_label), 'asset', v_cash_parent, false, false, true, true)
    RETURNING id INTO v_account_id;
  END IF;

  INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
  VALUES (p_store_id, v_slug, trim(p_label), v_account_id, false, 200);

  RETURN jsonb_build_object('success', true, 'account_code', v_code, 'slug', v_slug, 'account_id', v_account_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
