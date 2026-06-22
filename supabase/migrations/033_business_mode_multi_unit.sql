-- Business mode + multi-unit inventory foundation
-- All stock_quantity and cost_price remain in BASE units.

-- ============================================================
-- STORE BUSINESS MODE
-- ============================================================
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS business_mode TEXT NOT NULL DEFAULT 'retail_only'
    CHECK (business_mode IN ('retail_only', 'wholesale_only', 'wholesale_retail'));

-- ============================================================
-- UNIT TYPE CATALOG (per store)
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_kind TEXT NOT NULL DEFAULT 'base'
    CHECK (unit_kind IN ('base', 'retail', 'wholesale', 'both')),
  allows_decimal BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_unit_types_store ON unit_types(store_id);

-- ============================================================
-- PRODUCT UNIT OPTIONS (purchase + sale units with conversion)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_type_id UUID NOT NULL REFERENCES unit_types(id) ON DELETE RESTRICT,
  conversion_factor DECIMAL(15,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  is_purchase_unit BOOLEAN NOT NULL DEFAULT false,
  is_default_sale BOOLEAN NOT NULL DEFAULT false,
  retail_price DECIMAL(15,2),
  wholesale_price DECIMAL(15,2),
  distributor_price DECIMAL(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, unit_type_id)
);

CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);

-- ============================================================
-- PRODUCT EXTENSIONS
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS base_unit_id UUID REFERENCES unit_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS distributor_price DECIMAL(15,2);

-- ============================================================
-- LINE ITEM AUDIT FIELDS
-- ============================================================
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS sale_unit_id UUID REFERENCES unit_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_unit_code TEXT,
  ADD COLUMN IF NOT EXISTS sale_unit_qty DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS base_qty DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS price_tier TEXT DEFAULT 'retail'
    CHECK (price_tier IS NULL OR price_tier IN ('retail', 'wholesale', 'distributor'));

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS purchase_unit_id UUID REFERENCES unit_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_unit_code TEXT,
  ADD COLUMN IF NOT EXISTS purchase_unit_qty DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS base_qty DECIMAL(15,3);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS price_tier TEXT DEFAULT 'retail'
    CHECK (price_tier IS NULL OR price_tier IN ('retail', 'wholesale', 'distributor'));

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE unit_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store members can access unit_types" ON unit_types;
CREATE POLICY "Store members can access unit_types" ON unit_types
  FOR ALL USING (user_has_store_access(auth.uid(), store_id));

DROP POLICY IF EXISTS "Store members can access product_units" ON product_units;
CREATE POLICY "Store members can access product_units" ON product_units
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_units.product_id
        AND user_has_store_access(auth.uid(), p.store_id)
    )
  );

