-- Fix: restore DELETE permission for anon on appointments
-- The hardening migration (20260523000001) removed DELETE for anon but the app
-- uses anon key for all admin operations including appointment deletion.
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_appointments_delete" ON appointments;
CREATE POLICY "anon_appointments_delete" ON appointments FOR DELETE TO anon
  USING (tenant_id IS NOT NULL);
