-- KULMIS ERP: Enterprise accounting hardening
-- Hierarchical COA, archive/restore, RLS write protection, GL RPC, role alignment

-- ============================================================
-- Schema extensions
-- ============================================================
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_coa_store_active_code ON chart_of_accounts(store_id, is_active, code);
CREATE INDEX IF NOT EXISTS idx_journal_lines_store_account ON journal_lines(store_id, account_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_store_date ON journal_entries(store_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_audit_store ON accounting_audit_logs(store_id, created_at DESC);

-- ============================================================
-- Role helpers (owner + accountant = write; manager = read)
-- ============================================================
CREATE OR REPLACE FUNCTION accounting_can_write(p_store_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_users
    WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
      AND role IN ('owner', 'accountant')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION accounting_can_view(p_store_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_users
    WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
      AND role IN ('owner', 'accountant', 'manager', 'purchase_officer')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_protected_system_account(p_code TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_code IN ('1200', '2100', '1300', '4100', '5100', '3200', '3300');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION account_has_transactions(p_account_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM journal_lines WHERE account_id = p_account_id
    UNION ALL
    SELECT 1 FROM expenses WHERE account_id = p_account_id
    LIMIT 1
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- get_account_id: active accounts only
-- ============================================================
CREATE OR REPLACE FUNCTION get_account_id(p_store_id UUID, p_code TEXT)
RETURNS UUID AS $$
  SELECT id FROM chart_of_accounts
  WHERE store_id = p_store_id AND code = p_code AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- Hierarchical default chart of accounts + Opening Balance Equity
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
DECLARE
  v_ids JSONB := '{}'::JSONB;
  v_code TEXT;
  v_id UUID;
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_active) VALUES
  (p_store_id, '1000', 'Current Assets', 'asset', true, true),
  (p_store_id, '1100', 'Cash and Cash Equivalents', 'asset', true, true),
  (p_store_id, '1110', 'Cash on Hand', 'asset', true, true),
  (p_store_id, '1120', 'WAAFI Account', 'asset', true, true),
  (p_store_id, '1130', 'EVC Plus Account', 'asset', true, true),
  (p_store_id, '1140', 'Sahal Account', 'asset', true, true),
  (p_store_id, '1150', 'Zaad Account', 'asset', true, true),
  (p_store_id, '1160', 'Salaam Bank', 'asset', true, true),
  (p_store_id, '1165', 'Premier Bank', 'asset', true, true),
  (p_store_id, '1170', 'Dahabshiil Bank', 'asset', true, true),
  (p_store_id, '1200', 'Accounts Receivable', 'asset', true, true),
  (p_store_id, '1300', 'Inventory', 'asset', true, true),
  (p_store_id, '2000', 'Current Liabilities', 'liability', true, true),
  (p_store_id, '2100', 'Accounts Payable', 'liability', true, true),
  (p_store_id, '2200', 'Tax Payable', 'liability', true, true),
  (p_store_id, '3000', 'Owner Equity', 'equity', true, true),
  (p_store_id, '3100', 'Capital', 'equity', true, true),
  (p_store_id, '3200', 'Retained Earnings', 'equity', true, true),
  (p_store_id, '3300', 'Opening Balance Equity', 'equity', true, true),
  (p_store_id, '4000', 'Revenue', 'revenue', true, true),
  (p_store_id, '4100', 'Product Sales Revenue', 'revenue', true, true),
  (p_store_id, '5000', 'Cost of Goods Sold', 'cogs', true, true),
  (p_store_id, '5100', 'COGS - Products', 'cogs', true, true),
  (p_store_id, '6000', 'Operating Expenses', 'expense', true, true),
  (p_store_id, '6100', 'Rent Expense', 'expense', true, true),
  (p_store_id, '6200', 'Utilities Expense', 'expense', true, true),
  (p_store_id, '6300', 'Salaries Expense', 'expense', true, true),
  (p_store_id, '6400', 'Marketing Expense', 'expense', true, true),
  (p_store_id, '6500', 'Miscellaneous Expense', 'expense', true, true)
  ON CONFLICT (store_id, code) DO NOTHING;

  FOR v_code IN SELECT code FROM chart_of_accounts WHERE store_id = p_store_id
  LOOP
    SELECT id INTO v_id FROM chart_of_accounts WHERE store_id = p_store_id AND code = v_code;
    v_ids := v_ids || jsonb_build_object(v_code, v_id);
  END LOOP;

  UPDATE chart_of_accounts SET parent_id = (v_ids->>'1000')::UUID WHERE store_id = p_store_id AND code IN ('1100','1200','1300');
  UPDATE chart_of_accounts SET parent_id = (v_ids->>'1100')::UUID WHERE store_id = p_store_id AND code IN ('1110','1120','1130','1140','1150','1160','1165','1170');
  UPDATE chart_of_accounts SET parent_id = (v_ids->>'2000')::UUID WHERE store_id = p_store_id AND code IN ('2100','2200');
  UPDATE chart_of_accounts SET parent_id = (v_ids->>'3000')::UUID WHERE store_id = p_store_id AND code IN ('3100','3200','3300');
  UPDATE chart_of_accounts SET parent_id = (v_ids->>'4000')::UUID WHERE store_id = p_store_id AND code = '4100';
  UPDATE chart_of_accounts SET parent_id = (v_ids->>'5000')::UUID WHERE store_id = p_store_id AND code = '5100';
  UPDATE chart_of_accounts SET parent_id = (v_ids->>'6000')::UUID WHERE store_id = p_store_id AND code IN ('6100','6200','6300','6400','6500');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill Opening Balance Equity + hierarchy for existing stores
INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_active)
SELECT s.id, '3300', 'Opening Balance Equity', 'equity', true, true
FROM stores s
ON CONFLICT (store_id, code) DO NOTHING;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM stores LOOP
    PERFORM create_default_chart_of_accounts(r.id);
  END LOOP;
END $$;

-- Auto-seed COA on new store
CREATE OR REPLACE FUNCTION seed_store_chart_of_accounts()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_chart_of_accounts(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_store_created_seed_coa ON stores;
CREATE TRIGGER on_store_created_seed_coa
  AFTER INSERT ON stores
  FOR EACH ROW
  EXECUTE FUNCTION seed_store_chart_of_accounts();

-- ============================================================
-- post_journal_entry: fail on missing/inactive accounts
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
    v_debit := COALESCE(v_line.debit, 0);
    v_credit := COALESCE(v_line.credit, 0);
    IF v_debit = 0 AND v_credit = 0 THEN CONTINUE; END IF;

    v_account_id := get_account_id(p_store_id, v_line.account_code);
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Account code % not found or inactive for store', v_line.account_code;
    END IF;

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
-- Chart of Accounts CRUD (enterprise)
-- ============================================================
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
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_code IS NULL OR trim(p_code) = '' OR p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Code and name are required');
  END IF;

  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_parent_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parent account not found');
  END IF;

  INSERT INTO chart_of_accounts (store_id, code, name, description, account_type, parent_id, is_system, is_active)
  VALUES (p_store_id, trim(p_code), trim(p_name), NULLIF(trim(p_description), ''), p_account_type, p_parent_id, false, true)
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
  p_code TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL,
  p_account_type TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;

  IF v_account.is_system AND p_code IS NOT NULL AND trim(p_code) <> v_account.code THEN
    RETURN jsonb_build_object('success', false, 'error', 'System account code cannot be changed');
  END IF;

  IF v_account.is_system AND p_account_type IS NOT NULL AND p_account_type <> v_account.account_type THEN
    RETURN jsonb_build_object('success', false, 'error', 'System account type cannot be changed');
  END IF;

  IF p_parent_id IS NOT NULL AND p_parent_id = p_account_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account cannot be its own parent');
  END IF;

  UPDATE chart_of_accounts SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    code = CASE WHEN v_account.is_system THEN code ELSE COALESCE(NULLIF(trim(p_code), ''), code) END,
    description = COALESCE(p_description, description),
    parent_id = COALESCE(p_parent_id, parent_id),
    account_type = CASE WHEN v_account.is_system THEN account_type ELSE COALESCE(p_account_type, account_type) END,
    updated_at = NOW()
  WHERE id = p_account_id;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'chart_of_account', p_account_id, 'updated',
    jsonb_build_object('name', v_account.name, 'code', v_account.code),
    jsonb_build_object('name', p_name, 'code', p_code, 'description', p_description)
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Account code already exists');
WHEN OTHERS THEN
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

  IF v_account.is_system OR is_protected_system_account(v_account.code) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected system accounts cannot be archived');
  END IF;

  IF v_account.balance <> 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete account because it contains transactions.');
  END IF;

  IF account_has_transactions(p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete account because it contains transactions.');
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

CREATE OR REPLACE FUNCTION restore_chart_account(
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

  IF v_account.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account is already active');
  END IF;

  IF v_account.parent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = v_account.parent_id AND is_active = false
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Restore parent account first');
  END IF;

  UPDATE chart_of_accounts SET is_active = true, archived_at = NULL, updated_at = NOW() WHERE id = p_account_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'chart_of_account', p_account_id, 'restored', NULL, NULL);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alias legacy deactivate → archive
CREATE OR REPLACE FUNCTION deactivate_chart_account(
  p_store_id UUID, p_user_id UUID, p_account_id UUID
) RETURNS JSONB AS $$
  SELECT archive_chart_account(p_store_id, p_user_id, p_account_id);
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- General Ledger RPC (opening balance + pagination)
-- ============================================================
CREATE OR REPLACE FUNCTION get_general_ledger(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_opening DECIMAL(15,2) := 0;
  v_total INT;
  v_lines JSONB;
BEGIN
  IF NOT accounting_can_view(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_account_id IS NOT NULL AND p_date_from IS NOT NULL THEN
    SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) INTO v_opening
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.store_id = p_store_id AND jl.account_id = p_account_id
      AND je.entry_date < p_date_from;
  ELSIF p_account_id IS NOT NULL THEN
    SELECT balance INTO v_opening FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id;
    SELECT v_opening - COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) INTO v_opening
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.store_id = p_store_id AND jl.account_id = p_account_id
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.store_id = p_store_id
    AND (p_account_id IS NULL OR jl.account_id = p_account_id)
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR je.entry_date <= p_date_to);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.entry_date ASC, t.created_at ASC), '[]'::JSONB)
  INTO v_lines
  FROM (
    SELECT
      jl.id,
      jl.debit_amount,
      jl.credit_amount,
      jl.description AS line_description,
      jl.created_at,
      je.entry_number,
      je.entry_date,
      je.description AS entry_description,
      je.reference_type,
      a.code AS account_code,
      a.name AS account_name
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN chart_of_accounts a ON a.id = jl.account_id
    WHERE jl.store_id = p_store_id
      AND (p_account_id IS NULL OR jl.account_id = p_account_id)
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
    ORDER BY je.entry_date ASC, jl.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'opening_balance', v_opening,
    'total', v_total,
    'lines', v_lines
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Align manual journal + period RPCs with accountant role
-- ============================================================
CREATE OR REPLACE FUNCTION create_manual_journal_entry(
  p_store_id UUID,
  p_user_id UUID,
  p_description TEXT,
  p_entry_date DATE DEFAULT CURRENT_DATE,
  p_lines JSONB DEFAULT '[]'::JSONB
) RETURNS JSONB AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and accountants can post correction entries');
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least two journal lines required');
  END IF;

  v_entry_id := post_journal_entry(
    p_store_id, p_description, NULL, 'manual', p_user_id, p_lines, false, p_entry_date
  );

  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS: read-only direct access; writes via SECURITY DEFINER RPCs
-- ============================================================
DROP POLICY IF EXISTS "Store members can access chart_of_accounts" ON chart_of_accounts;
DROP POLICY IF EXISTS "Store members can access journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "Store members can access journal_lines" ON journal_lines;
DROP POLICY IF EXISTS "Store members can access accounting_audit_logs" ON accounting_audit_logs;

CREATE POLICY "coa_select" ON chart_of_accounts
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "je_select" ON journal_entries
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "jl_select" ON journal_lines
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "audit_select" ON accounting_audit_logs
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

-- Expenses: keep read for all; writes via RPC (existing policy allows direct - tighten insert/update)
DROP POLICY IF EXISTS "Store members can access expenses" ON expenses;
CREATE POLICY "expenses_select" ON expenses
  FOR SELECT USING (user_has_store_access(auth.uid(), store_id));

-- Opening stock posts to Opening Balance Equity (3300)
CREATE OR REPLACE FUNCTION record_stock_adjustment(
  p_store_id UUID,
  p_user_id UUID,
  p_product_id UUID,
  p_quantity_after DECIMAL,
  p_reason TEXT DEFAULT NULL,
  p_movement_type TEXT DEFAULT 'adjustment'
) RETURNS JSONB AS $$
DECLARE
  v_product RECORD;
  v_before DECIMAL(15,3);
  v_after DECIMAL(15,3);
  v_change DECIMAL(15,3);
  v_value DECIMAL(15,2);
  v_movement_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_credit_account TEXT;
BEGIN
  IF p_quantity_after < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity cannot be negative');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;
  IF NOT v_product.track_inventory THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product does not track inventory');
  END IF;

  v_before := v_product.stock_quantity;
  v_after := ROUND(p_quantity_after, 3);
  v_change := v_after - v_before;

  IF ABS(v_change) < 0.0001 THEN
    RETURN jsonb_build_object('success', true, 'message', 'No change', 'quantity_after', v_after);
  END IF;

  UPDATE products SET stock_quantity = v_after, updated_at = NOW() WHERE id = p_product_id;

  INSERT INTO stock_movements (
    store_id, product_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, created_by
  ) VALUES (
    p_store_id, p_product_id, 'adjustment', v_change, v_before, v_after,
    COALESCE(p_reason, p_movement_type), p_user_id
  ) RETURNING id INTO v_movement_id;

  v_value := ROUND(ABS(v_change) * COALESCE(v_product.cost_price, 0), 2);

  IF v_value > 0 THEN
    IF v_change > 0 THEN
      v_credit_account := CASE WHEN p_movement_type = 'opening' THEN '3300' ELSE '3200' END;
      v_journal_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1300', 'debit', v_value, 'credit', 0, 'description', 'Inventory increase'),
        jsonb_build_object('account_code', v_credit_account, 'debit', 0, 'credit', v_value, 'description', COALESCE(p_reason, 'Stock increase'))
      );
    ELSE
      v_journal_lines := jsonb_build_array(
        jsonb_build_object('account_code', '6500', 'debit', v_value, 'credit', 0, 'description', 'Inventory shrinkage'),
        jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_value, 'description', COALESCE(p_reason, 'Stock decrease'))
      );
    END IF;

    PERFORM post_journal_entry(
      p_store_id,
      'Stock ' || CASE WHEN v_change > 0 THEN 'increase' ELSE 'decrease' END || ': ' || v_product.name,
      v_movement_id, 'stock_adjustment', p_user_id, v_journal_lines, true
    );
  END IF;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'stock_movement', v_movement_id, p_movement_type,
    jsonb_build_object('before', v_before),
    jsonb_build_object('after', v_after, 'value', v_value)
  );

  RETURN jsonb_build_object(
    'success', true, 'movement_id', v_movement_id,
    'quantity_before', v_before, 'quantity_after', v_after, 'gl_value', v_value
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
