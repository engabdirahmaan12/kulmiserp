-- Production Security Hardening
-- Fixes: SECURITY DEFINER RPCs missing auth checks, RLS gaps, missing indexes

-- ============================================================
-- 1. Helper: verify caller belongs to a store with required role
-- ============================================================
CREATE OR REPLACE FUNCTION verify_store_access(
  p_store_id UUID,
  p_user_id UUID,
  p_min_roles TEXT[] DEFAULT ARRAY['owner','manager','cashier','accountant','purchase_officer']
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM store_users
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND is_active = true
      AND role = ANY(p_min_roles)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 2. complete_pos_sale — add caller auth check
-- ============================================================
CREATE OR REPLACE FUNCTION complete_pos_sale(
  p_store_id UUID,
  p_cashier_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_subtotal DECIMAL,
  p_discount_amount DECIMAL,
  p_discount_type TEXT,
  p_tax_amount DECIMAL,
  p_total_amount DECIMAL,
  p_paid_amount DECIMAL,
  p_change_amount DECIMAL,
  p_credit_amount DECIMAL,
  p_payment_method TEXT,
  p_payment_details JSONB,
  p_notes TEXT,
  p_due_date DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  -- Verify caller is authenticated and belongs to this store
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Caller must be the cashier or an owner/manager acting on their behalf
  IF v_caller_id <> p_cashier_id AND NOT verify_store_access(p_store_id, v_caller_id, ARRAY['owner','manager']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Cashier must belong to this store
  IF NOT verify_store_access(p_store_id, p_cashier_id, ARRAY['owner','manager','cashier','accountant','purchase_officer']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cashier not authorized for this store');
  END IF;

  -- Delegate to internal implementation (19_chart_of_accounts_redesign body)
  RETURN _complete_pos_sale_impl(
    p_store_id, p_cashier_id, p_customer_id, p_items,
    p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_total_amount,
    p_paid_amount, p_change_amount, p_credit_amount,
    p_payment_method, p_payment_details, p_notes, p_due_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. RLS: store_payment_methods — full CRUD policies
-- ============================================================
DROP POLICY IF EXISTS store_payment_methods_insert ON store_payment_methods;
DROP POLICY IF EXISTS store_payment_methods_update ON store_payment_methods;
DROP POLICY IF EXISTS store_payment_methods_delete ON store_payment_methods;

CREATE POLICY store_payment_methods_insert ON store_payment_methods
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = store_payment_methods.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
        AND su.role IN ('owner', 'manager')
    )
  );

CREATE POLICY store_payment_methods_update ON store_payment_methods
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = store_payment_methods.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
        AND su.role IN ('owner', 'manager')
    )
  );

CREATE POLICY store_payment_methods_delete ON store_payment_methods
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = store_payment_methods.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
        AND su.role IN ('owner', 'manager')
    )
  );

-- ============================================================
-- 4. Missing performance indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_created
  ON purchase_orders(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier
  ON purchase_orders(supplier_id, store_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order
  ON purchase_order_items(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product
  ON purchase_order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_store_product
  ON sale_items(product_id);

CREATE INDEX IF NOT EXISTS idx_sales_store_cashier
  ON sales(store_id, cashier_id);

CREATE INDEX IF NOT EXISTS idx_expenses_store_date
  ON expenses(store_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_store_users_user_active
  ON store_users(user_id, is_active, store_id);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_system_role
  ON chart_of_accounts(store_id, system_role) WHERE system_role IS NOT NULL;

-- ============================================================
-- 5. RLS: stores — prevent anonymous insert (require service role)
-- ============================================================
DROP POLICY IF EXISTS "Anyone can insert stores" ON stores;

CREATE POLICY "Service role only insert stores" ON stores
  FOR INSERT WITH CHECK (false);  -- All store creation must go through API route

-- ============================================================
-- 6. Ensure open store select policy stays (users see own stores via store_users)
-- ============================================================
-- The existing "Store members can access stores" policy on stores is correct.
-- Super admin access is done via service-role API routes, not anon client.

-- ============================================================
-- 7. Lock store_users against direct inserts (use invite API)
-- ============================================================
DROP POLICY IF EXISTS "Store members can manage store_users" ON store_users;
DROP POLICY IF EXISTS "Store owners can manage store_users" ON store_users;

-- Users can see their own memberships
DROP POLICY IF EXISTS "Users can see their store memberships" ON store_users;
CREATE POLICY "Users can see their store memberships" ON store_users
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM store_users su2
      WHERE su2.store_id = store_users.store_id
        AND su2.user_id = auth.uid()
        AND su2.is_active = true
        AND su2.role IN ('owner', 'manager')
    )
  );

-- Only owners/managers can update roles (used for deactivation etc.)
CREATE POLICY "Owners managers can update store_users" ON store_users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = store_users.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
        AND su.role IN ('owner', 'manager')
    )
  );

-- Direct INSERT is forbidden — must use service-role invite API
CREATE POLICY "No direct store_users insert" ON store_users
  FOR INSERT WITH CHECK (false);

-- Direct DELETE is forbidden — deactivate instead
CREATE POLICY "No direct store_users delete" ON store_users
  FOR DELETE USING (false);
