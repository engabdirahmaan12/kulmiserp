-- Custom invoice: same multi-unit inventory/accounting engine as POS
-- Refunds: restore stock in base units

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
  v_result JSONB;
BEGIN
  IF p_total_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Total must be greater than zero');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  v_result := _complete_pos_sale_impl(
    p_store_id,
    p_user_id,
    p_customer_id,
    p_items,
    p_subtotal,
    COALESCE(p_discount_amount, 0),
    'fixed',
    COALESCE(p_tax_amount, 0),
    p_total_amount,
    p_paid_amount,
    GREATEST(0, p_paid_amount - p_total_amount),
    COALESCE(p_credit_amount, 0),
    p_payment_method,
    jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', p_paid_amount)),
    p_notes,
    NULL
  );

  IF COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    UPDATE sales SET sale_date = p_sale_date WHERE id = (v_result->>'sale_id')::UUID;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  v_tax_refund DECIMAL(15,2) := 0;
  v_revenue_refund DECIMAL(15,2);
  v_restore_qty DECIMAL(15,3);
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.status = 'refunded' THEN RETURN jsonb_build_object('success', false, 'error', 'Already refunded'); END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_refund_items) AS x(
    sale_item_id UUID, product_id UUID, quantity DECIMAL, base_qty DECIMAL,
    cost_price DECIMAL, subtotal DECIMAL
  )
  LOOP
    v_restore_qty := COALESCE(v_item.base_qty, v_item.quantity, 0);

    IF v_item.product_id IS NOT NULL AND v_restore_qty > 0 THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
      IF FOUND AND v_product.track_inventory THEN
        v_before := v_product.stock_quantity;
        v_after := v_before + v_restore_qty;
        UPDATE products SET stock_quantity = v_after, updated_at = NOW() WHERE id = v_item.product_id;
        INSERT INTO stock_movements (
          store_id, product_id, movement_type, quantity_change,
          quantity_before, quantity_after, reference_id, reference_type, reason, created_by
        ) VALUES (
          p_store_id, v_item.product_id, 'return', v_restore_qty,
          v_before, v_after, p_sale_id, 'sale_refund', p_reason, p_user_id
        );
        INSERT INTO inventory_cost_layers (store_id, product_id, quantity_remaining, unit_cost, source_type, source_id)
        VALUES (p_store_id, v_item.product_id, v_restore_qty, COALESCE(v_item.cost_price, 0), 'sale_refund', p_sale_id);
      END IF;
    END IF;
    v_cogs_total := v_cogs_total + (COALESCE(v_item.cost_price, 0) * v_restore_qty);
  END LOOP;

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

  IF v_sale.total_amount > 0 AND COALESCE(v_sale.tax_amount, 0) > 0 THEN
    v_tax_refund := ROUND((p_refund_amount / v_sale.total_amount) * v_sale.tax_amount, 2);
  END IF;
  v_revenue_refund := p_refund_amount - v_tax_refund;

  IF v_revenue_refund > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'sales_revenue'), '4100'),
        'debit', v_revenue_refund, 'credit', 0, 'description', 'Sales refund'
      )
    );
  END IF;

  IF v_tax_refund > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'tax_payable'), '2200'),
        'debit', v_tax_refund, 'credit', 0, 'description', 'Tax refund'
      )
    );
  END IF;

  IF p_refund_amount > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(payment_method_account_code(v_sale.payment_method), '1110'),
        'debit', 0, 'credit', p_refund_amount, 'description', 'Refund paid'
      )
    );
  END IF;

  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'inventory'), '1300'),
        'debit', v_cogs_total, 'credit', 0, 'description', 'Inventory restored'
      ),
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'cogs'), '5100'),
        'debit', 0, 'credit', v_cogs_total, 'description', 'COGS reversal'
      )
    );
  END IF;

  IF jsonb_array_length(v_journal_lines) > 0 THEN
    PERFORM post_journal_entry(
      p_store_id,
      'Refund ' || v_sale.invoice_number,
      v_refund_sale_id,
      'sale_refund',
      p_user_id,
      v_journal_lines
    );
  END IF;

  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'refund_invoice', v_refund_invoice,
    'refund_sale_id', v_refund_sale_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
