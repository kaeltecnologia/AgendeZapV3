-- ================================================================
-- AgendeZap — Password Hashing com pgcrypto
-- Execute no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- Habilita pgcrypto, hasheia senhas existentes de tenants com bcrypt,
-- e atualiza as RPCs de login para comparar com crypt().
-- ================================================================

-- 1. Habilita extensão pgcrypto (necessária para crypt() e gen_salt())
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Hasheia senhas existentes de tenants (somente as que ainda estão em plaintext)
--    LENGTH < 60 garante que não re-hasheamos senhas já em formato bcrypt ($2a$...)
UPDATE tenants
SET password = crypt(password, gen_salt('bf', 10))
WHERE password IS NOT NULL
  AND password != ''
  AND LENGTH(password) < 60;

-- 3. Atualiza tenant_login para comparar com crypt()
CREATE OR REPLACE FUNCTION public.tenant_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t RECORD;
BEGIN
  SELECT id, nome, slug, email, phone, plan, status, mensalidade,
         evolution_instance, created_at, nicho, due_day, password
  INTO t
  FROM tenants
  WHERE (email = p_email OR slug = LOWER(SPLIT_PART(p_email, '@', 1)))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
  END IF;

  -- Aceita: sem senha configurada, OU senha bate com hash bcrypt
  IF NOT (
    t.password IS NULL OR
    t.password = '' OR
    t.password = crypt(p_password, t.password)
  ) THEN
    RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
  END IF;

  RETURN json_build_object(
    'id',                t.id,
    'name',              t.nome,
    'slug',              t.slug,
    'email',             t.email,
    'phone',             t.phone,
    'plan',              t.plan,
    'status',            t.status,
    'monthlyFee',        t.mensalidade,
    'evolution_instance', t.evolution_instance,
    'createdAt',         t.created_at,
    'nicho',             t.nicho,
    'due_day',           t.due_day
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_login(TEXT, TEXT) TO anon;

-- 4. Atualiza admin_login para suportar legado (plaintext) + bcrypt
--    Assim o admin_password em global_settings não quebra se ainda for plaintext.
--    Para hashear o admin_password manualmente, rodar:
--    UPDATE global_settings SET value = crypt(value, gen_salt('bf',10)) WHERE key = 'admin_password';
CREATE OR REPLACE FUNCTION public.admin_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stored_email TEXT;
  stored_pass  TEXT;
BEGIN
  SELECT value INTO stored_email FROM global_settings WHERE key = 'admin_email';
  SELECT value INTO stored_pass  FROM global_settings WHERE key = 'admin_password';

  IF stored_email IS NULL OR stored_pass IS NULL THEN
    RETURN json_build_object('error', 'Credenciais de admin não configuradas.');
  END IF;

  -- Suporta: plaintext legado OU hash bcrypt (detectado pelo prefixo $2)
  IF TRIM(p_email) = TRIM(stored_email) AND (
    TRIM(p_password) = TRIM(stored_pass) OR
    (LEFT(stored_pass, 2) = '$2' AND stored_pass = crypt(p_password, stored_pass))
  ) THEN
    RETURN json_build_object('success', true);
  END IF;

  RETURN json_build_object('error', 'Credenciais incorretas.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_login(TEXT, TEXT) TO anon;
