-- Store branding & product media (logos, covers, product galleries)
-- Path convention: {store_id}/... for tenant isolation

-- ── Store cover image ─────────────────────────────────────────
ALTER TABLE stores ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ── Product gallery images ────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_store ON product_images(store_id);

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_images_select" ON product_images FOR SELECT
  USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "product_images_insert" ON product_images FOR INSERT
  WITH CHECK (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "product_images_update" ON product_images FOR UPDATE
  USING (user_has_store_access(auth.uid(), store_id));

CREATE POLICY "product_images_delete" ON product_images FOR DELETE
  USING (user_has_store_access(auth.uid(), store_id));

-- ── Storage: product-images ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "product_images_storage_select"
  ON storage.objects FOR SELECT TO authenticated, anon
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "product_images_storage_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "product_images_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- ── Storage: store-assets (logo, cover) ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'store-assets',
  'store-assets',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "store_assets_storage_select"
  ON storage.objects FOR SELECT TO authenticated, anon
  USING (bucket_id = 'store-assets');

CREATE POLICY "store_assets_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "store_assets_storage_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "store_assets_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- ── Update store branding (logo, cover, shape settings) ───────
CREATE OR REPLACE FUNCTION update_store_branding(
  p_store_id UUID,
  p_user_id UUID,
  p_logo_url TEXT DEFAULT NULL,
  p_cover_url TEXT DEFAULT NULL,
  p_clear_logo BOOLEAN DEFAULT false,
  p_clear_cover BOOLEAN DEFAULT false,
  p_settings JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true;

  IF v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
  END IF;

  UPDATE stores SET
    logo_url = CASE
      WHEN p_clear_logo THEN NULL
      WHEN p_logo_url IS NOT NULL THEN p_logo_url
      ELSE logo_url
    END,
    cover_url = CASE
      WHEN p_clear_cover THEN NULL
      WHEN p_cover_url IS NOT NULL THEN p_cover_url
      ELSE cover_url
    END,
    settings = COALESCE(settings, '{}'::JSONB) || COALESCE(p_settings, '{}'::JSONB),
    updated_at = NOW()
  WHERE id = p_store_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
