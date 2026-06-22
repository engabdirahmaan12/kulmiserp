-- POS cost protection, purchase invoice numbering, transactions list, store owner access

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS purchase_prefix TEXT NOT NULL DEFAULT 'PUR',
  ADD COLUMN IF NOT EXISTS purchase_counter INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales(store_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_received ON purchase_orders(store_id, received_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_expenses_store_date ON expenses(store_id, expense_date DESC);

-- Store owners (stores.owner_id) count as members for RPC auth
CREATE OR REPLACE FUNCTION verify_store_access(
  p_store_id UUID,
  p_user_id UUID,
  p_min_roles TEXT[] DEFAULT ARRAY['owner','manager','cashier','accountant','purchase_officer']
) RETURNS BOOLEAN AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND owner_id = p_user_id) THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM store_users
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND is_active = true
      AND role = ANY(p_min_roles)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION next_purchase_invoice_number(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_counter INTEGER;
  v_number TEXT;
BEGIN
  SELECT purchase_prefix, purchase_counter
  INTO v_prefix, v_counter
  FROM stores
  WHERE id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  v_number := COALESCE(v_prefix, 'PUR') || '-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(v_counter::TEXT, 5, '0');
  UPDATE stores SET purchase_counter = v_counter + 1, updated_at = NOW() WHERE id = p_store_id;
  RETURN v_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  v_caller_id UUID := auth.uid();
  v_allow_below BOOLEAN;
  v_item JSONB;
  v_cost DECIMAL;
  v_qty DECIMAL;
  v_unit DECIMAL;
  v_disc DECIMAL;
  v_effective DECIMAL;
  v_product_name TEXT;
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
      FROM products
      WHERE id = (v_item->>'product_id')::UUID AND store_id = p_store_id;

      v_qty := GREATEST(COALESCE((v_item->>'quantity')::DECIMAL, 0), 0);
      v_unit := COALESCE((v_item->>'unit_price')::DECIMAL, 0);
      v_disc := COALESCE((v_item->>'discount_amount')::DECIMAL, 0);

      IF v_qty > 0 THEN
        v_effective := (v_unit * v_qty - v_disc) / v_qty;
        IF v_effective < COALESCE(v_cost, 0) THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Sale price cannot be lower than product cost.'
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN _complete_pos_sale_impl(
    p_store_id, p_cashier_id, p_customer_id, p_items,
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount, p_change_amount, p_credit_amount,
    p_payment_method, p_payment_details, p_notes, p_due_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
BEGIN
  IF auth.uid() IS NULL OR NOT verify_store_access(p_store_id, auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  v_offset := GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);

  WITH unified AS (
    SELECT
      s.id,
      'sale'::TEXT AS tx_type,
      s.invoice_number AS reference,
      COALESCE(c.full_name, 'Walk-in') AS party_name,
      s.total_amount AS amount,
      s.payment_method::TEXT,
      s.status::TEXT,
      s.sale_date AS tx_date,
      s.created_at,
      s.cashier_id AS user_id
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.store_id = p_store_id
      AND s.status IN ('completed', 'refunded', 'void')

    UNION ALL

    SELECT
      po.id,
      'purchase'::TEXT,
      po.po_number,
      COALESCE(sup.name, 'Supplier'),
      po.total_amount,
      NULL,
      po.status::TEXT,
      COALESCE(po.received_date::TIMESTAMPTZ, po.created_at),
      po.created_at,
      po.created_by
    FROM purchase_orders po
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    WHERE po.store_id = p_store_id
      AND po.status IN ('received', 'partial')

    UNION ALL

    SELECT
      e.id,
      'expense'::TEXT,
      COALESCE(e.reference, 'EXP-' || LEFT(e.id::TEXT, 8)),
      COALESCE(e.category, e.description, 'Expense'),
      e.amount,
      e.payment_method::TEXT,
      COALESCE(e.status, 'approved')::TEXT,
      e.expense_date::TIMESTAMPTZ,
      e.created_at,
      e.created_by
    FROM expenses e
    WHERE e.store_id = p_store_id
      AND COALESCE(e.status, 'approved') <> 'void'
  ),
  filtered AS (
    SELECT * FROM unified u
    WHERE (p_type IS NULL OR p_type = '' OR u.tx_type = p_type)
      AND (p_date_from IS NULL OR u.tx_date::DATE >= p_date_from)
      AND (p_date_to IS NULL OR u.tx_date::DATE <= p_date_to)
      AND (
        p_search IS NULL OR p_search = ''
        OR u.reference ILIKE '%' || p_search || '%'
        OR u.party_name ILIKE '%' || p_search || '%'
      )
  )
  SELECT COUNT(*)::BIGINT INTO v_total FROM filtered;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.tx_date DESC), '[]'::JSONB)
  INTO v_items
  FROM (
    SELECT id, tx_type, reference, party_name, amount, payment_method, status, tx_date, created_at, user_id
    FROM filtered
    ORDER BY tx_date DESC
    LIMIT GREATEST(p_page_size, 1) OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_items,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION next_purchase_invoice_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION list_store_transactions(UUID, INTEGER, INTEGER, TEXT, TEXT, DATE, DATE) TO authenticated;
