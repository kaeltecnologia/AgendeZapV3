-- ================================================================
-- ROLLBACK da etapa 1 (20261119000001_private_credentials.sql)
-- Só use se algo der errado. Devolve os HASHES (bcrypt) para as colunas
-- públicas e restaura as RPCs anteriores. Senhas em texto puro não voltam
-- (e não devem voltar). Tenants e admin continuam logando (as RPCs antigas
-- já aceitavam bcrypt). Afiliados: o login antigo comparava texto puro,
-- então precisariam de senha redefinida no painel.
-- ================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_tenants_capture_password       ON public.tenants;
DROP TRIGGER IF EXISTS trg_affiliates_capture_password    ON public.affiliate_links;
DROP TRIGGER IF EXISTS trg_tenants_cleanup_credentials    ON public.tenants;
DROP TRIGGER IF EXISTS trg_affiliates_cleanup_credentials ON public.affiliate_links;
DROP TRIGGER IF EXISTS trg_global_settings_guard          ON public.global_settings;

UPDATE public.tenants t SET password = c.password_hash
FROM private.tenant_credentials c WHERE c.tenant_id = t.id::text;

UPDATE public.affiliate_links a SET password = c.password_hash
FROM private.affiliate_credentials c WHERE c.affiliate_id = a.id::text;

INSERT INTO public.global_settings (key, value)
SELECT 'admin_password', password_hash FROM private.admin_credentials WHERE id = 1
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- RPCs anteriores (iguais a 20260523000002_password_hashing.sql)
CREATE OR REPLACE FUNCTION public.tenant_login(p_email TEXT, p_password TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE t RECORD;
BEGIN
  SELECT id, nome, slug, email, phone, plan, status, mensalidade,
         evolution_instance, created_at, nicho, due_day, password
  INTO t FROM tenants
  WHERE (email = p_email OR slug = LOWER(SPLIT_PART(p_email, '@', 1))) LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
  END IF;
  IF NOT (t.password IS NULL OR t.password = '' OR t.password = crypt(p_password, t.password)) THEN
    RETURN json_build_object('error', 'Credenciais inválidas ou barbearia não encontrada.');
  END IF;
  RETURN json_build_object('id', t.id, 'name', t.nome, 'slug', t.slug, 'email', t.email,
    'phone', t.phone, 'plan', t.plan, 'status', t.status, 'monthlyFee', t.mensalidade,
    'evolution_instance', t.evolution_instance, 'createdAt', t.created_at,
    'nicho', t.nicho, 'due_day', t.due_day);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_login(p_email TEXT, p_password TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE stored_email TEXT; stored_pass TEXT;
BEGIN
  SELECT value INTO stored_email FROM global_settings WHERE key = 'admin_email';
  SELECT value INTO stored_pass  FROM global_settings WHERE key = 'admin_password';
  IF stored_email IS NULL OR stored_pass IS NULL THEN
    RETURN json_build_object('error', 'Credenciais de admin não configuradas.');
  END IF;
  IF TRIM(p_email) = TRIM(stored_email) AND (
    TRIM(p_password) = TRIM(stored_pass) OR
    (LEFT(stored_pass, 2) = '$2' AND stored_pass = crypt(p_password, stored_pass))
  ) THEN
    RETURN json_build_object('success', true);
  END IF;
  RETURN json_build_object('error', 'Credenciais incorretas.');
END; $$;

DROP FUNCTION IF EXISTS public.affiliate_login(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_credentials(TEXT, TEXT, TEXT, TEXT);

-- O schema private fica (com os hashes) até você confirmar que pode apagar:
-- DROP SCHEMA private CASCADE;

COMMIT;
