-- KULMIS ERP: expense/debt/supplier payment GL posting + manual journals

-- ============================================================
-- Enhanced post_journal_entry (balanced entries + manual flag)
-- ============================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_store_id UUID,
  p_description TEXT,
  p_reference_id UUID,
  p_reference_type TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_is_auto BOOLEAN DEFAULT true
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

  INSERT INTO journal_entries (store_id, entry_number, description, reference_id, reference_type, is_auto, created_by)
  VALUES (p_store_id, v_entry_number, p_description, p_reference_id, p_reference_type, p_is_auto, p_created_by)
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

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Expense category → GL account
-- ============================================================
CREATE OR REPLACE FUNCTION expense_category_account_code(p_category TEXT)
RETURNS TEXT AS $$
BEGIN
  CASE COALESCE(p_category, '')
    WHEN 'Rent' THEN RETURN '6100';
    WHEN 'Utilities' THEN RETURN '6200';
    WHEN 'Salaries' THEN RETURN '6300';
    WHEN 'Marketing' THEN RETURN '6400';
    WHEN 'Supplies' THEN RETURN '6500';
    WHEN 'Transport' THEN RETURN '6500';
    WHEN 'Insurance' THEN RETURN '6500';
    WHEN 'Maintenance' THEN RETURN '6500';
    WHEN 'Food' THEN RETURN '6500';
    ELSE RETURN '6500';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- Record expense + journal (DR expense / CR cash)
-- ============================================================
CREATE OR REPLACE FUNCTION record_expense(
  p_store_id UUID,
  p_user_id UUID,
  p_description TEXT,
  p_amount DECIMAL,
  p_category TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash',
  p_expense_date DATE DEFAULT CURRENT_DATE,
  p_reference TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_expense_id UUID;
  v_expense_code TEXT;
  v_payment_code TEXT;
  v_account_id UUID;
  v_journal_lines JSONB;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  v_expense_code := expense_category_account_code(p_category);
  v_payment_code := payment_method_account_code(p_payment_method);
  v_account_id := get_account_id(p_store_id, v_expense_code);

  INSERT INTO expenses (
    store_id, account_id, amount, description, category,
    payment_method, reference, expense_date, created_by
  ) VALUES (
    p_store_id, v_account_id, p_amount, p_description, p_category,
    p_payment_method, p_reference, p_expense_date, p_user_id
  ) RETURNING id INTO v_expense_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_expense_code, 'debit', p_amount, 'credit', 0, 'description', p_description),
    jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_amount, 'description', 'Expense payment')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Expense: ' || p_description, v_expense_id, 'expense', p_user_id, v_journal_lines, true
  );

  RETURN jsonb_build_object('success', true, 'expense_id', v_expense_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Record customer debt payment + journal (DR cash / CR AR)
-- ============================================================
CREATE OR REPLACE FUNCTION record_debt_payment(
  p_store_id UUID,
  p_user_id UUID,
  p_customer_id UUID,
  p_amount DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes TEXT DEFAULT NULL,
  p_sale_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
  v_payment_id UUID;
  v_payment_code TEXT;
  v_journal_lines JSONB;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  IF p_amount > v_customer.balance THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment exceeds customer balance');
  END IF;

  v_payment_code := payment_method_account_code(p_payment_method);

  UPDATE customers SET
    balance = GREATEST(0, balance - p_amount),
    updated_at = NOW()
  WHERE id = p_customer_id;

  INSERT INTO debt_payments (
    store_id, customer_id, amount, payment_method, notes, sale_id, payment_date, created_by
  ) VALUES (
    p_store_id, p_customer_id, p_amount, p_payment_method, p_notes, p_sale_id, NOW(), p_user_id
  ) RETURNING id INTO v_payment_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_payment_code, 'debit', p_amount, 'credit', 0, 'description', 'Debt payment received'),
    jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', p_amount, 'description', 'Accounts receivable reduction')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Debt payment: ' || v_customer.full_name, v_payment_id, 'debt_payment', p_user_id, v_journal_lines, true
  );

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'new_balance', GREATEST(0, v_customer.balance - p_amount));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Record supplier payment + journal (DR AP / CR cash)
-- ============================================================
CREATE OR REPLACE FUNCTION record_supplier_payment(
  p_store_id UUID,
  p_user_id UUID,
  p_supplier_id UUID,
  p_amount DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes TEXT DEFAULT NULL,
  p_purchase_order_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_supplier RECORD;
  v_payment_id UUID;
  v_payment_code TEXT;
  v_journal_lines JSONB;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_supplier FROM suppliers WHERE id = p_supplier_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Supplier not found');
  END IF;

  IF p_amount > v_supplier.balance THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment exceeds supplier balance');
  END IF;

  v_payment_code := payment_method_account_code(p_payment_method);

  UPDATE suppliers SET
    balance = GREATEST(0, balance - p_amount),
    updated_at = NOW()
  WHERE id = p_supplier_id;

  INSERT INTO supplier_payments (
    store_id, supplier_id, purchase_order_id, amount, payment_method, notes, payment_date, created_by
  ) VALUES (
    p_store_id, p_supplier_id, p_purchase_order_id, p_amount, p_payment_method, p_notes, NOW(), p_user_id
  ) RETURNING id INTO v_payment_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', '2100', 'debit', p_amount, 'credit', 0, 'description', 'Accounts payable payment'),
    jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_amount, 'description', 'Supplier payment')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Supplier payment: ' || v_supplier.name, v_payment_id, 'supplier_payment', p_user_id, v_journal_lines, true
  );

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'new_balance', GREATEST(0, v_supplier.balance - p_amount));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Manual journal entry
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
  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least two journal lines required');
  END IF;

  v_entry_id := post_journal_entry(
    p_store_id, p_description, NULL, 'manual', p_user_id, p_lines, false
  );

  UPDATE journal_entries SET entry_date = p_entry_date WHERE id = v_entry_id;

  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
