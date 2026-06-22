-- PostgREST cannot resolve overloaded update_store_accounting_settings RPCs.
-- Drop all historical signatures and keep one canonical function.

DROP FUNCTION IF EXISTS public.update_store_accounting_settings(
  uuid, uuid, text, text, integer, text, boolean, uuid, uuid, uuid
);
DROP FUNCTION IF EXISTS public.update_store_accounting_settings(
  uuid, uuid, text, text, integer, text, boolean
);
DROP FUNCTION IF EXISTS public.update_store_accounting_settings(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.update_store_accounting_settings(
  p_store_id UUID,
  p_user_id UUID,
  p_secondary_currency TEXT DEFAULT NULL,
  p_inventory_cost_method TEXT DEFAULT NULL,
  p_fiscal_year_start_month INT DEFAULT NULL,
  p_coa_number_prefix TEXT DEFAULT NULL,
  p_auto_create_payment_accounts BOOLEAN DEFAULT NULL,
  p_default_cash_account_id UUID DEFAULT NULL,
  p_default_revenue_account_id UUID DEFAULT NULL,
  p_default_expense_account_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_old_method TEXT;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_inventory_cost_method IS NOT NULL AND p_inventory_cost_method NOT IN ('average', 'fifo', 'lifo') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid costing method');
  END IF;

  IF p_fiscal_year_start_month IS NOT NULL AND (p_fiscal_year_start_month < 1 OR p_fiscal_year_start_month > 12) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fiscal year start month must be 1-12');
  END IF;

  IF p_default_cash_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_default_cash_account_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid default cash account');
  END IF;

  IF p_default_revenue_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_default_revenue_account_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid default revenue account');
  END IF;

  IF p_default_expense_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE id = p_default_expense_account_id AND store_id = p_store_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid default expense account');
  END IF;

  SELECT inventory_cost_method INTO v_old_method FROM stores WHERE id = p_store_id;

  UPDATE stores SET
    secondary_currency = COALESCE(NULLIF(trim(p_secondary_currency), ''), secondary_currency),
    inventory_cost_method = COALESCE(p_inventory_cost_method, inventory_cost_method),
    fiscal_year_start_month = COALESCE(p_fiscal_year_start_month, fiscal_year_start_month),
    coa_number_prefix = COALESCE(p_coa_number_prefix, coa_number_prefix),
    auto_create_payment_accounts = COALESCE(p_auto_create_payment_accounts, auto_create_payment_accounts),
    default_cash_account_id = COALESCE(p_default_cash_account_id, default_cash_account_id),
    default_revenue_account_id = COALESCE(p_default_revenue_account_id, default_revenue_account_id),
    default_expense_account_id = COALESCE(p_default_expense_account_id, default_expense_account_id),
    updated_at = NOW()
  WHERE id = p_store_id;

  PERFORM log_accounting_audit(p_store_id, p_user_id, 'store', p_store_id, 'settings_updated', NULL,
    jsonb_build_object(
      'secondary_currency', p_secondary_currency,
      'inventory_cost_method', p_inventory_cost_method,
      'fiscal_year_start_month', p_fiscal_year_start_month,
      'coa_number_prefix', p_coa_number_prefix,
      'auto_create_payment_accounts', p_auto_create_payment_accounts,
      'default_cash_account_id', p_default_cash_account_id,
      'default_revenue_account_id', p_default_revenue_account_id,
      'default_expense_account_id', p_default_expense_account_id,
      'previous_cost_method', v_old_method
    ));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_store_accounting_settings(
  uuid, uuid, text, text, integer, text, boolean, uuid, uuid, uuid
) TO authenticated;
