-- 050_public_invoice_verify.sql
-- Public, read-only invoice verification used by the QR code on printed
-- invoices. Anyone who scans the QR lands on /verify/<store>/<invoice>,
-- which calls this RPC. Returns only safe, customer-facing fields — no
-- costs, margins, cashier identity, or internal ids.

CREATE OR REPLACE FUNCTION get_public_invoice(
  p_store_id       UUID,
  p_invoice_number TEXT
) RETURNS JSONB AS $$
DECLARE
  v_sale    RECORD;
  v_store   RECORD;
  v_items   JSONB;
  v_balance DECIMAL;
BEGIN
  IF p_store_id IS NULL OR p_invoice_number IS NULL OR p_invoice_number = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid request');
  END IF;

  SELECT s.* INTO v_sale
  FROM sales s
  WHERE s.store_id = p_store_id
    AND s.invoice_number = p_invoice_number
    AND s.status IN ('completed', 'refunded')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  SELECT name, logo_url, phone, address, email, currency
  INTO v_store FROM stores WHERE id = p_store_id;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name',    si.product_name,
    'quantity',        si.quantity,
    'unit_price',      si.unit_price,
    'discount_amount', si.discount_amount,
    'subtotal',        si.subtotal
  ) ORDER BY si.created_at)
  INTO v_items
  FROM sale_items si
  WHERE si.sale_id = v_sale.id;

  v_balance := GREATEST(0, COALESCE(v_sale.credit_amount, 0));

  RETURN jsonb_build_object(
    'success', true,
    'store', jsonb_build_object(
      'name',     COALESCE(v_store.name, 'Store'),
      'logo_url', v_store.logo_url,
      'phone',    v_store.phone,
      'address',  v_store.address,
      'email',    v_store.email,
      'currency', COALESCE(v_store.currency, 'USD')
    ),
    'invoice', jsonb_build_object(
      'invoice_number', v_sale.invoice_number,
      'sale_date',      v_sale.sale_date,
      'status',         v_sale.status,
      'customer_name',  (SELECT full_name FROM customers WHERE id = v_sale.customer_id),
      'subtotal',       v_sale.subtotal,
      'discount_amount',v_sale.discount_amount,
      'tax_amount',     v_sale.tax_amount,
      'total_amount',   v_sale.total_amount,
      'paid_amount',    v_sale.paid_amount,
      'credit_amount',  v_sale.credit_amount,
      'balance_due',    v_balance,
      'payment_status', CASE WHEN v_balance > 0 THEN (CASE WHEN COALESCE(v_sale.paid_amount,0) > 0 THEN 'partial' ELSE 'unpaid' END) ELSE 'paid' END,
      'is_refunded',    (v_sale.status = 'refunded')
    ),
    'items', COALESCE(v_items, '[]'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Unable to load invoice');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Public: callable by anonymous (QR scanners) and authenticated users.
GRANT EXECUTE ON FUNCTION get_public_invoice(UUID, TEXT) TO anon, authenticated;
