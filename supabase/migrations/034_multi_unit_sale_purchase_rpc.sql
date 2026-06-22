-- Multi-unit: stock, COGS, and purchases always use BASE units

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
  v_conv DECIMAL;
  v_purchase_qty DECIMAL;
  v_base_qty DECIMAL;
  v_purchase_unit_cost DECIMAL;
  v_base_unit_cost DECIMAL;
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

    v_conv := product_unit_conversion(v_item.product_id, v_item.purchase_unit_id);
    v_purchase_qty := COALESCE(v_item.purchase_unit_qty, v_item.quantity, 0);
    v_base_qty := COALESCE(v_item.base_qty, ROUND(v_purchase_qty * v_conv, 3));
    v_purchase_unit_cost := COALESCE(v_item.unit_cost, 0);
    v_base_unit_cost := CASE
      WHEN v_conv > 0 THEN ROUND(v_purchase_unit_cost / v_conv, 4)
      ELSE v_purchase_unit_cost
    END;

    IF v_base_qty <= 0 THEN CONTINUE; END IF;

    v_before := COALESCE(v_product.stock_quantity, 0);
    v_prev_cost := GREATEST(COALESCE(v_product.cost_price, 0), 0);
    v_after := v_before + v_base_qty;

    v_new_cost := calculate_weighted_average_cost(
      v_before, v_prev_cost, v_base_qty, v_base_unit_cost
    );

    UPDATE products SET
      stock_quantity = v_after,
      cost_price = v_new_cost,
      updated_at = NOW()
    WHERE id = v_item.product_id;

    PERFORM log_product_cost_history(
      p_store_id, v_item.product_id, 'purchase',
      v_base_qty, v_base_unit_cost,
      v_before, v_after,
      v_prev_cost, v_new_cost,
      v_po.supplier_id, v_po.po_number, p_po_id, p_user_id,
      CASE WHEN v_supplier_name IS NOT NULL THEN 'Supplier: ' || v_supplier_name ELSE NULL END
    );

    IF v_cost_method IN ('fifo', 'lifo') AND v_base_qty > 0 THEN
      INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
      VALUES (p_store_id, v_item.product_id, v_base_qty, v_base_unit_cost, 'purchase_order', p_po_id);
    END IF;

    INSERT INTO stock_movements (store_id, product_id, movement_type, quantity_change, quantity_before, quantity_after, reference_id, reference_type, reason, created_by)
    VALUES (p_store_id, v_item.product_id, 'purchase', v_base_qty, v_before, v_after, p_po_id, 'purchase_order', 'PO receive ' || v_po.po_number, p_user_id);

    UPDATE purchase_order_items SET
      received_quantity = v_purchase_qty,
      base_qty = v_base_qty
    WHERE id = v_item.id;
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
    jsonb_build_object('account_code', coa_code(p_store_id, 'inventory'), 'debit', v_po.total_amount, 'credit', 0, 'description', 'Inventory purchase')
  );
  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_store_id, p_payment_method);
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', 0, 'credit', p_paid_amount, 'description', 'Purchase payment')
    );
  END IF;
  IF v_ap_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'accounts_payable'), 'debit', 0, 'credit', v_ap_amount, 'description', 'Accounts payable')
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

CREATE OR REPLACE FUNCTION _complete_pos_sale_impl(
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
  v_base_qty DECIMAL(15,3);
  v_sale_unit_qty DECIMAL(15,3);
  v_conv DECIMAL;
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');
  v_revenue := p_total_amount - COALESCE(p_tax_amount, 0);
  v_resolved_due := COALESCE(
    p_due_date,
    NULLIF(p_payment_details->0->>'due_date', '')::DATE,
    CASE WHEN p_credit_amount > 0 THEN CURRENT_DATE + 30 ELSE NULL END
  );

  FOR v_check IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity DECIMAL,
    product_name TEXT,
    base_qty DECIMAL,
    sale_unit_id UUID,
    sale_unit_qty DECIMAL
  )
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_check.product_id AND store_id = p_store_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Product not found'); END IF;

    v_conv := product_unit_conversion(v_check.product_id, v_check.sale_unit_id);
    v_sale_unit_qty := COALESCE(v_check.sale_unit_qty, v_check.quantity, 0);
    v_base_qty := COALESCE(v_check.base_qty, ROUND(v_sale_unit_qty * v_conv, 3));

    IF v_product.track_inventory AND v_product.stock_quantity < v_base_qty THEN
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
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL,
    base_qty DECIMAL, sale_unit_id UUID, sale_unit_code TEXT,
    sale_unit_qty DECIMAL, price_tier TEXT
  )
  LOOP
    v_line_cogs := 0;
    v_unit_cost := 0;

    v_conv := product_unit_conversion(v_item.product_id, v_item.sale_unit_id);
    v_sale_unit_qty := COALESCE(v_item.sale_unit_qty, v_item.quantity, 0);
    v_base_qty := COALESCE(v_item.base_qty, ROUND(v_sale_unit_qty * v_conv, 3));

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

  PERFORM process_sale_stock(p_store_id, v_sale_id, (
    SELECT jsonb_agg(jsonb_build_object('product_id', x.product_id, 'quantity', COALESCE(x.base_qty, x.quantity)))
    FROM jsonb_to_recordset(p_items) AS x(
      product_id UUID,
      quantity DECIMAL,
      base_qty DECIMAL,
      sale_unit_id UUID,
      sale_unit_qty DECIMAL
    )
  ), p_cashier_id);

  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET balance = balance + p_credit_amount, total_purchases = total_purchases + p_total_amount, updated_at = NOW()
    WHERE id = p_customer_id;
  END IF;

  IF v_revenue > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'sales_revenue'), 'debit', 0, 'credit', v_revenue, 'description', 'Sales revenue')
    );
  END IF;
  IF COALESCE(p_tax_amount, 0) > 0 AND coa_code(p_store_id, 'tax_payable') IS NOT NULL THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'tax_payable'), 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable')
    );
  END IF;
  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_store_id, p_payment_method);
    IF p_payment_method = 'credit' THEN
      v_payment_code := COALESCE(coa_code(p_store_id, 'cash'), v_payment_code);
    END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;
  IF p_credit_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'accounts_receivable'), 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;
  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'cogs'), 'debit', v_cogs_total, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('account_code', coa_code(p_store_id, 'inventory'), 'debit', 0, 'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', v_invoice_number, 'total', p_total_amount, 'cogs', v_cogs_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update store business mode and re-seed unit catalog
CREATE OR REPLACE FUNCTION update_store_business_mode(
  p_store_id UUID,
  p_user_id UUID,
  p_business_mode TEXT
) RETURNS JSONB AS $$
BEGIN
  IF NOT verify_store_access(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_business_mode NOT IN ('retail_only', 'wholesale_only', 'wholesale_retail') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid business mode');
  END IF;

  UPDATE stores SET business_mode = p_business_mode, updated_at = NOW() WHERE id = p_store_id;
  PERFORM seed_store_unit_types(p_store_id, p_business_mode);

  RETURN jsonb_build_object('success', true, 'business_mode', p_business_mode);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_store_business_mode(UUID, UUID, TEXT) TO authenticated;
