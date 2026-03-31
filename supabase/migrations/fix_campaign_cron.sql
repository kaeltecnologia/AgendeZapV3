-- ──────────────────────────────────────────────────────────────────────────────
-- FIX: Campanhas de prospecção só funcionavam com a tela aberta
-- Problema: pg_cron não estava ativo → servidor nunca disparava sozinho
-- Solução: Ativar pg_cron + pg_net para chamar a Edge Function a cada minuto
--
-- PASSO 1: Ative as extensões no Dashboard → Database → Extensions:
--   • pg_cron   (já vem habilitado em projetos Supabase Pro)
--   • pg_net    (habilitar manualmente se não estiver ativo)
--
-- PASSO 2: Execute este SQL no Dashboard → SQL Editor → New Query
-- ──────────────────────────────────────────────────────────────────────────────

-- Remove job antigo se existir (evita duplicata)
DO $$ BEGIN
  PERFORM cron.unschedule('agz_campaign_worker');
EXCEPTION WHEN OTHERS THEN
  -- job não existe ainda, ok
END $$;

-- Cria o job: a cada 1 minuto, chama a Edge Function com o header x-campaign-tick
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

-- Verificar se o job foi criado:
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'agz_campaign_worker';
