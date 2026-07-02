-- 053_multi_unit_pricing_system.sql
-- Multi Unit Pricing System — Batch A (core engine)
--
-- Replaces the store-level "Business Mode" selector with per-product,
-- per-customer pricing: a 4th VIP price tier, quantity/bulk-break pricing,
-- and an audited POS price override. Purely additive — no destructive DDL,
-- no existing column/constraint values touched, no RPC signature changes
-- (only CREATE OR REPLACE with new optional fields). `business_mode` and
-- `update_store_business_mode` are left untouched and unused.

-- ============================================================
-- 1. VIP as a 4th price tier — additive CHECK widen, no data touched
-- ============================================================
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_price_tier_check;
ALTER TABLE customers ADD CONSTRAINT customers_price_tier_check
  CHECK (price_tier IS NULL OR price_tier IN ('retail', 'wholesale', 'distributor', 'vip'));

ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_price_tier_check;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_price_tier_check
  CHECK (price_tier IS NULL OR price_tier IN ('retail', 'wholesale', 'distributor', 'vip'));

-- ============================================================
-- 2. VIP price columns
-- ============================================================
ALTER TABLE products      ADD COLUMN IF NOT EXISTS vip_price DECIMAL(15,2);
ALTER TABLE product_units ADD COLUMN IF NOT EXISTS vip_price DECIMAL(15,2);

-- ============================================================
-- 3. POS price-override audit trail on sale_items
-- ============================================================
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS original_unit_price  DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS price_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS price_overridden_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Quantity / bulk-break pricing
-- ============================================================
CREATE TABLE IF NOT EXISTS product_quantity_prices (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID          NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
  product_id    UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- NULL unit_type_id = applies to any unit of this product. Usually set
  -- per unit, since a break like "50+ KG" is stated in a specific unit.
  unit_type_id  UUID          REFERENCES unit_types(id) ON DELETE CASCADE,
  price_tier    TEXT          NOT NULL DEFAULT 'retail'
                CHECK (price_tier IN ('retail', 'wholesale', 'distributor', 'vip')),
  min_qty       DECIMAL(15,3) NOT NULL CHECK (min_qty > 0),
  max_qty       DECIMAL(15,3),  -- NULL = "and above"
  price         DECIMAL(15,2)  NOT NULL CHECK (price >= 0),
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (max_qty IS NULL OR max_qty >= min_qty)
);

CREATE INDEX IF NOT EXISTS idx_pqp_product ON product_quantity_prices(product_id, unit_type_id, price_tier);
CREATE INDEX IF NOT EXISTS idx_pqp_store   ON product_quantity_prices(store_id);

ALTER TABLE product_quantity_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store members can access product_quantity_prices" ON product_quantity_prices;
CREATE POLICY "Store members can access product_quantity_prices" ON product_quantity_prices
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_quantity_prices.product_id
        AND user_has_store_access(auth.uid(), p.store_id)
    )
  );

-- ============================================================
-- 5. resolve_product_unit_price — add VIP branch (same shape as
--    wholesale/distributor), signature unchanged
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_product_unit_price(
  p_product_id UUID,
  p_unit_id UUID,
  p_tier TEXT DEFAULT 'retail'
) RETURNS DECIMAL AS $$
DECLARE
  v_product RECORD;
  v_unit RECORD;
  v_price DECIMAL;
