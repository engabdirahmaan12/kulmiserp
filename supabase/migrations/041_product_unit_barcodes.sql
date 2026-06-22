-- Optional barcode per product sale/purchase unit (e.g. Sack vs KG)

ALTER TABLE product_units
  ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE INDEX IF NOT EXISTS idx_product_units_barcode
  ON product_units (barcode)
  WHERE barcode IS NOT NULL;
