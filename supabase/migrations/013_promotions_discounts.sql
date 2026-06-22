-- ============================================================
-- 013: Promotions, Product Discounts & Invoice Settings
-- ============================================================

-- ── Promotions table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value >= 0),
  applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'category', 'product')),
  category_ids UUID[] DEFAULT NULL,
  product_ids UUID[] DEFAULT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  min_order_amount DECIMAL(10,2) DEFAULT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promotions_store_active_idx ON promotions(store_id, is_active);
CREATE INDEX IF NOT EXISTS promotions_store_dates_idx ON promotions(store_id, start_date, end_date);

-- ── Product-level discount overrides ─────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2) DEFAULT NULL CHECK (discount_value >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_start TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_end TIMESTAMPTZ DEFAULT NULL;

-- ── Store invoice/branding settings (JSONB extension) ─────────
-- Stored in stores.settings JSONB to avoid schema migration on every new field
-- Keys: invoice_theme, invoice_footer, invoice_terms, tax_number, show_tax, show_discount, show_sku, show_logo

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotions_store ON promotions;
CREATE POLICY promotions_store ON promotions FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ── Helper: compute best discount for a product at a given time ──
CREATE OR REPLACE FUNCTION get_product_active_discount(
  p_store_id UUID,
  p_product_id UUID,
  p_category_id UUID DEFAULT NULL,
  p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  source TEXT,
  discount_type TEXT,
  discount_value DECIMAL,
  promotion_id UUID,
  promotion_name TEXT
) AS $$
DECLARE
  v_prod RECORD;
  v_promo RECORD;
BEGIN
  -- Check product-level discount first
  SELECT * INTO v_prod FROM products
  WHERE id = p_product_id AND store_id = p_store_id;

  IF FOUND AND v_prod.discount_value IS NOT NULL AND v_prod.discount_value > 0 THEN
    IF (v_prod.discount_start IS NULL OR v_prod.discount_start <= p_at)
       AND (v_prod.discount_end IS NULL OR v_prod.discount_end >= p_at) THEN
      RETURN QUERY SELECT
        'product'::TEXT,
        v_prod.discount_type,
        v_prod.discount_value,
        NULL::UUID,
        NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Check active promotion (highest priority, matching criteria)
  SELECT * INTO v_promo FROM promotions
  WHERE store_id = p_store_id
    AND is_active = true
    AND (start_date IS NULL OR start_date <= p_at)
    AND (end_date IS NULL OR end_date >= p_at)
    AND (
      applies_to = 'all'
      OR (applies_to = 'product' AND p_product_id = ANY(product_ids))
      OR (applies_to = 'category' AND p_category_id IS NOT NULL AND p_category_id = ANY(category_ids))
    )
  ORDER BY priority DESC, discount_value DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      'promotion'::TEXT,
      v_promo.discount_type,
      v_promo.discount_value,
      v_promo.id,
      v_promo.name;
    RETURN;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ── Batch: get active discounts for all store products ─────────
CREATE OR REPLACE FUNCTION get_store_active_discounts(p_store_id UUID)
RETURNS TABLE (
  product_id UUID,
  source TEXT,
  discount_type TEXT,
  discount_value DECIMAL,
  promotion_id UUID,
  promotion_name TEXT
) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_prod RECORD;
BEGIN
  FOR v_prod IN
    SELECT p.id, p.category_id, p.discount_type, p.discount_value, p.discount_start, p.discount_end
    FROM products p
    WHERE p.store_id = p_store_id AND p.is_active = true
  LOOP
    -- product-level discount wins
    IF v_prod.discount_value IS NOT NULL AND v_prod.discount_value > 0
       AND (v_prod.discount_start IS NULL OR v_prod.discount_start <= v_now)
       AND (v_prod.discount_end IS NULL OR v_prod.discount_end >= v_now) THEN
      product_id := v_prod.id;
      source := 'product';
      discount_type := v_prod.discount_type;
      discount_value := v_prod.discount_value;
      promotion_id := NULL;
      promotion_name := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- best promotion for this product
    SELECT pr.id, pr.name, pr.discount_type, pr.discount_value
    INTO promotion_id, promotion_name, discount_type, discount_value
    FROM promotions pr
    WHERE pr.store_id = p_store_id
      AND pr.is_active = true
      AND (pr.start_date IS NULL OR pr.start_date <= v_now)
      AND (pr.end_date IS NULL OR pr.end_date >= v_now)
      AND (
        pr.applies_to = 'all'
        OR (pr.applies_to = 'product' AND v_prod.id = ANY(pr.product_ids))
        OR (pr.applies_to = 'category' AND v_prod.category_id IS NOT NULL AND v_prod.category_id = ANY(pr.category_ids))
      )
    ORDER BY pr.priority DESC, pr.discount_value DESC
    LIMIT 1;

    IF promotion_id IS NOT NULL THEN
      product_id := v_prod.id;
      source := 'promotion';
      RETURN NEXT;
      promotion_id := NULL;
      promotion_name := NULL;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ── CRUD RPCs ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_promotion(
  p_store_id UUID,
  p_user_id UUID,
  p_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_discount_type TEXT DEFAULT 'percentage',
  p_discount_value DECIMAL DEFAULT 0,
  p_applies_to TEXT DEFAULT 'all',
  p_category_ids UUID[] DEFAULT NULL,
  p_product_ids UUID[] DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_priority INTEGER DEFAULT 0,
  p_min_order_amount DECIMAL DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_id UUID;
BEGIN
  SELECT role INTO v_role FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;
  IF v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE promotions SET
      name = COALESCE(p_name, name),
      description = p_description,
      discount_type = COALESCE(p_discount_type, discount_type),
      discount_value = COALESCE(p_discount_value, discount_value),
      applies_to = COALESCE(p_applies_to, applies_to),
      category_ids = p_category_ids,
      product_ids = p_product_ids,
      start_date = p_start_date,
      end_date = p_end_date,
      is_active = COALESCE(p_is_active, is_active),
      priority = COALESCE(p_priority, priority),
      min_order_amount = p_min_order_amount,
      updated_at = NOW()
    WHERE id = p_id AND store_id = p_store_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO promotions (
      store_id, name, description, discount_type, discount_value,
      applies_to, category_ids, product_ids, start_date, end_date,
      is_active, priority, min_order_amount, created_by
    ) VALUES (
      p_store_id, p_name, p_description, p_discount_type, p_discount_value,
      p_applies_to, p_category_ids, p_product_ids, p_start_date, p_end_date,
      p_is_active, p_priority, p_min_order_amount, p_user_id
    ) RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_promotion(
  p_store_id UUID, p_user_id UUID, p_id UUID
) RETURNS JSONB AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;
  IF v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
  END IF;
  DELETE FROM promotions WHERE id = p_id AND store_id = p_store_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Update store settings (invoice/branding) ──────────────────
CREATE OR REPLACE FUNCTION update_store_invoice_settings(
  p_store_id UUID,
  p_user_id UUID,
  p_settings JSONB
) RETURNS JSONB AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;
  IF v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
  END IF;

  UPDATE stores SET
    settings = COALESCE(settings, '{}'::JSONB) || p_settings,
    updated_at = NOW()
  WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
