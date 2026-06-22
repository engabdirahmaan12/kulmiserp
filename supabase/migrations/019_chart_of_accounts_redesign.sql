-- KULMIS ERP: Chart of Accounts redesign
-- Minimal default accounts, system roles, payment method accounts, accounting settings

-- ============================================================
-- Schema extensions
-- ============================================================
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS system_role TEXT,
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_postable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS coa_number_prefix TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS auto_create_payment_accounts BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS store_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_store_payment_methods_store ON store_payment_methods(store_id, is_active);

ALTER TABLE store_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_payment_methods_select ON store_payment_methods;
CREATE POLICY store_payment_methods_select ON store_payment_methods
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = store_payment_methods.store_id
        AND su.user_id = auth.uid() AND su.is_active = true
    )
  );

-- ============================================================
-- Backfill system roles (one role per store — legacy codes overlap)
-- ============================================================
DROP INDEX IF EXISTS idx_coa_store_system_role;

-- Clear roles so a failed partial run can be re-applied safely
UPDATE chart_of_accounts SET system_role = NULL WHERE system_role IS NOT NULL;

WITH role_candidates AS (
  SELECT c.id, c.store_id, v.role, v.priority
  FROM chart_of_accounts c
  JOIN (VALUES
    ('1110', 'cash', 1),
    ('1000', 'cash', 2),
    ('1300', 'inventory', 1),
    ('1100', 'inventory', 2),
    ('1200', 'accounts_receivable', 1),
    ('2100', 'accounts_payable', 1),
    ('2000', 'accounts_payable', 2),
    ('3100', 'owner_capital', 1),
    ('3000', 'owner_capital', 2),
    ('4100', 'sales_revenue', 1),
    ('4000', 'sales_revenue', 2),
    ('6500', 'general_expenses', 1),
    ('5000', 'general_expenses', 2),
    ('5100', 'cogs', 1),
    ('2200', 'tax_payable', 1),
    ('3300', 'opening_balance_equity', 1),
    ('5290', 'bad_debt_expense', 1)
  ) AS v(code, role, priority) ON c.code = v.code
  WHERE
    NOT (c.code = '1000' AND v.role = 'cash' AND c.name ~* 'current assets')
    AND NOT (c.code = '1100' AND v.role = 'inventory' AND c.name ~* 'cash')
    AND NOT (c.code = '2000' AND v.role = 'accounts_payable' AND c.name ~* 'liabilit')
    AND NOT (c.code = '3000' AND v.role = 'owner_capital' AND c.name ~* 'equity' AND c.name !~* 'capital')
    AND NOT (c.code = '4000' AND v.role = 'sales_revenue' AND c.name ~* '^revenue$')
    AND NOT (c.code = '5000' AND v.role = 'general_expenses' AND c.name ~* 'cost of goods')
    AND NOT (c.code = '5000' AND v.role = 'general_expenses' AND c.name ~* '^cost of goods')
),
winners AS (
  SELECT DISTINCT ON (store_id, role) id, role
  FROM role_candidates
  ORDER BY store_id, role, priority
)
UPDATE chart_of_accounts c
SET system_role = w.role, is_protected = true
FROM winners w
WHERE c.id = w.id;

CREATE UNIQUE INDEX idx_coa_store_system_role
  ON chart_of_accounts(store_id, system_role)
  WHERE system_role IS NOT NULL;

UPDATE chart_of_accounts SET is_protected = true
WHERE is_system = true AND system_role IS NOT NULL;

-- Legacy header/group accounts are not postable (exclude accounts already assigned a role)
UPDATE chart_of_accounts SET is_postable = false
WHERE system_role IS NULL
  AND code IN ('1000', '1100', '2000', '3000', '4000', '5000', '6000')
  AND name ~* '(current assets|cash and cash|current liabilities|owner equity|revenue|cost of goods|operating expenses)';

-- ============================================================
-- Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION coa_code(p_store_id UUID, p_role TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_legacy JSONB := '{
    "cash": "1110",
    "inventory": "1300",
    "accounts_receivable": "1200",
    "accounts_payable": "2100",
    "owner_capital": "3100",
    "sales_revenue": "4100",
    "general_expenses": "6500",
    "cogs": "5100",
    "tax_payable": "2200",
    "opening_balance_equity": "3300",
    "bad_debt_expense": "5290"
  }'::JSONB;
