-- Cash deposits & withdrawals with GL posting + transaction feed

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('deposit', 'withdrawal')),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  movement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_store ON cash_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(movement_date);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_movements_store_access" ON cash_movements
  FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

CREATE OR REPLACE FUNCTION record_cash_movement(
  p_store_id UUID,
  p_user_id UUID,
  p_movement_type TEXT,
  p_amount DECIMAL,
  p_payment_method TEXT DEFAULT 'cash',
  p_notes TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_movement_id UUID;
  v_asset_code TEXT;
  v_equity_code TEXT;
  v_journal_lines JSONB := '[]'::JSONB;
  v_label TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF p_movement_type NOT IN ('deposit', 'withdrawal') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid movement type');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  v_asset_code := payment_method_account_code(p_store_id, COALESCE(p_payment_method, 'cash'));
  v_equity_code := COALESCE(coa_code(p_store_id, 'owner_capital'), '3100');

  INSERT INTO cash_movements (
    store_id, movement_type, amount, payment_method, reference, notes, movement_date, created_by
  ) VALUES (
    p_store_id, p_movement_type, p_amount, COALESCE(p_payment_method, 'cash'),
    p_reference, p_notes, NOW(), p_user_id
  ) RETURNING id INTO v_movement_id;

  v_label := CASE p_movement_type WHEN 'deposit' THEN 'Cash deposit' ELSE 'Cash withdrawal' END;

  IF p_movement_type = 'deposit' THEN
    v_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_asset_code, 'debit', p_amount, 'credit', 0, 'description', v_label),
      jsonb_build_object('account_code', v_equity_code, 'debit', 0, 'credit', p_amount, 'description', 'Owner capital')
    );
  ELSE
    v_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_equity_code, 'debit', p_amount, 'credit', 0, 'description', 'Owner withdrawal'),
      jsonb_build_object('account_code', v_asset_code, 'debit', 0, 'credit', p_amount, 'description', v_label)
    );
  END IF;

  PERFORM post_journal_entry(
    p_store_id, v_label || COALESCE(' — ' || p_reference, ''), v_movement_id,
    CASE p_movement_type WHEN 'deposit' THEN 'deposit' ELSE 'withdrawal' END,
    p_user_id, v_journal_lines
  );

  RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_cash_movement(UUID, UUID, TEXT, DECIMAL, TEXT, TEXT, TEXT) TO authenticated;

-- Patch transaction feed (extends 042)
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
