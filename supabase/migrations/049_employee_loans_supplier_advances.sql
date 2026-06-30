-- 049_employee_loans_supplier_advances.sql
-- Employee Loans (store lends money to staff) and Supplier Advances
-- (store prepays a supplier), each with full double-entry GL integration.
-- Also extends list_store_transactions so the Transaction Center surfaces
-- customer advances, employee loans, supplier advances and fund transfers.

-- ============================================================
-- 1. employees.loan_balance  &  suppliers.advance_balance
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_balance     DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS advance_balance  DECIMAL(15,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 2. employee_loans — store lends money to an employee
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_loans (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id            UUID          NOT NULL REFERENCES stores(id)    ON DELETE CASCADE,
  employee_id         UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  original_amount     DECIMAL(15,2) NOT NULL CHECK (original_amount > 0),
  outstanding_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  status              TEXT          NOT NULL DEFAULT 'outstanding'
                      CHECK (status IN ('outstanding', 'partial', 'settled')),
  payment_method      TEXT          NOT NULL DEFAULT 'cash',
  reason              TEXT,
  notes               TEXT,
  reference           TEXT,
  due_date            DATE,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_loans_store    ON employee_loans(store_id);
CREATE INDEX IF NOT EXISTS idx_emp_loans_employee ON employee_loans(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emp_loans_status   ON employee_loans(store_id, status) WHERE status <> 'settled';

ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emp_loans_store_access" ON employee_loans
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

CREATE TABLE IF NOT EXISTS employee_loan_payments (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id       UUID          NOT NULL REFERENCES stores(id)          ON DELETE CASCADE,
  loan_id        UUID          NOT NULL REFERENCES employee_loans(id)  ON DELETE CASCADE,
  employee_id    UUID          NOT NULL REFERENCES employees(id)       ON DELETE CASCADE,
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT          NOT NULL DEFAULT 'cash',
  notes          TEXT,
  reference      TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_loan_pmts_store ON employee_loan_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_emp_loan_pmts_loan  ON employee_loan_payments(loan_id, created_at DESC);

ALTER TABLE employee_loan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emp_loan_pmts_store_access" ON employee_loan_payments
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- 3. supplier_advances — store prepays a supplier
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_advances (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id            UUID          NOT NULL REFERENCES stores(id)    ON DELETE CASCADE,
  supplier_id         UUID          NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  original_amount     DECIMAL(15,2) NOT NULL CHECK (original_amount > 0),
  outstanding_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  status              TEXT          NOT NULL DEFAULT 'outstanding'
                      CHECK (status IN ('outstanding', 'partial', 'settled')),
  payment_method      TEXT          NOT NULL DEFAULT 'cash',
  reason              TEXT,
  notes               TEXT,
  reference           TEXT,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sup_advances_store    ON supplier_advances(store_id);
CREATE INDEX IF NOT EXISTS idx_sup_advances_supplier ON supplier_advances(supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_advances_status   ON supplier_advances(store_id, status) WHERE status <> 'settled';

ALTER TABLE supplier_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sup_advances_store_access" ON supplier_advances
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- Drawdowns / settlements against a supplier advance (e.g. applied to a purchase
-- or refunded back to cash).
CREATE TABLE IF NOT EXISTS supplier_advance_payments (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id       UUID          NOT NULL REFERENCES stores(id)           ON DELETE CASCADE,
  advance_id     UUID          NOT NULL REFERENCES supplier_advances(id) ON DELETE CASCADE,
  supplier_id    UUID          NOT NULL REFERENCES suppliers(id)        ON DELETE CASCADE,
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT          NOT NULL DEFAULT 'cash',
  notes          TEXT,
  reference      TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sup_adv_pmts_store   ON supplier_advance_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_sup_adv_pmts_advance ON supplier_advance_payments(advance_id, created_at DESC);

ALTER TABLE supplier_advance_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sup_adv_pmts_store_access" ON supplier_advance_payments
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- 4. Chart of Accounts — 1260 Employee Advances, 1270 Supplier Advances
--    Both are asset accounts (the store is owed value).
-- ============================================================
DO $$
DECLARE
  v_store  RECORD;
  v_parent UUID;
BEGIN
  FOR v_store IN SELECT id FROM stores WHERE is_active = true LOOP
    SELECT id INTO v_parent FROM chart_of_accounts
    WHERE store_id = v_store.id AND system_role = 'accounts_receivable' LIMIT 1;

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE store_id = v_store.id AND code = '1260') THEN
      INSERT INTO chart_of_accounts (
        store_id, code, name, account_type, parent_id,
        is_system, is_protected, is_postable, system_role, is_active
      ) VALUES (
        v_store.id, '1260', 'Employee Advances Receivable', 'asset', v_parent,
        true, true, true, 'employee_advances_receivable', true
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE store_id = v_store.id AND code = '1270') THEN
      INSERT INTO chart_of_accounts (
        store_id, code, name, account_type, parent_id,
        is_system, is_protected, is_postable, system_role, is_active
      ) VALUES (
        v_store.id, '1270', 'Supplier Advances', 'asset', v_parent,
        true, true, true, 'supplier_advances', true
      );
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 5. create_employee_loan RPC  (DR 1260 / CR cash)
-- ============================================================
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
    p_store_id, p_user_id, NOW(),
    CONCAT('Employee loan', CASE WHEN p_reason IS NOT NULL THEN ' - ' || p_reason ELSE '' END),
    v_loan_id, 'employee_loan',
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

-- ============================================================
-- 6. repay_employee_loan RPC  (DR cash / CR 1260)
-- ============================================================
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
    p_store_id, p_user_id, NOW(),
    CONCAT('Employee loan repayment', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
    p_loan_id, 'employee_loan_repayment',
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

-- ============================================================
-- 7. get_employee_loans RPC  (per-employee loans + payments)
-- ============================================================
CREATE OR REPLACE FUNCTION get_employee_loans(
  p_store_id    UUID,
  p_employee_id UUID,
  p_limit       INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC)
  INTO v_rows
  FROM (
    SELECT el.*,
      COALESCE(
        (SELECT jsonb_agg(row_to_json(p) ORDER BY p.created_at)
         FROM employee_loan_payments p WHERE p.loan_id = el.id),
        '[]'::jsonb
      ) AS payments
    FROM employee_loans el
    WHERE el.store_id = p_store_id AND el.employee_id = p_employee_id
    ORDER BY el.created_at DESC
    LIMIT p_limit
  ) a;

  RETURN jsonb_build_object(
    'success', true,
    'loans', COALESCE(v_rows, '[]'::jsonb),
    'total_outstanding', (
      SELECT COALESCE(SUM(outstanding_balance), 0) FROM employee_loans
      WHERE store_id = p_store_id AND employee_id = p_employee_id AND status <> 'settled'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. list_employee_loans RPC  (store-wide, joined with names)
-- ============================================================
CREATE OR REPLACE FUNCTION list_employee_loans(
  p_store_id     UUID,
  p_status       TEXT DEFAULT NULL,
  p_limit        INT  DEFAULT 200
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
  INTO v_rows
  FROM (
    SELECT el.*, e.full_name AS employee_name, e.role_title AS employee_role,
      COALESCE(
        (SELECT jsonb_agg(row_to_json(p) ORDER BY p.created_at)
         FROM employee_loan_payments p WHERE p.loan_id = el.id),
        '[]'::jsonb
      ) AS payments
    FROM employee_loans el
    JOIN employees e ON e.id = el.employee_id
    WHERE el.store_id = p_store_id
      AND (p_status IS NULL OR p_status = '' OR el.status = p_status)
    ORDER BY el.created_at DESC
    LIMIT p_limit
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'loans', COALESCE(v_rows, '[]'::jsonb),
    'total_outstanding', (
      SELECT COALESCE(SUM(outstanding_balance), 0) FROM employee_loans
      WHERE store_id = p_store_id AND status <> 'settled'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 9. create_supplier_advance RPC  (DR 1270 / CR cash)
-- ============================================================
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
    p_store_id, p_user_id, NOW(),
    CONCAT('Supplier advance', CASE WHEN p_reason IS NOT NULL THEN ' - ' || p_reason ELSE '' END),
    v_advance_id, 'supplier_advance',
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

-- ============================================================
-- 10. settle_supplier_advance RPC
--     Draw down a supplier advance. p_settle_mode:
--       'purchase' = advance consumed against a purchase (DR Inventory/AP offset
--                    is handled by the purchase itself; here we just relieve the
--                    advance to AP — DR 2100 Accounts Payable / CR 1270).
--       'refund'   = supplier returns the cash (DR cash / CR 1270).
-- ============================================================
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
      p_store_id, p_user_id, NOW(),
      CONCAT('Supplier advance applied to purchase', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
      p_advance_id, 'supplier_advance_applied',
      jsonb_build_array(
        jsonb_build_object('account_code', v_ap_code,  'debit', p_amount, 'credit', 0,       'description', 'Advance offsets payable'),
        jsonb_build_object('account_code', v_adv_code, 'debit', 0,        'credit', p_amount, 'description', 'Supplier advance relieved')
      )
    );
  ELSE
    v_cash_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
    PERFORM post_journal_entry(
      p_store_id, p_user_id, NOW(),
      CONCAT('Supplier advance refund', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
      p_advance_id, 'supplier_advance_refund',
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

-- ============================================================
-- 11. get_supplier_advances RPC  (per-supplier)
-- ============================================================
CREATE OR REPLACE FUNCTION get_supplier_advances(
  p_store_id    UUID,
  p_supplier_id UUID,
  p_limit       INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC)
  INTO v_rows
  FROM (
    SELECT sa.*,
      COALESCE(
        (SELECT jsonb_agg(row_to_json(p) ORDER BY p.created_at)
         FROM supplier_advance_payments p WHERE p.advance_id = sa.id),
        '[]'::jsonb
      ) AS payments
    FROM supplier_advances sa
    WHERE sa.store_id = p_store_id AND sa.supplier_id = p_supplier_id
    ORDER BY sa.created_at DESC
    LIMIT p_limit
  ) a;

  RETURN jsonb_build_object(
    'success', true,
    'advances', COALESCE(v_rows, '[]'::jsonb),
    'total_outstanding', (
      SELECT COALESCE(SUM(outstanding_balance), 0) FROM supplier_advances
      WHERE store_id = p_store_id AND supplier_id = p_supplier_id AND status <> 'settled'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. list_supplier_advances RPC  (store-wide, joined with names)
-- ============================================================
CREATE OR REPLACE FUNCTION list_supplier_advances(
  p_store_id UUID,
  p_status   TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 200
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
  INTO v_rows
  FROM (
    SELECT sa.*, sup.name AS supplier_name,
      COALESCE(
        (SELECT jsonb_agg(row_to_json(p) ORDER BY p.created_at)
         FROM supplier_advance_payments p WHERE p.advance_id = sa.id),
        '[]'::jsonb
      ) AS payments
    FROM supplier_advances sa
    JOIN suppliers sup ON sup.id = sa.supplier_id
    WHERE sa.store_id = p_store_id
      AND (p_status IS NULL OR p_status = '' OR sa.status = p_status)
    ORDER BY sa.created_at DESC
    LIMIT p_limit
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'advances', COALESCE(v_rows, '[]'::jsonb),
    'total_outstanding', (
      SELECT COALESCE(SUM(outstanding_balance), 0) FROM supplier_advances
      WHERE store_id = p_store_id AND status <> 'settled'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_employee_loan(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION repay_employee_loan(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_employee_loans(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION list_employee_loans(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_supplier_advance(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION settle_supplier_advance(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_supplier_advances(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION list_supplier_advances(UUID, TEXT, INT) TO authenticated;

-- ============================================================
-- 13. Extend list_store_transactions — Transaction Center now surfaces
--     customer advances, employee loans, supplier advances and fund transfers
--     alongside sales/purchases/expenses/payments/deposits.
-- ============================================================
CREATE OR REPLACE FUNCTION list_store_transactions(
  p_store_id    UUID,
  p_page        INTEGER DEFAULT 1,
  p_page_size   INTEGER DEFAULT 25,
  p_type        TEXT    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_date_from   DATE    DEFAULT NULL,
  p_date_to     DATE    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_offset INTEGER;
  v_total  BIGINT;
  v_items  JSONB;
  v_tz     TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT verify_store_access(p_store_id, auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(timezone, 'Africa/Mogadishu') INTO v_tz FROM stores WHERE id = p_store_id;
  IF v_tz IS NULL THEN v_tz := 'Africa/Mogadishu'; END IF;

  v_offset := GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);

  WITH unified AS (
    SELECT s.id, 'sale'::TEXT AS tx_type, s.invoice_number AS reference,
      COALESCE(c.full_name, 'Walk-in') AS party_name, s.total_amount AS amount,
      s.payment_method::TEXT, s.status::TEXT, s.sale_date AS tx_date, s.created_at, s.cashier_id AS user_id
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.store_id = p_store_id AND s.status IN ('completed', 'refunded', 'partially_refunded', 'void')

    UNION ALL
    SELECT po.id, 'purchase'::TEXT, COALESCE(po.po_number, 'PO-' || LEFT(po.id::TEXT, 8)),
      COALESCE(sup.name, 'Supplier'), po.total_amount, NULL::TEXT, po.status::TEXT,
      COALESCE(po.received_date::TIMESTAMPTZ, po.created_at), po.created_at, po.created_by
    FROM purchase_orders po
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    WHERE po.store_id = p_store_id AND po.status IN ('received', 'partial')

    UNION ALL
    SELECT pr.id, 'purchase_return'::TEXT, pr.return_number,
      COALESCE(sup.name, 'Supplier'), -pr.total_amount, NULL::TEXT, 'completed'::TEXT,
      pr.created_at, pr.created_at, pr.created_by
    FROM purchase_returns pr
    LEFT JOIN suppliers sup ON sup.id = pr.supplier_id
    WHERE pr.store_id = p_store_id

    UNION ALL
    SELECT e.id, 'expense'::TEXT, COALESCE(e.reference, 'EXP-' || LEFT(e.id::TEXT, 8)),
      COALESCE(e.category, e.description, 'Expense'), e.amount, e.payment_method::TEXT,
      COALESCE(e.status, 'approved')::TEXT, e.expense_date::TIMESTAMPTZ, e.created_at, e.created_by
    FROM expenses e
    WHERE e.store_id = p_store_id AND COALESCE(e.status, 'approved') <> 'void'

    UNION ALL
    SELECT dp.id, 'payment_received'::TEXT, 'PMT-' || LEFT(dp.id::TEXT, 8),
      COALESCE(c.full_name, 'Customer'), dp.amount, dp.payment_method::TEXT, 'completed'::TEXT,
      dp.payment_date, dp.payment_date, dp.created_by
    FROM debt_payments dp
    LEFT JOIN customers c ON c.id = dp.customer_id
    WHERE dp.store_id = p_store_id

    UNION ALL
    SELECT sp.id, 'supplier_payment'::TEXT, 'SPM-' || LEFT(sp.id::TEXT, 8),
      COALESCE(sup.name, 'Supplier'), -sp.amount, sp.payment_method::TEXT, 'completed'::TEXT,
      sp.payment_date, sp.payment_date, sp.created_by
    FROM supplier_payments sp
    LEFT JOIN suppliers sup ON sup.id = sp.supplier_id
    WHERE sp.store_id = p_store_id

    UNION ALL
    SELECT cm.id,
      CASE cm.movement_type WHEN 'deposit' THEN 'deposit' ELSE 'withdrawal' END,
      COALESCE(cm.reference, UPPER(cm.movement_type) || '-' || LEFT(cm.id::TEXT, 8)),
      'Cash / Bank',
      CASE cm.movement_type WHEN 'withdrawal' THEN -cm.amount ELSE cm.amount END,
      cm.payment_method::TEXT, 'completed'::TEXT,
      cm.movement_date, cm.created_at, cm.created_by
    FROM cash_movements cm
    WHERE cm.store_id = p_store_id

    UNION ALL
    SELECT cd.id, 'customer_deposit'::TEXT, 'DEP-' || LEFT(cd.id::TEXT, 8),
      COALESCE(c.full_name, 'Customer'), cd.amount,
      cd.payment_method::TEXT, 'completed'::TEXT,
      cd.created_at, cd.created_at, cd.created_by
    FROM customer_deposits cd
    LEFT JOIN customers c ON c.id = cd.customer_id
    WHERE cd.store_id = p_store_id AND cd.type = 'deposit'

    UNION ALL
    SELECT ca.id, 'customer_advance'::TEXT, COALESCE(ca.reference, 'CADV-' || LEFT(ca.id::TEXT, 8)),
      COALESCE(c.full_name, 'Customer'), -ca.original_amount,
      ca.payment_method::TEXT, ca.status::TEXT,
      ca.created_at, ca.created_at, ca.created_by
    FROM customer_advances ca
    LEFT JOIN customers c ON c.id = ca.customer_id
    WHERE ca.store_id = p_store_id

    UNION ALL
    SELECT el.id, 'employee_loan'::TEXT, COALESCE(el.reference, 'ELN-' || LEFT(el.id::TEXT, 8)),
      COALESCE(e.full_name, 'Employee'), -el.original_amount,
      el.payment_method::TEXT, el.status::TEXT,
      el.created_at, el.created_at, el.created_by
    FROM employee_loans el
    LEFT JOIN employees e ON e.id = el.employee_id
    WHERE el.store_id = p_store_id

    UNION ALL
    SELECT sa.id, 'supplier_advance'::TEXT, COALESCE(sa.reference, 'SADV-' || LEFT(sa.id::TEXT, 8)),
      COALESCE(sup.name, 'Supplier'), -sa.original_amount,
      sa.payment_method::TEXT, sa.status::TEXT,
      sa.created_at, sa.created_at, sa.created_by
    FROM supplier_advances sa
    LEFT JOIN suppliers sup ON sup.id = sa.supplier_id
    WHERE sa.store_id = p_store_id

    UNION ALL
    SELECT ft.id, 'transfer'::TEXT, COALESCE(ft.reference, 'TRF-' || LEFT(ft.id::TEXT, 8)),
      CONCAT(ft.from_method, ' → ', ft.to_method), ft.amount,
      NULL::TEXT, 'completed'::TEXT,
      ft.transfer_date, ft.created_at, ft.created_by
    FROM fund_transfers ft
    WHERE ft.store_id = p_store_id
  ),
  filtered AS (
    SELECT * FROM unified u
    WHERE (p_type IS NULL OR p_type = '' OR u.tx_type = p_type)
      AND (p_date_from IS NULL OR (u.tx_date AT TIME ZONE v_tz)::date >= p_date_from)
      AND (p_date_to IS NULL OR (u.tx_date AT TIME ZONE v_tz)::date <= p_date_to)
      AND (p_search IS NULL OR p_search = ''
           OR u.reference ILIKE '%' || p_search || '%'
           OR u.party_name ILIKE '%' || p_search || '%')
  ),
  paged AS (
    SELECT id, tx_type, reference, party_name, amount, payment_method, status, tx_date, created_at, user_id
    FROM filtered ORDER BY tx_date DESC
    LIMIT GREATEST(p_page_size, 1) OFFSET v_offset
  )
  SELECT (SELECT COUNT(*)::BIGINT FROM filtered),
    COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tx_date DESC) FROM paged p), '[]'::JSONB)
  INTO v_total, v_items;

  RETURN jsonb_build_object('success', true, 'items', v_items, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION list_store_transactions(UUID, INTEGER, INTEGER, TEXT, TEXT, DATE, DATE) TO authenticated;
