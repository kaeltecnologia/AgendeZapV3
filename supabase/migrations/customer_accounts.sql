-- ============================================================
-- Customer Accounts — Marketplace user registration + dashboard
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Conta de cliente (global, cross-tenant)
CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE customer_accounts DISABLE ROW LEVEL SECURITY;

-- 2. Favoritos (cliente <-> estabelecimento)
CREATE TABLE IF NOT EXISTS customer_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_phone, tenant_id)
);
ALTER TABLE customer_favorites DISABLE ROW LEVEL SECURITY;

-- 3. RPC: registro seguro (senha hashada server-side via bcrypt)
CREATE OR REPLACE FUNCTION customer_register(
  p_phone TEXT, p_name TEXT, p_password TEXT, p_city TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE v_account RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM customer_accounts WHERE phone = p_phone) THEN
    RETURN json_build_object('error', 'Telefone já cadastrado.');
  END IF;
  INSERT INTO customer_accounts (phone, name, password_hash, city)
  VALUES (p_phone, p_name, crypt(p_password, gen_salt('bf')), p_city)
  RETURNING * INTO v_account;
  RETURN json_build_object('id', v_account.id, 'phone', v_account.phone, 'name', v_account.name, 'city', v_account.city);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: login seguro
CREATE OR REPLACE FUNCTION customer_login(
  p_phone TEXT, p_password TEXT
) RETURNS JSON AS $$
DECLARE v_account RECORD;
BEGIN
  SELECT * INTO v_account FROM customer_accounts
  WHERE phone = p_phone AND password_hash = crypt(p_password, password_hash);
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Telefone ou senha incorretos.');
  END IF;
  RETURN json_build_object('id', v_account.id, 'phone', v_account.phone, 'name', v_account.name, 'city', v_account.city);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
