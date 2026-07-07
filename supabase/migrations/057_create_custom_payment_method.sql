-- 057_create_custom_payment_method.sql
-- Simple payment-method creation for the new Settings > Payments panel.
-- No chart-of-accounts / GL linkage (Accounting was removed) — just a slug
-- + label the store can use at POS checkout and Custom Invoice.

CREATE OR REPLACE FUNCTION create_custom_payment_method(
  p_store_id UUID,
  p_user_id  UUID,
  p_label    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_slug TEXT;
  v_id   UUID;
  v_next_sort INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM store_users
    WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
      AND role IN ('owner', 'manager')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF trim(COALESCE(p_label, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Label is required');
  END IF;

  v_slug := lower(trim(regexp_replace(p_label, '[^a-zA-Z0-9]+', '_', 'g')));
  v_slug := trim(both '_' from v_slug);

  IF v_slug = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Label is required');
  END IF;

  IF EXISTS (
    SELECT 1 FROM store_payment_methods WHERE store_id = p_store_id AND slug = v_slug
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A payment method with this name already exists');
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) + 10 INTO v_next_sort
  FROM store_payment_methods WHERE store_id = p_store_id;

  INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_active, is_system, sort_order)
  VALUES (p_store_id, v_slug, trim(p_label), NULL, true, false, v_next_sort)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'slug', v_slug);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
