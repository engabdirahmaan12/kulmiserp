-- Fix list_store_transactions: CTEs only exist for one statement in PL/pgSQL

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

  SELECT COALESCE(timezone, 'Africa/Mogadishu')
  INTO v_tz
  FROM stores
  WHERE id = p_store_id;

  IF v_tz IS NULL THEN
    v_tz := 'Africa/Mogadishu';
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
      COALESCE(po.po_number, 'PO-' || LEFT(po.id::TEXT, 8)),
      COALESCE(sup.name, 'Supplier'),
      po.total_amount,
      NULL::TEXT,
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
      (e.expense_date::TIMESTAMPTZ),
      e.created_at,
      e.created_by
    FROM expenses e
    WHERE e.store_id = p_store_id
      AND COALESCE(e.status, 'approved') <> 'void'
  ),
  filtered AS (
    SELECT * FROM unified u
    WHERE (p_type IS NULL OR p_type = '' OR u.tx_type = p_type)
      AND (
        p_date_from IS NULL
        OR (u.tx_date AT TIME ZONE v_tz)::date >= p_date_from
      )
      AND (
        p_date_to IS NULL
        OR (u.tx_date AT TIME ZONE v_tz)::date <= p_date_to
      )
      AND (
        p_search IS NULL OR p_search = ''
        OR u.reference ILIKE '%' || p_search || '%'
        OR u.party_name ILIKE '%' || p_search || '%'
      )
  ),
  paged AS (
    SELECT id, tx_type, reference, party_name, amount, payment_method, status, tx_date, created_at, user_id
    FROM filtered
    ORDER BY tx_date DESC
    LIMIT GREATEST(p_page_size, 1) OFFSET v_offset
  )
  SELECT
    (SELECT COUNT(*)::BIGINT FROM filtered),
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tx_date DESC) FROM paged p),
      '[]'::JSONB
    )
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_items,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION list_store_transactions(UUID, INTEGER, INTEGER, TEXT, TEXT, DATE, DATE) TO authenticated;
