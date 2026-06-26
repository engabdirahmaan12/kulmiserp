-- 048_advances_fund_transfers.sql
-- Customer Cash Advances, Fund Transfers between accounts,
-- Customer Statement view, and full GL integration.

-- ============================================================
-- 1. customer_advances — store lends money to customer
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_advances (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id           UUID          NOT NULL REFERENCES stores(id)     ON DELETE CASCADE,
  customer_id        UUID          NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  original_amount    DECIMAL(15,2) NOT NULL CHECK (original_amount > 0),
  outstanding_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  status             TEXT          NOT NULL DEFAULT 'outstanding'
                     CHECK (status IN ('outstanding', 'partial', 'settled')),
  payment_method     TEXT          NOT NULL DEFAULT 'cash',
  notes              TEXT,
  reference          TEXT,
  due_date           DATE,
  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cust_advances_store    ON customer_advances(store_id);
CREATE INDEX IF NOT EXISTS idx_cust_advances_customer ON customer_advances(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_advances_status   ON customer_advances(store_id, status) WHERE status <> 'settled';

ALTER TABLE customer_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cust_advances_store_access" ON customer_advances
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- 2. customer_advance_payments — repayments on an advance
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_advance_payments (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id       UUID          NOT NULL REFERENCES stores(id)             ON DELETE CASCADE,
  advance_id     UUID          NOT NULL REFERENCES customer_advances(id)  ON DELETE CASCADE,
  customer_id    UUID          NOT NULL REFERENCES customers(id)          ON DELETE CASCADE,
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT          NOT NULL DEFAULT 'cash',
  notes          TEXT,
  reference      TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advance_pmts_store    ON customer_advance_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_advance_pmts_advance  ON customer_advance_payments(advance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advance_pmts_customer ON customer_advance_payments(customer_id);

ALTER TABLE customer_advance_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cust_advance_pmts_store_access" ON customer_advance_payments
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- 3. fund_transfers — inter-account transfers
-- ============================================================
CREATE TABLE IF NOT EXISTS fund_transfers (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id      UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  from_method   TEXT          NOT NULL,
  to_method     TEXT          NOT NULL,
  amount        DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  reference     TEXT,
  notes         TEXT,
  transfer_date TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fund_transfers_store ON fund_transfers(store_id, transfer_date DESC);

ALTER TABLE fund_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fund_transfers_store_access" ON fund_transfers
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- 4. advance_balance column on customers
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS advance_balance DECIMAL(15,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 5. COA account 1250 — Customer Advances Receivable
--    Asset account: store is owed this money by customers
-- ============================================================
DO $$
DECLARE
  v_store    RECORD;
  v_parent   UUID;
BEGIN
  FOR v_store IN SELECT id FROM stores WHERE is_active = true LOOP
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts WHERE store_id = v_store.id AND code = '1250'
    ) THEN
      SELECT id INTO v_parent FROM chart_of_accounts
      WHERE store_id = v_store.id AND system_role = 'accounts_receivable' LIMIT 1;

      INSERT INTO chart_of_accounts (
        store_id, code, name, account_type, parent_id,
        is_system, is_protected, is_postable, system_role, is_active
      ) VALUES (
        v_store.id, '1250', 'Customer Advances Receivable', 'asset', v_parent,
        true, true, true, 'customer_advances_receivable', true
      );
    END IF;
  END LOOP;
END;
$$;

-- Patch create_default_chart_of_accounts to include 1250 and 2300 for new stores
-- We do this by rebuilding the accounts inserted by the function via a trigger
-- (simpler: ensure_coa_for_store will call create_default_chart_of_accounts which
--  already inserts 2300 via migration 046 patch; we add 1250 here).

-- ============================================================
-- 6. create_customer_advance RPC
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

  -- Insert advance record
  INSERT INTO customer_advances (
    store_id, customer_id, original_amount, outstanding_balance,
    status, payment_method, notes, reference, due_date, created_by
  ) VALUES (
    p_store_id, p_customer_id, p_amount, p_amount,
    'outstanding', COALESCE(p_payment_method, 'cash'), p_notes, p_reference, p_due_date, p_user_id
  ) RETURNING id INTO v_advance_id;

  -- Update customer advance_balance
  UPDATE customers SET advance_balance = advance_balance + p_amount WHERE id = p_customer_id;

  -- GL posting: DR 1250 (Customer Advances Receivable) / CR Payment Account
  v_asset_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));

  PERFORM post_journal_entry(
    p_store_id, p_user_id, NOW(),
    CONCAT('Cash advance to customer', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
    v_advance_id, 'customer_advance',
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

-- ============================================================
-- 7. repay_customer_advance RPC
-- ============================================================
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

  -- Insert payment record
  INSERT INTO customer_advance_payments (
    store_id, advance_id, customer_id, amount, payment_method, notes, reference, created_by
  ) VALUES (
    p_store_id, p_advance_id, v_advance.customer_id, p_amount,
    COALESCE(p_payment_method, 'cash'), p_notes, p_reference, p_user_id
  );

  -- Update outstanding balance and status
  v_new_outstanding := v_advance.outstanding_balance - p_amount;
  UPDATE customer_advances SET
    outstanding_balance = v_new_outstanding,
    status = CASE WHEN v_new_outstanding <= 0 THEN 'settled' WHEN v_new_outstanding < original_amount THEN 'partial' ELSE 'outstanding' END
  WHERE id = p_advance_id;

  -- Update customer advance_balance
  UPDATE customers SET advance_balance = GREATEST(0, advance_balance - p_amount) WHERE id = v_advance.customer_id;

  -- GL: DR Payment Account / CR 1250 (Customer Advances Receivable)
  v_asset_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));

  PERFORM post_journal_entry(
    p_store_id, p_user_id, NOW(),
    CONCAT('Advance repayment from customer', CASE WHEN p_reference IS NOT NULL THEN ' - ' || p_reference ELSE '' END),
    p_advance_id, 'advance_repayment',
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

-- ============================================================
-- 8. get_customer_advances RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_customer_advances(
  p_store_id    UUID,
  p_customer_id UUID,
  p_limit       INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC)
  INTO v_rows
  FROM (
    SELECT
      ca.*,
      COALESCE(
        (SELECT jsonb_agg(row_to_json(p) ORDER BY p.created_at)
         FROM customer_advance_payments p WHERE p.advance_id = ca.id),
        '[]'::jsonb
      ) as payments
    FROM customer_advances ca
    WHERE ca.store_id = p_store_id AND ca.customer_id = p_customer_id
    ORDER BY ca.created_at DESC
    LIMIT p_limit
  ) a;

  RETURN jsonb_build_object(
    'success', true,
    'advances', COALESCE(v_rows, '[]'::jsonb),
    'total_outstanding', (
      SELECT COALESCE(SUM(outstanding_balance), 0)
      FROM customer_advances WHERE store_id = p_store_id AND customer_id = p_customer_id AND status <> 'settled'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 9. create_fund_transfer RPC
-- ============================================================
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

  -- GL posting: DR to_account / CR from_account
  v_from_code := payment_method_account_code(p_store_id, p_from_method);
  v_to_code   := payment_method_account_code(p_store_id, p_to_method);

  PERFORM post_journal_entry(
    p_store_id, p_user_id, NOW(),
    CONCAT('Fund transfer: ', p_from_method, ' → ', p_to_method,
           CASE WHEN p_reference IS NOT NULL THEN ' (' || p_reference || ')' ELSE '' END),
    v_transfer_id, 'fund_transfer',
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

-- ============================================================
-- 10. list_fund_transfers RPC
-- ============================================================
CREATE OR REPLACE FUNCTION list_fund_transfers(
  p_store_id  UUID,
  p_from_date TIMESTAMPTZ DEFAULT NULL,
  p_to_date   TIMESTAMPTZ DEFAULT NULL,
  p_limit     INT         DEFAULT 100
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(ft) ORDER BY ft.transfer_date DESC)
  INTO v_rows
  FROM (
    SELECT ft.*, u.email as created_by_email
    FROM fund_transfers ft
    LEFT JOIN auth.users u ON u.id = ft.created_by
    WHERE ft.store_id = p_store_id
      AND (p_from_date IS NULL OR ft.transfer_date >= p_from_date)
      AND (p_to_date   IS NULL OR ft.transfer_date <= p_to_date)
    ORDER BY ft.transfer_date DESC
    LIMIT p_limit
  ) ft;

  RETURN jsonb_build_object(
    'success', true,
    'transfers', COALESCE(v_rows, '[]'::jsonb),
    'total_amount', (
      SELECT COALESCE(SUM(amount), 0) FROM fund_transfers
      WHERE store_id = p_store_id
        AND (p_from_date IS NULL OR transfer_date >= p_from_date)
        AND (p_to_date   IS NULL OR transfer_date <= p_to_date)
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. get_customer_statement RPC
--     Returns a unified chronological statement for a customer.
-- ============================================================
CREATE OR REPLACE FUNCTION get_customer_statement(
  p_store_id    UUID,
  p_customer_id UUID,
  p_from_date   TIMESTAMPTZ DEFAULT NULL,
  p_to_date     TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_entries JSONB;
  v_cust    RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT balance, deposit_balance, advance_balance, credit_limit, total_purchases
  INTO v_cust FROM customers WHERE id = p_customer_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Build unified entry set
  WITH all_entries AS (
    -- Credit sales
    SELECT s.id::text, s.sale_date::timestamptz AS event_date,
           'sale_credit' AS entry_type,
           CONCAT('Credit Sale — ', s.invoice_number) AS description,
           s.credit_amount AS amount, s.invoice_number AS reference
    FROM sales s
    WHERE s.store_id = p_store_id AND s.customer_id = p_customer_id
      AND s.credit_amount > 0
      AND (p_from_date IS NULL OR s.sale_date::timestamptz >= p_from_date)
      AND (p_to_date   IS NULL OR s.sale_date::timestamptz <= p_to_date)

    UNION ALL
    -- Paid sales
    SELECT s.id::text, s.sale_date::timestamptz,
           'sale_paid',
           CONCAT('Sale — ', s.invoice_number),
           s.total_amount, s.invoice_number
    FROM sales s
    WHERE s.store_id = p_store_id AND s.customer_id = p_customer_id
      AND (s.credit_amount IS NULL OR s.credit_amount = 0)
      AND (p_from_date IS NULL OR s.sale_date::timestamptz >= p_from_date)
      AND (p_to_date   IS NULL OR s.sale_date::timestamptz <= p_to_date)

    UNION ALL
    -- Debt payments
    SELECT dp.id::text, dp.payment_date::timestamptz,
           'payment',
           CONCAT('Payment received — ', dr.invoice_number),
           dp.amount, dp.reference
    FROM debt_payments dp
    JOIN debt_records dr ON dr.id = dp.debt_record_id
    WHERE dp.store_id = p_store_id AND dr.customer_id = p_customer_id
      AND (p_from_date IS NULL OR dp.payment_date::timestamptz >= p_from_date)
      AND (p_to_date   IS NULL OR dp.payment_date::timestamptz <= p_to_date)

    UNION ALL
    -- Customer deposits
    SELECT cd.id::text, cd.created_at,
           CASE cd.type WHEN 'deposit' THEN 'deposit_add'
                        WHEN 'used'    THEN 'deposit_used'
                                       ELSE 'deposit_refund' END,
           CASE cd.type WHEN 'deposit' THEN 'Deposit added'
                        WHEN 'used'    THEN 'Deposit used in sale'
                                       ELSE 'Deposit refunded' END,
           cd.amount, cd.reference
    FROM customer_deposits cd
    WHERE cd.store_id = p_store_id AND cd.customer_id = p_customer_id
      AND (p_from_date IS NULL OR cd.created_at >= p_from_date)
      AND (p_to_date   IS NULL OR cd.created_at <= p_to_date)

    UNION ALL
    -- Cash advances
    SELECT ca.id::text, ca.created_at,
           'advance',
           CONCAT('Cash advance', CASE WHEN ca.reference IS NOT NULL THEN ' — ' || ca.reference ELSE '' END),
           ca.original_amount, ca.reference
    FROM customer_advances ca
    WHERE ca.store_id = p_store_id AND ca.customer_id = p_customer_id
      AND (p_from_date IS NULL OR ca.created_at >= p_from_date)
      AND (p_to_date   IS NULL OR ca.created_at <= p_to_date)

    UNION ALL
    -- Advance repayments
    SELECT cap.id::text, cap.created_at,
           'advance_repayment',
           CONCAT('Advance repayment', CASE WHEN cap.reference IS NOT NULL THEN ' — ' || cap.reference ELSE '' END),
           cap.amount, cap.reference
    FROM customer_advance_payments cap
    WHERE cap.store_id = p_store_id AND cap.customer_id = p_customer_id
      AND (p_from_date IS NULL OR cap.created_at >= p_from_date)
      AND (p_to_date   IS NULL OR cap.created_at <= p_to_date)
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          id,
      'date',        event_date,
      'type',        entry_type,
      'description', description,
      'amount',      amount,
      'reference',   reference
    ) ORDER BY event_date ASC
  )
  INTO v_entries
  FROM all_entries;

  RETURN jsonb_build_object(
    'success', true,
    'entries', COALESCE(v_entries, '[]'::jsonb),
    'summary', jsonb_build_object(
      'credit_outstanding', COALESCE(v_cust.balance, 0),
      'deposit_balance',    COALESCE(v_cust.deposit_balance, 0),
      'advance_outstanding', COALESCE(v_cust.advance_balance, 0),
      'total_purchases',    COALESCE(v_cust.total_purchases, 0)
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. Update list_store_transactions to include fund transfers
-- ============================================================
-- (handled by existing list_store_transactions; fund_transfers appear via journal entries)
