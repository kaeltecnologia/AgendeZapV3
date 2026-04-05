-- Código sequencial para tenants
-- SERIAL auto-incrementa para novos registros
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS codigo SERIAL;

-- Reordenar códigos existentes pela data de criação
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM tenants
)
UPDATE tenants SET codigo = numbered.rn
FROM numbered WHERE tenants.id = numbered.id;

-- Resetar a sequência para continuar do último código
SELECT setval(
  pg_get_serial_sequence('tenants', 'codigo'),
  COALESCE((SELECT MAX(codigo) FROM tenants), 0)
);
