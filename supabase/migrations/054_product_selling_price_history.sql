-- ============================================================
-- 054: Selling-price audit trail — mirrors product_cost_history (017)
-- Tracks changes to products.selling_price / wholesale_price /
-- distributor_price / vip_price, regardless of code path (Product Form
-- edits, future bulk-edit tools, imports), via a DB trigger. Combined with
-- the existing product_cost_history table, this gives a full price-change
-- history (cost side + selling side) surfaced in Reports > Price History.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_selling_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_type TEXT NOT NULL CHECK (price_type IN ('retail', 'wholesale', 'distributor', 'vip')),
  old_price DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (old_price >= 0),
  new_price DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (new_price >= 0),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_selling_price_history_product_idx
  ON product_selling_price_history(store_id, product_id, created_at DESC);

ALTER TABLE product_selling_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_selling_price_history_store ON product_selling_price_history;
CREATE POLICY product_selling_price_history_store ON product_selling_price_history FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- ============================================================
-- Trigger: log every selling-price column that actually changed.
-- created_by is left NULL here — no per-request user context is available
-- inside a plain UPDATE trigger; app code paths that need attribution can
-- still be traced via the app's own audit logs.
-- ============================================================
CREATE OR REPLACE FUNCTION log_selling_price_change() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.selling_price IS DISTINCT FROM OLD.selling_price THEN
    INSERT INTO product_selling_price_history (store_id, product_id, price_type, old_price, new_price)
    VALUES (NEW.store_id, NEW.id, 'retail', COALESCE(OLD.selling_price, 0), COALESCE(NEW.selling_price, 0));
  END IF;

  IF NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price THEN
    INSERT INTO product_selling_price_history (store_id, product_id, price_type, old_price, new_price)
    VALUES (NEW.store_id, NEW.id, 'wholesale', COALESCE(OLD.wholesale_price, 0), COALESCE(NEW.wholesale_price, 0));
  END IF;

  IF NEW.distributor_price IS DISTINCT FROM OLD.distributor_price THEN
    INSERT INTO product_selling_price_history (store_id, product_id, price_type, old_price, new_price)
    VALUES (NEW.store_id, NEW.id, 'distributor', COALESCE(OLD.distributor_price, 0), COALESCE(NEW.distributor_price, 0));
  END IF;

  IF NEW.vip_price IS DISTINCT FROM OLD.vip_price THEN
    INSERT INTO product_selling_price_history (store_id, product_id, price_type, old_price, new_price)
    VALUES (NEW.store_id, NEW.id, 'vip', COALESCE(OLD.vip_price, 0), COALESCE(NEW.vip_price, 0));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS products_selling_price_audit ON products;
CREATE TRIGGER products_selling_price_audit
  AFTER UPDATE ON products
  FOR EACH ROW
  WHEN (
    NEW.selling_price IS DISTINCT FROM OLD.selling_price
    OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
    OR NEW.distributor_price IS DISTINCT FROM OLD.distributor_price
    OR NEW.vip_price IS DISTINCT FROM OLD.vip_price
  )
  EXECUTE FUNCTION log_selling_price_change();
