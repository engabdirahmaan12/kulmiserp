-- 052_somali_unit_catalog_seed.sql
-- Aligns seed_store_unit_types() with the Somali-first unit catalog now
-- shown in Settings (UnitTypesManager.tsx): Somali names as the primary
-- `name`, codes matching the catalog's Somali-derived identifiers
-- (JAWAAN, KARTOON, SANDUUQ, KIISH, BAAKAD, ...) instead of the older
-- English-derived codes (SACK, CARTON, BOX, BAG, PACKET, ...).
--
-- No schema changes. Existing stores keep whatever unit_types rows they
-- already have (old codes like SACK/CARTON still work fine — they just
-- show up under "Your custom units" instead of matching a standard
-- catalog entry, since the catalog now looks up by the new codes). This
-- only changes what NEW stores are seeded with going forward.
-- product_units references units by UUID, never by code, so no product
-- data is affected either way.

CREATE OR REPLACE FUNCTION seed_store_unit_types(
  p_store_id UUID,
  p_business_mode TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT COALESCE(p_business_mode, business_mode, 'retail_only')
  INTO v_mode FROM stores WHERE id = p_store_id;

  -- Base / measurable retail units — every store gets these regardless of mode
  INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
  VALUES
    (p_store_id, 'PCS',   'Xabbo',      'base', false, 10),
    (p_store_id, 'KG',    'Kiilo',      'base', true,  20),
    (p_store_id, 'GRAM',  'Garaam',     'base', true,  30),
    (p_store_id, 'LITER', 'Litir',      'base', true,  40),
    (p_store_id, 'ML',    'Millilitir', 'base', true,  50),
    (p_store_id, 'METER', 'Mitir',      'base', true,  60)
  ON CONFLICT (store_id, code) DO NOTHING;

  IF v_mode IN ('retail_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'BAAKAD', 'Baakad', 'both', false, 90),
      -- 'both' so a water company etc. can set Dhalo (Bottle) as the base/stock unit
      (p_store_id, 'BOTTLE', 'Dhalo',  'both', false, 80),
      (p_store_id, 'DOZEN',  'Dersin', 'both', false, 230)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;

  IF v_mode IN ('wholesale_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'KARTOON', 'Kartoon', 'wholesale', false, 320),
      (p_store_id, 'SANDUUQ', 'Sanduuq', 'wholesale', false, 340),
      (p_store_id, 'KIISH',   'Kiish',   'wholesale', false, 360),
      (p_store_id, 'BUNDLE',  'Bundle',  'wholesale', false, 400),
      (p_store_id, 'JAWAAN',  'Jawaan',  'wholesale', false, 350),
      (p_store_id, 'PALLET',  'Pallet',  'wholesale', false, 420)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seed_store_unit_types(UUID, TEXT) TO authenticated;
