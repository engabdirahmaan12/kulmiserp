-- Archive legacy sample COA accounts on existing stores (safe: zero balance, no journals, no payment link)

CREATE OR REPLACE FUNCTION coa_safe_to_archive_legacy(p_account_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT * INTO v FROM chart_of_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v.is_protected OR coa_is_protected_role(v.system_role) THEN RETURN false; END IF;
  IF v.system_role IN ('general_expenses', 'tax_payable', 'opening_balance_equity', 'bad_debt_expense') THEN RETURN false; END IF;
  IF v.balance <> 0 THEN RETURN false; END IF;
  IF account_has_transactions(p_account_id) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM store_payment_methods WHERE account_id = p_account_id) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE parent_id = p_account_id AND is_active = true) THEN RETURN false; END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Standardize display names on essential system accounts
UPDATE chart_of_accounts SET name = 'Cash'
WHERE system_role = 'cash' AND name ~* 'cash on hand';

UPDATE chart_of_accounts SET name = 'Inventory'
WHERE system_role = 'inventory' AND name ~* '^inventory$|inventory asset';

UPDATE chart_of_accounts SET name = 'General Expenses'
WHERE system_role = 'general_expenses';

UPDATE chart_of_accounts SET name = 'Sales Revenue'
WHERE system_role = 'sales_revenue' AND name ~* 'product sales|sales revenue';

UPDATE chart_of_accounts SET name = 'Owner Capital'
WHERE system_role = 'owner_capital';

UPDATE chart_of_accounts SET name = 'Cost of Goods Sold'
WHERE system_role = 'cogs';

-- Deactivate legacy header / group accounts
UPDATE chart_of_accounts c
SET is_active = false, is_postable = false, archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
WHERE c.system_role IS NULL
  AND c.code IN ('1000', '1100', '2000', '3000', '4000', '5000', '6000')
  AND (
    c.is_postable = false
    OR c.name ~* '(current assets|cash and cash|current liabilities|owner equity|^revenue$|cost of goods sold|operating expenses)'
  )
  AND coa_safe_to_archive_legacy(c.id);

-- Archive preset wallet / bank sample accounts (1120–1170)
UPDATE chart_of_accounts c
SET is_active = false, archived_at = NOW(), updated_at = NOW()
WHERE c.code IN ('1120', '1130', '1140', '1150', '1160', '1165', '1170')
  AND c.system_role IS NULL
  AND c.is_system = true
  AND coa_safe_to_archive_legacy(c.id);

-- Archive preset expense samples (6100–6400)
UPDATE chart_of_accounts c
SET is_active = false, archived_at = NOW(), updated_at = NOW()
WHERE c.code IN ('6100', '6200', '6300', '6400')
  AND c.system_role IS NULL
  AND c.is_system = true
  AND coa_safe_to_archive_legacy(c.id);

-- Archive duplicate / unused equity and COGS shells
UPDATE chart_of_accounts c
SET is_active = false, archived_at = NOW(), updated_at = NOW()
WHERE c.code IN ('3200', '3100')
  AND c.system_role IS NULL
  AND c.is_system = true
  AND coa_safe_to_archive_legacy(c.id);

UPDATE chart_of_accounts c
SET is_active = false, archived_at = NOW(), updated_at = NOW()
WHERE c.code = '5100'
  AND c.system_role IS NULL
  AND c.name ~* 'cogs'
  AND coa_safe_to_archive_legacy(c.id);

-- Ensure every store has the 8 essential roles (creates missing accounts with new numbering)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM stores LOOP
    PERFORM create_default_chart_of_accounts(r.id);
  END LOOP;
END $$;

-- Re-sync default expense pointer after cleanup
UPDATE stores s SET default_expense_account_id = (
  SELECT id FROM chart_of_accounts
  WHERE store_id = s.id AND system_role = 'general_expenses' AND is_active = true
  LIMIT 1
)
WHERE default_expense_account_id IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM chart_of_accounts c
     WHERE c.id = s.default_expense_account_id AND c.is_active = true
   );
