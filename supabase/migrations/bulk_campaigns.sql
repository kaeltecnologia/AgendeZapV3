-- ──────────────────────────────────────────────────────────────────────────────
-- AgendeZap — Bulk Campaigns (server-side disparo queue)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Main table -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_campaigns (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT        NOT NULL DEFAULT 'Campanha',
  admin_instance  TEXT        NOT NULL,
  contacts        JSONB       NOT NULL DEFAULT '[]',   -- [{id,name,phone}]
  messages        JSONB       NOT NULL DEFAULT '[]',   -- [string]
  delay_min       INT         NOT NULL DEFAULT 30,
  delay_max       INT         NOT NULL DEFAULT 60,
  pause_every     INT         NOT NULL DEFAULT 20,
  pause_min       INT         NOT NULL DEFAULT 120,
  pause_max       INT         NOT NULL DEFAULT 300,
  use_time_window BOOLEAN     NOT NULL DEFAULT false,
  window_start    TEXT        NOT NULL DEFAULT '08:00',
  window_end      TEXT        NOT NULL DEFAULT '18:00',
  status          TEXT        NOT NULL DEFAULT 'pending', -- pending|running|done|stopped
  sent_count      INT         NOT NULL DEFAULT 0,
  error_count     INT         NOT NULL DEFAULT 0,
  current_index   INT         NOT NULL DEFAULT 0,
  next_send_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. RLS (SuperAdmin-only tool — anon key is fine, no tenant separation needed) -
ALTER TABLE bulk_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bulk_campaigns' AND policyname = 'bulk_campaigns_all'
  ) THEN
    CREATE POLICY bulk_campaigns_all ON bulk_campaigns USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Auto-trigger every minute via pg_cron + pg_net ----------------------------
-- Prerequisites (enable once in Dashboard → Database → Extensions):
--   • pg_cron
--   • pg_net
--
-- Run in Supabase SQL Editor after enabling the extensions above:

DO $$ BEGIN
  PERFORM cron.unschedule('agz_campaign_worker');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'agz_campaign_worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook',
    headers := '{"Content-Type":"application/json","x-campaign-tick":"true","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id
  $$
);

-- To verify the cron job:
-- SELECT * FROM cron.job;

-- To remove the cron job if needed:
-- SELECT cron.unschedule('agz_campaign_worker');
