-- ================================================================
-- AgendeZap — Tabelas dedicadas para dados financeiros de profissionais
-- Migração saindo do JSONB follow_up para tabelas próprias no Supabase
--
-- Execute no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
-- ================================================================

-- ── 1. Tabela adiantamentos ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS adiantamentos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  professional_id UUID    NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  date        DATE        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS adiantamentos_tenant_idx      ON adiantamentos(tenant_id);
CREATE INDEX IF NOT EXISTS adiantamentos_professional_idx ON adiantamentos(professional_id);
CREATE INDEX IF NOT EXISTS adiantamentos_date_idx        ON adiantamentos(date);

ALTER TABLE adiantamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_adiantamentos_select" ON adiantamentos
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_adiantamentos_insert" ON adiantamentos
  FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_adiantamentos_update" ON adiantamentos
  FOR UPDATE TO anon USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_adiantamentos_delete" ON adiantamentos
  FOR DELETE TO anon USING (tenant_id IS NOT NULL);


-- ── 2. Tabela pagamentos_pro ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagamentos_pro (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL,
  professional_id     UUID          NOT NULL,
  periodo_inicio      DATE          NOT NULL,
  periodo_fim         DATE          NOT NULL,
  comissao_total      DECIMAL(10,2) NOT NULL DEFAULT 0,
  adiantamentos_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  liquido             DECIMAL(10,2) NOT NULL DEFAULT 0,
  status              TEXT          NOT NULL DEFAULT 'pago',
  paid_at             TIMESTAMPTZ,
  paid_method         TEXT,
  notes               TEXT,
  comanda_ids         JSONB         NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pagamentos_pro_tenant_idx      ON pagamentos_pro(tenant_id);
CREATE INDEX IF NOT EXISTS pagamentos_pro_professional_idx ON pagamentos_pro(professional_id);
CREATE INDEX IF NOT EXISTS pagamentos_pro_periodo_idx     ON pagamentos_pro(periodo_inicio, periodo_fim);

ALTER TABLE pagamentos_pro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_pagamentos_pro_select" ON pagamentos_pro
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_pagamentos_pro_insert" ON pagamentos_pro
  FOR INSERT TO anon WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_pagamentos_pro_update" ON pagamentos_pro
  FOR UPDATE TO anon USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon_pagamentos_pro_delete" ON pagamentos_pro
  FOR DELETE TO anon USING (tenant_id IS NOT NULL);


-- ── 3. Migração de dados existentes no JSONB follow_up ───────────
-- Extrai _adiantamentos de cada tenant_settings e insere na nova tabela
-- (Ignora registros que já existam pelo id)

INSERT INTO adiantamentos (id, tenant_id, professional_id, amount, date, description, created_at)
SELECT
  (a->>'id')::UUID,
  ts.tenant_id,
  (a->>'professionalId')::UUID,
  (a->>'amount')::DECIMAL,
  (a->>'date')::DATE,
  a->>'description',
  COALESCE((a->>'createdAt')::TIMESTAMPTZ, NOW())
FROM tenant_settings ts,
     jsonb_array_elements(COALESCE(ts.follow_up->'_adiantamentos', '[]'::jsonb)) AS a
WHERE (a->>'id') IS NOT NULL
  AND (a->>'professionalId') IS NOT NULL
  AND (a->>'amount') IS NOT NULL
  AND (a->>'date') IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Extrai _pagamentosPro de cada tenant_settings e insere na nova tabela
INSERT INTO pagamentos_pro (id, tenant_id, professional_id, periodo_inicio, periodo_fim,
                            comissao_total, adiantamentos_total, liquido, status,
                            paid_at, paid_method, notes, comanda_ids, created_at)
SELECT
  (p->>'id')::UUID,
  ts.tenant_id,
  (p->>'professionalId')::UUID,
  (p->>'periodoInicio')::DATE,
  (p->>'periodoFim')::DATE,
  COALESCE((p->>'comissaoTotal')::DECIMAL, 0),
  COALESCE((p->>'adiantamentosTotal')::DECIMAL, 0),
  COALESCE((p->>'liquido')::DECIMAL, 0),
  COALESCE(p->>'status', 'pago'),
  (p->>'paidAt')::TIMESTAMPTZ,
  p->>'paidMethod',
  p->>'notes',
  COALESCE(p->'comandaIds', '[]'::jsonb),
  COALESCE((p->>'createdAt')::TIMESTAMPTZ, NOW())
FROM tenant_settings ts,
     jsonb_array_elements(COALESCE(ts.follow_up->'_pagamentosPro', '[]'::jsonb)) AS p
WHERE (p->>'id') IS NOT NULL
  AND (p->>'professionalId') IS NOT NULL
  AND (p->>'periodoInicio') IS NOT NULL
ON CONFLICT (id) DO NOTHING;
