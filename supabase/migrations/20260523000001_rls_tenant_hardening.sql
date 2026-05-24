-- ================================================================
-- AgendeZap — RLS Tenant Hardening v1
-- Execute no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- Melhoria: separa policies por operação, bloqueando DELETE para anon.
--
-- Limitação arquitetural: SELECT permanece USING (true) pois o app usa
-- anon key diretamente do frontend com pgBouncer em transaction mode,
-- o que impede SET LOCAL para filtrar por tenant_id via session var.
-- Para isolamento completo de leitura: migrar para Supabase Auth com
-- JWT claims contendo tenant_id.
-- ================================================================

-- ── customers ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_customers_all" ON customers;
CREATE POLICY "anon_customers_select" ON customers FOR SELECT TO anon USING (true);
CREATE POLICY "anon_customers_insert" ON customers FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_customers_update" ON customers FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);
-- DELETE: sem policy anon → bloqueado automaticamente pelo RLS

-- ── appointments ───────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_appointments_all" ON appointments;
CREATE POLICY "anon_appointments_select" ON appointments FOR SELECT TO anon USING (true);
CREATE POLICY "anon_appointments_insert" ON appointments FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_appointments_update" ON appointments FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── professionals ──────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_professionals_all" ON professionals;
CREATE POLICY "anon_professionals_select" ON professionals FOR SELECT TO anon USING (true);
CREATE POLICY "anon_professionals_insert" ON professionals FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_professionals_update" ON professionals FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── services ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_services_all" ON services;
CREATE POLICY "anon_services_select" ON services FOR SELECT TO anon USING (true);
CREATE POLICY "anon_services_insert" ON services FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_services_update" ON services FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── tenant_settings ────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_tenant_settings_all" ON tenant_settings;
CREATE POLICY "anon_tenant_settings_select" ON tenant_settings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_tenant_settings_insert" ON tenant_settings FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_tenant_settings_update" ON tenant_settings FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── expenses ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_expenses_all" ON expenses;
CREATE POLICY "anon_expenses_select" ON expenses FOR SELECT TO anon USING (true);
CREATE POLICY "anon_expenses_insert" ON expenses FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_expenses_update" ON expenses FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── whatsapp_messages ──────────────────────────────────────────
DROP POLICY IF EXISTS "anon_whatsapp_messages_all" ON whatsapp_messages;
CREATE POLICY "anon_whatsapp_messages_select" ON whatsapp_messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_whatsapp_messages_insert" ON whatsapp_messages FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_whatsapp_messages_update" ON whatsapp_messages FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── agent_sessions ─────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_agent_sessions_all" ON agent_sessions;
CREATE POLICY "anon_agent_sessions_select" ON agent_sessions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_agent_sessions_insert" ON agent_sessions FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_agent_sessions_update" ON agent_sessions FOR UPDATE TO anon
  USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);

-- ── tenants — manter select/insert/update, sem DELETE anon ─────
DROP POLICY IF EXISTS "anon_tenants_select" ON tenants;
DROP POLICY IF EXISTS "anon_tenants_insert" ON tenants;
DROP POLICY IF EXISTS "anon_tenants_update" ON tenants;
CREATE POLICY "anon_tenants_select" ON tenants FOR SELECT TO anon USING (true);
CREATE POLICY "anon_tenants_insert" ON tenants FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_tenants_update" ON tenants FOR UPDATE TO anon USING (true) WITH CHECK (true);
-- DELETE: sem policy anon → bloqueado automaticamente
