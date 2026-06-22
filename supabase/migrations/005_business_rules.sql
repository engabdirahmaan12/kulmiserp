-- KULMIS ERP Business Rules: atomic sales, purchases, refunds, journal automation

-- ============================================================
-- SUPPLIER PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'waafi', 'evc', 'sahal', 'zaad', 'credit')),
  notes TEXT,
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_payments_store_access" ON supplier_payments
  FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

CREATE INDEX IF NOT EXISTS idx_supplier_payments_store ON supplier_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);

-- Journal entry counter on stores
ALTER TABLE stores ADD COLUMN IF NOT EXISTS journal_counter INTEGER DEFAULT 1;

-- Customer payment phone preference
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_phone TEXT;

-- Align debt_payments columns (001 vs 004 drift)
ALTER TABLE debt_payments ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;
ALTER TABLE debt_payments ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE debt_payments ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION get_account_id(p_store_id UUID, p_code TEXT)
RETURNS UUID AS $$
  SELECT id FROM chart_of_accounts WHERE store_id = p_store_id AND code = p_code LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION payment_method_account_code(p_method TEXT)
RETURNS TEXT AS $$
BEGIN
  CASE p_method
    WHEN 'waafi' THEN RETURN '1120';
    WHEN 'evc' THEN RETURN '1130';
    WHEN 'sahal' THEN RETURN '1140';
    WHEN 'zaad' THEN RETURN '1150';
    WHEN 'credit' THEN RETURN '1200';
    ELSE RETURN '1110';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_store_id UUID,
  p_description TEXT,
  p_reference_id UUID,
  p_reference_type TEXT,
  p_created_by UUID,
  p_lines JSONB
) RETURNS UUID AS $$
DECLARE
  v_entry_id UUID;
  v_entry_number TEXT;
  v_counter INTEGER;
  v_line RECORD;
  v_account_id UUID;
  v_debit DECIMAL(15,2);
  v_credit DECIMAL(15,2);
BEGIN
  SELECT journal_counter INTO v_counter FROM stores WHERE id = p_store_id FOR UPDATE;
  v_entry_number := 'JE-' || v_counter::TEXT;
  UPDATE stores SET journal_counter = v_counter + 1 WHERE id = p_store_id;

  INSERT INTO journal_entries (store_id, entry_number, description, reference_id, reference_type, is_auto, created_by)
  VALUES (p_store_id, v_entry_number, p_description, p_reference_id, p_reference_type, true, p_created_by)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(account_code TEXT, debit DECIMAL, credit DECIMAL, description TEXT)
  LOOP
    v_account_id := get_account_id(p_store_id, v_line.account_code);
    IF v_account_id IS NULL THEN CONTINUE; END IF;
    v_debit := COALESCE(v_line.debit, 0);
    v_credit := COALESCE(v_line.credit, 0);
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
-- COMPLETE POS SALE (atomic: sale + stock + customer + journal)
-- ============================================================
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
  p_notes TEXT
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
  v_check RECORD;
BEGIN
  -- Pre-validate stock before any writes
  FOR v_check IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL, product_name TEXT)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_check.product_id AND store_id = p_store_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Product not found');
    END IF;
    IF v_product.track_inventory AND v_product.stock_quantity < v_check.quantity THEN
      RETURN jsonb_build_object('success', false, 'error', format('Insufficient stock for %s', v_product.name));
    END IF;
  END LOOP;

  -- Credit limit check
  IF p_credit_amount > 0 AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
    END IF;
    IF v_customer.credit_limit > 0 AND (v_customer.balance + p_credit_amount) > v_customer.credit_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Credit limit exceeded');
    END IF;
  END IF;

  -- Invoice number
  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_invoice_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 5, '0');

  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, discount_type, tax_amount, total_amount,
    paid_amount, change_amount, credit_amount, payment_method, payment_details, notes, sale_date
  ) VALUES (
    p_store_id, v_invoice_number, p_customer_id, p_cashier_id, 'completed',
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount, p_change_amount, p_credit_amount, p_payment_method, p_payment_details, p_notes, NOW()
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, product_name TEXT, product_sku TEXT,
    quantity DECIMAL, unit_price DECIMAL, cost_price DECIMAL,
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL
  )
  LOOP
    INSERT INTO sale_items (
      store_id, sale_id, product_id, product_name, product_sku,
      quantity, unit_price, cost_price, discount_amount, tax_amount, subtotal
    ) VALUES (
      p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku,
      v_item.quantity, v_item.unit_price, v_item.cost_price, v_item.discount_amount, v_item.tax_amount, v_item.subtotal
    );
    v_cogs_total := v_cogs_total + (COALESCE(v_item.cost_price, 0) * v_item.quantity);
  END LOOP;

  PERFORM process_sale_stock(p_store_id, v_sale_id, (
    SELECT jsonb_agg(jsonb_build_object('product_id', x.product_id, 'quantity', x.quantity))
    FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity DECIMAL)
  ), p_cashier_id);

  -- Customer balance
  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET
      balance = balance + p_credit_amount,
      total_purchases = total_purchases + p_total_amount,
      updated_at = NOW()
    WHERE id = p_customer_id;
  END IF;

  -- Journal: revenue
  v_journal_lines := v_journal_lines || jsonb_build_array(
    jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', p_total_amount, 'description', 'Sales revenue')
  );

  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_payment_method);
    IF p_payment_method = 'credit' THEN
      v_payment_code := '1110';
    END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;

  IF p_credit_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;

  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '5100', 'debit', v_cogs_total, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);

  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'invoice_number', v_invoice_number,
    'total', p_total_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RECEIVE PURCHASE ORDER (stock + avg cost + supplier AP + journal)