BEGIN
  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF p_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM product_units pu
    WHERE pu.product_id = p_product_id AND pu.unit_type_id = p_unit_id;

    IF FOUND THEN
      v_price := CASE COALESCE(p_tier, 'retail')
        WHEN 'wholesale'   THEN COALESCE(v_unit.wholesale_price, v_unit.retail_price, v_product.wholesale_price)
        WHEN 'distributor' THEN COALESCE(v_unit.distributor_price, v_unit.wholesale_price, v_product.distributor_price)
        WHEN 'vip'         THEN COALESCE(v_unit.vip_price, v_unit.retail_price, v_product.vip_price, v_product.selling_price)
        ELSE COALESCE(v_unit.retail_price, v_product.selling_price)
      END;
      IF v_price IS NOT NULL AND v_price > 0 THEN
        RETURN v_price;
      END IF;
    END IF;
  END IF;

  RETURN CASE COALESCE(p_tier, 'retail')
    WHEN 'wholesale'   THEN COALESCE(v_product.wholesale_price, v_product.selling_price, 0)
    WHEN 'distributor' THEN COALESCE(v_product.distributor_price, v_product.wholesale_price, v_product.selling_price, 0)
    WHEN 'vip'         THEN COALESCE(v_product.vip_price, v_product.selling_price, 0)
    ELSE COALESCE(v_product.selling_price, 0)
  END;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 6. resolve_quantity_price — new, thin server-side sibling for parity /
--    future validation. Not on the sale-completion critical path (client
--    computes final unit_price, same trust model tier-pricing already uses).
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_quantity_price(
  p_product_id  UUID,
  p_unit_id     UUID,
  p_tier        TEXT DEFAULT 'retail',
  p_qty         DECIMAL DEFAULT 0
) RETURNS DECIMAL AS $$
DECLARE
  v_price DECIMAL;
