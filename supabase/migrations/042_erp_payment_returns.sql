-- ERP payment sync, sale/purchase returns, expanded transaction feed

-- Allow partial refund status on sales
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE sales ADD CONSTRAINT sales_status_check
  CHECK (status IN ('draft', 'completed', 'void', 'refunded', 'partially_refunded', 'held'));

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS returned_base_qty DECIMAL(15,3) NOT NULL DEFAULT 0;

-- Purchase returns ledger
CREATE TABLE IF NOT EXISTS purchase_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  return_number TEXT NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, return_number)
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  purchase_unit_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  base_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(15,4) NOT NULL DEFAULT 0,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_store ON purchase_returns(store_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_po ON purchase_returns(purchase_order_id);

-- Sync invoice paid/credit when collecting customer debt against a sale
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
  v_sale RECORD;
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

  v_payment_code := payment_method_account_code(p_store_id, p_payment_method);

  UPDATE customers SET
    balance = GREATEST(0, balance - p_amount),
    updated_at = NOW()
  WHERE id = p_customer_id;

  INSERT INTO debt_payments (
    store_id, customer_id, amount, payment_method, notes, sale_id, payment_date, created_by
  ) VALUES (
    p_store_id, p_customer_id, p_amount, p_payment_method, p_notes, p_sale_id, NOW(), p_user_id
  ) RETURNING id INTO v_payment_id;

  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND store_id = p_store_id FOR UPDATE;
    IF FOUND THEN
      UPDATE sales SET
        paid_amount = paid_amount + LEAST(p_amount, GREATEST(credit_amount, 0)),
        credit_amount = GREATEST(0, credit_amount - p_amount),
        updated_at = NOW()
      WHERE id = p_sale_id;
    END IF;
  END IF;

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
    jsonb_build_object('account_code', COALESCE(coa_code(p_store_id, 'accounts_receivable'), '1200'), 'debit', 0, 'credit', p_amount, 'description', 'Accounts receivable reduction')
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

-- Sync PO paid amount when paying supplier against a PO
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
  v_po RECORD;
  v_apply_to_po DECIMAL(15,2);
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

  v_payment_code := payment_method_account_code(p_store_id, p_payment_method);

  UPDATE suppliers SET
    balance = GREATEST(0, balance - p_amount),
    updated_at = NOW()
  WHERE id = p_supplier_id;

  INSERT INTO supplier_payments (
    store_id, supplier_id, amount, payment_method, notes, purchase_order_id, payment_date, created_by
  ) VALUES (
    p_store_id, p_supplier_id, p_amount, p_payment_method, p_notes, p_purchase_order_id, NOW(), p_user_id
  ) RETURNING id INTO v_payment_id;

  IF p_purchase_order_id IS NOT NULL THEN
    SELECT * INTO v_po FROM purchase_orders WHERE id = p_purchase_order_id AND store_id = p_store_id FOR UPDATE;
    IF FOUND THEN
      v_apply_to_po := LEAST(p_amount, GREATEST(v_po.total_amount - v_po.paid_amount, 0));
      IF v_apply_to_po > 0 THEN
        UPDATE purchase_orders SET
          paid_amount = paid_amount + v_apply_to_po,
          updated_at = NOW()
        WHERE id = p_purchase_order_id;
      END IF;
    END IF;
  END IF;

  IF p_debt_record_id IS NOT NULL THEN
    SELECT * INTO v_debt FROM debt_records
    WHERE id = p_debt_record_id AND store_id = p_store_id AND supplier_id = p_supplier_id FOR UPDATE;
    IF FOUND AND v_debt.remaining_balance > 0 THEN
      UPDATE debt_records SET
        paid_amount = paid_amount + LEAST(p_amount, v_debt.remaining_balance),
        remaining_balance = remaining_balance - LEAST(p_amount, v_debt.remaining_balance),
        updated_at = NOW()
      WHERE id = p_debt_record_id;
      PERFORM refresh_debt_record_status(p_debt_record_id);
    END IF;
  ELSE
    PERFORM apply_debt_payment_allocation(
      p_store_id, 'supplier', p_supplier_id, p_amount, v_payment_id, 'supplier_payments', p_user_id
    );
  END IF;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', COALESCE(coa_code(p_store_id, 'accounts_payable'), '2100'), 'debit', p_amount, 'credit', 0, 'description', 'Accounts payable reduction'),
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

-- Sale return / refund with item-level qty and refund method
CREATE OR REPLACE FUNCTION process_sale_refund(
  p_store_id UUID,
  p_sale_id UUID,
  p_user_id UUID,
  p_refund_items JSONB,
  p_refund_amount DECIMAL,
  p_reason TEXT DEFAULT NULL,
  p_refund_method TEXT DEFAULT 'cash'
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
  v_payment_code TEXT;
  v_full_refund BOOLEAN;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.status = 'refunded' THEN RETURN jsonb_build_object('success', false, 'error', 'Already fully refunded'); END IF;
  IF v_sale.status NOT IN ('completed', 'partially_refunded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sale cannot be refunded');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_refund_items) AS x(
    sale_item_id UUID, product_id UUID, quantity DECIMAL, base_qty DECIMAL,
    cost_price DECIMAL, subtotal DECIMAL
  )
  LOOP
    v_restore_qty := COALESCE(v_item.base_qty, v_item.quantity, 0);
    IF v_restore_qty <= 0 THEN CONTINUE; END IF;

    IF v_item.sale_item_id IS NOT NULL THEN
      UPDATE sale_items SET
        returned_base_qty = returned_base_qty + v_restore_qty
      WHERE id = v_item.sale_item_id AND sale_id = p_sale_id;
    END IF;

    IF v_item.product_id IS NOT NULL THEN
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
    -p_refund_amount, 0, COALESCE(p_refund_method, 'cash'),
    'Return for ' || v_sale.invoice_number || ': ' || COALESCE(p_reason, ''),
    NOW()
  ) RETURNING id INTO v_refund_sale_id;

  v_full_refund := p_refund_amount >= v_sale.total_amount - 0.01;
  UPDATE sales SET
    status = CASE WHEN v_full_refund THEN 'refunded' ELSE 'partially_refunded' END,
    updated_at = NOW()
  WHERE id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL THEN
    IF p_refund_method = 'store_credit' THEN
      UPDATE customers SET balance = balance - p_refund_amount, updated_at = NOW()
      WHERE id = v_sale.customer_id;
    ELSIF v_sale.credit_amount > 0 THEN
      UPDATE customers SET
        balance = GREATEST(0, balance - LEAST(v_sale.credit_amount, p_refund_amount)),
        updated_at = NOW()
      WHERE id = v_sale.customer_id;
    END IF;
  END IF;

  IF v_sale.total_amount > 0 AND COALESCE(v_sale.tax_amount, 0) > 0 THEN
    v_tax_refund := ROUND((p_refund_amount / v_sale.total_amount) * v_sale.tax_amount, 2);
  END IF;
  v_revenue_refund := p_refund_amount - v_tax_refund;

  IF v_revenue_refund > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'sales_revenue'), '4100'),
        'debit', v_revenue_refund, 'credit', 0, 'description', 'Sales return'
      )
    );
  END IF;

  IF v_tax_refund > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'tax_payable'), '2200'),
        'debit', v_tax_refund, 'credit', 0, 'description', 'Tax reversal'
      )
    );
  END IF;

  IF p_refund_amount > 0 AND p_refund_method <> 'store_credit' THEN
    v_payment_code := payment_method_account_code(p_store_id, COALESCE(p_refund_method, 'cash'));
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', v_payment_code, 'debit', 0, 'credit', p_refund_amount, 'description', 'Refund paid'
      )
    );
  ELSIF p_refund_amount > 0 AND p_refund_method = 'store_credit' THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'accounts_receivable'), '1200'),
        'debit', 0, 'credit', p_refund_amount, 'description', 'Store credit issued'
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
      p_store_id, 'Return ' || v_sale.invoice_number, v_refund_sale_id, 'sale_refund', p_user_id, v_journal_lines
    );
  END IF;

  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'refund_invoice', v_refund_invoice,
    'refund_sale_id', v_refund_sale_id,
    'full_refund', v_full_refund
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Purchase return: reduce stock, reverse payable, post GL
CREATE OR REPLACE FUNCTION process_purchase_return(
  p_store_id UUID,
  p_po_id UUID,
  p_user_id UUID,
  p_return_items JSONB,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_product RECORD;
  v_before DECIMAL;
  v_after DECIMAL;
  v_return_total DECIMAL(15,2) := 0;
  v_return_id UUID;
  v_return_number TEXT;
  v_counter INTEGER;
  v_prefix TEXT;
  v_journal_lines JSONB := '[]'::JSONB;
  v_base_qty DECIMAL(15,3);
  v_subtotal DECIMAL(15,2);
  v_ap_reduce DECIMAL(15,2);
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PO not found'); END IF;
  IF v_po.status NOT IN ('received', 'partial') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only received purchases can be returned');
  END IF;

  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_return_number := COALESCE(v_prefix, 'PO') || '-RET-' || LPAD(v_counter::TEXT, 5, '0');

  INSERT INTO purchase_returns (
    store_id, purchase_order_id, return_number, supplier_id, total_amount, notes, created_by
  ) VALUES (
    p_store_id, p_po_id, v_return_number, v_po.supplier_id, 0, p_reason, p_user_id
  ) RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_return_items) AS x(
    product_id UUID, product_name TEXT, purchase_unit_qty DECIMAL, base_qty DECIMAL,
    unit_cost DECIMAL, subtotal DECIMAL
  )
  LOOP
    v_base_qty := COALESCE(v_item.base_qty, 0);
    v_subtotal := COALESCE(v_item.subtotal, v_item.unit_cost * COALESCE(v_item.purchase_unit_qty, v_base_qty));
    IF v_base_qty <= 0 THEN CONTINUE; END IF;

    v_return_total := v_return_total + v_subtotal;

    INSERT INTO purchase_return_items (
      purchase_return_id, product_id, product_name, purchase_unit_qty, base_qty, unit_cost, subtotal
    ) VALUES (
      v_return_id, v_item.product_id, COALESCE(v_item.product_name, 'Product'),
      COALESCE(v_item.purchase_unit_qty, v_base_qty), v_base_qty, COALESCE(v_item.unit_cost, 0), v_subtotal
    );

    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id AND store_id = p_store_id FOR UPDATE;
      IF FOUND AND v_product.track_inventory THEN
        v_before := v_product.stock_quantity;
        v_after := GREATEST(0, v_before - v_base_qty);
        UPDATE products SET stock_quantity = v_after, updated_at = NOW() WHERE id = v_item.product_id;
        INSERT INTO stock_movements (
          store_id, product_id, movement_type, quantity_change,
          quantity_before, quantity_after, reference_id, reference_type, reason, created_by
        ) VALUES (
          p_store_id, v_item.product_id, 'adjustment', -v_base_qty,
          v_before, v_after, v_return_id, 'purchase_return', p_reason, p_user_id
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE purchase_returns SET total_amount = v_return_total WHERE id = v_return_id;

  v_ap_reduce := LEAST(v_return_total, GREATEST(v_po.total_amount - v_po.paid_amount, 0));
  IF v_po.supplier_id IS NOT NULL AND v_ap_reduce > 0 THEN
    UPDATE suppliers SET balance = GREATEST(0, balance - v_ap_reduce), updated_at = NOW()
    WHERE id = v_po.supplier_id;
  END IF;

  IF v_return_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'accounts_payable'), '2100'),
        'debit', v_ap_reduce, 'credit', 0, 'description', 'Purchase return AP reduction'
      ),
      jsonb_build_object(
        'account_code', COALESCE(coa_code(p_store_id, 'inventory'), '1300'),
        'debit', 0, 'credit', v_return_total, 'description', 'Inventory returned to supplier'
      )
    );
    PERFORM post_journal_entry(
      p_store_id, 'Purchase return ' || v_po.po_number, v_return_id, 'purchase_return', p_user_id, v_journal_lines
    );
  END IF;

  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total_amount', v_return_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_purchase_return(UUID, UUID, UUID, JSONB, TEXT) TO authenticated;

-- Expanded unified transaction feed
CREATE OR REPLACE FUNCTION list_store_transactions(
  p_store_id UUID,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_type TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_offset INTEGER;
  v_total BIGINT;
  v_items JSONB;
  v_tz TEXT;
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
      COALESCE(e.status, 'approved')::TEXT, (e.expense_date::TIMESTAMPTZ), e.created_at, e.created_by
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
  ),
  filtered AS (
    SELECT * FROM unified u
    WHERE (p_type IS NULL OR p_type = '' OR u.tx_type = p_type)
      AND (p_date_from IS NULL OR (u.tx_date AT TIME ZONE v_tz)::date >= p_date_from)
      AND (p_date_to IS NULL OR (u.tx_date AT TIME ZONE v_tz)::date <= p_date_to)
      AND (p_search IS NULL OR p_search = '' OR u.reference ILIKE '%' || p_search || '%' OR u.party_name ILIKE '%' || p_search || '%')
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
