-- ── Migration 015: Discounts Module Rebuild ─────────────────────────────────
-- Adds status column to get_store_active_discounts and adds product-level
-- discount columns (in case they don't exist from migration 013).

-- Ensure columns exist on products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS discount_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discount_end TIMESTAMPTZ;

-- ── Updated get_store_active_discounts with status field ──────────────────────
DROP FUNCTION IF EXISTS get_store_active_discounts(UUID);
CREATE OR REPLACE FUNCTION get_store_active_discounts(p_store_id UUID)
RETURNS TABLE (
  product_id      UUID,
  source          TEXT,
  discount_type   TEXT,
  discount_value  DECIMAL,
  promotion_id    UUID,
  promotion_name  TEXT,
  status          TEXT
) AS $$
DECLARE
  v_now  TIMESTAMPTZ := NOW();
  v_prod RECORD;
BEGIN
  FOR v_prod IN
    SELECT p.id, p.category_id,
           p.discount_type, p.discount_value, p.discount_start, p.discount_end
    FROM products p
    WHERE p.store_id = p_store_id AND p.is_active = true
  LOOP
    -- 1. Product-level discount (highest priority)
    IF v_prod.discount_value IS NOT NULL AND v_prod.discount_value > 0
       AND v_prod.discount_type IS NOT NULL
       AND (v_prod.discount_start IS NULL OR v_prod.discount_start <= v_now)
       AND (v_prod.discount_end   IS NULL OR v_prod.discount_end   >= v_now) THEN

      product_id    := v_prod.id;
      source        := 'product';
      discount_type  := v_prod.discount_type;
      discount_value := v_prod.discount_value;
      promotion_id  := NULL;
      promotion_name := NULL;
      status        := 'active';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 2. Best active promotion for this product (product > category > global)
    SELECT pr.id, pr.name, pr.discount_type, pr.discount_value
    INTO   promotion_id, promotion_name, discount_type, discount_value
    FROM   promotions pr
    WHERE  pr.store_id  = p_store_id
      AND  pr.is_active = true
      AND  (pr.start_date IS NULL OR pr.start_date <= v_now)
      AND  (pr.end_date   IS NULL OR pr.end_date   >= v_now)
      AND  (
        pr.applies_to = 'all'
        OR (pr.applies_to = 'product'  AND v_prod.id             = ANY(pr.product_ids))
        OR (pr.applies_to = 'category' AND v_prod.category_id IS NOT NULL
                                        AND v_prod.category_id = ANY(pr.category_ids))
      )
    ORDER BY
      CASE pr.applies_to WHEN 'product' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
      pr.priority DESC,
      pr.discount_value DESC
    LIMIT 1;

    IF promotion_id IS NOT NULL THEN
      product_id    := v_prod.id;
      source        := 'promotion';
      status        := 'active';
      RETURN NEXT;
      -- Reset for next iteration
      promotion_id   := NULL;
      promotion_name := NULL;
      discount_type  := NULL;
      discount_value := NULL;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ── Updated get_product_active_discount (single product) ─────────────────────
DROP FUNCTION IF EXISTS get_product_active_discount(UUID, UUID);
CREATE OR REPLACE FUNCTION get_product_active_discount(
  p_store_id  UUID,
  p_product_id UUID
) RETURNS TABLE (
  source         TEXT,
  discount_type  TEXT,
  discount_value DECIMAL,
  promotion_id   UUID,
  promotion_name TEXT,
  status         TEXT
) AS $$
DECLARE
  v_now      TIMESTAMPTZ := NOW();
  v_prod     RECORD;
BEGIN
  SELECT id, category_id,
         discount_type, discount_value, discount_start, discount_end
  INTO   v_prod
  FROM   products
  WHERE  id = p_product_id AND store_id = p_store_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- Product-level discount
  IF v_prod.discount_value IS NOT NULL AND v_prod.discount_value > 0
     AND v_prod.discount_type IS NOT NULL
     AND (v_prod.discount_start IS NULL OR v_prod.discount_start <= v_now)
     AND (v_prod.discount_end   IS NULL OR v_prod.discount_end   >= v_now) THEN
    source        := 'product';
    discount_type  := v_prod.discount_type;
    discount_value := v_prod.discount_value;
    promotion_id  := NULL;
    promotion_name := NULL;
    status        := 'active';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Best promotion
  SELECT pr.id, pr.name, pr.discount_type, pr.discount_value
  INTO   promotion_id, promotion_name, discount_type, discount_value
  FROM   promotions pr
  WHERE  pr.store_id  = p_store_id
    AND  pr.is_active = true
    AND  (pr.start_date IS NULL OR pr.start_date <= v_now)
    AND  (pr.end_date   IS NULL OR pr.end_date   >= v_now)
    AND  (
      pr.applies_to = 'all'
      OR (pr.applies_to = 'product'  AND v_prod.id             = ANY(pr.product_ids))
      OR (pr.applies_to = 'category' AND v_prod.category_id IS NOT NULL
                                      AND v_prod.category_id = ANY(pr.category_ids))
    )
  ORDER BY
    CASE pr.applies_to WHEN 'product' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
    pr.priority DESC,
    pr.discount_value DESC
  LIMIT 1;

  IF promotion_id IS NOT NULL THEN
    source := 'promotion';
    status := 'active';
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
