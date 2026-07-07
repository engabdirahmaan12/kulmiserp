-- 058_payment_method_category.sql
-- Give each payment method a user-chosen GROUP so custom accounts land in the
-- right section of the checkout selector ("Cash & Bank" vs "Mobile Money" vs
-- "Other"). Previously the group was guessed from the slug in the frontend,
-- so a new account like "Salaam Bank" wrongly appeared under Mobile Money.
-- Additive + safe: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.

ALTER TABLE store_payment_methods
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'mobile'
  CHECK (category IN ('cash', 'mobile', 'other'));

-- Backfill existing/system rows into sensible groups.
UPDATE store_payment_methods
  SET category = 'cash'
  WHERE slug IN ('cash', 'bank', 'cheque');

UPDATE store_payment_methods
  SET category = 'mobile'
  WHERE slug IN ('evc', 'waafi', 'zaad', 'sahal', 'premier_wallet');

-- Drop the old 3-arg version so we don't leave a stale overload behind, then
-- recreate the creator with a group (p_category). Defaulting to 'mobile' keeps
-- the signature forgiving; the Settings panel passes the user's choice.
DROP FUNCTION IF EXISTS create_custom_payment_method(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION create_custom_payment_method(
  p_store_id UUID,
  p_user_id  UUID,
  p_label    TEXT,
  p_category TEXT DEFAULT 'mobile'
) RETURNS JSONB AS $$
DECLARE
  v_slug TEXT;
  v_id   UUID;
  v_next_sort INT;
  v_category TEXT;
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

  v_category := lower(COALESCE(NULLIF(trim(p_category), ''), 'mobile'));
  IF v_category NOT IN ('cash', 'mobile', 'other') THEN
    v_category := 'mobile';
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

  INSERT INTO store_payment_methods (store_id, slug, label, account_id, is_active, is_system, sort_order, category)
  VALUES (p_store_id, v_slug, trim(p_label), NULL, true, false, v_next_sort, v_category)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'slug', v_slug, 'category', v_category);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
