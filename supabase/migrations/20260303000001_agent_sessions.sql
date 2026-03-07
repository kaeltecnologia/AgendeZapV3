-- ================================================================
-- AgendeZap — Tabelas para operação 24/7 da Edge Function
-- Execute este SQL no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
-- ================================================================

-- Sessões do agente (substituem o in-memory Map do browser)
create table if not exists agent_sessions (
  tenant_id  text not null,
  phone      text not null,
  data       jsonb not null default '{}',
  history    jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

-- Índice para TTL cleanup
create index if not exists idx_agent_sessions_updated_at on agent_sessions(updated_at);

-- Deduplicação de mensagens (compartilhado entre Edge Function e polling)
create table if not exists msg_dedup (
  fp  text primary key,
  ts  timestamptz not null default now()
);

create index if not exists idx_msg_dedup_ts on msg_dedup(ts);

-- Configurações globais (chave API compartilhada via SuperAdmin)
create table if not exists global_settings (
  key   text primary key,
  value text not null default ''
);

-- RLS desabilitado em agent_sessions e msg_dedup — browser usa anon key
-- e precisa acessar para dedup e sessões do agente.
alter table agent_sessions disable row level security;
alter table msg_dedup disable row level security;

-- global_settings mantém RLS ativo (contém chaves API sensíveis)
alter table global_settings enable row level security;

do $$ begin
  create policy "service_role_all_global_settings" on global_settings
    for all using (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- Limpeza automática de sessões expiradas (30 min) e dedup antigo (5 min)
-- Requer pg_cron (ativo no Supabase por padrão)
-- Usa DO block para evitar erro de job duplicado ao re-executar o script
do $$
begin
  perform cron.schedule(
    'cleanup-agent-sessions',
    '*/10 * * * *',
    'delete from agent_sessions where updated_at < now() - interval ''30 minutes'''
  );
exception when others then
  null; -- job já existe, ignora
end $$;

do $$
begin
  perform cron.schedule(
    'cleanup-msg-dedup',
    '*/5 * * * *',
    'delete from msg_dedup where ts < now() - interval ''5 minutes'''
  );
exception when others then
  null; -- job já existe, ignora
end $$;