BEGIN
  SELECT code INTO v_code
  FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = p_role AND is_active = true
  LIMIT 1;

  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  v_code := v_legacy ->> p_role;
  IF v_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE store_id = p_store_id AND code = v_code AND is_active = true
  ) THEN
    RETURN v_code;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_protected_system_account(p_code TEXT)
RETURNS BOOLEAN AS $$
  SELECT false;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION account_is_protected(p_account_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(is_protected, false) OR system_role IS NOT NULL
  FROM chart_of_accounts WHERE id = p_account_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION coa_type_base(p_account_type TEXT)
RETURNS INT AS $$
BEGIN
  CASE p_account_type
    WHEN 'asset' THEN RETURN 1000;
    WHEN 'liability' THEN RETURN 2000;
    WHEN 'equity' THEN RETURN 3000;
    WHEN 'revenue' THEN RETURN 4000;
    WHEN 'expense' THEN RETURN 5000;
    WHEN 'cogs' THEN RETURN 5000;
    ELSE RETURN 9000;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION suggest_next_account_code(
  p_store_id UUID,
  p_account_type TEXT,
  p_min INT DEFAULT NULL,
  p_max INT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_base INT;
  v_min INT;
  v_max INT;
  v_next INT;
BEGIN
  v_base := coa_type_base(p_account_type);
  v_min := COALESCE(p_min, v_base + 10);
  v_max := COALESCE(p_max, v_base + 999);

  SELECT COALESCE(MAX(code::INT), v_min - 10) + 10 INTO v_next
  FROM chart_of_accounts
  WHERE store_id = p_store_id
    AND code ~ '^\d+$'
    AND code::INT >= v_min
    AND code::INT <= v_max;

  IF v_next > v_max THEN
    RAISE EXCEPTION 'No available account numbers in range %-%', v_min, v_max;
  END IF;

  RETURN v_next::TEXT;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION suggest_payment_account_code(p_store_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN suggest_next_account_code(p_store_id, 'asset', 1010, 1099);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- Minimal default chart of accounts (new stores)
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
DECLARE
  v_cash_id UUID;
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_protected, is_postable, system_role, is_active) VALUES
  (p_store_id, '1000', 'Cash', 'asset', true, true, true, 'cash', true),
  (p_store_id, '1100', 'Inventory', 'asset', true, true, true, 'inventory', true),
  (p_store_id, '1200', 'Accounts Receivable', 'asset', true, true, true, 'accounts_receivable', true),
  (p_store_id, '2000', 'Accounts Payable', 'liability', true, true, true, 'accounts_payable', true),
  (p_store_id, '3000', 'Owner Capital', 'equity', true, true, true, 'owner_capital', true),
  (p_store_id, '4000', 'Sales Revenue', 'revenue', true, true, true, 'sales_revenue', true),
  (p_store_id, '5000', 'General Expenses', 'expense', true, true, true, 'general_expenses', true),
  (p_store_id, '5100', 'Cost of Goods Sold', 'cogs', true, true, true, 'cogs', true)
  ON CONFLICT (store_id, code) DO NOTHING;

  SELECT id INTO v_cash_id FROM chart_of_accounts
  WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

  IF v_cash_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM store_payment_methods WHERE store_id = p_store_id AND slug = 'cash'
  ) THEN
    INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
    VALUES (p_store_id, 'cash', 'Cash', v_cash_id, true, 0)
    ON CONFLICT (store_id, slug) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill payment methods from legacy wallet/bank accounts
INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
SELECT c.store_id,
  CASE c.code
    WHEN '1110' THEN 'cash'
    WHEN '1120' THEN 'waafi'
    WHEN '1130' THEN 'evc'
    WHEN '1140' THEN 'sahal'
    WHEN '1150' THEN 'zaad'
    WHEN '1160' THEN 'salaam'
    WHEN '1165' THEN 'premier'
    WHEN '1170' THEN 'dahabshiil'
  END,
  c.name,
  c.id,
  true,
  CASE c.code
    WHEN '1110' THEN 0 WHEN '1120' THEN 10 WHEN '1130' THEN 20 WHEN '1140' THEN 30
    WHEN '1150' THEN 40 WHEN '1160' THEN 50 WHEN '1165' THEN 55 WHEN '1170' THEN 60
  END
FROM chart_of_accounts c
WHERE c.code IN ('1110','1120','1130','1140','1150','1160','1165','1170')
  AND c.is_active = true
ON CONFLICT (store_id, slug) DO NOTHING;

-- ============================================================
-- Payment method helpers (must exist before store-scoped resolver)
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_store_payment_method(
  p_store_id UUID,
  p_slug TEXT,
  p_label TEXT
) RETURNS UUID AS $$
DECLARE
  v_slug TEXT := lower(trim(p_slug));
  v_id UUID;
  v_account_id UUID;
  v_code TEXT;
  v_cash_parent UUID;
BEGIN
  SELECT spm.id INTO v_id FROM store_payment_methods spm
  WHERE spm.store_id = p_store_id AND spm.slug = v_slug LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF v_slug = 'cash' THEN
    v_code := coa_code(p_store_id, 'cash');
    IF v_code IS NULL THEN
      PERFORM create_default_chart_of_accounts(p_store_id);
      v_code := coa_code(p_store_id, 'cash');
    END IF;
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE store_id = p_store_id AND code = v_code LIMIT 1;
  ELSE
    v_code := suggest_payment_account_code(p_store_id);
    SELECT id INTO v_cash_parent FROM chart_of_accounts WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

    INSERT INTO chart_of_accounts (store_id, code, name, account_type, parent_id, is_system, is_protected, is_postable, is_active)
    VALUES (p_store_id, v_code, trim(p_label), 'asset', v_cash_parent, false, false, true, true)
    RETURNING id INTO v_account_id;
  END IF;

  INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
  VALUES (p_store_id, v_slug, trim(p_label), v_account_id, v_slug IN ('cash','waafi','evc','sahal','zaad'), 100)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_store_payment_method(
  p_store_id UUID,
  p_user_id UUID,
  p_slug TEXT,
  p_label TEXT,
  p_account_code TEXT DEFAULT NULL
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

  v_code := COALESCE(NULLIF(trim(p_account_code), ''), suggest_payment_account_code(p_store_id));
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE store_id = p_store_id AND code = v_code) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account number already exists');
  END IF;

  SELECT id INTO v_cash_parent FROM chart_of_accounts WHERE store_id = p_store_id AND system_role = 'cash' LIMIT 1;

  INSERT INTO chart_of_accounts (store_id, code, name, account_type, parent_id, is_system, is_protected, is_postable, is_active)
  VALUES (p_store_id, v_code, trim(p_label), 'asset', v_cash_parent, false, false, true, true)
  RETURNING id INTO v_account_id;

  INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_system, sort_order)
  VALUES (p_store_id, v_slug, trim(p_label), v_account_id, false, 200);

  RETURN jsonb_build_object('success', true, 'account_code', v_code, 'slug', v_slug);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Payment method → account resolution
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

