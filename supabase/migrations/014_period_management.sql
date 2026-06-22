-- ============================================================
-- 014: Enhanced Accounting Period Management
-- ============================================================

-- ── Extend accounting_periods ──────────────────────────────
ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'reopened')),
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Sync status with is_closed for existing rows
UPDATE accounting_periods SET status = CASE WHEN is_closed THEN 'closed' ELSE 'open' END
  WHERE status = 'open';

-- ── Period override log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS period_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  reason TEXT NOT NULL,
  transaction_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE period_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS period_overrides_store ON period_overrides;
CREATE POLICY period_overrides_store ON period_overrides FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ── Period snapshots (archive on close) ───────────────────
CREATE TABLE IF NOT EXISTS period_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by UUID REFERENCES auth.users(id),
  total_sales DECIMAL(15,2) DEFAULT 0,
  total_purchases DECIMAL(15,2) DEFAULT 0,
  total_expenses DECIMAL(15,2) DEFAULT 0,
  gross_profit DECIMAL(15,2) DEFAULT 0,
  net_profit DECIMAL(15,2) DEFAULT 0,
  inventory_value DECIMAL(15,2) DEFAULT 0,
  total_ar DECIMAL(15,2) DEFAULT 0,
  total_ap DECIMAL(15,2) DEFAULT 0,
  cash_balance DECIMAL(15,2) DEFAULT 0,
  journal_count INTEGER DEFAULT 0,
  snapshot_data JSONB DEFAULT '{}'
);

ALTER TABLE period_archives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS period_archives_store ON period_archives;
CREATE POLICY period_archives_store ON period_archives FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ── Helper: compute period KPIs ───────────────────────────
CREATE OR REPLACE FUNCTION get_period_kpis(
  p_store_id UUID,
  p_period_start DATE,
  p_period_end DATE
) RETURNS JSONB AS $$
DECLARE
  v_sales DECIMAL := 0;
  v_purchases DECIMAL := 0;
  v_expenses DECIMAL := 0;
  v_net_profit DECIMAL := 0;
  v_ar DECIMAL := 0;
  v_ap DECIMAL := 0;
  v_journals INTEGER := 0;
