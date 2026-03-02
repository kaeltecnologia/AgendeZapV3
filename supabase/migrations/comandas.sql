-- ──────────────────────────────────────────────────────────────────────────────
-- AgendeZap — Comandas (ordem de serviço por atendimento)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comandas (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id        TEXT        NOT NULL,
  appointment_id   TEXT        NOT NULL,
  professional_id  TEXT        NOT NULL,
  customer_id      TEXT        NOT NULL,
  items            JSONB       NOT NULL DEFAULT '[]',  -- ComandaItem[]
  status           TEXT        NOT NULL DEFAULT 'open', -- 'open' | 'closed'
  payment_method   TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);

-- RLS (same open policy as other tables — tenant filtering done in application code)
ALTER TABLE comandas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comandas' AND policyname = 'comandas_all'
  ) THEN
    CREATE POLICY comandas_all ON comandas USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comandas_tenant     ON comandas (tenant_id);
CREATE INDEX IF NOT EXISTS idx_comandas_appointment ON comandas (appointment_id);
CREATE INDEX IF NOT EXISTS idx_comandas_status      ON comandas (tenant_id, status);
