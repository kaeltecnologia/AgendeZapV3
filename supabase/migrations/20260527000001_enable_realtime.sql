-- Enable Supabase Realtime for tables that need cross-session sync.
-- Idempotent: catches "already in publication" errors silently.
DO $$
DECLARE
  tables text[] := ARRAY['appointments','tenant_settings','professionals','services','customers','tenants'];
  t text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- already in publication or table doesn't exist
    END;
  END LOOP;
END $$;
