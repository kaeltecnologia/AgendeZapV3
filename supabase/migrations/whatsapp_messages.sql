-- Persistent WhatsApp message history
-- Run once in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  msg_id     TEXT    NOT NULL,
  tenant_id  TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  direction  TEXT    NOT NULL,   -- 'in' | 'out'
  body       TEXT    DEFAULT '',
  msg_type   TEXT    DEFAULT 'text',
  push_name  TEXT    DEFAULT '',
  from_me    BOOLEAN DEFAULT FALSE,
  ts         BIGINT  NOT NULL,   -- Unix seconds (messageTimestamp from Evolution API)
  raw        JSONB   DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_wam_tenant_ts    ON whatsapp_messages (tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_wam_tenant_phone ON whatsapp_messages (tenant_id, phone);

-- Allow service_role (used by Edge Function and browser) to read/write
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON whatsapp_messages;
CREATE POLICY "service_role full access" ON whatsapp_messages
  FOR ALL USING (auth.role() = 'service_role');
