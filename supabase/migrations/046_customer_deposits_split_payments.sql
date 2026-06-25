-- Customer Deposits, Split Payments, and expanded payment methods
-- Adds prepaid wallet per customer, multi-method checkout, and full GL integration

-- ============================================================
-- 1. customer_deposits ledger table
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_deposits (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id     UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount       DECIMAL(15,2) NOT NULL,            -- positive = in, negative = out
  type         TEXT        NOT NULL CHECK (type IN ('deposit', 'used', 'refund')),
  payment_method TEXT,                            -- for 'deposit' and 'refund' rows
  sale_id      UUID        REFERENCES sales(id),  -- set when type = 'used'
  reference    TEXT,
  notes        TEXT,
  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cust_deposits_store    ON customer_deposits(store_id);
CREATE INDEX IF NOT EXISTS idx_cust_deposits_customer ON customer_deposits(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_deposits_sale     ON customer_deposits(sale_id) WHERE sale_id IS NOT NULL;

ALTER TABLE customer_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cust_deposits_store_access" ON customer_deposits
  FOR ALL
  USING  (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- 2. deposit_balance column on customers
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deposit_balance DECIMAL(15,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Customer Deposit Liability COA entries for all existing stores
--    We insert code 2300 if it doesn't already exist and tag it with
--    a new system_role 'customer_deposit_liability'.
-- ============================================================
DO $$
DECLARE
  v_store RECORD;
  v_existing_id UUID;
BEGIN
  FOR v_store IN SELECT id FROM stores WHERE is_active = true LOOP
    -- Check if a 2300-series account already exists for this store
    SELECT id INTO v_existing_id
    FROM chart_of_accounts
    WHERE store_id = v_store.id AND code = '2300'
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO chart_of_accounts (
        store_id, code, name, account_type, is_system, is_protected, is_postable, system_role, is_active
      ) VALUES (
        v_store.id, '2300', 'Customer Deposit Liability', 'liability',
        true, true, true, 'customer_deposit_liability', true
      );
    ELSE
      -- Tag existing account with the new system role (only if not already tagged)
      UPDATE chart_of_accounts
      SET system_role = 'customer_deposit_liability', is_protected = true
      WHERE id = v_existing_id AND system_role IS NULL;
    END IF;
  END LOOP;
END;
$$;

-- Extend create_default_chart_of_accounts for new stores
CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_store_id UUID)
RETURNS VOID AS $$
DECLARE
  v_cash_id UUID;
BEGIN
  INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_protected, is_postable, system_role, is_active) VALUES
    (p_store_id, '1110', 'Cash on Hand',              'asset',     true, true, true,  'cash',                       true),
    (p_store_id, '1200', 'Accounts Receivable',        'asset',     true, true, true,  'accounts_receivable',        true),
    (p_store_id, '1300', 'Inventory',                  'asset',     true, true, true,  'inventory',                  true),
    (p_store_id, '2100', 'Accounts Payable',            'liability', true, true, true,  'accounts_payable',           true),
    (p_store_id, '2200', 'Tax Payable',                 'liability', true, true, true,  'tax_payable',                true),
    (p_store_id, '2300', 'Customer Deposit Liability',  'liability', true, true, true,  'customer_deposit_liability', true),
    (p_store_id, '3100', 'Owner Capital',               'equity',    true, true, true,  'owner_capital',              true),
    (p_store_id, '3200', 'Retained Earnings',           'equity',    true, true, false, NULL,                         true),
    (p_store_id, '4100', 'Sales Revenue',               'revenue',   true, true, true,  'sales_revenue',              true),
    (p_store_id, '5100', 'Cost of Goods Sold',          'cogs',      true, true, true,  'cogs',                       true),
    (p_store_id, '6500', 'General Expenses',            'expense',   true, true, true,  'general_expenses',           true)
  ON CONFLICT DO NOTHING;

  -- Default cash payment method → 1110
  SELECT id INTO v_cash_id FROM chart_of_accounts WHERE store_id = p_store_id AND code = '1110' LIMIT 1;
  IF v_cash_id IS NOT NULL THEN
    INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_active, is_system, sort_order)
    VALUES (p_store_id, 'cash', 'Cash', v_cash_id, true, true, 0)
    ON CONFLICT (store_id, slug) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. add_customer_deposit() RPC
-- ============================================================
CREATE OR REPLACE FUNCTION add_customer_deposit(
  p_store_id      UUID,
  p_user_id       UUID,
  p_customer_id   UUID,
  p_amount        DECIMAL,
  p_payment_method TEXT    DEFAULT 'cash',
  p_notes         TEXT    DEFAULT NULL,
  p_reference     TEXT    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_deposit_id    UUID;
  v_payment_code  TEXT;
  v_liability_code TEXT;
  v_journal_lines JSONB;
  v_customer_name TEXT;
  v_new_balance   DECIMAL;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF NOT verify_store_access(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT full_name INTO v_customer_name
  FROM customers WHERE id = p_customer_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Record the deposit
  INSERT INTO customer_deposits (
    store_id, customer_id, amount, type, payment_method, reference, notes, created_by
  ) VALUES (
    p_store_id, p_customer_id, p_amount, 'deposit',
    COALESCE(p_payment_method, 'cash'), p_reference, p_notes, p_user_id
  ) RETURNING id INTO v_deposit_id;

  -- Update running balance
  UPDATE customers
  SET deposit_balance = deposit_balance + p_amount, updated_at = NOW()
  WHERE id = p_customer_id
  RETURNING deposit_balance INTO v_new_balance;

  -- GL: DR Cash/Mobile  /  CR Customer Deposit Liability
  v_payment_code   := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
  v_liability_code := COALESCE(
    (SELECT code FROM chart_of_accounts
     WHERE store_id = p_store_id AND system_role = 'customer_deposit_liability' AND is_active = true
     LIMIT 1),
    '2300'
  );

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_payment_code,   'debit', p_amount, 'credit', 0,        'description', 'Customer deposit received'),
    jsonb_build_object('account_code', v_liability_code, 'debit', 0,        'credit', p_amount, 'description', 'Customer deposit liability')
  );

  PERFORM post_journal_entry(
    p_store_id,
    'Deposit — ' || v_customer_name,
    v_deposit_id, 'customer_deposit', p_user_id, v_journal_lines
  );

  RETURN jsonb_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'new_balance', v_new_balance
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_customer_deposit(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 5. refund_customer_deposit() RPC
-- ============================================================
CREATE OR REPLACE FUNCTION refund_customer_deposit(
  p_store_id      UUID,
  p_user_id       UUID,
  p_customer_id   UUID,
  p_amount        DECIMAL,
  p_payment_method TEXT    DEFAULT 'cash',
  p_notes         TEXT    DEFAULT NULL,
  p_reference     TEXT    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_deposit_id     UUID;
  v_current_balance DECIMAL;
  v_payment_code   TEXT;
  v_liability_code TEXT;
  v_journal_lines  JSONB;
  v_customer_name  TEXT;
  v_new_balance    DECIMAL;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF NOT verify_store_access(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT deposit_balance, full_name INTO v_current_balance, v_customer_name
  FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  IF COALESCE(v_current_balance, 0) < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient deposit balance');
  END IF;

  INSERT INTO customer_deposits (
    store_id, customer_id, amount, type, payment_method, reference, notes, created_by
  ) VALUES (
    p_store_id, p_customer_id, -p_amount, 'refund',
    COALESCE(p_payment_method, 'cash'), p_reference, p_notes, p_user_id
  ) RETURNING id INTO v_deposit_id;

  UPDATE customers
  SET deposit_balance = deposit_balance - p_amount, updated_at = NOW()
  WHERE id = p_customer_id
  RETURNING deposit_balance INTO v_new_balance;

  -- GL: DR Customer Deposit Liability  /  CR Cash
  v_payment_code   := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
  v_liability_code := COALESCE(
    (SELECT code FROM chart_of_accounts
     WHERE store_id = p_store_id AND system_role = 'customer_deposit_liability' AND is_active = true
     LIMIT 1),
    '2300'
  );

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_liability_code, 'debit', p_amount, 'credit', 0,        'description', 'Deposit refund'),
    jsonb_build_object('account_code', v_payment_code,   'debit', 0,        'credit', p_amount, 'description', 'Refund paid out')
  );

  PERFORM post_journal_entry(
    p_store_id,
    'Deposit Refund — ' || v_customer_name,
    v_deposit_id, 'deposit_refund', p_user_id, v_journal_lines
  );

  RETURN jsonb_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'new_balance', v_new_balance
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refund_customer_deposit(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 6. get_customer_deposit_history() RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_customer_deposit_history(
  p_store_id    UUID,
  p_customer_id UUID,
  p_limit       INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT verify_store_access(p_store_id, auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'amount', d.amount,
      'type', d.type,
      'payment_method', d.payment_method,
      'reference', d.reference,
      'notes', d.notes,
      'sale_id', d.sale_id,
      'created_at', d.created_at
    ) ORDER BY d.created_at DESC
  ), '[]'::JSONB)
  INTO v_rows
  FROM (
    SELECT * FROM customer_deposits
    WHERE store_id = p_store_id AND customer_id = p_customer_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) d;

  RETURN jsonb_build_object(
    'success', true,
    'rows', v_rows,
    'deposit_balance', (SELECT COALESCE(deposit_balance, 0) FROM customers WHERE id = p_customer_id AND store_id = p_store_id)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_customer_deposit_history(UUID, UUID, INT) TO authenticated;

-- ============================================================
-- 7. Updated _complete_pos_sale_impl with split payments + deposit
-- ============================================================
DROP FUNCTION IF EXISTS _complete_pos_sale_impl(UUID,UUID,UUID,JSONB,DECIMAL,DECIMAL,TEXT,DECIMAL,DECIMAL,DECIMAL,DECIMAL,DECIMAL,TEXT,JSONB,TEXT,DATE);

CREATE OR REPLACE FUNCTION _complete_pos_sale_impl(
  p_store_id       UUID,
  p_cashier_id     UUID,
  p_customer_id    UUID,
  p_items          JSONB,
  p_subtotal       DECIMAL,
  p_discount_amount DECIMAL,
  p_discount_type  TEXT,
  p_tax_amount     DECIMAL,
  p_total_amount   DECIMAL,
  p_paid_amount    DECIMAL,
  p_change_amount  DECIMAL,
  p_credit_amount  DECIMAL,
  p_payment_method TEXT,
  p_payment_details JSONB,
  p_notes          TEXT,
  p_due_date       DATE    DEFAULT NULL,
  p_deposit_amount DECIMAL DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_sale_id            UUID;
  v_invoice_number     TEXT;
  v_counter            INTEGER;
  v_prefix             TEXT;
  v_item               RECORD;
  v_product            RECORD;
  v_customer           RECORD;
  v_journal_lines      JSONB := '[]'::JSONB;
  v_payment_code       TEXT;
  v_cogs_total         DECIMAL(15,2) := 0;
  v_revenue            DECIMAL(15,2);
  v_cost_method        TEXT;
  v_resolved_due       DATE;
  v_line_cogs          DECIMAL(15,2);
  v_unit_cost          DECIMAL(15,2);
  v_base_qty           DECIMAL(15,3);
  v_sale_unit_qty      DECIMAL(15,3);
  v_conv               DECIMAL;
  v_stock_check        JSONB;
  v_split              RECORD;
  v_split_code         TEXT;
  v_deposit_liability  TEXT;
  v_effective_deposit  DECIMAL(15,2);
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');
  v_revenue := p_total_amount - COALESCE(p_tax_amount, 0);
  v_effective_deposit := GREATEST(COALESCE(p_deposit_amount, 0), 0);

  v_resolved_due := COALESCE(
    p_due_date,
    NULLIF(p_payment_details->0->>'due_date', '')::DATE,
    CASE WHEN p_credit_amount > 0 THEN CURRENT_DATE + 30 ELSE NULL END
  );

  -- Stock pre-check
  v_stock_check := assert_pos_sale_stock(p_store_id, p_items);
  IF NOT COALESCE((v_stock_check->>'success')::BOOLEAN, false) THEN
    RETURN v_stock_check;
  END IF;

  -- Fetch and lock customer when credit or deposit is involved
  IF (COALESCE(p_credit_amount, 0) > 0 OR v_effective_deposit > 0) AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Customer not found'); END IF;

    IF p_credit_amount > 0 AND v_customer.credit_limit > 0
       AND (v_customer.balance + p_credit_amount) > v_customer.credit_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Credit limit exceeded');
    END IF;

    IF v_effective_deposit > 0 AND COALESCE(v_customer.deposit_balance, 0) < v_effective_deposit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient deposit balance');
    END IF;
  END IF;

  -- Invoice number
  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_invoice_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 5, '0');

  -- Create sale record
  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, discount_type, tax_amount, total_amount,
    paid_amount, change_amount, credit_amount, payment_method, payment_details, notes, sale_date, due_date
  ) VALUES (
    p_store_id, v_invoice_number, p_customer_id, p_cashier_id, 'completed',
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount + v_effective_deposit,   -- total cash received (regular + deposit)
    p_change_amount, p_credit_amount,
    p_payment_method, p_payment_details, p_notes, NOW(), v_resolved_due
  ) RETURNING id INTO v_sale_id;

  -- Create sale items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, product_name TEXT, product_sku TEXT,
    quantity DECIMAL, unit_price DECIMAL, cost_price DECIMAL,
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL,
    base_qty DECIMAL, sale_unit_id UUID, sale_unit_code TEXT,
    sale_unit_qty DECIMAL, price_tier TEXT
  )
  LOOP
    v_line_cogs := 0;
    v_unit_cost := 0;

    v_conv         := product_unit_conversion(v_item.product_id, v_item.sale_unit_id);
    v_sale_unit_qty := COALESCE(v_item.sale_unit_qty, v_item.quantity, 0);
    v_base_qty     := COALESCE(v_item.base_qty, ROUND(v_sale_unit_qty * v_conv, 3));

    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;

      IF v_cost_method = 'fifo' THEN
        v_line_cogs := consume_fifo_cost(p_store_id, v_item.product_id, v_base_qty);
        v_unit_cost := CASE WHEN v_base_qty > 0 THEN ROUND(v_line_cogs / v_base_qty, 4) ELSE 0 END;
      ELSIF v_cost_method = 'lifo' THEN
        v_line_cogs := consume_lifo_cost(p_store_id, v_item.product_id, v_base_qty);
        v_unit_cost := CASE WHEN v_base_qty > 0 THEN ROUND(v_line_cogs / v_base_qty, 4) ELSE 0 END;
      ELSE
        v_unit_cost := GREATEST(COALESCE(v_product.cost_price, 0), 0);
        v_line_cogs := ROUND(v_unit_cost * v_base_qty, 2);
      END IF;
    ELSE
      v_unit_cost := GREATEST(COALESCE(v_item.cost_price, 0), 0);
      v_line_cogs := ROUND(v_unit_cost * v_base_qty, 2);
    END IF;

    v_cogs_total := v_cogs_total + v_line_cogs;

    INSERT INTO sale_items (
      store_id, sale_id, product_id, product_name, product_sku,
      quantity, unit_price, cost_price, discount_amount, tax_amount, subtotal,
      sale_unit_id, sale_unit_code, sale_unit_qty, base_qty, price_tier
    ) VALUES (
      p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku,
      v_base_qty, v_item.unit_price, v_unit_cost, v_item.discount_amount, v_item.tax_amount, v_item.subtotal,
      v_item.sale_unit_id, v_item.sale_unit_code, v_sale_unit_qty, v_base_qty,
      COALESCE(v_item.price_tier, 'retail')
    );
  END LOOP;

  -- Update stock
  PERFORM process_sale_stock(p_store_id, v_sale_id, (
    SELECT jsonb_agg(jsonb_build_object(
      'product_id', x.product_id,
      'quantity', COALESCE(x.base_qty, x.quantity)
    ))
    FROM jsonb_to_recordset(p_items) AS x(
      product_id UUID, quantity DECIMAL, base_qty DECIMAL,
      sale_unit_id UUID, sale_unit_qty DECIMAL
    )
  ), p_cashier_id);

  -- Update customer balances
  IF p_customer_id IS NOT NULL THEN
    IF v_effective_deposit > 0 THEN
      UPDATE customers SET
        deposit_balance  = deposit_balance  - v_effective_deposit,
        balance          = balance          + COALESCE(p_credit_amount, 0),
        total_purchases  = total_purchases  + p_total_amount,
        updated_at       = NOW()
      WHERE id = p_customer_id;

      -- Record deposit usage
      INSERT INTO customer_deposits (store_id, customer_id, amount, type, sale_id, notes, created_by)
      VALUES (p_store_id, p_customer_id, -v_effective_deposit, 'used', v_sale_id,
              'Applied to sale ' || v_invoice_number, p_cashier_id);
    ELSE
      UPDATE customers SET
        balance         = balance         + COALESCE(p_credit_amount, 0),
        total_purchases = total_purchases + p_total_amount,
        updated_at      = NOW()
      WHERE id = p_customer_id;
    END IF;
  END IF;

  -- ── Journal entries ──────────────────────────────────────────
  -- Revenue credit
  IF v_revenue > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'sales_revenue'), 'debit', 0, 'credit', v_revenue, 'description', 'Sales revenue')
    );
  END IF;

  -- Tax payable credit
  IF COALESCE(p_tax_amount, 0) > 0 AND coa_code(p_store_id, 'tax_payable') IS NOT NULL THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'tax_payable'), 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable')
    );
  END IF;

  -- Payment debit(s)
  IF p_payment_method = 'split' THEN
    -- Post each non-deposit payment line individually
    FOR v_split IN
      SELECT
        COALESCE(x.method, 'cash') AS method,
        COALESCE(x.amount, 0)      AS amt
      FROM jsonb_to_recordset(COALESCE(p_payment_details, '[]'::JSONB)) AS x(method TEXT, amount DECIMAL)
    LOOP
      IF v_split.method <> 'customer_deposit' AND v_split.amt > 0 THEN
        v_split_code := payment_method_account_code(p_store_id, v_split.method);
        v_journal_lines := v_journal_lines || jsonb_build_array(
          jsonb_build_object('account_code', v_split_code, 'debit', v_split.amt, 'credit', 0,
                             'description', 'Split payment: ' || v_split.method)
        );
      END IF;
    END LOOP;
  ELSIF COALESCE(p_paid_amount, 0) > 0 THEN
    v_payment_code := payment_method_account_code(p_store_id, p_payment_method);
    IF p_payment_method = 'credit' THEN
      v_payment_code := COALESCE(coa_code(p_store_id, 'cash'), v_payment_code);
    END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;

  -- Deposit applied: debit Deposit Liability
  IF v_effective_deposit > 0 THEN
    v_deposit_liability := COALESCE(
      (SELECT code FROM chart_of_accounts
       WHERE store_id = p_store_id AND system_role = 'customer_deposit_liability' AND is_active = true
       LIMIT 1),
      '2300'
    );
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_deposit_liability, 'debit', v_effective_deposit, 'credit', 0,
                         'description', 'Customer deposit applied')
    );
  END IF;

  -- Accounts Receivable for credit portion
  IF COALESCE(p_credit_amount, 0) > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'accounts_receivable'), 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;

  -- COGS
  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'cogs'),      'debit', v_cogs_total, 'credit', 0,           'description', 'COGS'),
      jsonb_build_object('account_code', coa_code(p_store_id, 'inventory'), 'debit', 0,           'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'invoice_number', v_invoice_number,
    'total', p_total_amount,
    'cogs', v_cogs_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. Updated complete_pos_sale public wrapper
-- ============================================================
DROP FUNCTION IF EXISTS complete_pos_sale(UUID,UUID,UUID,JSONB,DECIMAL,DECIMAL,TEXT,DECIMAL,DECIMAL,DECIMAL,DECIMAL,DECIMAL,TEXT,JSONB,TEXT,DATE);

CREATE OR REPLACE FUNCTION complete_pos_sale(
  p_store_id        UUID,
  p_cashier_id      UUID,
  p_customer_id     UUID,
  p_items           JSONB,
  p_subtotal        DECIMAL,
  p_discount_amount DECIMAL,
  p_discount_type   TEXT,
  p_tax_amount      DECIMAL,
  p_total_amount    DECIMAL,
  p_paid_amount     DECIMAL,
  p_change_amount   DECIMAL,
  p_credit_amount   DECIMAL,
  p_payment_method  TEXT,
  p_payment_details JSONB,
  p_notes           TEXT,
  p_due_date        DATE    DEFAULT NULL,
  p_deposit_amount  DECIMAL DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_allow_below   BOOLEAN;
  v_item          JSONB;
  v_cost          DECIMAL;
  v_qty           DECIMAL;
  v_unit          DECIMAL;
  v_disc          DECIMAL;
  v_effective     DECIMAL;
  v_product_name  TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF v_caller_id <> p_cashier_id AND NOT verify_store_access(p_store_id, v_caller_id, ARRAY['owner','manager']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF NOT verify_store_access(p_store_id, p_cashier_id, ARRAY['owner','manager','cashier','accountant','purchase_officer']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cashier not authorized for this store');
  END IF;

  SELECT COALESCE((settings->>'pos_allow_below_cost_sales')::BOOLEAN, false)
  INTO v_allow_below
  FROM stores WHERE id = p_store_id;

  IF NOT COALESCE(v_allow_below, false) THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      SELECT cost_price, name INTO v_cost, v_product_name
      FROM products WHERE id = (v_item->>'product_id')::UUID AND store_id = p_store_id;

      v_qty  := GREATEST(COALESCE((v_item->>'quantity')::DECIMAL, 0), 0);
      v_unit := COALESCE((v_item->>'unit_price')::DECIMAL, 0);
      v_disc := COALESCE((v_item->>'discount_amount')::DECIMAL, 0);

      IF v_qty > 0 THEN
        v_effective := (v_unit * v_qty - v_disc) / v_qty;
        IF v_effective < COALESCE(v_cost, 0) THEN
          RETURN jsonb_build_object('success', false, 'error', 'Sale price cannot be lower than product cost.');
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN _complete_pos_sale_impl(
    p_store_id, p_cashier_id, p_customer_id, p_items,
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount, p_change_amount, p_credit_amount,
    p_payment_method, p_payment_details, p_notes, p_due_date,
    COALESCE(p_deposit_amount, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_pos_sale(UUID,UUID,UUID,JSONB,DECIMAL,DECIMAL,TEXT,DECIMAL,DECIMAL,DECIMAL,DECIMAL,DECIMAL,TEXT,JSONB,TEXT,DATE,DECIMAL) TO authenticated;

-- ============================================================
-- 9. Patch list_store_transactions to include customer deposits
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

    SELECT cd.id, 'customer_deposit'::TEXT,
      'DEP-' || LEFT(cd.id::TEXT, 8),
      COALESCE(c.full_name, 'Customer'),
      cd.amount,
      cd.payment_method::TEXT, 'completed'::TEXT,
      cd.created_at, cd.created_at, cd.created_by
    FROM customer_deposits cd
    LEFT JOIN customers c ON c.id = cd.customer_id
    WHERE cd.store_id = p_store_id AND cd.type = 'deposit'
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
