-- ================================================================
-- AgendeZap — Diagnóstico da tabela customers
-- Execute CADA bloco separadamente no Supabase SQL Editor
-- ================================================================

-- 1. Estrutura da tabela (colunas, tipos e nullable)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers'
ORDER BY ordinal_position;

-- ----------------------------------------------------------------
-- 2. Índices únicos (causa de "duplicate key" ao salvar)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'customers' AND schemaname = 'public';

-- ----------------------------------------------------------------
-- 3. Permissões do role 'anon' na tabela (GRANT)
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'customers'
ORDER BY grantee, privilege_type;

-- ----------------------------------------------------------------
-- 4. Total de clientes por tenant
SELECT tenant_id, COUNT(*) AS total
FROM customers
GROUP BY tenant_id;

-- ----------------------------------------------------------------
-- 5. Tentar INSERT manual (substitua pelo seu tenant_id real):
-- INSERT INTO customers (tenant_id, nome, telefone)
-- VALUES ('SEU-TENANT-ID-AQUI', 'Teste', '11999990000')
-- RETURNING *;
