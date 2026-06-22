-- Fix: multiple post_journal_entry overloads from migrations 005/006/007 cause
-- "function post_journal_entry(uuid, text, uuid, unknown, uuid, jsonb) is not unique"
-- Drop all signatures and keep one canonical function.

DROP FUNCTION IF EXISTS post_journal_entry(uuid, text, uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS post_journal_entry(uuid, text, uuid, text, uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS post_journal_entry(uuid, text, uuid, text, uuid, jsonb, boolean, date);

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
