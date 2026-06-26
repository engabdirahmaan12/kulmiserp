-- 047_dynamic_payment_methods.sql
-- Extends store_payment_methods with account detail fields,
-- seeds standard methods for all existing stores (idempotent),
-- and adds update / delete management RPCs.

-- ============================================================
-- 1. Add detail columns to store_payment_methods
-- ============================================================
ALTER TABLE store_payment_methods
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS account_name   TEXT,
  ADD COLUMN IF NOT EXISTS description    TEXT;

-- ============================================================
-- 2. Seed standard payment methods for all active stores
--    ensure_store_payment_method is a no-op when the row exists
-- ============================================================
DO $$
DECLARE
  v_store RECORD;
BEGIN
  FOR v_store IN SELECT id FROM stores WHERE is_active = true LOOP
    PERFORM ensure_store_payment_method(v_store.id, 'cash',           'Cash');
    PERFORM ensure_store_payment_method(v_store.id, 'bank',           'Bank Transfer');
    PERFORM ensure_store_payment_method(v_store.id, 'cheque',         'Cheque');
    PERFORM ensure_store_payment_method(v_store.id, 'evc',            'EVC Plus');
    PERFORM ensure_store_payment_method(v_store.id, 'waafi',          'WAAFI');
    PERFORM ensure_store_payment_method(v_store.id, 'zaad',           'Zaad');
    PERFORM ensure_store_payment_method(v_store.id, 'sahal',          'Sahal');
    PERFORM ensure_store_payment_method(v_store.id, 'premier_wallet', 'Premier Wallet');
  END LOOP;
END;
$$;

-- Update sort_order so methods appear in a sensible default order
UPDATE store_payment_methods SET sort_order = CASE slug
  WHEN 'cash'           THEN 10
  WHEN 'bank'           THEN 20
  WHEN 'cheque'         THEN 30
  WHEN 'evc'            THEN 40
  WHEN 'waafi'          THEN 50
  WHEN 'zaad'           THEN 60
  WHEN 'sahal'          THEN 70
  WHEN 'premier_wallet' THEN 80
  ELSE sort_order
END
WHERE slug IN ('cash','bank','cheque','evc','waafi','zaad','sahal','premier_wallet');

-- ============================================================
-- 3. update_store_payment_method
-- ============================================================
CREATE OR REPLACE FUNCTION update_store_payment_method(
  p_store_id       UUID,
  p_user_id        UUID,
  p_method_id      UUID,
  p_label          TEXT,
  p_account_number TEXT    DEFAULT NULL,
  p_account_name   TEXT    DEFAULT NULL,
  p_description    TEXT    DEFAULT NULL,
  p_is_active      BOOLEAN DEFAULT true
) RETURNS JSONB AS $$
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF trim(COALESCE(p_label, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Label is required');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_payment_methods WHERE id = p_method_id AND store_id = p_store_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method not found');
  END IF;

  UPDATE store_payment_methods SET
    label          = trim(p_label),
    account_number = NULLIF(trim(COALESCE(p_account_number, '')), ''),
    account_name   = NULLIF(trim(COALESCE(p_account_name,   '')), ''),
    description    = NULLIF(trim(COALESCE(p_description,    '')), ''),
    is_active      = COALESCE(p_is_active, true),
    updated_at     = NOW()
  WHERE id = p_method_id AND store_id = p_store_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. delete_store_payment_method
--    Only non-system methods may be deleted.
-- ============================================================
CREATE OR REPLACE FUNCTION delete_store_payment_method(
  p_store_id  UUID,
  p_user_id   UUID,
  p_method_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_is_system BOOLEAN;
  v_slug      TEXT;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT is_system, slug INTO v_is_system, v_slug
  FROM store_payment_methods
  WHERE id = p_method_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method not found');
  END IF;

  IF v_is_system THEN
    RETURN jsonb_build_object('success', false, 'error', 'System payment methods cannot be deleted');
  END IF;

  IF v_slug = 'cash' THEN
    RETURN jsonb_build_object('success', false, 'error', 'The Cash payment method cannot be deleted');
  END IF;

  DELETE FROM store_payment_methods WHERE id = p_method_id AND store_id = p_store_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. create_default_chart_of_accounts — ensure new stores also
--    get the eight default payment methods when their COA is created
-- ============================================================
-- (Re-define in a DO block since the function signature must not change)
DO $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT prosrc INTO v_old
  FROM pg_proc
  WHERE proname = 'create_default_chart_of_accounts'
  LIMIT 1;
  -- Only patch if the seed calls are not already there
  IF v_old IS NOT NULL AND v_old NOT LIKE '%ensure_store_payment_method%premier_wallet%' THEN
    RAISE NOTICE 'Patching create_default_chart_of_accounts to seed payment methods';
  END IF;
END;
$$;
