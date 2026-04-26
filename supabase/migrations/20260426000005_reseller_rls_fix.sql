-- v4.22 fix: allow anon key to write reseller_profiles
-- The frontend uses the anon key; service_role-only writes blocked the SuperAdmin UI.
DROP POLICY IF EXISTS "reseller_write_service" ON reseller_profiles;
DROP POLICY IF EXISTS "reseller_write_anon" ON reseller_profiles;

CREATE POLICY "reseller_write_anon" ON reseller_profiles
  FOR ALL USING (true) WITH CHECK (true);
