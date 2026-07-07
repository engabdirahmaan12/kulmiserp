-- ============================================================
-- 055: Fix broken post_journal_entry calls in 048 (Customer Advances &
-- Fund Transfers) and 049 (Employee Loans & Supplier Advances). Those
-- calls passed arguments in the wrong order
-- (store_id, user_id, NOW(), description, reference_id, reference_type,
-- lines) instead of the real signature
-- (store_id, description, reference_id, reference_type, created_by, lines,
-- [is_auto], [entry_date]) — causing
-- "function post_journal_entry(uuid, uuid, timestamp with time zone,
-- text, uuid, unknown, jsonb) does not exist".
--
-- Because each function wraps its body in EXCEPTION WHEN OTHERS, this
-- error was being swallowed and the WHOLE transaction (advance/loan/transfer
-- record, balance update, everything) was silently rolled back every single
-- time — Customer Advances, Fund Transfers, Employee Loans, and Supplier
-- Advances have never actually worked. This migration only corrects the
-- post_journal_entry argument order; no other logic changes.
-- ============================================================

CREATE OR REPLACE FUNCTION create_customer_advance(
  p_store_id      UUID,
  p_user_id       UUID,
  p_customer_id   UUID,
  p_amount        DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes         TEXT    DEFAULT NULL,
  p_reference     TEXT    DEFAULT NULL,
  p_due_date      DATE    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_advance_id   UUID;
  v_asset_code   TEXT;
  v_advance_code TEXT := '1250';
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND store_id = p_store_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  INSERT INTO customer_advances (
    store_id, customer_id, original_amount, outstanding_balance,
    status, payment_method, notes, reference, due_date, created_by
  ) VALUES (
    p_store_id, p_customer_id, p_amount, p_amount,
    'outstanding', COALESCE(p_payment_method, 'cash'), p_notes, p_reference, p_due_date, p_user_id
  ) RETURNING id INTO v_advance_id;

  UPDATE customers SET advance_balance = advance_balance + p_amount WHERE id = p_customer_id;

  v_asset_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));

  PERFORM post_journal_entry(
    p_store_id,
    CONCAT('Cash advance to customer', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
    v_advance_id, 'customer_advance', p_user_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_advance_code, 'debit', p_amount, 'credit', 0,   'description', 'Customer advance receivable'),
      jsonb_build_object('account_code', v_asset_code,   'debit', 0,       'credit', p_amount, 'description', 'Cash paid out as advance')
    )
  );

  RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id, 'outstanding_balance', p_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION repay_customer_advance(
  p_store_id      UUID,
  p_user_id       UUID,
  p_advance_id    UUID,
  p_amount        DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes         TEXT DEFAULT NULL,
  p_reference     TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_advance        customer_advances%ROWTYPE;
  v_new_outstanding DECIMAL;
  v_asset_code      TEXT;
  v_advance_code    TEXT := '1250';
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_advance FROM customer_advances WHERE id = p_advance_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Advance not found');
  END IF;

  IF v_advance.status = 'settled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This advance is already settled');
  END IF;

  IF p_amount > v_advance.outstanding_balance THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Amount exceeds outstanding balance of %s', v_advance.outstanding_balance));
  END IF;

  INSERT INTO customer_advance_payments (
    store_id, advance_id, customer_id, amount, payment_method, notes, reference, created_by
  ) VALUES (
    p_store_id, p_advance_id, v_advance.customer_id, p_amount,
    COALESCE(p_payment_method, 'cash'), p_notes, p_reference, p_user_id
  );

  v_new_outstanding := v_advance.outstanding_balance - p_amount;
  UPDATE customer_advances SET
    outstanding_balance = v_new_outstanding,
    status = CASE WHEN v_new_outstanding <= 0 THEN 'settled' WHEN v_new_outstanding < original_amount THEN 'partial' ELSE 'outstanding' END
  WHERE id = p_advance_id;

  UPDATE customers SET advance_balance = GREATEST(0, advance_balance - p_amount) WHERE id = v_advance.customer_id;

  v_asset_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));

  PERFORM post_journal_entry(
    p_store_id,
    CONCAT('Advance repayment from customer', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
    p_advance_id, 'advance_repayment', p_user_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_asset_code,   'debit', p_amount, 'credit', 0,       'description', 'Cash received as advance repayment'),
      jsonb_build_object('account_code', v_advance_code, 'debit', 0,       'credit', p_amount, 'description', 'Customer advance receivable settled')
    )
  );

  RETURN jsonb_build_object('success', true, 'new_outstanding', v_new_outstanding);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_fund_transfer(
  p_store_id    UUID,
  p_user_id     UUID,
  p_from_method TEXT,
  p_to_method   TEXT,
  p_amount      DECIMAL,
  p_reference   TEXT DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_transfer_id  UUID;
  v_from_code    TEXT;
  v_to_code      TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF p_from_method = p_to_method THEN
    RETURN jsonb_build_object('success', false, 'error', 'From and To accounts must be different');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  INSERT INTO fund_transfers (
    store_id, from_method, to_method, amount, reference, notes, transfer_date, created_by
  ) VALUES (
    p_store_id, p_from_method, p_to_method, p_amount, p_reference, p_notes, NOW(), p_user_id
  ) RETURNING id INTO v_transfer_id;

  v_from_code := payment_method_account_code(p_store_id, p_from_method);
  v_to_code   := payment_method_account_code(p_store_id, p_to_method);

  PERFORM post_journal_entry(
    p_store_id,
    CONCAT('Fund transfer: ', p_from_method, ' → ', p_to_method,
           CASE WHEN p_reference IS NOT NULL THEN ' (' || p_reference || ')' ELSE '' END),
    v_transfer_id, 'fund_transfer', p_user_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to_code,   'debit', p_amount, 'credit', 0,       'description', CONCAT('Transfer in from ', p_from_method)),
      jsonb_build_object('account_code', v_from_code, 'debit', 0,       'credit', p_amount, 'description', CONCAT('Transfer out to ', p_to_method))
    )
  );

  RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_employee_loan(
  p_store_id       UUID,
  p_user_id        UUID,
  p_employee_id    UUID,
  p_amount         DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_reason         TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_reference      TEXT DEFAULT NULL,
  p_due_date       DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_loan_id    UUID;
  v_cash_code  TEXT;
  v_loan_code  TEXT := '1260';
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND store_id = p_store_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Employee not found');
  END IF;

  INSERT INTO employee_loans (
    store_id, employee_id, original_amount, outstanding_balance,
    status, payment_method, reason, notes, reference, due_date, created_by
  ) VALUES (
    p_store_id, p_employee_id, p_amount, p_amount,
    'outstanding', COALESCE(p_payment_method, 'cash'), p_reason, p_notes, p_reference, p_due_date, p_user_id
  ) RETURNING id INTO v_loan_id;

  UPDATE employees SET loan_balance = loan_balance + p_amount WHERE id = p_employee_id;

  v_cash_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
  PERFORM post_journal_entry(
    p_store_id,
    CONCAT('Employee loan', CASE WHEN p_reason IS NOT NULL THEN ' - ' || p_reason ELSE '' END),
    v_loan_id, 'employee_loan', p_user_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_loan_code, 'debit', p_amount, 'credit', 0,       'description', 'Employee advance receivable'),
      jsonb_build_object('account_code', v_cash_code, 'debit', 0,        'credit', p_amount, 'description', 'Cash paid to employee')
    )
  );

  RETURN jsonb_build_object('success', true, 'loan_id', v_loan_id, 'outstanding_balance', p_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION repay_employee_loan(
  p_store_id       UUID,
  p_user_id        UUID,
  p_loan_id        UUID,
  p_amount         DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes          TEXT DEFAULT NULL,
  p_reference      TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_loan            employee_loans%ROWTYPE;
  v_new_outstanding DECIMAL;
  v_cash_code       TEXT;
  v_loan_code       TEXT := '1260';
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_loan FROM employee_loans WHERE id = p_loan_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Loan not found');
  END IF;
  IF v_loan.status = 'settled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This loan is already settled');
  END IF;
  IF p_amount > v_loan.outstanding_balance THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Amount exceeds outstanding balance of %s', v_loan.outstanding_balance));
  END IF;

  INSERT INTO employee_loan_payments (
    store_id, loan_id, employee_id, amount, payment_method, notes, reference, created_by
  ) VALUES (
    p_store_id, p_loan_id, v_loan.employee_id, p_amount,
    COALESCE(p_payment_method, 'cash'), p_notes, p_reference, p_user_id
  );

  v_new_outstanding := v_loan.outstanding_balance - p_amount;
  UPDATE employee_loans SET
    outstanding_balance = v_new_outstanding,
    status = CASE WHEN v_new_outstanding <= 0 THEN 'settled'
                  WHEN v_new_outstanding < original_amount THEN 'partial' ELSE 'outstanding' END
  WHERE id = p_loan_id;

  UPDATE employees SET loan_balance = GREATEST(0, loan_balance - p_amount) WHERE id = v_loan.employee_id;

  v_cash_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
  PERFORM post_journal_entry(
    p_store_id,
    CONCAT('Employee loan repayment', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
    p_loan_id, 'employee_loan_repayment', p_user_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_cash_code, 'debit', p_amount, 'credit', 0,       'description', 'Cash received from employee'),
      jsonb_build_object('account_code', v_loan_code, 'debit', 0,        'credit', p_amount, 'description', 'Employee advance settled')
    )
  );

  RETURN jsonb_build_object('success', true, 'new_outstanding', v_new_outstanding);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_supplier_advance(
  p_store_id       UUID,
  p_user_id        UUID,
  p_supplier_id    UUID,
  p_amount         DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_reason         TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_reference      TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_advance_id UUID;
  v_cash_code  TEXT;
  v_adv_code   TEXT := '1270';
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND store_id = p_store_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Supplier not found');
  END IF;

  INSERT INTO supplier_advances (
    store_id, supplier_id, original_amount, outstanding_balance,
    status, payment_method, reason, notes, reference, created_by
  ) VALUES (
    p_store_id, p_supplier_id, p_amount, p_amount,
    'outstanding', COALESCE(p_payment_method, 'cash'), p_reason, p_notes, p_reference, p_user_id
  ) RETURNING id INTO v_advance_id;

  UPDATE suppliers SET advance_balance = advance_balance + p_amount WHERE id = p_supplier_id;

  v_cash_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
  PERFORM post_journal_entry(
    p_store_id,
    CONCAT('Supplier advance', CASE WHEN p_reason IS NOT NULL THEN ' - ' || p_reason ELSE '' END),
    v_advance_id, 'supplier_advance', p_user_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_adv_code,  'debit', p_amount, 'credit', 0,       'description', 'Prepayment to supplier'),
      jsonb_build_object('account_code', v_cash_code, 'debit', 0,        'credit', p_amount, 'description', 'Cash paid to supplier')
    )
  );

  RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id, 'outstanding_balance', p_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION settle_supplier_advance(
  p_store_id       UUID,
  p_user_id        UUID,
  p_advance_id     UUID,
  p_amount         DECIMAL,
  p_settle_mode    TEXT DEFAULT 'refund',
  p_payment_method TEXT DEFAULT 'cash',
  p_notes          TEXT DEFAULT NULL,
  p_reference      TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_advance         supplier_advances%ROWTYPE;
  v_new_outstanding DECIMAL;
  v_cash_code       TEXT;
  v_ap_code         TEXT;
  v_adv_code        TEXT := '1270';
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_advance FROM supplier_advances WHERE id = p_advance_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Advance not found');
  END IF;
  IF v_advance.status = 'settled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This advance is already settled');
  END IF;
  IF p_amount > v_advance.outstanding_balance THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Amount exceeds remaining advance of %s', v_advance.outstanding_balance));
  END IF;

  INSERT INTO supplier_advance_payments (
    store_id, advance_id, supplier_id, amount, payment_method, notes, reference, created_by
  ) VALUES (
    p_store_id, p_advance_id, v_advance.supplier_id, p_amount,
    COALESCE(p_payment_method, 'cash'), p_notes, p_reference, p_user_id
  );

  v_new_outstanding := v_advance.outstanding_balance - p_amount;
  UPDATE supplier_advances SET
    outstanding_balance = v_new_outstanding,
    status = CASE WHEN v_new_outstanding <= 0 THEN 'settled'
                  WHEN v_new_outstanding < original_amount THEN 'partial' ELSE 'outstanding' END
  WHERE id = p_advance_id;

  UPDATE suppliers SET advance_balance = GREATEST(0, advance_balance - p_amount) WHERE id = v_advance.supplier_id;

  IF p_settle_mode = 'purchase' THEN
    SELECT code INTO v_ap_code FROM chart_of_accounts
    WHERE store_id = p_store_id AND system_role = 'accounts_payable' LIMIT 1;
    v_ap_code := COALESCE(v_ap_code, '2100');
    PERFORM post_journal_entry(
      p_store_id,
      CONCAT('Supplier advance applied to purchase', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
      p_advance_id, 'supplier_advance_applied', p_user_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_ap_code,  'debit', p_amount, 'credit', 0,       'description', 'Advance offsets payable'),
        jsonb_build_object('account_code', v_adv_code, 'debit', 0,        'credit', p_amount, 'description', 'Supplier advance relieved')
      )
    );
  ELSE
    v_cash_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
    PERFORM post_journal_entry(
      p_store_id,
      CONCAT('Supplier advance refund', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
      p_advance_id, 'supplier_advance_refund', p_user_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cash_code, 'debit', p_amount, 'credit', 0,       'description', 'Cash refunded by supplier'),
        jsonb_build_object('account_code', v_adv_code,  'debit', 0,        'credit', p_amount, 'description', 'Supplier advance relieved')
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'new_outstanding', v_new_outstanding);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
