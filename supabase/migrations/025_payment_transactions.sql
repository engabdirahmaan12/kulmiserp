-- Secure Payment Transactions System
-- All subscription activation MUST go through this table + verified RPC only.

-- ============================================================
-- 1. payment_transactions table
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id               TEXT NOT NULL,               -- 'basic' | 'business' | 'enterprise'
  months                SMALLINT NOT NULL DEFAULT 1,
  amount_usd            DECIMAL(10,2) NOT NULL,
  provider              TEXT NOT NULL,               -- 'waafi' | 'evc' | 'sahal' | 'zaad'
  phone_number          TEXT NOT NULL,
  merchant_reference    TEXT NOT NULL UNIQUE,        -- our internal reference sent to provider
  provider_transaction_id TEXT,                      -- returned by provider after initiation
  provider_status       TEXT,                        -- raw status from provider API
  status                TEXT NOT NULL DEFAULT 'initiated'
                          CHECK (status IN ('initiated','pending','verifying','success','failed','expired','cancelled')),
  failure_reason        TEXT,
  amount_verified_usd   DECIMAL(10,2),               -- amount confirmed by provider
  initiated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at           TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_store ON payment_transactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_tx_merchant_ref ON payment_transactions(merchant_reference);
CREATE INDEX IF NOT EXISTS idx_payment_tx_status ON payment_transactions(status, created_at DESC);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own store's transactions
CREATE POLICY payment_tx_select ON payment_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = payment_transactions.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
    )
  );

-- No direct INSERT/UPDATE/DELETE — all writes go through SECURITY DEFINER RPCs
CREATE POLICY payment_tx_no_insert ON payment_transactions FOR INSERT WITH CHECK (false);
CREATE POLICY payment_tx_no_update ON payment_transactions FOR UPDATE USING (false);
CREATE POLICY payment_tx_no_delete ON payment_transactions FOR DELETE USING (false);

-- ============================================================
-- 2. payment_audit_log table
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID REFERENCES payment_transactions(id) ON DELETE SET NULL,
  store_id        UUID NOT NULL,
  user_id         UUID,
  event           TEXT NOT NULL,  -- 'payment_requested' | 'payment_verified' | 'payment_failed' | 'subscription_activated'
  details         JSONB NOT NULL DEFAULT '{}',
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_store ON payment_audit_log(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_audit_tx ON payment_audit_log(transaction_id);

ALTER TABLE payment_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_audit_select ON payment_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM store_users su
      WHERE su.store_id = payment_audit_log.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
        AND su.role IN ('owner', 'manager')
    )
  );

CREATE POLICY payment_audit_no_write ON payment_audit_log
  FOR ALL WITH CHECK (false);

-- ============================================================
-- 3. RPC: initiate_payment_transaction (creates record, returns merchant ref)
-- ============================================================
CREATE OR REPLACE FUNCTION initiate_payment_transaction(
  p_store_id     UUID,
  p_user_id      UUID,
  p_plan_id      TEXT,
  p_months       SMALLINT,
  p_amount_usd   DECIMAL,
  p_provider     TEXT,
  p_phone_number TEXT
) RETURNS JSONB AS $$
DECLARE
  v_tx_id UUID;
  v_merchant_ref TEXT;
  v_attempt INT := 0;
