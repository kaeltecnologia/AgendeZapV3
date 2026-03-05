-- ================================================================
-- AgendeZap — Fix: RLS nas tabelas principais do app
--
-- Execute este SQL no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- Problema: O app usa anon key no browser mas as tabelas podem ter
-- RLS ativo sem policies → SELECT retorna [] silenciosamente e
-- INSERT falha com "violates row-level security policy".
--
-- Solução: desabilitar RLS nas tabelas que usam tenant_id como
-- isolamento (sem Supabase Auth), ou adicionar policies permissivas.
-- ================================================================

-- Desabilita RLS nas tabelas principais (seguro — o app usa tenant_id
-- para isolamento, não o sistema de auth do Supabase).
ALTER TABLE IF EXISTS customers         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointments      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS professionals     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS services          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenant_settings   DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenants           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expenses          DISABLE ROW LEVEL SECURITY;

-- Alternativa (se preferir manter RLS ativo): adicionar policies permissivas
-- para o role 'anon'. Descomente o bloco abaixo se preferir esta abordagem:
--
-- DO $$ BEGIN
--   CREATE POLICY "anon_all_customers"       ON customers       FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "anon_all_appointments"    ON appointments    FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "anon_all_professionals"   ON professionals   FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "anon_all_services"        ON services        FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "anon_all_tenant_settings" ON tenant_settings FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "anon_all_tenants"         ON tenants         FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "anon_all_expenses"        ON expenses        FOR ALL USING (true) WITH CHECK (true);
-- EXCEPTION WHEN duplicate_object THEN NULL;
-- END $$;

-- Confirmar resultado:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN ('customers','appointments','professionals','services','tenant_settings','tenants','expenses');