-- ============================================================
-- SEED DEFAULT UNIT TYPES FOR A STORE
-- ============================================================
CREATE OR REPLACE FUNCTION seed_store_unit_types(
  p_store_id UUID,
  p_business_mode TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT COALESCE(p_business_mode, business_mode, 'retail_only')
  INTO v_mode FROM stores WHERE id = p_store_id;

  -- Base / measurable units
  INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
  VALUES
    (p_store_id, 'PCS', 'Piece', 'base', false, 1),
    (p_store_id, 'KG', 'Kilogram', 'base', true, 2),
    (p_store_id, 'LITER', 'Liter', 'base', true, 3),
    (p_store_id, 'METER', 'Meter', 'base', true, 4)
  ON CONFLICT (store_id, code) DO NOTHING;

  IF v_mode IN ('retail_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'PACK', 'Pack', 'retail', false, 10),
      (p_store_id, 'BOTTLE', 'Bottle', 'retail', false, 11)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;

  IF v_mode IN ('wholesale_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'CARTON', 'Carton', 'wholesale', false, 20),
      (p_store_id, 'BOX', 'Box', 'wholesale', false, 21),
      (p_store_id, 'BUNDLE', 'Bundle', 'wholesale', false, 22),
      (p_store_id, 'SACK', 'Sack', 'wholesale', true, 23),
      (p_store_id, 'CRATE', 'Crate', 'wholesale', false, 24)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RESOLVE BASE QTY FROM SALE/PURCHASE UNIT
-- ============================================================
CREATE OR REPLACE FUNCTION product_unit_conversion(
  p_product_id UUID,
  p_unit_id UUID
) RETURNS DECIMAL AS $$
DECLARE
  v_factor DECIMAL;
BEGIN
  IF p_unit_id IS NULL THEN
    RETURN 1;
  END IF;

  SELECT conversion_factor INTO v_factor
  FROM product_units
  WHERE product_id = p_product_id AND unit_type_id = p_unit_id;

  IF v_factor IS NOT NULL THEN
    RETURN v_factor;
  END IF;

  -- Base unit itself
  IF EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = p_product_id AND p.base_unit_id = p_unit_id
  ) THEN
    RETURN 1;
  END IF;

  RETURN 1;
END;
$$ LANGUAGE plpgsql STABLE;

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
        WHEN 'wholesale' THEN COALESCE(v_unit.wholesale_price, v_unit.retail_price, v_product.wholesale_price)
        WHEN 'distributor' THEN COALESCE(v_unit.distributor_price, v_unit.wholesale_price, v_product.distributor_price)
        ELSE COALESCE(v_unit.retail_price, v_product.selling_price)
      END;
      IF v_price IS NOT NULL AND v_price > 0 THEN
        RETURN v_price;
      END IF;
    END IF;
  END IF;

  RETURN CASE COALESCE(p_tier, 'retail')
    WHEN 'wholesale' THEN COALESCE(v_product.wholesale_price, v_product.selling_price, 0)
    WHEN 'distributor' THEN COALESCE(v_product.distributor_price, v_product.wholesale_price, v_product.selling_price, 0)
    ELSE COALESCE(v_product.selling_price, 0)
  END;
END;
$$ LANGUAGE plpgsql STABLE;

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
      'distributor_price', COALESCE(pu.distributor_price, v_product.distributor_price)
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
      'distributor_price', v_product.distributor_price
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

GRANT EXECUTE ON FUNCTION seed_store_unit_types(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION product_unit_conversion(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_product_unit_price(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_product_sale_units(UUID) TO authenticated;

-- Seed + backfill existing stores
DO $$
DECLARE
  v_store RECORD;
  v_unit_id UUID;
  v_product RECORD;
  v_code TEXT;
BEGIN
  FOR v_store IN SELECT id, business_mode FROM stores LOOP
    PERFORM seed_store_unit_types(v_store.id, v_store.business_mode);

    FOR v_product IN SELECT id, store_id, unit, selling_price, wholesale_price, distributor_price, cost_price
                     FROM products WHERE store_id = v_store.id
    LOOP
      v_code := UPPER(TRIM(COALESCE(NULLIF(v_product.unit, ''), 'PCS')));
      IF v_code IN ('PIECE', 'PC', 'PCS') THEN v_code := 'PCS'; END IF;
      IF v_code IN ('L', 'LTR', 'LITRE', 'LITERS') THEN v_code := 'LITER'; END IF;
      IF v_code IN ('M', 'MTR', 'METRE', 'METERS') THEN v_code := 'METER'; END IF;

      SELECT id INTO v_unit_id
      FROM unit_types
      WHERE store_id = v_store.id AND code = v_code
      LIMIT 1;

      IF v_unit_id IS NULL THEN
        INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
        VALUES (v_store.id, v_code, INITCAP(v_code), 'base', v_code IN ('KG', 'LITER', 'METER'), 99)
        RETURNING id INTO v_unit_id;
      END IF;

      UPDATE products SET base_unit_id = v_unit_id WHERE id = v_product.id AND base_unit_id IS NULL;

      IF NOT EXISTS (SELECT 1 FROM product_units WHERE product_id = v_product.id) THEN
        INSERT INTO product_units (
          product_id, unit_type_id, conversion_factor,
          is_purchase_unit, is_default_sale,
          retail_price, wholesale_price, distributor_price
        ) VALUES (
          v_product.id, v_unit_id, 1,
          true, true,
          v_product.selling_price, v_product.wholesale_price, v_product.distributor_price
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
