-- Super Admin Platform: plans, AI usage, platform audit, notifications, store extensions

-- ============================================================
-- 1. Extend stores for platform management
-- ============================================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ai_monthly_limit INTEGER DEFAULT NULL;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS freeze_reason TEXT;

-- Allow 'disabled' status (soft-disable without data deletion)
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_subscription_status_check;
ALTER TABLE stores ADD CONSTRAINT stores_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'expired', 'suspended', 'cancelled', 'disabled'));

-- ============================================================
-- 2. Configurable subscription plans
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly', 'trial')),
  max_users INTEGER,
  max_products INTEGER,
  max_stores INTEGER DEFAULT 1,
  ai_monthly_requests INTEGER,
  ai_monthly_tokens INTEGER,
  reports_access BOOLEAN NOT NULL DEFAULT true,
  accounting_access BOOLEAN NOT NULL DEFAULT true,
  inventory_access BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans (slug, name, description, price_usd, billing_cycle, max_users, max_products, ai_monthly_requests, ai_monthly_tokens, reports_access, accounting_access, inventory_access, sort_order, features)
VALUES
  ('free_trial', 'Free', '14-day trial with core features', 0, 'trial', 2, 100, 50, 50000, true, false, true, 0,
   '["POS", "Inventory", "Basic Reports"]'::jsonb),
  ('basic', 'Starter', 'Small business essentials', 29, 'monthly', 5, 500, 200, 200000, true, true, true, 1,
   '["POS", "Inventory", "Accounting", "Reports"]'::jsonb),
  ('business', 'Professional', 'Growing teams and multi-location', 79, 'monthly', 15, 5000, 1000, 1000000, true, true, true, 2,
   '["All Starter", "Advanced Reports", "Multi-user", "AI Copilot"]'::jsonb),
  ('enterprise', 'Enterprise', 'Unlimited scale and priority support', 199, 'monthly', NULL, NULL, NULL, NULL, true, true, true, 3,
   '["All Professional", "Unlimited users", "Priority support", "Custom integrations"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 3. Platform settings (global AI toggle, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO platform_settings (key, value) VALUES
  ('ai', '{"enabled": true, "default_monthly_requests": 500, "default_monthly_tokens": 500000}'::jsonb),
  ('security', '{"require_2fa": false, "session_timeout_hours": 24}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. AI usage tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL DEFAULT 'copilot',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  model TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_store_month ON ai_usage_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs(created_at DESC);

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_no_client ON ai_usage_logs FOR ALL USING (false);

-- ============================================================
-- 5. Platform audit logs (cross-tenant admin actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_store ON platform_audit_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_logs(action, created_at DESC);

ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_audit_no_client ON platform_audit_logs FOR ALL USING (false);

-- ============================================================
-- 6. Platform notifications (alerts for super admins)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_unread ON platform_notifications(is_read, created_at DESC);

ALTER TABLE platform_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_notif_no_client ON platform_notifications FOR ALL USING (false);

-- ============================================================
-- 7. Platform login activity
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_login_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  platform_role TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_login_user ON platform_login_activity(user_id, created_at DESC);

ALTER TABLE platform_login_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_login_no_client ON platform_login_activity FOR ALL USING (false);

-- ============================================================
-- 8. Helper: log platform audit (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION log_platform_audit(
  p_actor_id UUID,
  p_actor_email TEXT,
  p_actor_role TEXT,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT DEFAULT NULL,
  p_store_id UUID DEFAULT NULL,
  p_old_data JSONB DEFAULT NULL,
  p_new_data JSONB DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO platform_audit_logs (
    actor_id, actor_email, actor_role, action, resource_type, resource_id,
    store_id, old_data, new_data, ip_address, user_agent
  ) VALUES (
    p_actor_id, p_actor_email, p_actor_role, p_action, p_resource_type, p_resource_id,
    p_store_id, p_old_data, p_new_data, p_ip_address, p_user_agent
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 9. Extend store subscription (days/months/years)
-- ============================================================
CREATE OR REPLACE FUNCTION platform_extend_subscription(
  p_store_id UUID,
  p_days INTEGER DEFAULT 0,
  p_months INTEGER DEFAULT 0,
  p_years INTEGER DEFAULT 0,
  p_plan_slug TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_store stores%ROWTYPE;
  v_base TIMESTAMPTZ;
  v_new_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  v_base := COALESCE(v_store.subscription_ends_at, NOW());
  IF v_base < NOW() THEN v_base := NOW(); END IF;

  v_new_end := v_base
    + (COALESCE(p_days, 0) || ' days')::INTERVAL
    + (COALESCE(p_months, 0) || ' months')::INTERVAL
    + (COALESCE(p_years, 0) || ' years')::INTERVAL;

  UPDATE stores SET
    subscription_ends_at = v_new_end,
    subscription_status = 'active',
    is_active = true,
    subscription_plan = COALESCE(p_plan_slug, subscription_plan),
    frozen_at = NULL,
    freeze_reason = NULL,
    updated_at = NOW()
  WHERE id = p_store_id;

  RETURN jsonb_build_object(
    'store_id', p_store_id,
    'subscription_ends_at', v_new_end,
    'subscription_status', 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 10. Store usage stats (for detail page)
-- ============================================================
CREATE OR REPLACE FUNCTION platform_get_store_stats(p_store_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_products INTEGER;
  v_sales INTEGER;
  v_purchases INTEGER;
  v_invoices INTEGER;
  v_revenue DECIMAL(15,2);
  v_users INTEGER;
  v_ai_requests INTEGER;
  v_ai_tokens BIGINT;
  v_ai_cost DECIMAL(10,4);
BEGIN
  SELECT COUNT(*) INTO v_products FROM products WHERE store_id = p_store_id;
  SELECT COUNT(*) INTO v_sales FROM sales WHERE store_id = p_store_id;
  SELECT COUNT(*) INTO v_purchases FROM purchase_orders WHERE store_id = p_store_id;
  SELECT COUNT(*) INTO v_invoices FROM sales WHERE store_id = p_store_id AND sale_type = 'custom';
  SELECT COALESCE(SUM(total_amount), 0) INTO v_revenue FROM sales WHERE store_id = p_store_id AND status NOT IN ('cancelled', 'refunded');
  SELECT COUNT(*) INTO v_users FROM store_users WHERE store_id = p_store_id AND is_active = true;

  SELECT COUNT(*), COALESCE(SUM(tokens_used), 0), COALESCE(SUM(estimated_cost_usd), 0)
  INTO v_ai_requests, v_ai_tokens, v_ai_cost
  FROM ai_usage_logs
  WHERE store_id = p_store_id
    AND created_at >= date_trunc('month', NOW());

  RETURN jsonb_build_object(
    'products_count', v_products,
    'sales_count', v_sales,
    'purchases_count', v_purchases,
    'invoices_count', v_invoices,
    'revenue', v_revenue,
    'users_count', v_users,
    'ai_requests_month', v_ai_requests,
    'ai_tokens_month', v_ai_tokens,
    'ai_cost_month', v_ai_cost
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 11. Auto-expire stores (call via cron or on login)
-- ============================================================
CREATE OR REPLACE FUNCTION platform_expire_stores()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE stores SET
    subscription_status = 'expired',
    updated_at = NOW()
  WHERE subscription_status IN ('active', 'trial')
    AND is_active = true
    AND (
      (subscription_status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW())
      OR (subscription_status = 'active' AND subscription_ends_at IS NOT NULL AND subscription_ends_at < NOW())
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Create platform notifications for newly expired (last hour)
  INSERT INTO platform_notifications (type, severity, title, message, store_id, data)
  SELECT
    'store_expired',
    'warning',
    'Store subscription expired',
    s.name || ' subscription has expired.',
    s.id,
    jsonb_build_object('store_name', s.name, 'plan', s.subscription_plan)
  FROM stores s
  WHERE s.subscription_status = 'expired'
    AND s.updated_at >= NOW() - INTERVAL '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM platform_notifications pn
      WHERE pn.store_id = s.id AND pn.type = 'store_expired'
        AND pn.created_at >= NOW() - INTERVAL '24 hours'
    );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 12. Dashboard stats RPC
-- ============================================================
CREATE OR REPLACE FUNCTION platform_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
  v_total INTEGER;
  v_active INTEGER;
  v_trial INTEGER;
  v_expired INTEGER;
  v_suspended INTEGER;
  v_new_today INTEGER;
  v_users INTEGER;
  v_subscriptions INTEGER;
  v_revenue DECIMAL(15,2);
  v_ai_requests INTEGER;
  v_ai_tokens BIGINT;
BEGIN
  PERFORM platform_expire_stores();

  SELECT COUNT(*) INTO v_total FROM stores;
  SELECT COUNT(*) INTO v_active FROM stores WHERE subscription_status = 'active' AND is_active = true;
  SELECT COUNT(*) INTO v_trial FROM stores WHERE subscription_status = 'trial' AND is_active = true;
  SELECT COUNT(*) INTO v_expired FROM stores WHERE subscription_status = 'expired';
  SELECT COUNT(*) INTO v_suspended FROM stores WHERE subscription_status IN ('suspended', 'disabled') OR is_active = false;
  SELECT COUNT(*) INTO v_new_today FROM stores WHERE created_at >= date_trunc('day', NOW());
  SELECT COUNT(DISTINCT user_id) INTO v_users FROM store_users WHERE is_active = true;
  SELECT COUNT(*) INTO v_subscriptions FROM stores WHERE subscription_status = 'active';

  SELECT COALESCE(SUM(amount_usd), 0) INTO v_revenue
  FROM payment_transactions
  WHERE status = 'success'
    AND activated_at >= date_trunc('month', NOW());

  SELECT COUNT(*), COALESCE(SUM(tokens_used), 0)
  INTO v_ai_requests, v_ai_tokens
  FROM ai_usage_logs
  WHERE created_at >= date_trunc('month', NOW());

  RETURN jsonb_build_object(
    'total_stores', v_total,
    'active_stores', v_active,
    'trial_stores', v_trial,
    'expired_stores', v_expired,
    'suspended_stores', v_suspended,
    'new_stores_today', v_new_today,
    'total_users', v_users,
    'active_subscriptions', v_subscriptions,
    'monthly_revenue', v_revenue,
    'ai_requests_month', v_ai_requests,
    'ai_tokens_month', v_ai_tokens
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 13. Generate expiring-soon notifications
-- ============================================================
CREATE OR REPLACE FUNCTION platform_check_expiring_stores()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO platform_notifications (type, severity, title, message, store_id, data)
  SELECT
    'store_expiring',
    'info',
    'Store subscription expiring soon',
    s.name || ' expires on ' || to_char(COALESCE(s.subscription_ends_at, s.trial_ends_at), 'Mon DD, YYYY'),
    s.id,
    jsonb_build_object('expires_at', COALESCE(s.subscription_ends_at, s.trial_ends_at))
  FROM stores s
  WHERE s.subscription_status IN ('active', 'trial')
    AND s.is_active = true
    AND COALESCE(s.subscription_ends_at, s.trial_ends_at) BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM platform_notifications pn
      WHERE pn.store_id = s.id AND pn.type = 'store_expiring'
        AND pn.created_at >= NOW() - INTERVAL '7 days'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
