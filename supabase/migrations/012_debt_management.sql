-- ============================================================
-- 012: Advanced Debt Management (AR + AP)
-- Customer receivables + supplier payables subledger
-- ============================================================

-- Due dates on source documents
ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS due_date DATE;

-- Enums
DO $$ BEGIN
  CREATE TYPE debt_party_type AS ENUM ('customer', 'supplier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE debt_status AS ENUM ('current', 'due_soon', 'overdue', 'paid', 'written_off');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- debt_records — subledger for AR/AP
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  party_type debt_party_type NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  due_date DATE,
  promise_date DATE,
  total_amount DECIMAL(15,2) NOT NULL CHECK (total_amount >= 0),
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_balance DECIMAL(15,2) NOT NULL CHECK (remaining_balance >= 0),
  status debt_status NOT NULL DEFAULT 'current',
  written_off_at TIMESTAMPTZ,
  written_off_by UUID REFERENCES auth.users(id),
  write_off_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT debt_party_fk CHECK (
    (party_type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL)
    OR (party_type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS debt_records_sale_uidx ON debt_records(sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS debt_records_po_uidx ON debt_records(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debt_records_store_party_idx ON debt_records(store_id, party_type, status);
CREATE INDEX IF NOT EXISTS debt_records_due_date_idx ON debt_records(store_id, due_date) WHERE remaining_balance > 0;
CREATE INDEX IF NOT EXISTS debt_records_customer_idx ON debt_records(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debt_records_supplier_idx ON debt_records(supplier_id) WHERE supplier_id IS NOT NULL;

-- ============================================================
-- debt_events — timeline
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  debt_record_id UUID NOT NULL REFERENCES debt_records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(15,2),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS debt_events_record_idx ON debt_events(debt_record_id, created_at DESC);

-- ============================================================
-- debt_notes — staff notes
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  debt_record_id UUID REFERENCES debt_records(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS debt_notes_record_idx ON debt_notes(debt_record_id);

-- ============================================================
-- debt_portal_tokens — public read-only links
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  party_type debt_party_type NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portal_party_fk CHECK (
    (party_type = 'customer' AND customer_id IS NOT NULL)
    OR (party_type = 'supplier' AND supplier_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS debt_portal_tokens_lookup ON debt_portal_tokens(token) WHERE is_active = true;

-- Bad debt expense account for write-offs
INSERT INTO chart_of_accounts (store_id, code, name, account_type, is_system, is_active)
SELECT s.id, '5290', 'Bad Debt Expense', 'expense', true, true
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c WHERE c.store_id = s.id AND c.code = '5290'
);

-- ============================================================
-- Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION compute_debt_status(
  p_remaining DECIMAL,
  p_due_date DATE,
  p_written_off_at TIMESTAMPTZ
) RETURNS debt_status AS $$
BEGIN
  IF p_written_off_at IS NOT NULL THEN RETURN 'written_off'; END IF;
  IF COALESCE(p_remaining, 0) <= 0 THEN RETURN 'paid'; END IF;
  IF p_due_date IS NULL THEN RETURN 'current'; END IF;
  IF p_due_date < CURRENT_DATE THEN RETURN 'overdue'; END IF;
  IF p_due_date <= CURRENT_DATE + 7 THEN RETURN 'due_soon'; END IF;
  RETURN 'current';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION refresh_debt_record_status(p_debt_id UUID)
RETURNS void AS $$
DECLARE
  v RECORD;
  v_status debt_status;
BEGIN
  SELECT * INTO v FROM debt_records WHERE id = p_debt_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := compute_debt_status(v.remaining_balance, v.due_date, v.written_off_at);

  UPDATE debt_records SET
    status = v_status,
    updated_at = NOW()
  WHERE id = p_debt_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_debt_event(
  p_store_id UUID,
  p_debt_id UUID,
  p_event_type TEXT,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_amount DECIMAL DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO debt_events (store_id, debt_record_id, event_type, title, description, amount, created_by, metadata)
  VALUES (p_store_id, p_debt_id, p_event_type, p_title, p_description, p_amount, p_user_id, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Sync customer debt from sale (trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION sync_customer_debt_from_sale()
RETURNS TRIGGER AS $$
DECLARE
  v_due DATE;
  v_debt_id UUID;
  v_status debt_status;
BEGIN
  IF NEW.status <> 'completed' OR COALESCE(NEW.credit_amount, 0) <= 0 OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_due := COALESCE(
    NEW.due_date,
    NULLIF(NEW.payment_details->0->>'due_date', '')::DATE,
    (CURRENT_DATE + INTERVAL '30 days')::DATE
  );

  INSERT INTO debt_records (
    store_id, party_type, customer_id, sale_id, invoice_number,
    due_date, total_amount, paid_amount, remaining_balance, status, created_by
  ) VALUES (
    NEW.store_id, 'customer', NEW.customer_id, NEW.id, NEW.invoice_number,
    v_due, NEW.credit_amount, 0, NEW.credit_amount, 'current', NEW.cashier_id
  )
  ON CONFLICT (sale_id) WHERE sale_id IS NOT NULL DO UPDATE SET
    total_amount = EXCLUDED.total_amount,
    remaining_balance = GREATEST(0, EXCLUDED.total_amount - debt_records.paid_amount),
    due_date = COALESCE(EXCLUDED.due_date, debt_records.due_date),
    updated_at = NOW()
  RETURNING id INTO v_debt_id;

  IF v_debt_id IS NULL THEN
    SELECT id INTO v_debt_id FROM debt_records WHERE sale_id = NEW.id;
  END IF;

  PERFORM refresh_debt_record_status(v_debt_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM log_debt_event(
      NEW.store_id, v_debt_id, 'invoice_created', 'Invoice created',
      'Credit sale ' || NEW.invoice_number, NEW.credit_amount, NEW.cashier_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_customer_debt ON sales;
CREATE TRIGGER trg_sync_customer_debt
  AFTER INSERT OR UPDATE OF credit_amount, status, due_date, payment_details ON sales
  FOR EACH ROW EXECUTE FUNCTION sync_customer_debt_from_sale();

-- ============================================================
-- Sync supplier debt from PO receive (trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION sync_supplier_debt_from_po()
RETURNS TRIGGER AS $$
DECLARE
  v_ap DECIMAL(15,2);
  v_due DATE;
  v_debt_id UUID;
BEGIN
  IF NEW.status <> 'received' OR NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_ap := GREATEST(0, NEW.total_amount - COALESCE(NEW.paid_amount, 0));
  IF v_ap <= 0 THEN RETURN NEW; END IF;

  v_due := COALESCE(NEW.due_date, (CURRENT_DATE + INTERVAL '30 days')::DATE);

  INSERT INTO debt_records (
    store_id, party_type, supplier_id, purchase_order_id, invoice_number,
    due_date, total_amount, paid_amount, remaining_balance, status
  ) VALUES (
    NEW.store_id, 'supplier', NEW.supplier_id, NEW.id, NEW.po_number,
    v_due, v_ap, 0, v_ap, 'current'
  )
  ON CONFLICT (purchase_order_id) WHERE purchase_order_id IS NOT NULL DO UPDATE SET
    total_amount = EXCLUDED.total_amount,
    remaining_balance = GREATEST(0, EXCLUDED.total_amount - debt_records.paid_amount),
    due_date = COALESCE(EXCLUDED.due_date, debt_records.due_date),
    updated_at = NOW()
  RETURNING id INTO v_debt_id;

  IF v_debt_id IS NULL THEN
    SELECT id INTO v_debt_id FROM debt_records WHERE purchase_order_id = NEW.id;
  END IF;

  PERFORM refresh_debt_record_status(v_debt_id);

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'received' THEN
    PERFORM log_debt_event(
      NEW.store_id, v_debt_id, 'invoice_created', 'Purchase received',
      'Supplier payable for ' || NEW.po_number, v_ap, NULL
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_supplier_debt ON purchase_orders;
CREATE TRIGGER trg_sync_supplier_debt
  AFTER INSERT OR UPDATE OF status, paid_amount, due_date ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION sync_supplier_debt_from_po();

-- ============================================================
-- Allocate payment across debt records (FIFO by due date)
-- ============================================================
CREATE OR REPLACE FUNCTION apply_debt_payment_allocation(
  p_store_id UUID,
  p_party_type debt_party_type,
  p_party_id UUID,
  p_amount DECIMAL,
  p_payment_id UUID,
  p_payment_table TEXT,
  p_user_id UUID
) RETURNS DECIMAL AS $$
DECLARE
  v_remaining DECIMAL(15,2) := p_amount;
  v_rec RECORD;
  v_apply DECIMAL(15,2);
BEGIN
  FOR v_rec IN
    SELECT id, remaining_balance, invoice_number
    FROM debt_records
    WHERE store_id = p_store_id
      AND party_type = p_party_type
      AND remaining_balance > 0
      AND status <> 'written_off'
      AND (
        (p_party_type = 'customer' AND customer_id = p_party_id)
        OR (p_party_type = 'supplier' AND supplier_id = p_party_id)
      )
    ORDER BY due_date NULLS LAST, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_remaining, v_rec.remaining_balance);

    UPDATE debt_records SET
      paid_amount = paid_amount + v_apply,
      remaining_balance = remaining_balance - v_apply,
      updated_at = NOW()
    WHERE id = v_rec.id;

    PERFORM refresh_debt_record_status(v_rec.id);

    PERFORM log_debt_event(
      p_store_id, v_rec.id,
      CASE WHEN v_apply >= v_rec.remaining_balance THEN 'payment_received' ELSE 'partial_payment' END,
      CASE WHEN v_apply >= v_rec.remaining_balance THEN 'Payment received' ELSE 'Partial payment' END,
      'Applied to ' || v_rec.invoice_number,
      v_apply, p_user_id,
      jsonb_build_object('payment_id', p_payment_id, 'payment_table', p_payment_table)
    );

    v_remaining := v_remaining - v_apply;
  END LOOP;

  RETURN p_amount - v_remaining;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Updated: record_debt_payment with subledger allocation
-- ============================================================
CREATE OR REPLACE FUNCTION record_debt_payment(
  p_store_id UUID,
  p_user_id UUID,
  p_customer_id UUID,
  p_amount DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes TEXT DEFAULT NULL,
  p_sale_id UUID DEFAULT NULL,
  p_debt_record_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
  v_payment_id UUID;
  v_payment_code TEXT;
  v_journal_lines JSONB;
  v_apply_amount DECIMAL(15,2);
  v_debt RECORD;
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

  IF p_debt_record_id IS NOT NULL THEN
    SELECT * INTO v_debt FROM debt_records
    WHERE id = p_debt_record_id AND store_id = p_store_id AND customer_id = p_customer_id FOR UPDATE;
    IF FOUND AND v_debt.remaining_balance > 0 THEN
      v_apply_amount := LEAST(p_amount, v_debt.remaining_balance);
      UPDATE debt_records SET
        paid_amount = paid_amount + v_apply_amount,
        remaining_balance = remaining_balance - v_apply_amount,
        updated_at = NOW()
      WHERE id = p_debt_record_id;
      PERFORM refresh_debt_record_status(p_debt_record_id);
      PERFORM log_debt_event(
        p_store_id, p_debt_record_id,
        CASE WHEN v_apply_amount >= v_debt.remaining_balance THEN 'payment_received' ELSE 'partial_payment' END,
        'Payment applied', p_notes, v_apply_amount, p_user_id,
        jsonb_build_object('payment_id', v_payment_id)
      );
    END IF;
  ELSE
    PERFORM apply_debt_payment_allocation(
      p_store_id, 'customer', p_customer_id, p_amount, v_payment_id, 'debt_payments', p_user_id
    );
  END IF;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_payment_code, 'debit', p_amount, 'credit', 0, 'description', 'Debt payment received'),
    jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', p_amount, 'description', 'Accounts receivable reduction')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Debt payment: ' || v_customer.full_name, v_payment_id, 'debt_payment', p_user_id, v_journal_lines, true
  );

  RETURN jsonb_build_object(
    'success', true, 'payment_id', v_payment_id,
    'new_balance', GREATEST(0, v_customer.balance - p_amount)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Updated: record_supplier_payment with subledger allocation
-- ============================================================
CREATE OR REPLACE FUNCTION record_supplier_payment(
  p_store_id UUID,
  p_user_id UUID,
  p_supplier_id UUID,
  p_amount DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes TEXT DEFAULT NULL,
  p_purchase_order_id UUID DEFAULT NULL,
  p_debt_record_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_supplier RECORD;
  v_payment_id UUID;
  v_payment_code TEXT;
  v_journal_lines JSONB;
  v_debt RECORD;
  v_apply_amount DECIMAL(15,2);
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

  IF p_debt_record_id IS NOT NULL THEN
    SELECT * INTO v_debt FROM debt_records
    WHERE id = p_debt_record_id AND store_id = p_store_id AND supplier_id = p_supplier_id FOR UPDATE;
    IF FOUND AND v_debt.remaining_balance > 0 THEN
      v_apply_amount := LEAST(p_amount, v_debt.remaining_balance);
      UPDATE debt_records SET
        paid_amount = paid_amount + v_apply_amount,
        remaining_balance = remaining_balance - v_apply_amount,
        updated_at = NOW()
      WHERE id = p_debt_record_id;
      PERFORM refresh_debt_record_status(p_debt_record_id);
      PERFORM log_debt_event(
        p_store_id, p_debt_record_id,
        CASE WHEN v_apply_amount >= v_debt.remaining_balance THEN 'payment_received' ELSE 'partial_payment' END,
        'Supplier payment applied', p_notes, v_apply_amount, p_user_id,
        jsonb_build_object('payment_id', v_payment_id)
      );
    END IF;
  ELSE
    PERFORM apply_debt_payment_allocation(
      p_store_id, 'supplier', p_supplier_id, p_amount, v_payment_id, 'supplier_payments', p_user_id
    );
  END IF;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', '2100', 'debit', p_amount, 'credit', 0, 'description', 'Accounts payable reduction'),
    jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_amount, 'description', 'Supplier payment')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Supplier payment: ' || v_supplier.name, v_payment_id, 'supplier_payment', p_user_id, v_journal_lines, true
  );

  RETURN jsonb_build_object(
    'success', true, 'payment_id', v_payment_id,
    'new_balance', GREATEST(0, v_supplier.balance - p_amount)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Write off customer debt (owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION write_off_debt(
  p_store_id UUID,
  p_user_id UUID,
  p_debt_record_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_debt RECORD;
  v_customer RECORD;
  v_journal_lines JSONB;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;
  IF v_role IS DISTINCT FROM 'owner' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only store owner can write off debt');
  END IF;

  SELECT * INTO v_debt FROM debt_records
  WHERE id = p_debt_record_id AND store_id = p_store_id AND party_type = 'customer' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Debt record not found'); END IF;
  IF v_debt.remaining_balance <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Nothing to write off'); END IF;

  SELECT * INTO v_customer FROM customers WHERE id = v_debt.customer_id FOR UPDATE;

  UPDATE customers SET
    balance = GREATEST(0, balance - v_debt.remaining_balance),
    updated_at = NOW()
  WHERE id = v_debt.customer_id;

  UPDATE debt_records SET
    paid_amount = paid_amount + remaining_balance,
    remaining_balance = 0,
    status = 'written_off',
    written_off_at = NOW(),
    written_off_by = p_user_id,
    write_off_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_debt_record_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', '5290', 'debit', v_debt.remaining_balance, 'credit', 0, 'description', 'Bad debt write-off'),
    jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', v_debt.remaining_balance, 'description', 'AR write-off')
  );

  PERFORM post_journal_entry(
    p_store_id, 'Write-off: ' || v_debt.invoice_number, p_debt_record_id, 'debt_write_off', p_user_id, v_journal_lines, true
  );

  PERFORM log_debt_event(
    p_store_id, p_debt_record_id, 'written_off', 'Debt written off',
    COALESCE(p_reason, 'Owner write-off'), v_debt.remaining_balance, p_user_id
  );

  RETURN jsonb_build_object('success', true, 'amount', v_debt.remaining_balance);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Promise date + notes
-- ============================================================
CREATE OR REPLACE FUNCTION set_debt_promise_date(
  p_store_id UUID,
  p_user_id UUID,
  p_debt_record_id UUID,
  p_promise_date DATE
) RETURNS JSONB AS $$
DECLARE
  v_debt RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE debt_records SET promise_date = p_promise_date, updated_at = NOW()
  WHERE id = p_debt_record_id AND store_id = p_store_id
  RETURNING * INTO v_debt;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Debt not found'); END IF;

  PERFORM log_debt_event(
    p_store_id, p_debt_record_id, 'promise_set', 'Payment promise recorded',
    'Promised to pay on ' || p_promise_date::TEXT, NULL, p_user_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_debt_note(
  p_store_id UUID,
  p_user_id UUID,
  p_note TEXT,
  p_debt_record_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  INSERT INTO debt_notes (store_id, debt_record_id, customer_id, supplier_id, note, created_by)
  VALUES (p_store_id, p_debt_record_id, p_customer_id, p_supplier_id, p_note, p_user_id)
  RETURNING id INTO v_id;

  IF p_debt_record_id IS NOT NULL THEN
    PERFORM log_debt_event(
      p_store_id, p_debt_record_id, 'note_added', 'Note added', p_note, NULL, p_user_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'note_id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Portal tokens (generate + public read)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_debt_portal_token(
  p_store_id UUID,
  p_user_id UUID,
  p_party_type debt_party_type,
  p_customer_id UUID DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_token TEXT;
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE debt_portal_tokens SET is_active = false
  WHERE store_id = p_store_id AND party_type = p_party_type
    AND (
      (p_party_type = 'customer' AND customer_id = p_customer_id)
      OR (p_party_type = 'supplier' AND supplier_id = p_supplier_id)
    );

  INSERT INTO debt_portal_tokens (store_id, party_type, customer_id, supplier_id, created_by)
  VALUES (p_store_id, p_party_type, p_customer_id, p_supplier_id, p_user_id)
  RETURNING token, id INTO v_token, v_id;

  RETURN jsonb_build_object('success', true, 'token', v_token, 'id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_debt_portal(p_token TEXT)
RETURNS JSONB AS $$
DECLARE
  v_tok RECORD;
  v_store RECORD;
  v_party JSONB;
  v_debts JSONB;
  v_payments JSONB;
BEGIN
  SELECT * INTO v_tok FROM debt_portal_tokens
  WHERE token = p_token AND is_active = true
    AND (expires_at IS NULL OR expires_at > NOW());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired link');
  END IF;

  SELECT id, name, currency, phone, address INTO v_store FROM stores WHERE id = v_tok.store_id;

  IF v_tok.party_type = 'customer' THEN
    SELECT jsonb_build_object(
      'name', full_name, 'phone', phone, 'balance', balance
    ) INTO v_party FROM customers WHERE id = v_tok.customer_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'invoice_number', invoice_number, 'due_date', due_date, 'total_amount', total_amount,
      'paid_amount', paid_amount, 'remaining_balance', remaining_balance, 'status', status
    ) ORDER BY due_date NULLS LAST), '[]'::JSONB) INTO v_debts
    FROM debt_records
    WHERE customer_id = v_tok.customer_id AND store_id = v_tok.store_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'amount', amount, 'payment_method', payment_method, 'payment_date', payment_date
    ) ORDER BY payment_date DESC), '[]'::JSONB) INTO v_payments
    FROM debt_payments WHERE customer_id = v_tok.customer_id AND store_id = v_tok.store_id;
  ELSE
    SELECT jsonb_build_object(
      'name', name, 'phone', phone, 'balance', balance
    ) INTO v_party FROM suppliers WHERE id = v_tok.supplier_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'invoice_number', invoice_number, 'due_date', due_date, 'total_amount', total_amount,
      'paid_amount', paid_amount, 'remaining_balance', remaining_balance, 'status', status
    ) ORDER BY due_date NULLS LAST), '[]'::JSONB) INTO v_debts
    FROM debt_records
    WHERE supplier_id = v_tok.supplier_id AND store_id = v_tok.store_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'amount', amount, 'payment_method', payment_method, 'payment_date', payment_date
    ) ORDER BY payment_date DESC), '[]'::JSONB) INTO v_payments
    FROM supplier_payments WHERE supplier_id = v_tok.supplier_id AND store_id = v_tok.store_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'party_type', v_tok.party_type,
    'store', jsonb_build_object('name', v_store.name, 'currency', v_store.currency, 'phone', v_store.phone),
    'party', v_party,
    'debts', v_debts,
    'payments', v_payments
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Dashboard stats + aging RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_debt_dashboard(p_store_id UUID, p_party_type debt_party_type DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB := '{}'::JSONB;
  v_party debt_party_type;
BEGIN
  FOR v_party IN SELECT unnest(ARRAY['customer'::debt_party_type, 'supplier'::debt_party_type])
  LOOP
    IF p_party_type IS NOT NULL AND v_party <> p_party_type THEN CONTINUE; END IF;

    v_result := v_result || jsonb_build_object(v_party::TEXT, (
      SELECT jsonb_build_object(
        'total', COALESCE(SUM(remaining_balance) FILTER (WHERE remaining_balance > 0 AND status <> 'written_off'), 0),
        'overdue', COALESCE(SUM(remaining_balance) FILTER (
          WHERE remaining_balance > 0 AND status = 'overdue'
        ), 0),
        'due_today', COALESCE(SUM(remaining_balance) FILTER (
          WHERE remaining_balance > 0 AND due_date = CURRENT_DATE
        ), 0),
        'due_this_week', COALESCE(SUM(remaining_balance) FILTER (
          WHERE remaining_balance > 0 AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        ), 0),
        'count', COUNT(*) FILTER (WHERE remaining_balance > 0 AND status <> 'written_off'),
        'aging', jsonb_build_object(
          '0_30', COALESCE(SUM(remaining_balance) FILTER (
            WHERE remaining_balance > 0 AND due_date >= CURRENT_DATE - 30
          ), 0),
          '31_60', COALESCE(SUM(remaining_balance) FILTER (
            WHERE remaining_balance > 0 AND due_date BETWEEN CURRENT_DATE - 60 AND CURRENT_DATE - 31
          ), 0),
          '61_90', COALESCE(SUM(remaining_balance) FILTER (
            WHERE remaining_balance > 0 AND due_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE - 61
          ), 0),
          '90_plus', COALESCE(SUM(remaining_balance) FILTER (
            WHERE remaining_balance > 0 AND (due_date < CURRENT_DATE - 90 OR (due_date IS NULL AND created_at < NOW() - INTERVAL '90 days'))
          ), 0)
        )
      )
      FROM debt_records WHERE store_id = p_store_id AND party_type = v_party
    ));
  END LOOP;

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- Backfill existing open debts
-- ============================================================
INSERT INTO debt_records (
  store_id, party_type, customer_id, sale_id, invoice_number,
  due_date, total_amount, paid_amount, remaining_balance, status, created_at
)
SELECT
  s.store_id, 'customer', s.customer_id, s.id, s.invoice_number,
  COALESCE(s.due_date, (s.sale_date::DATE + 30)),
  s.credit_amount, 0, s.credit_amount,
  compute_debt_status(s.credit_amount, COALESCE(s.due_date, s.sale_date::DATE + 30), NULL),
  s.sale_date
FROM sales s
WHERE s.status = 'completed' AND COALESCE(s.credit_amount, 0) > 0 AND s.customer_id IS NOT NULL
ON CONFLICT (sale_id) WHERE sale_id IS NOT NULL DO NOTHING;

INSERT INTO debt_records (
  store_id, party_type, supplier_id, purchase_order_id, invoice_number,
  due_date, total_amount, paid_amount, remaining_balance, status, created_at
)
SELECT
  po.store_id, 'supplier', po.supplier_id, po.id, po.po_number,
  COALESCE(po.due_date, (COALESCE(po.received_date, po.created_at::DATE) + 30)),
  GREATEST(0, po.total_amount - COALESCE(po.paid_amount, 0)),
  0,
  GREATEST(0, po.total_amount - COALESCE(po.paid_amount, 0)),
  compute_debt_status(
    GREATEST(0, po.total_amount - COALESCE(po.paid_amount, 0)),
    COALESCE(po.due_date, COALESCE(po.received_date, po.created_at::DATE) + 30),
    NULL
  ),
  po.updated_at
FROM purchase_orders po
WHERE po.status = 'received' AND po.supplier_id IS NOT NULL
  AND (po.total_amount - COALESCE(po.paid_amount, 0)) > 0
ON CONFLICT (purchase_order_id) WHERE purchase_order_id IS NOT NULL DO NOTHING;

-- Refresh all statuses
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM debt_records LOOP
    PERFORM refresh_debt_record_status(r.id);
  END LOOP;
END $$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE debt_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_portal_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debt_records_store ON debt_records;
CREATE POLICY debt_records_store ON debt_records FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS debt_events_store ON debt_events;
CREATE POLICY debt_events_store ON debt_events FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS debt_notes_store ON debt_notes;
CREATE POLICY debt_notes_store ON debt_notes FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS debt_portal_tokens_store ON debt_portal_tokens;
CREATE POLICY debt_portal_tokens_store ON debt_portal_tokens FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- Extend receive_purchase_order with due_date param
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
  v_new_cost DECIMAL;
  v_ap_amount DECIMAL;
  v_journal_lines JSONB := '[]'::JSONB;
  v_payment_code TEXT;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PO not found'); END IF;
  IF v_po.status IN ('received', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PO already closed');
  END IF;

  FOR v_item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_before := v_product.stock_quantity;
    v_after := v_before + v_item.quantity;
    IF v_after > 0 AND v_item.quantity > 0 THEN
      v_new_cost := ((v_before * v_product.cost_price) + (v_item.quantity * v_item.unit_cost)) / v_after;
    ELSE v_new_cost := v_item.unit_cost; END IF;
    UPDATE products SET stock_quantity = v_after, cost_price = ROUND(v_new_cost, 2), updated_at = NOW() WHERE id = v_item.product_id;
    INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
    VALUES (p_store_id, v_item.product_id, v_item.quantity, v_item.unit_cost, 'purchase_order', p_po_id);
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
    jsonb_build_object('account_code', '1300', 'debit', v_po.total_amount, 'credit', 0, 'description', 'Inventory purchase')
  );
  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_payment_method);
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_paid_amount, 'description', 'Purchase payment')
    );
  END IF;
  IF v_ap_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', v_ap_amount, 'description', 'Accounts payable')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Purchase ' || v_po.po_number, p_po_id, 'purchase_order', p_user_id, v_journal_lines);
  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'ap_amount', v_ap_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Patch complete_pos_sale: add due_date param (append to signature)
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
    INSERT INTO sale_items (store_id, sale_id, product_id, product_name, product_sku, quantity, unit_price, cost_price, discount_amount, tax_amount, subtotal)
    VALUES (p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku, v_item.quantity, v_item.unit_price, v_item.cost_price, v_item.discount_amount, v_item.tax_amount, v_item.subtotal);
    IF v_cost_method = 'fifo' THEN
      v_cogs_total := v_cogs_total + consume_fifo_cost(p_store_id, v_item.product_id, v_item.quantity);
    ELSE
      v_cogs_total := v_cogs_total + (COALESCE(v_item.cost_price, 0) * v_item.quantity);
    END IF;
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
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', v_revenue, 'description', 'Sales revenue'));
  END IF;
  IF COALESCE(p_tax_amount, 0) > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object('account_code', '2200', 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable'));
  END IF;
  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_payment_method);
    IF p_payment_method = 'credit' THEN v_payment_code := '1110'; END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received'));
  END IF;
  IF p_credit_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object('account_code', '1200', 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable'));
  END IF;
  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '5100', 'debit', v_cogs_total, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', v_invoice_number, 'total', p_total_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
