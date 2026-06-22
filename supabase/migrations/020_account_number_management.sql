-- KULMIS ERP: Account number management — editable codes, custom formats, audit trail

CREATE OR REPLACE FUNCTION normalize_account_code(p_code TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN upper(trim(p_code));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION validate_account_code(p_code TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := normalize_account_code(p_code);
  IF v_code IS NULL OR v_code = '' THEN
    RETURN 'Account number is required';
  END IF;
  IF length(v_code) > 32 THEN
    RETURN 'Account number must be 32 characters or less';
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9\-_.\/]*$' THEN
    RETURN 'Account number may use letters, numbers, dashes, underscores, dots, or slashes';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION suggest_next_account_code(
  p_store_id UUID,
  p_account_type TEXT,
  p_min INT DEFAULT NULL,
  p_max INT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_base INT;
  v_min INT;
  v_max INT;
  v_next INT;
  v_candidate TEXT;
  v_used BOOLEAN;
BEGIN
  v_base := coa_type_base(p_account_type);
  v_min := COALESCE(p_min, v_base);
  v_max := COALESCE(p_max, v_base + 990);

  SELECT COALESCE(MAX(
    CASE WHEN code ~ '^\d+$' THEN code::INT ELSE NULL END
  ), v_min - 10) + 10 INTO v_next
  FROM chart_of_accounts
  WHERE store_id = p_store_id
    AND code ~ '^\d+$'
    AND code::INT >= v_min
    AND code::INT <= v_max;

  WHILE v_next <= v_max LOOP
    v_candidate := v_next::TEXT;
    SELECT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE store_id = p_store_id AND lower(code) = lower(v_candidate)
    ) INTO v_used;
    IF NOT v_used THEN RETURN v_candidate; END IF;
    v_next := v_next + 10;
  END LOOP;

  RAISE EXCEPTION 'No available account numbers in range %-%', v_min, v_max;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION suggest_payment_account_code(p_store_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN suggest_next_account_code(p_store_id, 'asset', 1010, 1999);
EXCEPTION WHEN OTHERS THEN
  RETURN suggest_next_account_code(p_store_id, 'asset', 1000, 1999);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_account_type TEXT,
  p_parent_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_id UUID;
  v_code TEXT;
  v_err TEXT;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account name is required');
  END IF;

  v_code := normalize_account_code(p_code);
  v_err := validate_account_code(v_code);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  IF EXISTS (
    SELECT 1 FROM chart_of_accounts
    WHERE store_id = p_store_id AND lower(code) = lower(v_code)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account number already exists.');
  END IF;

  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_parent_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parent account not found');
  END IF;

  INSERT INTO chart_of_accounts (store_id, code, name, description, account_type, parent_id, is_system, is_protected, is_postable, is_active)
  VALUES (p_store_id, v_code, trim(p_name), NULLIF(trim(p_description), ''), p_account_type, p_parent_id, false, false, true, true)
  RETURNING id INTO v_id;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'chart_of_account', v_id, 'created',
    NULL, jsonb_build_object('code', v_code, 'name', p_name, 'account_type', p_account_type)
  );

  RETURN jsonb_build_object('success', true, 'account_id', v_id, 'code', v_code);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Account number already exists.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_chart_account(
  p_store_id UUID,
  p_user_id UUID,
  p_account_id UUID,
  p_name TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL,
  p_account_type TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_account RECORD;
  v_protected BOOLEAN;
  v_new_code TEXT;
  v_err TEXT;
  v_code_changed BOOLEAN := false;
BEGIN
  IF NOT accounting_can_write(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = p_account_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Account not found'); END IF;

  v_protected := v_account.is_protected OR v_account.system_role IS NOT NULL;

  IF v_protected AND p_account_type IS NOT NULL AND p_account_type <> v_account.account_type THEN
    RETURN jsonb_build_object('success', false, 'error', 'Protected account type cannot be changed');
  END IF;

  IF p_parent_id IS NOT NULL AND p_parent_id = p_account_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account cannot be its own parent');
  END IF;

  v_new_code := v_account.code;
  IF p_code IS NOT NULL AND NULLIF(trim(p_code), '') IS NOT NULL THEN
    v_new_code := normalize_account_code(p_code);
    v_err := validate_account_code(v_new_code);
    IF v_err IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', v_err);
    END IF;
    IF lower(v_new_code) <> lower(v_account.code) THEN
      IF EXISTS (
        SELECT 1 FROM chart_of_accounts
        WHERE store_id = p_store_id AND lower(code) = lower(v_new_code) AND id <> p_account_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Account number already exists.');
      END IF;
      v_code_changed := true;
    END IF;
  END IF;

  UPDATE chart_of_accounts SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    code = v_new_code,
    description = COALESCE(p_description, description),
    parent_id = COALESCE(p_parent_id, parent_id),
    account_type = CASE WHEN v_protected THEN account_type ELSE COALESCE(p_account_type, account_type) END,
    updated_at = NOW()
  WHERE id = p_account_id;

  IF v_code_changed THEN
    PERFORM log_accounting_audit(
      p_store_id, p_user_id, 'chart_of_account', p_account_id, 'account_code_changed',
      jsonb_build_object('account_number', v_account.code, 'name', v_account.name),
      jsonb_build_object('account_number', v_new_code, 'name', COALESCE(NULLIF(trim(p_name), ''), v_account.name))
    );
  END IF;

  PERFORM log_accounting_audit(
    p_store_id, p_user_id, 'chart_of_account', p_account_id, 'updated',
    jsonb_build_object('name', v_account.name, 'code', v_account.code),
    jsonb_build_object('name', p_name, 'code', v_new_code, 'description', p_description)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code_changed', v_code_changed,
    'old_code', v_account.code,
    'new_code', v_new_code
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Account number already exists.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC for UI auto-suggestion
CREATE OR REPLACE FUNCTION suggest_chart_account_code(
  p_store_id UUID,
  p_user_id UUID,
  p_account_type TEXT
) RETURNS JSONB AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF NOT accounting_can_view(p_store_id, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_account_type = 'asset' THEN
    BEGIN
      v_code := suggest_payment_account_code(p_store_id);
    EXCEPTION WHEN OTHERS THEN
      v_code := suggest_next_account_code(p_store_id, p_account_type);
    END;
  ELSE
    v_code := suggest_next_account_code(p_store_id, p_account_type);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