CREATE OR REPLACE FUNCTION payment_method_account_code(p_store_id UUID, p_method TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_auto BOOLEAN;
  v_label TEXT;
BEGIN
  SELECT coa.code INTO v_code
  FROM store_payment_methods spm
  JOIN chart_of_accounts coa ON coa.id = spm.account_id
  WHERE spm.store_id = p_store_id AND spm.slug = lower(trim(p_method)) AND spm.is_active = true AND coa.is_active = true
  LIMIT 1;

  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  IF p_method = 'credit' THEN
    RETURN coa_code(p_store_id, 'accounts_receivable');
  END IF;

  SELECT auto_create_payment_accounts INTO v_auto FROM stores WHERE id = p_store_id;

  IF COALESCE(v_auto, true) THEN
    v_label := CASE lower(trim(p_method))
      WHEN 'cash' THEN 'Cash'
      WHEN 'waafi' THEN 'WAAFI Wallet'
      WHEN 'evc' THEN 'EVC Plus Wallet'
      WHEN 'sahal' THEN 'Sahal Wallet'
      WHEN 'zaad' THEN 'Zaad Wallet'
      WHEN 'salaam' THEN 'Salaam Bank'
      WHEN 'premier' THEN 'Premier Bank'
      WHEN 'dahabshiil' THEN 'Dahabshiil Bank'
      ELSE initcap(replace(p_method, '_', ' ')) || ' Wallet'
    END;

    PERFORM ensure_store_payment_method(p_store_id, lower(trim(p_method)), v_label);

    SELECT coa.code INTO v_code
    FROM store_payment_methods spm
    JOIN chart_of_accounts coa ON coa.id = spm.account_id
    WHERE spm.store_id = p_store_id AND spm.slug = lower(trim(p_method)) AND spm.is_active = true
    LIMIT 1;

    IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  END IF;

  RETURN COALESCE(coa_code(p_store_id, 'cash'), payment_method_account_code(p_method));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION expense_category_account_code(p_category TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN '6500';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION expense_category_account_code(p_store_id UUID, p_category TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := coa_code(p_store_id, 'general_expenses');
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  RETURN expense_category_account_code(p_category);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- COA CRUD updates
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

  IF v_account.is_protected OR v_account.system_role IS NOT NULL OR v_account.is_system THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected accounts cannot be deleted');
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

  IF v_account.is_protected OR v_account.system_role IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected system accounts cannot be archived');
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

CREATE OR REPLACE FUNCTION update_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID,
  p_name TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL,
  p_account_type TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
  v_protected BOOLEAN;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;

  v_protected := v_account.is_protected OR v_account.system_role IS NOT NULL;

  IF v_protected AND p_code IS NOT NULL AND trim(p_code) <> v_account.code THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected account number cannot be changed');
  END IF;

  IF v_protected AND p_account_type IS NOT NULL AND p_account_type <> v_account.account_type THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected account type cannot be changed');
  END IF;

  IF p_parent_id IS NOT NULL AND p_parent_id = p_account_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account cannot be its own parent');
  END IF;

  UPDATE chart_of_accounts SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    code = CASE WHEN v_protected THEN code ELSE COALESCE(NULLIF(trim(p_code), ''), code) END,
    description = COALESCE(p_description, description),
    parent_id = COALESCE(p_parent_id, parent_id),
    account_type = CASE WHEN v_protected THEN account_type ELSE COALESCE(p_account_type, account_type) END,
    updated_at = NOW()
  WHERE id = p_account_id;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'chart_of_account', p_account_id, 'updated',
    jsonb_build_object('name', v_account.name, 'code', v_account.code),
    jsonb_build_object('name', p_name, 'code', p_code, 'description', p_description)
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Account number already exists');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_account_type TEXT,
  p_parent_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_id UUID;
  v_code TEXT;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_code IS NULL OR trim(p_code) = '' OR p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account number and name are required');
  END IF;

  v_code := trim(p_code);
  IF v_code !~ '^\d+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account number must be numeric');
  END IF;

  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_parent_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parent account not found');
  END IF;

  INSERT INTO chart_of_accounts (store_id, code, name, description, account_type, parent_id, is_system, is_protected, is_postable, is_active)
  VALUES (p_store_id, v_code, trim(p_name), NULLIF(trim(p_description), ''), p_account_type, p_parent_id, false, false, true, true)
  RETURNING id INTO v_id;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'chart_of_account', v_id, 'created',
    NULL, jsonb_build_object('code', v_code, 'name', p_name, 'account_type', p_account_type)
  );

  RETURN jsonb_build_object('success', true, 'account_id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Account number already exists');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Accounting settings
-- ============================================================
CREATE OR REPLACE FUNCTION update_store_accounting_settings(
  p_store_id UUID,
  p_user_id UUID,
  p_secondary_currency TEXT DEFAULT NULL,
  p_inventory_cost_method TEXT DEFAULT NULL,
  p_fiscal_year_start_month INT DEFAULT NULL,
  p_coa_number_prefix TEXT DEFAULT NULL,
  p_auto_create_payment_accounts BOOLEAN DEFAULT NULL
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

  SELECT inventory_cost_method INTO v_old_method FROM stores WHERE id = p_store_id;

  UPDATE stores SET
    secondary_currency = COALESCE(NULLIF(trim(p_secondary_currency), ''), secondary_currency),
    inventory_cost_method = COALESCE(p_inventory_cost_method, inventory_cost_method),
    fiscal_year_start_month = COALESCE(p_fiscal_year_start_month, fiscal_year_start_month),
    coa_number_prefix = COALESCE(p_coa_number_prefix, coa_number_prefix),
    auto_create_payment_accounts = COALESCE(p_auto_create_payment_accounts, auto_create_payment_accounts),
    updated_at = NOW()
  WHERE id = p_store_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'store', p_store_id, 'settings_updated', NULL,
    jsonb_build_object(
      'secondary_currency', p_secondary_currency,
      'inventory_cost_method', p_inventory_cost_method,
      'fiscal_year_start_month', p_fiscal_year_start_month,
      'coa_number_prefix', p_coa_number_prefix,
      'auto_create_payment_accounts', p_auto_create_payment_accounts,
      'previous_cost_method', v_old_method
    ));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Patch POS sale to use dynamic account codes
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
  p_notes TEXT,
  p_due_date DATE DEFAULT NULL
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
  v_resolved_due DATE;
  v_line_cogs DECIMAL(15,2);
  v_unit_cost DECIMAL(15,2);
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');
  v_revenue := p_total_amount - COALESCE(p_tax_amount, 0);
  v_resolved_due := COALESCE(
    p_due_date,
    NULLIF(p_payment_details->0->>'due_date', '')::DATE,
    CASE WHEN p_credit_amount > 0 THEN CURRENT_DATE + 30 ELSE NULL END
  );

  FOR v_check IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL, product_name TEXT)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_check.product_id AND store_id = p_store_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Product not found'); END IF;
    IF v_product.track_inventory AND v_product.stock_quantity < v_check.quantity THEN
      RETURN jsonb_build_object('success', false, 'error', format('Insufficient stock for %s', v_product.name));
    END IF;
  END LOOP;

  IF p_credit_amount > 0 AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Customer not found'); END IF;
    IF v_customer.credit_limit > 0 AND (v_customer.balance + p_credit_amount) > v_customer.credit_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Credit limit exceeded');
    END IF;
  END IF;

  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_invoice_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 5, '0');

  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, discount_type, tax_amount, total_amount,
    paid_amount, change_amount, credit_amount, payment_method, payment_details, notes, sale_date, due_date
  ) VALUES (
    p_store_id, v_invoice_number, p_customer_id, p_cashier_id, 'completed',
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount, p_change_amount, p_credit_amount, p_payment_method, p_payment_details, p_notes, NOW(), v_resolved_due
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, product_name TEXT, product_sku TEXT,
    quantity DECIMAL, unit_price DECIMAL, cost_price DECIMAL,
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL
  )
  LOOP
    v_line_cogs := 0;
    v_unit_cost := 0;

    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;

      IF v_cost_method = 'fifo' THEN
        v_line_cogs := consume_fifo_cost(p_store_id, v_item.product_id, v_item.quantity);
        v_unit_cost := CASE WHEN COALESCE(v_item.quantity, 0) > 0 THEN ROUND(v_line_cogs / v_item.quantity, 2) ELSE 0 END;
      ELSIF v_cost_method = 'lifo' THEN
        v_line_cogs := consume_lifo_cost(p_store_id, v_item.product_id, v_item.quantity);
        v_unit_cost := CASE WHEN COALESCE(v_item.quantity, 0) > 0 THEN ROUND(v_line_cogs / v_item.quantity, 2) ELSE 0 END;
      ELSE
        v_unit_cost := GREATEST(COALESCE(v_product.cost_price, 0), 0);
        v_line_cogs := ROUND(v_unit_cost * COALESCE(v_item.quantity, 0), 2);
      END IF;
    ELSE
      v_unit_cost := GREATEST(COALESCE(v_item.cost_price, 0), 0);
      v_line_cogs := ROUND(v_unit_cost * COALESCE(v_item.quantity, 0), 2);
    END IF;

    v_cogs_total := v_cogs_total + v_line_cogs;

    INSERT INTO sale_items (store_id, sale_id, product_id, product_name, product_sku, quantity, unit_price, cost_price, discount_amount, tax_amount, subtotal)
    VALUES (p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku, v_item.quantity, v_item.unit_price, v_unit_cost, v_item.discount_amount, v_item.tax_amount, v_item.subtotal);
  END LOOP;

  PERFORM process_sale_stock(p_store_id, v_sale_id, (
    SELECT jsonb_agg(jsonb_build_object('product_id', x.product_id, 'quantity', x.quantity))
    FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL)
  ), p_cashier_id);

  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET balance = balance + p_credit_amount, total_purchases = total_purchases + p_total_amount, updated_at = NOW()
    WHERE id = p_customer_id;
  END IF;

  IF v_revenue > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'sales_revenue'), 'debit', 0, 'credit', v_revenue, 'description', 'Sales revenue')
    );
  END IF;
  IF COALESCE(p_tax_amount, 0) > 0 AND coa_code(p_store_id, 'tax_payable') IS NOT NULL THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'tax_payable'), 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable')
    );
  END IF;
  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_store_id, p_payment_method);
    IF p_payment_method = 'credit' THEN
      v_payment_code := COALESCE(coa_code(p_store_id, 'cash'), v_payment_code);
    END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;
  IF p_credit_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'accounts_receivable'), 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;
  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'cogs'), 'debit', v_cogs_total, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('account_code', coa_code(p_store_id, 'inventory'), 'debit', 0, 'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', v_invoice_number, 'total', p_total_amount, 'cogs', v_cogs_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Patch receive PO journal lines to use dynamic account codes
CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_store_id UUID,
  p_po_id UUID,
  p_user_id UUID,
  p_paid_amount DECIMAL DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_due_date DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_product RECORD;
  v_before DECIMAL;
  v_after DECIMAL;
  v_prev_cost DECIMAL;
  v_new_cost DECIMAL;
  v_ap_amount DECIMAL;
  v_journal_lines JSONB := '[]'::JSONB;
  v_payment_code TEXT;
  v_cost_method TEXT;
  v_supplier_name TEXT;
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PO not found'); END IF;
  IF v_po.status IN ('received', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PO already closed');
  END IF;

  IF v_po.supplier_id IS NOT NULL THEN
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_po.supplier_id;
  END IF;

  FOR v_item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_before := COALESCE(v_product.stock_quantity, 0);
    v_prev_cost := GREATEST(COALESCE(v_product.cost_price, 0), 0);
    v_after := v_before + COALESCE(v_item.quantity, 0);

    v_new_cost := calculate_weighted_average_cost(
      v_before, v_prev_cost, v_item.quantity, v_item.unit_cost
    );

    UPDATE products SET
      stock_quantity = v_after,
      cost_price = v_new_cost,
      updated_at = NOW()
    WHERE id = v_item.product_id;

    PERFORM record_product_cost_history(
      p_store_id, v_item.product_id, v_new_cost, v_item.quantity, v_item.unit_cost,
      v_po.supplier_id, v_po.po_number, p_po_id, p_user_id,
      CASE WHEN v_supplier_name IS NOT NULL THEN 'Supplier: ' || v_supplier_name ELSE NULL END
    );

    IF v_cost_method IN ('fifo', 'lifo') AND COALESCE(v_item.quantity, 0) > 0 THEN
      INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
      VALUES (p_store_id, v_item.product_id, v_item.quantity, v_item.unit_cost, 'purchase_order', p_po_id);
    END IF;

    INSERT INTO stock_movements (store_id, product_id, movement_type, quantity_change, quantity_before, quantity_after, reference_id, reference_type, reason, created_by)
    VALUES (p_store_id, v_item.product_id, 'purchase', v_item.quantity, v_before, v_after, p_po_id, 'purchase_order', 'PO receive ' || v_po.po_number, p_user_id);

    UPDATE purchase_order_items SET received_quantity = v_item.quantity WHERE id = v_item.id;
  END LOOP;

  v_ap_amount := v_po.total_amount - p_paid_amount;

  UPDATE purchase_orders SET
    status = 'received',
    received_date = CURRENT_DATE,
    paid_amount = p_paid_amount,
    due_date = COALESCE(p_due_date, due_date, CURRENT_DATE + 30),
    updated_at = NOW()
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL AND v_ap_amount > 0 THEN
    UPDATE suppliers SET balance = balance + v_ap_amount, updated_at = NOW() WHERE id = v_po.supplier_id;
  END IF;

  v_journal_lines := v_journal_lines || jsonb_build_array(
    jsonb_build_object('account_code', coa_code(p_store_id, 'inventory'), 'debit', v_po.total_amount, 'credit', 0, 'description', 'Inventory purchase')
  );
  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_store_id, p_payment_method);
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_paid_amount, 'description', 'Purchase payment')
    );
  END IF;
  IF v_ap_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'accounts_payable'), 'debit', 0, 'credit', v_ap_amount, 'description', 'Accounts payable')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Purchase ' || v_po.po_number, p_po_id, 'purchase_order', p_user_id, v_journal_lines);

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'purchase_order', p_po_id, 'received', NULL,
    jsonb_build_object('po_number', v_po.po_number, 'total', v_po.total_amount, 'cost_method', v_cost_method));

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'ap_amount', v_ap_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
