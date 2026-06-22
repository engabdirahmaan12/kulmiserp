-- Payment security hardening: no activation without verified WAAFI response

-- ============================================================
-- 1. Gateway response storage (status → verifying, NOT success)
-- ============================================================
CREATE OR REPLACE FUNCTION store_payment_gateway_response(
  p_transaction_id      UUID,
  p_provider_tx_id      TEXT,
  p_provider_status     TEXT,
  p_amount_reported_usd DECIMAL,
  p_gateway_response    JSONB DEFAULT '{}'
) RETURNS JSONB AS $$
DECLARE
  v_tx RECORD;
BEGIN
  SELECT * INTO v_tx FROM payment_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  IF v_tx.status IN ('success', 'failed', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction already finalized');
  END IF;

  IF p_provider_tx_id IS NULL OR length(trim(p_provider_tx_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing provider transaction ID');
  END IF;

  IF upper(p_provider_status) <> 'APPROVED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gateway status is not APPROVED');
  END IF;

  UPDATE payment_transactions SET
    status = 'verifying',
    provider_transaction_id = p_provider_tx_id,
    provider_status = upper(p_provider_status),
    amount_verified_usd = p_amount_reported_usd,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object('success', true, 'status', 'verifying');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Audit log helper (service role only)
-- ============================================================
CREATE OR REPLACE FUNCTION record_payment_audit(
  p_transaction_id UUID,
  p_store_id       UUID,
  p_user_id        UUID,
  p_event          TEXT,
  p_details        JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
  VALUES (p_transaction_id, p_store_id, p_user_id, p_event, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Stricter activation — ONLY when verifying + APPROVED + amount + tx id
-- ============================================================
CREATE OR REPLACE FUNCTION activate_subscription_after_payment(
  p_transaction_id      UUID,
  p_provider_tx_id      TEXT,
  p_provider_status     TEXT,
  p_amount_verified_usd DECIMAL
) RETURNS JSONB AS $$
DECLARE
  v_tx RECORD;
  v_sub_ends_at TIMESTAMPTZ;
  v_expected_amount DECIMAL;
BEGIN
  SELECT * INTO v_tx FROM payment_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  -- Idempotent: already activated
  IF v_tx.status = 'success' THEN
    RETURN jsonb_build_object(
      'success', true,
      'plan', v_tx.plan_id,
      'subscription_ends_at', (SELECT subscription_ends_at FROM stores WHERE id = v_tx.store_id)
    );
  END IF;

  IF v_tx.status IN ('failed', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction already finalized', 'status', v_tx.status);
  END IF;

  -- Must have gone through gateway verification step
  IF v_tx.status NOT IN ('verifying', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not ready for activation');
  END IF;

  -- Strict gateway checks
  IF upper(coalesce(p_provider_status, '')) <> 'APPROVED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not approved by gateway');
  END IF;

  IF p_provider_tx_id IS NULL OR length(trim(p_provider_tx_id)) = 0 OR p_provider_tx_id LIKE 'TEST-%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid provider transaction ID');
  END IF;

  IF v_tx.provider_transaction_id IS NOT NULL AND v_tx.provider_transaction_id <> p_provider_tx_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider transaction ID mismatch');
  END IF;

  v_expected_amount := v_tx.amount_usd * v_tx.months;
  IF p_amount_verified_usd IS NULL OR p_amount_verified_usd < (v_expected_amount * 0.99) THEN
    UPDATE payment_transactions SET
      status = 'failed',
      failure_reason = 'Amount mismatch: expected ' || v_expected_amount || ', got ' || coalesce(p_amount_verified_usd::text, 'null'),
      updated_at = NOW()
    WHERE id = p_transaction_id;

    INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
    VALUES (p_transaction_id, v_tx.store_id, v_tx.user_id, 'payment_failed', jsonb_build_object(
      'reason', 'amount_mismatch', 'expected', v_expected_amount, 'received', p_amount_verified_usd
    ));

    RETURN jsonb_build_object('success', false, 'error', 'Payment amount does not match plan price');
  END IF;

  UPDATE payment_transactions SET
    status = 'success',
    provider_transaction_id = p_provider_tx_id,
    provider_status = 'APPROVED',
    amount_verified_usd = p_amount_verified_usd,
    verified_at = NOW(),
    activated_at = NOW(),
    updated_at = NOW()
  WHERE id = p_transaction_id;

  v_sub_ends_at := NOW() + (v_tx.months || ' months')::INTERVAL;

  UPDATE stores SET
    subscription_status = 'active',
    subscription_plan = v_tx.plan_id,
    subscription_ends_at = v_sub_ends_at,
    updated_at = NOW()
  WHERE id = v_tx.store_id;

  INSERT INTO billing_payments (store_id, gateway, phone_number, amount, currency, plan, months, status, transaction_ref, gateway_ref)
  VALUES (v_tx.store_id, v_tx.provider, v_tx.phone_number, v_expected_amount, 'USD',
          v_tx.plan_id, v_tx.months, 'completed', v_tx.merchant_reference, p_provider_tx_id)
  ON CONFLICT (transaction_ref) DO UPDATE SET
    status = 'completed',
    gateway_ref = EXCLUDED.gateway_ref,
    updated_at = NOW();

  INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
  VALUES (p_transaction_id, v_tx.store_id, v_tx.user_id, 'subscription_activated', jsonb_build_object(
    'plan', v_tx.plan_id,
    'months', v_tx.months,
    'subscription_ends_at', v_sub_ends_at,
    'provider_tx_id', p_provider_tx_id,
    'amount_verified', p_amount_verified_usd
  ));

  RETURN jsonb_build_object(
    'success', true,
    'subscription_ends_at', v_sub_ends_at,
    'plan', v_tx.plan_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Prevent authenticated users from changing subscription fields directly
CREATE OR REPLACE FUNCTION prevent_client_subscription_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role / postgres / SECURITY DEFINER paths have no auth.uid()
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
     OR NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at THEN
    RAISE EXCEPTION 'Subscription changes require verified payment';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_client_subscription_update ON stores;
CREATE TRIGGER trg_prevent_client_subscription_update
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION prevent_client_subscription_update();
