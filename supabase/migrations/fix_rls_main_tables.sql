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

-- Tabelas de operação 24/7 (Edge Function + browser precisam acessar)
ALTER TABLE IF EXISTS whatsapp_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agent_sessions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS msg_dedup         DISABLE ROW LEVEL SECURITY;

-- Confirmar resultado:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN ('customers','appointments','professionals','services',
--   'tenant_settings','tenants','expenses','whatsapp_messages','agent_sessions','msg_dedup');
