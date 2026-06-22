-- ============================================================
-- 017: Production inventory costing engine (WAC default, FIFO, LIFO)
-- Cost history audit trail, accurate COGS from live average cost
-- ============================================================

-- Extend costing method (default remains 'average' = Weighted Average Cost)
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_inventory_cost_method_check;
ALTER TABLE stores
  ADD CONSTRAINT stores_inventory_cost_method_check
  CHECK (inventory_cost_method IN ('average', 'fifo', 'lifo'));

COMMENT ON COLUMN stores.inventory_cost_method IS 'average = Weighted Average Cost (WAC), fifo, lifo';

-- ============================================================
-- product_cost_history — immutable audit trail (never overwrite)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_cost_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'purchase'
    CHECK (event_type IN ('purchase', 'opening_balance', 'adjustment', 'method_change')),
  purchase_qty DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (purchase_qty >= 0),
  purchase_unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (purchase_unit_cost >= 0),
  quantity_before DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (quantity_before >= 0),
  quantity_after DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (quantity_after >= 0),
  previous_average_cost DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (previous_average_cost >= 0),
  new_average_cost DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (new_average_cost >= 0),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_reference TEXT,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_cost_history_product_idx
  ON product_cost_history(store_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_cost_history_po_idx
  ON product_cost_history(purchase_order_id) WHERE purchase_order_id IS NOT NULL;

ALTER TABLE product_cost_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_cost_history_store ON product_cost_history;
CREATE POLICY product_cost_history_store ON product_cost_history FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- WAC helper — (qty_before × prev_cost + purchase_qty × purchase_cost) ÷ qty_after
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_weighted_average_cost(
  p_quantity_before DECIMAL,
  p_previous_cost DECIMAL,
  p_purchase_qty DECIMAL,
  p_purchase_unit_cost DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  v_after DECIMAL;
BEGIN
  IF COALESCE(p_purchase_qty, 0) <= 0 THEN
    RETURN GREATEST(COALESCE(p_previous_cost, 0), 0);
  END IF;

  v_after := COALESCE(p_quantity_before, 0) + p_purchase_qty;

  IF v_after <= 0 THEN
    RETURN GREATEST(COALESCE(p_purchase_unit_cost, 0), 0);
  END IF;

  RETURN ROUND(
    (
      (COALESCE(p_quantity_before, 0) * GREATEST(COALESCE(p_previous_cost, 0), 0))
      + (p_purchase_qty * GREATEST(COALESCE(p_purchase_unit_cost, 0), 0))
    ) / v_after,
    2
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION log_product_cost_history(
  p_store_id UUID,
  p_product_id UUID,
  p_event_type TEXT,
  p_purchase_qty DECIMAL,
  p_purchase_unit_cost DECIMAL,
  p_quantity_before DECIMAL,
  p_quantity_after DECIMAL,
  p_previous_cost DECIMAL,
  p_new_cost DECIMAL,
  p_supplier_id UUID DEFAULT NULL,
  p_purchase_reference TEXT DEFAULT NULL,
  p_purchase_order_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO product_cost_history (
    store_id, product_id, event_type,
    purchase_qty, purchase_unit_cost,
    quantity_before, quantity_after,
    previous_average_cost, new_average_cost,
    supplier_id, purchase_reference, purchase_order_id,
    created_by, notes
  ) VALUES (
    p_store_id, p_product_id, p_event_type,
    GREATEST(COALESCE(p_purchase_qty, 0), 0),
    GREATEST(COALESCE(p_purchase_unit_cost, 0), 0),
    GREATEST(COALESCE(p_quantity_before, 0), 0),
    GREATEST(COALESCE(p_quantity_after, 0), 0),
    GREATEST(COALESCE(p_previous_cost, 0), 0),
    GREATEST(COALESCE(p_new_cost, 0), 0),
    p_supplier_id, p_purchase_reference, p_purchase_order_id,
    p_user_id, p_notes
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- LIFO cost consumption (newest layers first)
-- ============================================================
CREATE OR REPLACE FUNCTION consume_lifo_cost(
  p_store_id UUID,
  p_product_id UUID,
  p_quantity DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  v_remaining DECIMAL := p_quantity;
  v_total_cost DECIMAL(15,2) := 0;
  v_layer RECORD;
  v_fallback DECIMAL(15,2);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN 0; END IF;

  FOR v_layer IN
    SELECT * FROM inventory_cost_layers
    WHERE store_id = p_store_id AND product_id = p_product_id AND quantity_remaining > 0
    ORDER BY received_at DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_layer.quantity_remaining >= v_remaining THEN
      v_total_cost := v_total_cost + (v_remaining * v_layer.unit_cost);
      UPDATE inventory_cost_layers
      SET quantity_remaining = quantity_remaining - v_remaining
      WHERE id = v_layer.id;
      v_remaining := 0;
    ELSE
      v_total_cost := v_total_cost + (v_layer.quantity_remaining * v_layer.unit_cost);
      v_remaining := v_remaining - v_layer.quantity_remaining;
      UPDATE inventory_cost_layers SET quantity_remaining = 0 WHERE id = v_layer.id;
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    SELECT cost_price INTO v_fallback FROM products WHERE id = p_product_id;
    v_total_cost := v_total_cost + (v_remaining * GREATEST(COALESCE(v_fallback, 0), 0));
  END IF;

  RETURN ROUND(v_total_cost, 2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RECEIVE PO — WAC update + cost history + conditional layers
-- ============================================================
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
  v_prev_cost DECIMAL;
  v_new_cost DECIMAL;
  v_ap_amount DECIMAL;
  v_journal_lines JSONB := '[]'::JSONB;
  v_payment_code TEXT;
  v_cost_method TEXT;
  v_supplier_name TEXT;
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PO not found'); END IF;
  IF v_po.status IN ('received', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PO already closed');
  END IF;

  IF v_po.supplier_id IS NOT NULL THEN
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_po.supplier_id;
  END IF;

  FOR v_item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_before := COALESCE(v_product.stock_quantity, 0);
    v_prev_cost := GREATEST(COALESCE(v_product.cost_price, 0), 0);
    v_after := v_before + COALESCE(v_item.quantity, 0);

    v_new_cost := calculate_weighted_average_cost(
      v_before, v_prev_cost, v_item.quantity, v_item.unit_cost
    );

    UPDATE products SET
      stock_quantity = v_after,
      cost_price = v_new_cost,
      updated_at = NOW()
    WHERE id = v_item.product_id;

    PERFORM log_product_cost_history(
      p_store_id, v_item.product_id, 'purchase',
      v_item.quantity, v_item.unit_cost,
      v_before, v_after,
      v_prev_cost, v_new_cost,
      v_po.supplier_id, v_po.po_number, p_po_id, p_user_id,
      CASE WHEN v_supplier_name IS NOT NULL THEN 'Supplier: ' || v_supplier_name ELSE NULL END
    );

    IF v_cost_method IN ('fifo', 'lifo') AND COALESCE(v_item.quantity, 0) > 0 THEN
      INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
      VALUES (p_store_id, v_item.product_id, v_item.quantity, v_item.unit_cost, 'purchase_order', p_po_id);
    END IF;

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

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'purchase_order', p_po_id, 'received', NULL,
    jsonb_build_object('po_number', v_po.po_number, 'total', v_po.total_amount, 'cost_method', v_cost_method));

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'ap_amount', v_ap_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- POS SALE — COGS from live average cost (WAC), FIFO, or LIFO
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
  v_line_cogs DECIMAL(15,2);
  v_unit_cost DECIMAL(15,2);
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
    v_line_cogs := 0;
    v_unit_cost := 0;

    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;

      IF v_cost_method = 'fifo' THEN
        v_line_cogs := consume_fifo_cost(p_store_id, v_item.product_id, v_item.quantity);
        v_unit_cost := CASE WHEN COALESCE(v_item.quantity, 0) > 0 THEN ROUND(v_line_cogs / v_item.quantity, 2) ELSE 0 END;
      ELSIF v_cost_method = 'lifo' THEN
        v_line_cogs := consume_lifo_cost(p_store_id, v_item.product_id, v_item.quantity);
        v_unit_cost := CASE WHEN COALESCE(v_item.quantity, 0) > 0 THEN ROUND(v_line_cogs / v_item.quantity, 2) ELSE 0 END;
      ELSE
        v_unit_cost := GREATEST(COALESCE(v_product.cost_price, 0), 0);
        v_line_cogs := ROUND(v_unit_cost * COALESCE(v_item.quantity, 0), 2);
      END IF;
    ELSE
      v_unit_cost := GREATEST(COALESCE(v_item.cost_price, 0), 0);
      v_line_cogs := ROUND(v_unit_cost * COALESCE(v_item.quantity, 0), 2);
    END IF;

    v_cogs_total := v_cogs_total + v_line_cogs;

    INSERT INTO sale_items (store_id, sale_id, product_id, product_name, product_sku, quantity, unit_price, cost_price, discount_amount, tax_amount, subtotal)
    VALUES (p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku, v_item.quantity, v_item.unit_price, v_unit_cost, v_item.discount_amount, v_item.tax_amount, v_item.subtotal);
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

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', v_invoice_number, 'total', p_total_amount, 'cogs', v_cogs_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Settings — validate costing method
-- ============================================================
CREATE OR REPLACE FUNCTION update_store_accounting_settings(
  p_store_id UUID,
  p_user_id UUID,
  p_secondary_currency TEXT DEFAULT NULL,
  p_inventory_cost_method TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_old_method TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_inventory_cost_method IS NOT NULL AND p_inventory_cost_method NOT IN ('average', 'fifo', 'lifo') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid costing method');
  END IF;

  SELECT inventory_cost_method INTO v_old_method FROM stores WHERE id = p_store_id;

  UPDATE stores SET
    secondary_currency = COALESCE(NULLIF(trim(p_secondary_currency), ''), secondary_currency),
    inventory_cost_method = COALESCE(p_inventory_cost_method, inventory_cost_method),
    updated_at = NOW()
  WHERE id = p_store_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'store', p_store_id, 'settings_updated', NULL,
    jsonb_build_object(
      'secondary_currency', p_secondary_currency,
      'inventory_cost_method', p_inventory_cost_method,
      'previous_cost_method', v_old_method
    ));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
