-- v4.17: Professional sub-login + services-per-professional
-- Adds: login_pin, login_phone, service_ids to professionals
--       professional_login() RPC

ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS login_pin   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS login_phone TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS service_ids TEXT[] DEFAULT '{}';

-- Index para lookup de login por telefone
CREATE INDEX IF NOT EXISTS idx_professionals_login_phone ON professionals (login_phone);
CREATE INDEX IF NOT EXISTS idx_professionals_phone       ON professionals (phone);

-- RPC: autentica profissional por telefone + PIN
-- Busca por login_phone primeiro, depois por phone (fallback)
CREATE OR REPLACE FUNCTION professional_login(p_phone TEXT, p_pin TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_clean_phone TEXT;
BEGIN
  -- normaliza: mantém dígitos apenas para comparação
  v_clean_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');

  SELECT
    p.id            AS professional_id,
    p.nome          AS professional_name,
    p.tenant_id,
    p.login_pin,
    t.nome          AS tenant_name,
    t.slug          AS tenant_slug,
    t.plano         AS tenant_plan,
    t.nicho         AS tenant_nicho
  INTO v_row
  FROM professionals p
  JOIN tenants t ON t.id = p.tenant_id
  WHERE p.ativo = true
    AND p.login_pin = p_pin
    AND (
      regexp_replace(COALESCE(p.login_phone, ''), '[^0-9]', '', 'g') = v_clean_phone
      OR
      regexp_replace(COALESCE(p.phone, ''),       '[^0-9]', '', 'g') = v_clean_phone
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Telefone ou PIN inválido');
  END IF;

  RETURN json_build_object(
    'professional_id',   v_row.professional_id,
    'professional_name', v_row.professional_name,
    'tenant_id',         v_row.tenant_id,
    'tenant_name',       v_row.tenant_name,
    'tenant_slug',       v_row.tenant_slug,
    'tenant_plan',       v_row.tenant_plan,
    'tenant_nicho',      v_row.tenant_nicho
  );
END;
$$;

-- Permissão de execução para anon (login não requer auth)
GRANT EXECUTE ON FUNCTION professional_login(TEXT, TEXT) TO anon;
