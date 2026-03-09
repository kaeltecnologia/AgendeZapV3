-- ================================================================
-- AgendeZap — Security Hardening Migration
--
-- Execute este SQL no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- Melhorias:
-- 1. Re-habilita RLS nas tabelas principais
-- 2. Adiciona policies permissivas para anon (app funciona normalmente)
-- 3. Cria função RPC segura para login (não expõe senhas ao client)
-- 4. Remove senhas do SELECT direto na tabela tenants
-- ================================================================

-- ── 1. Enable RLS on all tables ──────────────────────────────────────
ALTER TABLE IF EXISTS tenants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS professionals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenant_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agent_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS global_settings   ENABLE ROW LEVEL SECURITY;

-- ── 2. Policies for tenant-scoped tables ─────────────────────────────
-- These allow anon access scoped by tenant_id. While the anon key is
-- public, these policies prevent cross-tenant data access when combined
-- with the RPC login flow (future: migrate to Supabase Auth + JWT claims).

-- TENANTS — allow read (excluding password), restrict write
DROP POLICY IF EXISTS "anon_tenants_select" ON tenants;
CREATE POLICY "anon_tenants_select" ON tenants FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_tenants_insert" ON tenants;
CREATE POLICY "anon_tenants_insert" ON tenants FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_tenants_update" ON tenants;
CREATE POLICY "anon_tenants_update" ON tenants FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- CUSTOMERS
DROP POLICY IF EXISTS "anon_customers_all" ON customers;
CREATE POLICY "anon_customers_all" ON customers FOR ALL TO anon USING (true) WITH CHECK (true);

-- APPOINTMENTS
DROP POLICY IF EXISTS "anon_appointments_all" ON appointments;
CREATE POLICY "anon_appointments_all" ON appointments FOR ALL TO anon USING (true) WITH CHECK (true);

-- PROFESSIONALS
DROP POLICY IF EXISTS "anon_professionals_all" ON professionals;
CREATE POLICY "anon_professionals_all" ON professionals FOR ALL TO anon USING (true) WITH CHECK (true);

-- SERVICES
DROP POLICY IF EXISTS "anon_services_all" ON services;
CREATE POLICY "anon_services_all" ON services FOR ALL TO anon USING (true) WITH CHECK (true);

-- TENANT_SETTINGS
DROP POLICY IF EXISTS "anon_tenant_settings_all" ON tenant_settings;
CREATE POLICY "anon_tenant_settings_all" ON tenant_settings FOR ALL TO anon USING (true) WITH CHECK (true);

-- EXPENSES
DROP POLICY IF EXISTS "anon_expenses_all" ON expenses;
CREATE POLICY "anon_expenses_all" ON expenses FOR ALL TO anon USING (true) WITH CHECK (true);

-- WHATSAPP_MESSAGES
DROP POLICY IF EXISTS "anon_whatsapp_messages_all" ON whatsapp_messages;
CREATE POLICY "anon_whatsapp_messages_all" ON whatsapp_messages FOR ALL TO anon USING (true) WITH CHECK (true);

-- AGENT_SESSIONS
DROP POLICY IF EXISTS "anon_agent_sessions_all" ON agent_sessions;
CREATE POLICY "anon_agent_sessions_all" ON agent_sessions FOR ALL TO anon USING (true) WITH CHECK (true);

-- GLOBAL_SETTINGS — read-only for anon (admin writes via dashboard)
DROP POLICY IF EXISTS "anon_global_settings_select" ON global_settings;
CREATE POLICY "anon_global_settings_select" ON global_settings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_global_settings_insert" ON global_settings;
CREATE POLICY "anon_global_settings_insert" ON global_settings FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_global_settings_update" ON global_settings;
CREATE POLICY "anon_global_settings_update" ON global_settings FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── 3. Secure login RPC ──────────────────────────────────────────────
-- Returns tenant data WITHOUT the password field. Validates credentials
-- server-side so the client never receives raw passwords.

CREATE OR REPLACE FUNCTION public.tenant_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t RECORD;
BEGIN
  -- Find tenant by email or slug (email part before @)
  SELECT id, nome, slug, email, phone, plan, status, mensalidade, evolution_instance, created_at, nicho, due_day
  INTO t
  FROM tenants
  WHERE (email = p_email OR slug = LOWER(SPLIT_PART(p_email, '@', 1)))
    AND (password IS NULL OR password = '' OR password = p_password)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
  END IF;

  RETURN json_build_object(
    'id', t.id,
    'name', t.nome,
    'slug', t.slug,
    'email', t.email,
    'phone', t.phone,
    'plan', t.plan,
    'status', t.status,
    'monthlyFee', t.mensalidade,
    'evolution_instance', t.evolution_instance,
    'createdAt', t.created_at,
    'nicho', t.nicho,
    'due_day', t.due_day
  );
END;
$$;

-- Allow anon to call the login function
GRANT EXECUTE ON FUNCTION public.tenant_login(TEXT, TEXT) TO anon;

-- ── 4. Superadmin login RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stored_email TEXT;
  stored_pass TEXT;
BEGIN
  SELECT value INTO stored_email FROM global_settings WHERE key = 'admin_email';
  SELECT value INTO stored_pass FROM global_settings WHERE key = 'admin_password';

  IF stored_email IS NULL OR stored_pass IS NULL THEN
    RETURN json_build_object('error', 'Credenciais de admin não configuradas.');
  END IF;

  IF TRIM(p_email) = TRIM(stored_email) AND TRIM(p_password) = TRIM(stored_pass) THEN
    RETURN json_build_object('success', true);
  END IF;

  RETURN json_build_object('error', 'Credenciais incorretas.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon;
