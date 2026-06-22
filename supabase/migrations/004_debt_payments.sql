-- Debt payments tracking table
CREATE TABLE IF NOT EXISTS debt_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount DECIMAL(15,2) NOT NULL,
  payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'waafi', 'evc', 'sahal', 'zaad')),
  notes TEXT,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "debt_payments_store_access" ON debt_payments
  FOR ALL
  USING (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (store_id IN (SELECT store_id FROM store_users WHERE user_id = auth.uid() AND is_active = true));

-- Index
CREATE INDEX IF NOT EXISTS idx_debt_payments_store_id ON debt_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_customer_id ON debt_payments(customer_id);

-- Updated_at trigger
CREATE TRIGGER update_debt_payments_updated_at
  BEFORE UPDATE ON debt_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