BEGIN
  SELECT price INTO v_price
  FROM product_quantity_prices
  WHERE product_id = p_product_id
    AND (unit_type_id = p_unit_id OR unit_type_id IS NULL)
    AND price_tier = COALESCE(p_tier, 'retail')
    AND is_active = true
    AND min_qty <= p_qty
    AND (max_qty IS NULL OR p_qty <= max_qty)
  ORDER BY (unit_type_id IS NULL), min_qty DESC
  LIMIT 1;

  RETURN v_price; -- NULL if no breakpoint matches
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 7. get_product_sale_units — add vip_price + quantity_prices to the
--    JSON response, signature unchanged
-- ============================================================
CREATE OR REPLACE FUNCTION get_product_sale_units(p_product_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_product RECORD;
  v_units JSONB;
BEGIN
  SELECT p.*, ut.code AS base_code, ut.name AS base_name, ut.allows_decimal AS base_allows_decimal
  INTO v_product
  FROM products p
  LEFT JOIN unit_types ut ON ut.id = p.base_unit_id
  WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pu.id,
      'unit_type_id', ut.id,
      'code', ut.code,
      'name', ut.name,
      'allows_decimal', ut.allows_decimal,
      'conversion_factor', pu.conversion_factor,
      'is_purchase_unit', pu.is_purchase_unit,
      'is_default_sale', pu.is_default_sale,
      'retail_price', COALESCE(pu.retail_price, v_product.selling_price),
      'wholesale_price', COALESCE(pu.wholesale_price, v_product.wholesale_price),
      'distributor_price', COALESCE(pu.distributor_price, v_product.distributor_price),
      'vip_price', COALESCE(pu.vip_price, v_product.vip_price),
      'quantity_prices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', qp.id,
          'price_tier', qp.price_tier,
          'min_qty', qp.min_qty,
          'max_qty', qp.max_qty,
          'price', qp.price
        ) ORDER BY qp.price_tier, qp.min_qty)
        FROM product_quantity_prices qp
        WHERE qp.product_id = p_product_id
          AND qp.unit_type_id = ut.id
          AND qp.is_active = true
      ), '[]'::jsonb)
    ) ORDER BY pu.is_default_sale DESC, ut.sort_order
  ), '[]'::JSONB)
  INTO v_units
  FROM product_units pu
  JOIN unit_types ut ON ut.id = pu.unit_type_id
  WHERE pu.product_id = p_product_id
    AND (pu.is_purchase_unit = false OR pu.is_default_sale = true);

  -- If no sale units configured, synthesize base unit option
  IF v_units = '[]'::JSONB AND v_product.base_unit_id IS NOT NULL THEN
    v_units := jsonb_build_array(jsonb_build_object(
      'id', NULL,
      'unit_type_id', v_product.base_unit_id,
      'code', v_product.base_code,
      'name', v_product.base_name,
      'allows_decimal', COALESCE(v_product.base_allows_decimal, false),
      'conversion_factor', 1,
      'is_purchase_unit', false,
      'is_default_sale', true,
      'retail_price', v_product.selling_price,
      'wholesale_price', v_product.wholesale_price,
      'distributor_price', v_product.distributor_price,
      'vip_price', v_product.vip_price,
      'quantity_prices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', qp.id,
          'price_tier', qp.price_tier,
          'min_qty', qp.min_qty,
          'max_qty', qp.max_qty,
          'price', qp.price
        ) ORDER BY qp.price_tier, qp.min_qty)
        FROM product_quantity_prices qp
        WHERE qp.product_id = p_product_id
          AND qp.unit_type_id = v_product.base_unit_id
          AND qp.is_active = true
      ), '[]'::jsonb)
    ));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'base_unit_id', v_product.base_unit_id,
    'base_code', v_product.base_code,
    'cost_price', v_product.cost_price,
    'stock_quantity', v_product.stock_quantity,
    'units', v_units
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 8. _complete_pos_sale_impl — extend sale_items field spec + INSERT with
--    the 3 audit columns. Signature unchanged; new fields are optional
--    (missing keys in the JSON simply resolve to NULL, so old client
--    payloads without these fields keep working exactly as before).
-- ============================================================
CREATE OR REPLACE FUNCTION _complete_pos_sale_impl(
  p_store_id       UUID,
  p_cashier_id     UUID,
  p_customer_id    UUID,
  p_items          JSONB,
  p_subtotal       DECIMAL,
  p_discount_amount DECIMAL,
  p_discount_type  TEXT,
  p_tax_amount     DECIMAL,
  p_total_amount   DECIMAL,
  p_paid_amount    DECIMAL,
  p_change_amount  DECIMAL,
  p_credit_amount  DECIMAL,
  p_payment_method TEXT,
  p_payment_details JSONB,
  p_notes          TEXT,
  p_due_date       DATE    DEFAULT NULL,
  p_deposit_amount DECIMAL DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_sale_id            UUID;
  v_invoice_number     TEXT;
  v_counter            INTEGER;
  v_prefix             TEXT;
  v_item               RECORD;
  v_product            RECORD;
  v_customer           RECORD;
  v_journal_lines      JSONB := '[]'::JSONB;
  v_payment_code       TEXT;
  v_cogs_total         DECIMAL(15,2) := 0;
  v_revenue            DECIMAL(15,2);
  v_cost_method        TEXT;
  v_resolved_due       DATE;
  v_line_cogs          DECIMAL(15,2);
  v_unit_cost          DECIMAL(15,2);
  v_base_qty           DECIMAL(15,3);
  v_sale_unit_qty      DECIMAL(15,3);
  v_conv               DECIMAL;
  v_stock_check        JSONB;
  v_split              RECORD;
  v_split_code         TEXT;
  v_deposit_liability  TEXT;
  v_effective_deposit  DECIMAL(15,2);
BEGIN
  SELECT inventory_cost_method INTO v_cost_method FROM stores WHERE id = p_store_id;
  v_cost_method := COALESCE(v_cost_method, 'average');
  v_revenue := p_total_amount - COALESCE(p_tax_amount, 0);
  v_effective_deposit := GREATEST(COALESCE(p_deposit_amount, 0), 0);

  v_resolved_due := COALESCE(
    p_due_date,
    NULLIF(p_payment_details->0->>'due_date', '')::DATE,
    CASE WHEN p_credit_amount > 0 THEN CURRENT_DATE + 30 ELSE NULL END
  );

  -- Stock pre-check
  v_stock_check := assert_pos_sale_stock(p_store_id, p_items);
  IF NOT COALESCE((v_stock_check->>'success')::BOOLEAN, false) THEN
    RETURN v_stock_check;
  END IF;

  -- Fetch and lock customer when credit or deposit is involved
  IF (COALESCE(p_credit_amount, 0) > 0 OR v_effective_deposit > 0) AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Customer not found'); END IF;

    IF p_credit_amount > 0 AND v_customer.credit_limit > 0
       AND (v_customer.balance + p_credit_amount) > v_customer.credit_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Credit limit exceeded');
    END IF;

    IF v_effective_deposit > 0 AND COALESCE(v_customer.deposit_balance, 0) < v_effective_deposit THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient deposit balance');
    END IF;
  END IF;

  -- Invoice number
  SELECT invoice_counter, invoice_prefix INTO v_counter, v_prefix FROM stores WHERE id = p_store_id FOR UPDATE;
  v_invoice_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 5, '0');

  -- Create sale record
  INSERT INTO sales (
    store_id, invoice_number, customer_id, cashier_id, status,
    subtotal, discount_amount, discount_type, tax_amount, total_amount,
    paid_amount, change_amount, credit_amount, payment_method, payment_details, notes, sale_date, due_date
  ) VALUES (
    p_store_id, v_invoice_number, p_customer_id, p_cashier_id, 'completed',
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount + v_effective_deposit,   -- total cash received (regular + deposit)
    p_change_amount, p_credit_amount,
    p_payment_method, p_payment_details, p_notes, NOW(), v_resolved_due
  ) RETURNING id INTO v_sale_id;

  -- Create sale items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, product_name TEXT, product_sku TEXT,
    quantity DECIMAL, unit_price DECIMAL, cost_price DECIMAL,
    discount_amount DECIMAL, tax_amount DECIMAL, subtotal DECIMAL,
    base_qty DECIMAL, sale_unit_id UUID, sale_unit_code TEXT,
    sale_unit_qty DECIMAL, price_tier TEXT,
    original_unit_price DECIMAL, price_override_reason TEXT, price_overridden_by UUID
  )
  LOOP
    v_line_cogs := 0;
    v_unit_cost := 0;

    v_conv         := product_unit_conversion(v_item.product_id, v_item.sale_unit_id);
    v_sale_unit_qty := COALESCE(v_item.sale_unit_qty, v_item.quantity, 0);
    v_base_qty     := COALESCE(v_item.base_qty, ROUND(v_sale_unit_qty * v_conv, 3));

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
      sale_unit_id, sale_unit_code, sale_unit_qty, base_qty, price_tier,
      original_unit_price, price_override_reason, price_overridden_by
    ) VALUES (
      p_store_id, v_sale_id, v_item.product_id, v_item.product_name, v_item.product_sku,
      v_base_qty, v_item.unit_price, v_unit_cost, v_item.discount_amount, v_item.tax_amount, v_item.subtotal,
      v_item.sale_unit_id, v_item.sale_unit_code, v_sale_unit_qty, v_base_qty,
      COALESCE(v_item.price_tier, 'retail'),
      v_item.original_unit_price, v_item.price_override_reason, v_item.price_overridden_by
    );
  END LOOP;

  -- Update stock
  PERFORM process_sale_stock(p_store_id, v_sale_id, (
    SELECT jsonb_agg(jsonb_build_object(
      'product_id', x.product_id,
      'quantity', COALESCE(x.base_qty, x.quantity)
    ))
    FROM jsonb_to_recordset(p_items) AS x(
      product_id UUID, quantity DECIMAL, base_qty DECIMAL,
      sale_unit_id UUID, sale_unit_qty DECIMAL
    )
  ), p_cashier_id);

  -- Update customer balances
  IF p_customer_id IS NOT NULL THEN
    IF v_effective_deposit > 0 THEN
      UPDATE customers SET
        deposit_balance  = deposit_balance  - v_effective_deposit,
        balance          = balance          + COALESCE(p_credit_amount, 0),
        total_purchases  = total_purchases  + p_total_amount,
        updated_at       = NOW()
      WHERE id = p_customer_id;

      -- Record deposit usage
      INSERT INTO customer_deposits (store_id, customer_id, amount, type, sale_id, notes, created_by)
      VALUES (p_store_id, p_customer_id, -v_effective_deposit, 'used', v_sale_id,
              'Applied to sale ' || v_invoice_number, p_cashier_id);
    ELSE
      UPDATE customers SET
        balance         = balance         + COALESCE(p_credit_amount, 0),
        total_purchases = total_purchases + p_total_amount,
        updated_at      = NOW()
      WHERE id = p_customer_id;
    END IF;
  END IF;

  -- ── Journal entries ──────────────────────────────────────────
  -- Revenue credit
  IF v_revenue > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'sales_revenue'), 'debit', 0, 'credit', v_revenue, 'description', 'Sales revenue')
    );
  END IF;

  -- Tax payable credit
  IF COALESCE(p_tax_amount, 0) > 0 AND coa_code(p_store_id, 'tax_payable') IS NOT NULL THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'tax_payable'), 'debit', 0, 'credit', p_tax_amount, 'description', 'Tax payable')
    );
  END IF;

  -- Payment debit(s)
  IF p_payment_method = 'split' THEN
    -- Post each non-deposit payment line individually
    FOR v_split IN
      SELECT
        COALESCE(x.method, 'cash') AS method,
        COALESCE(x.amount, 0)      AS amt
      FROM jsonb_to_recordset(COALESCE(p_payment_details, '[]'::JSONB)) AS x(method TEXT, amount DECIMAL)
    LOOP
      IF v_split.method <> 'customer_deposit' AND v_split.amt > 0 THEN
        v_split_code := payment_method_account_code(p_store_id, v_split.method);
        v_journal_lines := v_journal_lines || jsonb_build_array(
          jsonb_build_object('account_code', v_split_code, 'debit', v_split.amt, 'credit', 0,
                             'description', 'Split payment: ' || v_split.method)
        );
      END IF;
    END LOOP;
  ELSIF COALESCE(p_paid_amount, 0) > 0 THEN
    v_payment_code := payment_method_account_code(p_store_id, p_payment_method);
    IF p_payment_method = 'credit' THEN
      v_payment_code := COALESCE(coa_code(p_store_id, 'cash'), v_payment_code);
    END IF;
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_payment_code, 'debit', p_paid_amount, 'credit', 0, 'description', 'Payment received')
    );
  END IF;

  -- Deposit applied: debit Deposit Liability
  IF v_effective_deposit > 0 THEN
    v_deposit_liability := COALESCE(
      (SELECT code FROM chart_of_accounts
       WHERE store_id = p_store_id AND system_role = 'customer_deposit_liability' AND is_active = true
       LIMIT 1),
      '2300'
    );
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_deposit_liability, 'debit', v_effective_deposit, 'credit', 0,
                         'description', 'Customer deposit applied')
    );
  END IF;

  -- Accounts Receivable for credit portion
  IF COALESCE(p_credit_amount, 0) > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'accounts_receivable'), 'debit', p_credit_amount, 'credit', 0, 'description', 'Accounts receivable')
    );
  END IF;

  -- COGS
  IF v_cogs_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(
      jsonb_build_object('account_code', coa_code(p_store_id, 'cogs'),      'debit', v_cogs_total, 'credit', 0,           'description', 'COGS'),
      jsonb_build_object('account_code', coa_code(p_store_id, 'inventory'), 'debit', 0,           'credit', v_cogs_total, 'description', 'Inventory reduction')
    );
  END IF;

  PERFORM post_journal_entry(p_store_id, 'Sale ' || v_invoice_number, v_sale_id, 'sale', p_cashier_id, v_journal_lines);
  UPDATE stores SET invoice_counter = v_counter + 1 WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'invoice_number', v_invoice_number,
    'total', p_total_amount,
    'cogs', v_cogs_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