BEGIN
  -- Verify caller belongs to the store as owner/manager
  IF NOT EXISTS (
    SELECT 1 FROM store_users
    WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
      AND role IN ('owner', 'manager')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Validate plan
  IF p_plan_id NOT IN ('basic', 'business', 'enterprise') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid plan');
  END IF;

  -- Validate provider
  IF p_provider NOT IN ('waafi', 'evc', 'sahal', 'zaad') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid payment provider');
  END IF;

  -- Validate amount
  IF p_amount_usd <= 0 OR p_amount_usd > 10000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  -- Validate months
  IF p_months < 1 OR p_months > 24 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid months');
  END IF;

  -- Check for a pending transaction in last 5 minutes (prevent spam)
  IF EXISTS (
    SELECT 1 FROM payment_transactions
    WHERE store_id = p_store_id
      AND status IN ('initiated', 'pending', 'verifying')
      AND initiated_at > NOW() - INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A payment is already in progress. Please wait before retrying.');
  END IF;

  -- Generate unique merchant reference
  LOOP
    v_merchant_ref := 'KLMS-' || to_char(NOW(), 'YYMMDD') || '-'
                   || upper(substring(encode(gen_random_bytes(4), 'hex'), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM payment_transactions WHERE merchant_reference = v_merchant_ref);
    v_attempt := v_attempt + 1;
    IF v_attempt > 5 THEN RAISE EXCEPTION 'Could not generate unique reference'; END IF;
  END LOOP;

  -- Insert transaction record (status = initiated)
  INSERT INTO payment_transactions (
    store_id, user_id, plan_id, months, amount_usd,
    provider, phone_number, merchant_reference, status
  ) VALUES (
    p_store_id, p_user_id, p_plan_id, p_months, p_amount_usd,
    p_provider, p_phone_number, v_merchant_ref, 'initiated'
  ) RETURNING id INTO v_tx_id;

  -- Audit log
  INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
  VALUES (v_tx_id, p_store_id, p_user_id, 'payment_requested', jsonb_build_object(
    'plan', p_plan_id, 'months', p_months, 'amount', p_amount_usd,
    'provider', p_provider, 'merchant_reference', v_merchant_ref
  ));

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'merchant_reference', v_merchant_ref
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. RPC: activate_subscription_after_payment (ONLY callable from service role)
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
  -- Lock the transaction row
  SELECT * INTO v_tx FROM payment_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  -- Must not already be processed
  IF v_tx.status IN ('success', 'failed', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction already finalized', 'status', v_tx.status);
  END IF;

  -- Verify amount matches (allow 1% tolerance for currency rounding)
  v_expected_amount := v_tx.amount_usd * v_tx.months;
  IF p_amount_verified_usd < (v_expected_amount * 0.99) THEN
    UPDATE payment_transactions SET
      status = 'failed',
      provider_transaction_id = p_provider_tx_id,
      provider_status = p_provider_status,
      amount_verified_usd = p_amount_verified_usd,
      failure_reason = 'Amount mismatch: expected ' || v_expected_amount || ', got ' || p_amount_verified_usd,
      updated_at = NOW()
    WHERE id = p_transaction_id;

    INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
    VALUES (p_transaction_id, v_tx.store_id, v_tx.user_id, 'payment_failed', jsonb_build_object(
      'reason', 'amount_mismatch', 'expected', v_expected_amount, 'received', p_amount_verified_usd
    ));

    RETURN jsonb_build_object('success', false, 'error', 'Payment amount does not match');
  END IF;

  -- Mark transaction as success
  UPDATE payment_transactions SET
    status = 'success',
    provider_transaction_id = p_provider_tx_id,
    provider_status = p_provider_status,
    amount_verified_usd = p_amount_verified_usd,
    verified_at = NOW(),
    activated_at = NOW(),
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- Calculate subscription end date
  v_sub_ends_at := NOW() + (v_tx.months || ' months')::INTERVAL;

  -- Activate subscription on store
  UPDATE stores SET
    subscription_status = 'active',
    subscription_plan = v_tx.plan_id,
    subscription_ends_at = v_sub_ends_at,
    updated_at = NOW()
  WHERE id = v_tx.store_id;

  -- Also keep billing_payments in sync for legacy queries
  INSERT INTO billing_payments (store_id, gateway, phone_number, amount, currency, plan, months, status, transaction_ref)
  VALUES (v_tx.store_id, v_tx.provider, v_tx.phone_number, v_tx.amount_usd, 'USD',
          v_tx.plan_id, v_tx.months, 'completed', v_tx.merchant_reference)
  ON CONFLICT (transaction_ref) DO UPDATE SET status = 'completed';

  -- Audit log
  INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
  VALUES (p_transaction_id, v_tx.store_id, v_tx.user_id, 'subscription_activated', jsonb_build_object(
    'plan', v_tx.plan_id, 'months', v_tx.months,
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

-- ============================================================
-- 5. RPC: fail_payment_transaction (called by backend on failure)
-- ============================================================
CREATE OR REPLACE FUNCTION fail_payment_transaction(
  p_transaction_id  UUID,
  p_provider_tx_id  TEXT,
  p_provider_status TEXT,
  p_reason          TEXT
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

  UPDATE payment_transactions SET
    status = CASE
      WHEN p_provider_status IN ('CANCELLED', 'USER_REJECTED') THEN 'cancelled'
      WHEN p_provider_status IN ('TIMEOUT', 'EXPIRED') THEN 'expired'
      ELSE 'failed'
    END,
    provider_transaction_id = p_provider_tx_id,
    provider_status = p_provider_status,
    failure_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  INSERT INTO payment_audit_log (transaction_id, store_id, user_id, event, details)
  VALUES (p_transaction_id, v_tx.store_id, v_tx.user_id, 'payment_failed', jsonb_build_object(
    'provider_status', p_provider_status, 'reason', p_reason
  ));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. Expire stale initiated transactions (> 10 minutes old)
-- ============================================================
CREATE OR REPLACE FUNCTION expire_stale_payment_transactions() RETURNS VOID AS $$
BEGIN
  UPDATE payment_transactions SET
    status = 'expired',
    failure_reason = 'Payment session expired — no response within 10 minutes',
    updated_at = NOW()
  WHERE status IN ('initiated', 'pending', 'verifying')
    AND initiated_at < NOW() - INTERVAL '10 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