BEGIN
  SELECT COALESCE(SUM(total_amount), 0) INTO v_sales
  FROM sales
  WHERE store_id = p_store_id
    AND status IN ('completed', 'paid')
    AND sale_date::DATE BETWEEN p_period_start AND p_period_end;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_purchases
  FROM purchase_orders
  WHERE store_id = p_store_id
    AND status = 'received'
    AND created_at::DATE BETWEEN p_period_start AND p_period_end;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM expenses
  WHERE store_id = p_store_id
    AND status = 'approved'
    AND expense_date BETWEEN p_period_start AND p_period_end;

  SELECT COALESCE(SUM(balance), 0) INTO v_ar
  FROM customers
  WHERE store_id = p_store_id AND balance > 0;

  SELECT COALESCE(SUM(balance), 0) INTO v_ap
  FROM suppliers
  WHERE store_id = p_store_id AND balance > 0;

  SELECT COUNT(*) INTO v_journals
  FROM journal_entries
  WHERE store_id = p_store_id
    AND entry_date BETWEEN p_period_start AND p_period_end;

  v_net_profit := v_sales - v_purchases - v_expenses;

  RETURN jsonb_build_object(
    'total_sales', v_sales,
    'total_purchases', v_purchases,
    'total_expenses', v_expenses,
    'gross_profit', v_sales - v_purchases,
    'net_profit', v_net_profit,
    'total_ar', v_ar,
    'total_ap', v_ap,
    'journal_count', v_journals
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ── Reopen period RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION reopen_accounting_period(
  p_store_id UUID,
  p_user_id UUID,
  p_period_id UUID,
  p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_period RECORD;
BEGIN
  SELECT role INTO v_role
  FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;

  IF v_role NOT IN ('owner', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and accountants can reopen periods');
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason is required to reopen a period');
  END IF;

  SELECT * INTO v_period FROM accounting_periods
  WHERE id = p_period_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Period not found');
  END IF;

  IF NOT v_period.is_closed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Period is already open');
  END IF;

  -- Reopen: unlock journals in this period
  UPDATE journal_entries
  SET is_locked = false
  WHERE store_id = p_store_id
    AND entry_date BETWEEN v_period.period_start AND v_period.period_end;

  -- Update period status
  UPDATE accounting_periods SET
    is_closed = false,
    status = 'reopened',
    reopened_at = NOW(),
    reopened_by = p_user_id,
    reopen_reason = p_reason
  WHERE id = p_period_id;

  -- Audit log
  INSERT INTO accounting_audit_logs (store_id, user_id, action, entity_type, entity_id, new_values)
  VALUES (p_store_id, p_user_id, 'reopen_period', 'accounting_period', p_period_id,
    jsonb_build_object('period_name', v_period.name, 'reason', p_reason));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Override: post into closed period (owner only) ─────────
CREATE OR REPLACE FUNCTION override_post_to_closed_period(
  p_store_id UUID,
  p_user_id UUID,
  p_period_id UUID,
  p_reason TEXT,
  p_transaction_ref TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;

  IF v_role <> 'owner' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners can override closed periods');
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason is required');
  END IF;

  INSERT INTO period_overrides (store_id, period_id, user_id, reason, transaction_ref)
  VALUES (p_store_id, p_period_id, p_user_id, p_reason, p_transaction_ref);

  INSERT INTO accounting_audit_logs (store_id, user_id, action, entity_type, entity_id, new_values)
  VALUES (p_store_id, p_user_id, 'override_closed_period', 'accounting_period', p_period_id,
    jsonb_build_object('reason', p_reason, 'transaction_ref', p_transaction_ref));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Enhanced close_accounting_period (adds archive) ────────
CREATE OR REPLACE FUNCTION close_accounting_period(
  p_store_id UUID,
  p_user_id UUID,
  p_period_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_period RECORD;
  v_kpis JSONB;
BEGIN
  SELECT role INTO v_role
  FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;

  IF v_role NOT IN ('owner', 'manager', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
  END IF;

  SELECT * INTO v_period FROM accounting_periods
  WHERE id = p_period_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Period not found');
  END IF;

  IF v_period.is_closed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Period already closed');
  END IF;

  -- Lock all journal entries in this date range
  UPDATE journal_entries SET is_locked = true
  WHERE store_id = p_store_id
    AND entry_date BETWEEN v_period.period_start AND v_period.period_end;

  -- Close the period
  UPDATE accounting_periods SET
    is_closed = true,
    status = 'closed',
    closed_at = NOW(),
    closed_by = p_user_id
  WHERE id = p_period_id;

  -- Compute and store archive snapshot
  v_kpis := get_period_kpis(p_store_id, v_period.period_start::DATE, v_period.period_end::DATE);

  INSERT INTO period_archives (
    store_id, period_id, archived_by,
    total_sales, total_purchases, total_expenses,
    gross_profit, net_profit, total_ar, total_ap, journal_count,
    snapshot_data
  ) VALUES (
    p_store_id, p_period_id, p_user_id,
    (v_kpis->>'total_sales')::DECIMAL,
    (v_kpis->>'total_purchases')::DECIMAL,
    (v_kpis->>'total_expenses')::DECIMAL,
    (v_kpis->>'gross_profit')::DECIMAL,
    (v_kpis->>'net_profit')::DECIMAL,
    (v_kpis->>'total_ar')::DECIMAL,
    (v_kpis->>'total_ap')::DECIMAL,
    (v_kpis->>'journal_count')::INTEGER,
    v_kpis
  )
  ON CONFLICT DO NOTHING;

  -- Audit
  INSERT INTO accounting_audit_logs (store_id, user_id, action, entity_type, entity_id, new_values)
  VALUES (p_store_id, p_user_id, 'close_period', 'accounting_period', p_period_id,
    jsonb_build_object('period_name', v_period.name, 'kpis', v_kpis));

  RETURN jsonb_build_object('success', true, 'kpis', v_kpis);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC: get period with archive data ─────────────────────
CREATE OR REPLACE FUNCTION get_periods_with_archives(p_store_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ap.id,
      'name', ap.name,
      'period_start', ap.period_start,
      'period_end', ap.period_end,
      'is_closed', ap.is_closed,
      'status', ap.status,
      'closed_at', ap.closed_at,
      'closed_by', ap.closed_by,
      'reopened_at', ap.reopened_at,
      'reopen_reason', ap.reopen_reason,
      'created_at', ap.created_at,
      'archive', CASE WHEN pa.id IS NOT NULL THEN
        jsonb_build_object(
          'total_sales', pa.total_sales,
          'total_purchases', pa.total_purchases,
          'total_expenses', pa.total_expenses,
          'gross_profit', pa.gross_profit,
          'net_profit', pa.net_profit,
          'total_ar', pa.total_ar,
          'total_ap', pa.total_ap,
          'journal_count', pa.journal_count,
          'archived_at', pa.archived_at
        )
      ELSE NULL END
    ) ORDER BY ap.period_start DESC
  )
  INTO v_result
  FROM accounting_periods ap
  LEFT JOIN period_archives pa ON pa.period_id = ap.id AND pa.store_id = p_store_id
  WHERE ap.store_id = p_store_id;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ── Backdated protection: surface closed-period check ──────
-- This function returns whether a given date is inside a closed period
CREATE OR REPLACE FUNCTION is_date_in_closed_period(
  p_store_id UUID,
  p_date DATE
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE store_id = p_store_id
      AND is_closed = true
      AND p_date BETWEEN period_start AND period_end
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
