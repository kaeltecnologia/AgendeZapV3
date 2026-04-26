-- v4.18: add email + birth_date to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS birth_date DATE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_birth_date ON customers (birth_date) WHERE birth_date IS NOT NULL;
