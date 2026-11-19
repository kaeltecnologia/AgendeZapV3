-- ================================================================
-- AgendeZap — Etapa 1 de segurança: credenciais fora do alcance da anon key
-- Execute no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- PRÉ-REQUISITO: o frontend com o commit "segurança etapa 1" já precisa estar
-- publicado (ele remove o fallback de login que compara senha no navegador).
--
-- O que faz:
--   1. Cria o schema `private` (não exposto pela API REST).
--   2. Move as senhas de tenants, affiliate_links e do superadmin para lá, em bcrypt.
--   3. Triggers: qualquer senha gravada em tenants/affiliate_links (cadastro,
--      revenda, edição no admin) é hasheada e guardada em private; a coluna
--      pública fica sempre NULL. As telas continuam funcionando sem mudança.
--   4. global_settings: anon não consegue mais gravar admin_email/admin_password.
--   5. RPCs: tenant_login, admin_login (reescritas), affiliate_login e
--      admin_update_credentials (novas).
--
-- Tudo roda numa transação: se qualquer passo falhar, nada é aplicado.
-- Rollback: 20261119000001_private_credentials_ROLLBACK.sql
-- ================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Schema privado ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.tenant_credentials (
  tenant_id     TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.affiliate_credentials (
  affiliate_id  TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.admin_credentials (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- Hash idempotente: se já é bcrypt, mantém; senão, gera bcrypt.
CREATE OR REPLACE FUNCTION private.hash_pw(p TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN p ~ '^\$2[aby]\$[0-9]{2}\$.{53}$' THEN p
    ELSE crypt(p, gen_salt('bf', 10))
  END
$$;

-- ── 2. Migra senhas existentes ────────────────────────────────────
INSERT INTO private.tenant_credentials (tenant_id, password_hash)
SELECT id::text, private.hash_pw(password)
FROM public.tenants
WHERE password IS NOT NULL AND password <> ''
ON CONFLICT (tenant_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();

INSERT INTO private.affiliate_credentials (affiliate_id, password_hash)
SELECT id::text, private.hash_pw(password)
FROM public.affiliate_links
WHERE password IS NOT NULL AND password <> ''
ON CONFLICT (affiliate_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();

INSERT INTO private.admin_credentials (id, email, password_hash)
SELECT 1,
       btrim((SELECT value FROM public.global_settings WHERE key = 'admin_email')),
       private.hash_pw(btrim((SELECT value FROM public.global_settings WHERE key = 'admin_password')))
WHERE EXISTS (SELECT 1 FROM public.global_settings WHERE key = 'admin_password' AND coalesce(value, '') <> '')
  AND EXISTS (SELECT 1 FROM public.global_settings WHERE key = 'admin_email'    AND coalesce(value, '') <> '')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, updated_at = now();

-- Segurança: aborta se o admin não foi migrado (evita ficar sem acesso).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.admin_credentials WHERE id = 1) THEN
    RAISE EXCEPTION 'admin_credentials vazio — migração abortada, nada foi alterado.';
  END IF;
END $$;

-- Limpa as cópias públicas
UPDATE public.tenants         SET password = NULL WHERE password IS NOT NULL;
UPDATE public.affiliate_links SET password = NULL WHERE password IS NOT NULL;
DELETE FROM public.global_settings WHERE key = 'admin_password';

-- ── 3. Triggers de captura de senha ───────────────────────────────
CREATE OR REPLACE FUNCTION private.tenants_capture_password()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.password IS NOT NULL AND NEW.password <> '' THEN
    INSERT INTO private.tenant_credentials (tenant_id, password_hash, updated_at)
    VALUES (NEW.id::text, private.hash_pw(NEW.password), now())
    ON CONFLICT (tenant_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();
  END IF;
  NEW.password := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_capture_password ON public.tenants;
CREATE TRIGGER trg_tenants_capture_password
  BEFORE INSERT OR UPDATE OF password ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION private.tenants_capture_password();

CREATE OR REPLACE FUNCTION private.affiliates_capture_password()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.password IS NOT NULL AND NEW.password <> '' THEN
    INSERT INTO private.affiliate_credentials (affiliate_id, password_hash, updated_at)
    VALUES (NEW.id::text, private.hash_pw(NEW.password), now())
    ON CONFLICT (affiliate_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();
  END IF;
  NEW.password := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_affiliates_capture_password ON public.affiliate_links;
CREATE TRIGGER trg_affiliates_capture_password
  BEFORE INSERT OR UPDATE OF password ON public.affiliate_links
  FOR EACH ROW EXECUTE FUNCTION private.affiliates_capture_password();

-- Limpa credenciais órfãs quando o registro é apagado (service role / admin)
CREATE OR REPLACE FUNCTION private.cleanup_credentials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    DELETE FROM private.tenant_credentials WHERE tenant_id = OLD.id::text;
  ELSE
    DELETE FROM private.affiliate_credentials WHERE affiliate_id = OLD.id::text;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_cleanup_credentials ON public.tenants;
CREATE TRIGGER trg_tenants_cleanup_credentials
  AFTER DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION private.cleanup_credentials();

DROP TRIGGER IF EXISTS trg_affiliates_cleanup_credentials ON public.affiliate_links;
CREATE TRIGGER trg_affiliates_cleanup_credentials
  AFTER DELETE ON public.affiliate_links
  FOR EACH ROW EXECUTE FUNCTION private.cleanup_credentials();

-- ── 4. global_settings: credenciais do admin só via RPC ───────────
-- Para anon/authenticated, gravações em admin_email/admin_password são
-- ignoradas em silêncio (não quebra o upsert das outras chaves).
CREATE OR REPLACE FUNCTION private.global_settings_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NEW.key IN ('admin_password', 'admin_email') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_global_settings_guard ON public.global_settings;
CREATE TRIGGER trg_global_settings_guard
  BEFORE INSERT OR UPDATE ON public.global_settings
  FOR EACH ROW EXECUTE FUNCTION private.global_settings_guard();

-- ── 5. RPCs de login ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  t RECORD;
BEGIN
  IF coalesce(p_password, '') = '' OR coalesce(btrim(p_email), '') = '' THEN
    RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
  END IF;

  -- Pode haver mais de um candidato (e-mail de um, slug de outro): vale o que bater a senha.
  FOR t IN
    SELECT tt.id, tt.nome, tt.slug, tt.email, tt.phone, tt.plan, tt.status, tt.mensalidade,
           tt.evolution_instance, tt.created_at, tt.nicho, tt.due_day, c.password_hash
    FROM tenants tt
    JOIN private.tenant_credentials c ON c.tenant_id = tt.id::text
    WHERE lower(tt.email) = lower(btrim(p_email))
       OR tt.slug = lower(split_part(btrim(p_email), '@', 1))
  LOOP
    IF t.password_hash = crypt(p_password, t.password_hash) THEN
      RETURN json_build_object(
        'id',                 t.id,
        'name',               t.nome,
        'slug',               t.slug,
        'email',              t.email,
        'phone',              t.phone,
        'plan',               t.plan,
        'status',             t.status,
        'monthlyFee',         t.mensalidade,
        'evolution_instance', t.evolution_instance,
        'createdAt',          t.created_at,
        'nicho',              t.nicho,
        'due_day',            t.due_day
      );
    END IF;
  END LOOP;

  RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
END $$;

GRANT EXECUTE ON FUNCTION public.tenant_login(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT email, password_hash INTO a FROM private.admin_credentials WHERE id = 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Credenciais de admin não configuradas.');
  END IF;

  IF coalesce(p_password, '') <> ''
     AND lower(btrim(p_email)) = lower(btrim(a.email))
     AND a.password_hash = crypt(p_password, a.password_hash) THEN
    RETURN json_build_object('success', true);
  END IF;

  RETURN json_build_object('error', 'Credenciais incorretas.');
END $$;

GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon, authenticated;

-- Troca de e-mail/senha do superadmin (exige a senha atual)
CREATE OR REPLACE FUNCTION public.admin_update_credentials(
  p_current_email TEXT, p_current_password TEXT, p_new_email TEXT, p_new_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT email, password_hash INTO a FROM private.admin_credentials WHERE id = 1;
  IF NOT FOUND
     OR coalesce(p_current_password, '') = ''
     OR lower(btrim(p_current_email)) <> lower(btrim(a.email))
     OR a.password_hash <> crypt(p_current_password, a.password_hash) THEN
    RETURN json_build_object('error', 'E-mail ou senha atual incorretos.');
  END IF;

  IF coalesce(btrim(p_new_email), '') = '' THEN
    RETURN json_build_object('error', 'Informe o novo e-mail.');
  END IF;
  IF coalesce(p_new_password, '') <> '' AND length(p_new_password) < 8 THEN
    RETURN json_build_object('error', 'A nova senha deve ter no mínimo 8 caracteres.');
  END IF;

  UPDATE private.admin_credentials
  SET email         = btrim(p_new_email),
      password_hash = CASE WHEN coalesce(p_new_password, '') <> ''
                           THEN crypt(p_new_password, gen_salt('bf', 10))
                           ELSE password_hash END,
      updated_at    = now()
  WHERE id = 1;

  -- cópia só para exibição no painel (nunca usada para autenticar)
  INSERT INTO global_settings (key, value) VALUES ('admin_email', btrim(p_new_email))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RETURN json_build_object('success', true);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_update_credentials(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.affiliate_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  IF coalesce(p_password, '') = '' OR coalesce(btrim(p_email), '') = '' THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT a.id, a.name, a.slug, a.phone, a.email, a.commission_percent,
           a.indirect_commission_percent, a.active, a.created_at, c.password_hash
    FROM affiliate_links a
    JOIN private.affiliate_credentials c ON c.affiliate_id = a.id::text
    WHERE lower(a.email) = lower(btrim(p_email)) AND a.active = true
  LOOP
    IF r.password_hash = crypt(p_password, r.password_hash) THEN
      RETURN json_build_object(
        'id',                          r.id,
        'name',                        r.name,
        'slug',                        r.slug,
        'phone',                       r.phone,
        'email',                       r.email,
        'commission_percent',          r.commission_percent,
        'indirect_commission_percent', r.indirect_commission_percent,
        'active',                      r.active,
        'created_at',                  r.created_at
      );
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.affiliate_login(TEXT, TEXT) TO anon, authenticated;

-- Funções do schema private não podem ser chamadas pela API
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── Verificação (rode depois do COMMIT; todos devem bater) ────────
-- SELECT
--   (SELECT count(*) FROM public.tenants WHERE password IS NOT NULL)          AS tenants_com_senha_publica,   -- esperado 0
--   (SELECT count(*) FROM public.affiliate_links WHERE password IS NOT NULL)  AS afiliados_com_senha_publica, -- esperado 0
--   (SELECT count(*) FROM public.global_settings WHERE key='admin_password')  AS admin_pw_publico,            -- esperado 0
--   (SELECT count(*) FROM private.tenant_credentials)                         AS tenants_migrados,            -- esperado 106
--   (SELECT count(*) FROM private.affiliate_credentials)                      AS afiliados_migrados,          -- esperado 7
--   (SELECT count(*) FROM private.admin_credentials)                          AS admin_migrado;               -- esperado 1
