-- Fix receive_purchase_order: migration 019 called record_product_cost_history
-- which was never created. Use log_product_cost_history from migration 017.

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

-- Alias for any code expecting the old name (maps to log_product_cost_history)
CREATE OR REPLACE FUNCTION record_product_cost_history(
  p_store_id UUID,
  p_product_id UUID,
  p_new_cost DECIMAL,
  p_purchase_qty DECIMAL,
  p_purchase_unit_cost DECIMAL,
  p_supplier_id UUID,
  p_purchase_reference TEXT,
  p_purchase_order_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_before DECIMAL;
  v_after DECIMAL;
  v_prev_cost DECIMAL;
BEGIN
  SELECT stock_quantity, cost_price INTO v_after, v_prev_cost
  FROM products WHERE id = p_product_id AND store_id = p_store_id;

  v_after := COALESCE(v_after, 0);
  v_prev_cost := GREATEST(COALESCE(v_prev_cost, 0), 0);
  v_before := GREATEST(v_after - COALESCE(p_purchase_qty, 0), 0);

  RETURN log_product_cost_history(
    p_store_id, p_product_id, 'purchase',
    p_purchase_qty, p_purchase_unit_cost,
    v_before, v_after,
    v_prev_cost, p_new_cost,
    p_supplier_id, p_purchase_reference, p_purchase_order_id, p_user_id,
    p_notes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