-- ============================================================
CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_store_id UUID,
  p_po_id UUID,
  p_user_id UUID,
  p_paid_amount DECIMAL DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash'
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
    ELSE
      v_new_cost := v_item.unit_cost;
    END IF;

    UPDATE products SET
      stock_quantity = v_after,
      cost_price = ROUND(v_new_cost, 2),
      updated_at = NOW()
    WHERE id = v_item.product_id;

    INSERT INTO stock_movements (
      store_id, product_id, movement_type, quantity_change,
      quantity_before, quantity_after, reference_id, reference_type, reason, created_by
    ) VALUES (
      p_store_id, v_item.product_id, 'purchase', v_item.quantity,
      v_before, v_after, p_po_id, 'purchase_order', 'PO receive ' || v_po.po_number, p_user_id
    );

    UPDATE purchase_order_items SET received_quantity = v_item.quantity WHERE id = v_item.id;
  END LOOP;

  v_ap_amount := v_po.total_amount - p_paid_amount;

  UPDATE purchase_orders SET
    status = 'received',
    received_date = CURRENT_DATE,
    paid_amount = p_paid_amount,
    updated_at = NOW()
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL AND v_ap_amount > 0 THEN
    UPDATE suppliers SET balance = balance + v_ap_amount, updated_at = NOW() WHERE id = v_po.supplier_id;
  END IF;

  -- Journal: DR Inventory, CR Cash/AP
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

-- ============================================================
-- PROCESS SALE REFUND (full or partial items)
-- ============================================================
CREATE OR REPLACE FUNCTION process_sale_refund(
  p_store_id UUID,
  p_sale_id UUID,
  p_user_id UUID,
  p_refund_items JSONB,
  p_refund_amount DECIMAL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
  v_product RECORD;
  v_before DECIMAL;
  v_after DECIMAL;
  v_refund_invoice TEXT;
  v_counter INTEGER;
  v_prefix TEXT;
  v_refund_sale_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_cogs_total DECIMAL(15,2) := 0;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.status = 'refunded' THEN RETURN jsonb_build_object('success', false, 'error', 'Already refunded'); END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_refund_items) AS x(
    sale_item_id UUID, product_id UUID, quantity DECIMAL, cost_price DECIMAL, subtotal DECIMAL
  )
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
      IF FOUND AND v_product.track_inventory THEN
        v_before := v_product.stock_quantity;
        v_after := v_before + v_item.quantity;
        UPDATE products SET stock_quantity = v_after, updated_at = NOW() WHERE id = v_item.product_id;
        INSERT INTO stock_movements (
          store_id, product_id, movement_type, quantity_change,
          quantity_before, quantity_after, reference_id, reference_type, reason, created_by
        ) VALUES (
          p_store_id, v_item.product_id, 'return', v_item.quantity,
          v_before, v_after, p_sale_id, 'sale_refund', p_reason, p_user_id
        );
      END IF;
    END IF;
    v_cogs_total := v_cogs_total + (COALESCE(v_item.cost_price, 0) * v_item.quantity);
  END LOOP;

  -- Refund invoice
  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_refund_invoice := COALESCE(v_prefix, 'INV') || '-RF-' || LPAD(v_counter::TEXT, 5, '0');

  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, tax_amount, total_amount,
    paid_amount, credit_amount, payment_method, notes, sale_date
  ) VALUES (
    p_store_id, v_refund_invoice, v_sale.customer_id, p_user_id, 'refunded',
    p_refund_amount, 0, 0, -p_refund_amount,
    -p_refund_amount, 0, v_sale.payment_method, 'Refund for ' || v_sale.invoice_number || ': ' || COALESCE(p_reason, ''),
    NOW()
  ) RETURNING id INTO v_refund_sale_id;

  UPDATE sales SET status = 'refunded', updated_at = NOW() WHERE id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL AND v_sale.credit_amount > 0 THEN
    UPDATE customers SET
      balance = GREATEST(0, balance - LEAST(v_sale.credit_amount, p_refund_amount)),
      updated_at = NOW()
    WHERE id = v_sale.customer_id;
  END IF;

  -- Reverse journal
  v_journal_lines := v_journal_lines || jsonb_build_array(
    jsonb_build_object('account_code', '4100', 'debit', p_refund_amount, 'credit', 0, 'description', 'Sales refund'),
    jsonb_build_object('account_code', payment_method_account_code(v_sale.payment_method), 'debit', 0, 'credit', p_refund_amount, 'description', 'Refund payment')
  );

  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1300', 'debit', v_cogs_total, 'credit', 0, 'description', 'Inventory return'),
      jsonb_build_object('account_code', '5100', 'debit', 0, 'credit', v_cogs_total, 'description', 'COGS reversal')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Refund ' || v_sale.invoice_number, p_refund_sale_id, 'sale_refund', p_user_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true, 'refund_invoice', v_refund_invoice, 'refund_sale_id', v_refund_sale_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
