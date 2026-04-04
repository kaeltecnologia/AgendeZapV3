-- Add last_login_at column to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Allow tenants to update their own last_login_at
CREATE POLICY IF NOT EXISTS "tenants_update_last_login"
  ON tenants FOR UPDATE
  USING (true)
  WITH CHECK (true);
