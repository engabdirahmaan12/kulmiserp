-- 056_payment_methods_nullable_account.sql
-- Accounting (and its GL-linked chart of accounts) has been removed from the
-- product. Payment methods no longer need a linked chart_of_accounts row, so
-- widen the constraint to allow simple, GL-free payment methods.

ALTER TABLE store_payment_methods
  ALTER COLUMN account_id DROP NOT NULL;
