-- Minimal COA defaults: 8 essential system accounts, refined protection rules, payment wallet naming

CREATE OR REPLACE FUNCTION coa_is_protected_role(p_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_role IN (
    'cash',
    'accounts_receivable',
    'accounts_payable',
    'inventory',
    'sales_revenue',
    'cogs',
    'owner_capital'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 8 essential accounts for new stores (no sample expense breakdown)
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
DECLARE
  v_cash_id UUID;
  v_revenue_id UUID;
  v_expense_id UUID;
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_protected, is_postable, system_role, is_active) VALUES
  (p_store_id, '1000', 'Cash', 'asset', true, true, true, 'cash', true),
  (p_store_id, '1100', 'Inventory', 'asset', true, true, true, 'inventory', true),
  (p_store_id, '1200', 'Accounts Receivable', 'asset', true, true, true, 'accounts_receivable', true),
  (p_store_id, '2000', 'Accounts Payable', 'liability', true, true, true, 'accounts_payable', true),
  (p_store_id, '3000', 'Owner Capital', 'equity', true, true, true, 'owner_capital', true),
  (p_store_id, '4000', 'Sales Revenue', 'revenue', true, true, true, 'sales_revenue', true),
  (p_store_id, '5000', 'General Expenses', 'expense', true, false, true, 'general_expenses', true),
  (p_store_id, '5100', 'Cost of Goods Sold', 'cogs', true, true, true, 'cogs', true)
  ON CONFLICT (store_id, code) DO NOTHING;

  SELECT id INTO v_cash_id FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

  SELECT id INTO v_revenue_id FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = 'sales_revenue' LIMIT 1;

  SELECT id INTO v_expense_id FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = 'general_expenses' LIMIT 1;

  IF v_cash_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM store_payment_methods WHERE store_id = p_store_id AND slug = 'cash'
  ) THEN
    INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
    VALUES (p_store_id, 'cash', 'Cash', v_cash_id, true, 0)
    ON CONFLICT (store_id, slug) DO NOTHING;
  END IF;

  UPDATE stores SET
    default_cash_account_id = COALESCE(default_cash_account_id, v_cash_id),
    default_revenue_account_id = COALESCE(default_revenue_account_id, v_revenue_id),
    default_expense_account_id = COALESCE(default_expense_account_id, v_expense_id)
  WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill General Expenses for stores that only have the 7-account QuickBooks seed
INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_protected, is_postable, system_role, is_active)
SELECT s.id, '5000', 'General Expenses', 'expense', true, false, true, 'general_expenses', true
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.store_id = s.id AND c.system_role = 'general_expenses'
)
ON CONFLICT (store_id, code) DO NOTHING;

UPDATE chart_of_accounts SET name = 'Owner Capital'
WHERE system_role = 'owner_capital' AND name IN ('Owner Equity', 'Owner''s Equity');

UPDATE stores s SET default_expense_account_id = (
  SELECT id FROM chart_of_accounts
  WHERE store_id = s.id AND system_role = 'general_expenses' AND is_active = true
  LIMIT 1
)
WHERE default_expense_account_id IS NULL;

-- ============================================================
-- Protected-role checks (only listed ERP accounts)
-- ============================================================
CREATE OR REPLACE FUNCTION delete_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;

  IF v_account.is_protected OR coa_is_protected_role(v_account.system_role) OR v_account.system_role = 'general_expenses' THEN
    RETURN jsonb_build_object('success', false, 'error', 'System accounts cannot be deleted');
  END IF;

  IF v_account.balance <> 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete account with a balance');
  END IF;

  IF account_has_transactions(p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete account with journal entries');
  END IF;

  IF EXISTS (SELECT 1 FROM store_payment_methods WHERE account_id = p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account is linked to a payment method');
  END IF;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE parent_id = p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Remove child accounts first');
  END IF;

  DELETE FROM chart_of_accounts WHERE id = p_account_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'chart_of_account', p_account_id, 'deleted', NULL, NULL);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION archive_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;

  IF v_account.is_protected OR coa_is_protected_role(v_account.system_role) OR v_account.system_role = 'general_expenses' THEN
    RETURN jsonb_build_object('success', false, 'error', 'System accounts cannot be archived');
  END IF;

  IF v_account.balance <> 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot archive account with a balance');
  END IF;

  IF account_has_transactions(p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot archive account with journal entries');
  END IF;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE parent_id = p_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Archive child accounts first');
  END IF;

  UPDATE chart_of_accounts SET is_active = false, archived_at = NOW(), updated_at = NOW() WHERE id = p_account_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'chart_of_account', p_account_id, 'archived', NULL, NULL);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Payment methods: auto-create numbered asset accounts (1010, 1020, …)
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
  v_account_name TEXT;
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

    v_account_name := trim(p_label);
    IF v_slug <> 'cash'
       AND v_account_name !~* '(wallet|bank|cash|money)$' THEN
      v_account_name := v_account_name || ' Wallet';
    END IF;

    SELECT id INTO v_cash_parent FROM chart_of_accounts WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

    INSERT INTO chart_of_accounts (store_id, code, name, account_type, parent_id, is_system, is_protected, is_postable, is_active)
    VALUES (p_store_id, normalize_account_code(v_code), v_account_name, 'asset', v_cash_parent, false, false, true, true)
    RETURNING id INTO v_account_id;
  END IF;

  INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
  VALUES (p_store_id, v_slug, trim(p_label), v_account_id, false, 200);

  RETURN jsonb_build_object('success', true, 'account_code', v_code, 'account_name', v_account_name, 'slug', v_slug, 'account_id', v_account_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
