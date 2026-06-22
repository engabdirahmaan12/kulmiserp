-- KULMIS ERP: Realtime accounting integration for all business modules
-- Every operational transaction posts to the GL automatically — no manual entry required.

-- ============================================================
-- Stock adjustment / opening inventory → Inventory (1300) GL
-- ============================================================
CREATE OR REPLACE FUNCTION record_stock_adjustment(
  p_store_id UUID,
  p_user_id UUID,
  p_product_id UUID,
  p_quantity_after DECIMAL,
  p_reason TEXT DEFAULT NULL,
  p_movement_type TEXT DEFAULT 'adjustment'
) RETURNS JSONB AS $$
DECLARE
  v_product RECORD;
  v_before DECIMAL(15,3);
  v_after DECIMAL(15,3);
  v_change DECIMAL(15,3);
  v_value DECIMAL(15,2);
  v_movement_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_credit_account TEXT;
BEGIN
  IF p_quantity_after < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity cannot be negative');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;
  IF NOT v_product.track_inventory THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product does not track inventory');
  END IF;

  v_before := v_product.stock_quantity;
  v_after := ROUND(p_quantity_after, 3);
  v_change := v_after - v_before;

  IF ABS(v_change) < 0.0001 THEN
    RETURN jsonb_build_object('success', true, 'message', 'No change', 'quantity_after', v_after);
  END IF;

  UPDATE products SET stock_quantity = v_after, updated_at = NOW() WHERE id = p_product_id;

  INSERT INTO stock_movements (
    store_id, product_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, created_by
  ) VALUES (
    p_store_id, p_product_id,
    CASE WHEN p_movement_type = 'opening' THEN 'adjustment' ELSE 'adjustment' END,
    v_change, v_before, v_after,
    COALESCE(p_reason, p_movement_type), p_user_id
  ) RETURNING id INTO v_movement_id;

  v_value := ROUND(ABS(v_change) * COALESCE(v_product.cost_price, 0), 2);

  IF v_value > 0 THEN
    IF v_change > 0 THEN
      v_credit_account := CASE WHEN p_movement_type = 'opening' THEN '3100' ELSE '3200' END;
      v_journal_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1300', 'debit', v_value, 'credit', 0, 'description', 'Inventory increase'),
        jsonb_build_object('account_code', v_credit_account, 'debit', 0, 'credit', v_value, 'description', COALESCE(p_reason, 'Stock increase'))
      );
    ELSE
      v_journal_lines := jsonb_build_array(
        jsonb_build_object('account_code', '6500', 'debit', v_value, 'credit', 0, 'description', 'Inventory shrinkage'),
        jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_value, 'description', COALESCE(p_reason, 'Stock decrease'))
      );
    END IF;

    PERFORM post_journal_entry(
      p_store_id,
      'Stock ' || CASE WHEN v_change > 0 THEN 'increase' ELSE 'decrease' END || ': ' || v_product.name,
      v_movement_id,
      'stock_adjustment',
      p_user_id,
      v_journal_lines,
      true
    );
  END IF;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'stock_movement', v_movement_id,
    p_movement_type,
    jsonb_build_object('before', v_before),
    jsonb_build_object('after', v_after, 'value', v_value)
  );

  RETURN jsonb_build_object(
    'success', true,
    'movement_id', v_movement_id,
    'quantity_before', v_before,
    'quantity_after', v_after,
    'gl_value', v_value
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Custom / service invoice (no inventory) → full GL posting
-- ============================================================
CREATE OR REPLACE FUNCTION complete_custom_sale(
  p_store_id UUID,
  p_user_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_subtotal DECIMAL,
  p_discount_amount DECIMAL,
  p_tax_amount DECIMAL,
  p_total_amount DECIMAL,
  p_paid_amount DECIMAL,
  p_credit_amount DECIMAL,
  p_payment_method TEXT,
  p_notes TEXT DEFAULT NULL,
  p_sale_date TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB AS $$
DECLARE
  v_sale_id UUID;
  v_invoice_number TEXT;
  v_counter INTEGER;
  v_prefix TEXT;
  v_item RECORD;
  v_customer RECORD;
  v_journal_lines JSONB := '[]'::JSONB;
  v_payment_code TEXT;
  v_revenue DECIMAL(15,2);
BEGIN
  IF p_total_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Total must be greater than zero');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_credit_amount > 0 AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
    END IF;
    IF v_customer.credit_limit > 0 AND (v_customer.balance + p_credit_amount) > v_customer.credit_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Credit limit exceeded');
    END IF;
  END IF;

  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_invoice_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 5, '0');
  v_revenue := p_total_amount - COALESCE(p_tax_amount, 0);

  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, discount_type, tax_amount, total_amount,
    paid_amount, change_amount, credit_amount, payment_method, payment_details, notes, sale_date
  ) VALUES (
    p_store_id, v_invoice_number, p_customer_id, p_user_id, 'completed',
    p_subtotal, COALESCE(p_discount_amount, 0), 'fixed', COALESCE(p_tax_amount, 0), p_total_amount,
    p_paid_amount, GREATEST(0, p_paid_amount - p_total_amount), COALESCE(p_credit_amount, 0),
    p_payment_method,
    jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', p_paid_amount)),
    p_notes, p_sale_date
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_name TEXT, quantity DECIMAL, unit_price DECIMAL,
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL
  )
  LOOP
    INSERT INTO sale_items (
      store_id, sale_id, product_name, quantity, unit_price, cost_price,
      discount_amount, tax_amount, subtotal
    ) VALUES (
      p_store_id, v_sale_id, v_item.product_name, v_item.quantity, v_item.unit_price, 0,
      COALESCE(v_item.discount_amount, 0), COALESCE(v_item.tax_amount, 0), v_item.subtotal
    );
  END LOOP;

  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET
      balance = balance + COALESCE(p_credit_amount, 0),
      total_purchases = total_purchases + p_total_amount,
      updated_at = NOW()
    WHERE id = p_customer_id;
  END IF;

  IF v_revenue > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', v_revenue, 'description', 'Custom invoice revenue')
    );
  END IF;

  IF COALESCE(p_tax_amount, 0) > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2200', 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable')
    );
  END IF;

  IF p_paid_amount > 0 THEN
    v_payment_code := payment_method_account_code(p_payment_method);
    IF p_payment_method = 'credit' THEN v_payment_code := '1110'; END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;

  IF COALESCE(p_credit_amount, 0) > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;

  PERFORM post_journal_entry(
    p_store_id, 'Custom sale ' || v_invoice_number, v_sale_id, 'custom_sale', p_user_id, v_journal_lines, true
  );

  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'invoice_number', v_invoice_number,
    'total', p_total_amount
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Manual journals: owner/manager corrections only
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
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and managers can post manual journal entries');
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least two journal lines required');
  END IF;

  v_entry_id := post_journal_entry(
    p_store_id, p_description, NULL, 'manual', p_user_id, p_lines, false, p_entry_date
  );

  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
