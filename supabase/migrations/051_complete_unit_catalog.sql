-- 051_complete_unit_catalog.sql
-- Richer default unit set for newly-created stores, aligned with the full
-- Retail / Wholesale / Special unit catalog surfaced in Settings →
-- Business Configuration → Available unit types. No schema changes —
-- the complete bilingual catalog (Somali/English names, descriptions,
-- examples) lives client-side in UnitTypesManager.tsx; this only widens
-- what a brand-new store starts with so common needs (pharmacies,
-- water companies, hardware) work without a trip to Settings first.
--
-- Existing stores are untouched (ON CONFLICT DO NOTHING) — their owners
-- manage additions via the Settings toggle UI, which upserts on demand.

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
    (p_store_id, 'PCS',   'Piece',      'base', false, 10),
    (p_store_id, 'KG',    'Kilogram',   'base', true,  20),
    (p_store_id, 'GRAM',  'Gram',       'base', true,  30),
    (p_store_id, 'LITER', 'Liter',      'base', true,  40),
    (p_store_id, 'ML',    'Milliliter', 'base', true,  50),
    (p_store_id, 'METER', 'Meter',      'base', true,  60)
  ON CONFLICT (store_id, code) DO NOTHING;

  IF v_mode IN ('retail_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'PACKET', 'Packet', 'wholesale', false, 150),
      -- 'both' so a water company etc. can set Bottle as the base/stock unit
      (p_store_id, 'BOTTLE', 'Bottle', 'both',       false, 310),
      (p_store_id, 'DOZEN',  'Dozen',  'both',       false, 180)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;

  IF v_mode IN ('wholesale_only', 'wholesale_retail') THEN
    INSERT INTO unit_types (store_id, code, name, unit_kind, allows_decimal, sort_order)
    VALUES
      (p_store_id, 'CARTON', 'Carton', 'wholesale', false, 120),
      (p_store_id, 'BOX',    'Box',    'wholesale', false, 130),
      (p_store_id, 'BAG',    'Bag',    'wholesale', false, 140),
      (p_store_id, 'BUNDLE', 'Bundle', 'wholesale', false, 160),
      (p_store_id, 'SACK',   'Sack',   'wholesale', false, 110),
      (p_store_id, 'PALLET', 'Pallet', 'wholesale', false, 190)
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seed_store_unit_types(UUID, TEXT) TO authenticated;
