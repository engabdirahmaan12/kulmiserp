-- Product sales mode, barcode uniqueness, GRAM unit, improved unit seed

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sales_mode TEXT NOT NULL DEFAULT 'both'
    CHECK (sales_mode IN ('retail', 'wholesale', 'both'));

CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_unique
  ON products (store_id, barcode)
  WHERE barcode IS NOT NULL;

COMMENT ON COLUMN products.sales_mode IS
  'How this product is sold: retail, wholesale, or both (wholesale + retail).';

-- ============================================================
-- SEED DEFAULT UNIT TYPES (add GRAM, keep full catalog)
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

  INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
  VALUES
    (p_store_id, 'PCS', 'Piece', 'base', false, 1),
    (p_store_id, 'GRAM', 'Gram', 'base', true, 2),
    (p_store_id, 'KG', 'Kilogram', 'base', true, 3),
    (p_store_id, 'LITER', 'Liter', 'base', true, 4),
    (p_store_id, 'METER', 'Meter', 'base', true, 5)
  ON CONFLICT (store_id, code) DO NOTHING;

  IF v_mode IN ('retail_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'PACK', 'Pack', 'retail', false, 10),
      (p_store_id, 'BOTTLE', 'Bottle', 'retail', false, 11),
      (p_store_id, 'BOX', 'Box', 'both', false, 12)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;

  IF v_mode IN ('wholesale_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'CARTON', 'Carton', 'wholesale', false, 20),
      (p_store_id, 'BUNDLE', 'Bundle', 'wholesale', false, 21),
      (p_store_id, 'SACK', 'Sack', 'wholesale', true, 22),
      (p_store_id, 'CRATE', 'Crate', 'wholesale', false, 23)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill GRAM for existing stores
INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
SELECT s.id, 'GRAM', 'Gram', 'base', true, 2
FROM stores s
ON CONFLICT (store_id, code) DO NOTHING;

-- Ensure stores with no units get seeded
DO $$
DECLARE
  v_store RECORD;
BEGIN
  FOR v_store IN SELECT id, business_mode FROM stores LOOP
    IF NOT EXISTS (SELECT 1 FROM unit_types WHERE store_id = v_store.id LIMIT 1) THEN
      PERFORM seed_store_unit_types(v_store.id, v_store.business_mode);
    END IF;
  END LOOP;
END $$;
