-- ================================================================
-- AgendeZap — pg_cron para Follow-Up Scheduler Edge Function
-- Execute este SQL no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- IMPORTANTE: Substitua eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxMzc3OSwiZXhwIjoyMDg3MTg5Nzc5fQ.WOSeS2YjbT_38a0deRqMOlWevXwNQshwXVCfhSCivT4 pela chave real antes de executar!
-- ================================================================

-- 1. Remover o cleanup de msg_dedup antigo (5 min é agressivo demais para follow-up keys)
do $$ begin
  perform cron.unschedule('cleanup-msg-dedup');
exception when others then null;
end $$;

-- 2. Recriar cleanup de msg_dedup com TTL de 25 horas
--    Follow-up keys (fu::aviso::, fu::lembrete::, etc.) precisam durar 24h+
do $$ begin
  perform cron.schedule(
    'cleanup-msg-dedup',
    '*/30 * * * *',
    'delete from msg_dedup where ts < now() - interval ''25 hours'''
  );
exception when others then null;
end $$;

-- 3. Criar job que chama a edge function follow-up-scheduler a cada 1 minuto
--    Usa pg_net (net.http_post) para HTTP call assíncrono
do $outer$ begin
  perform cron.schedule(
    'follow-up-scheduler',
    '* * * * *',
    $inner$
    select net.http_post(
      url := 'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/follow-up-scheduler',
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxMzc3OSwiZXhwIjoyMDg3MTg5Nzc5fQ.WOSeS2YjbT_38a0deRqMOlWevXwNQshwXVCfhSCivT4"}'::jsonb
    );
    $inner$
  );
exception when others then null;
end $outer$;
