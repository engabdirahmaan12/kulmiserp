-- KULMIS ERP: New tables and idempotent policy additions

-- billing_payments table for Somali payment gateways
CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL CHECK (gateway IN ('waafi', 'evc', 'sahal', 'zaad')),
  phone_number TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  plan TEXT NOT NULL,
  months INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  transaction_ref TEXT UNIQUE,
  gateway_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "billing_payments_owner_select" ON billing_payments
    FOR SELECT USING (
      store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
      OR
      store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND role IN ('owner', 'manager'))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "billing_payments_owner_insert" ON billing_payments
    FOR INSERT WITH CHECK (
      store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
      OR
      store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND role IN ('owner'))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "billing_payments_owner_update" ON billing_payments
    FOR UPDATE USING (
      store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- updated_at trigger for billing_payments
DROP TRIGGER IF EXISTS update_billing_payments_updated_at ON billing_payments;
CREATE TRIGGER update_billing_payments_updated_at
  BEFORE UPDATE ON billing_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
