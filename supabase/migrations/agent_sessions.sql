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

-- RLS: apenas service_role (Edge Function) pode acessar
alter table agent_sessions enable row level security;
alter table msg_dedup enable row level security;
alter table global_settings enable row level security;

-- Policies para service_role (Edge Function usa SUPABASE_SERVICE_ROLE_KEY)
create policy "service_role_all_agent_sessions" on agent_sessions
  for all using (auth.role() = 'service_role');

create policy "service_role_all_msg_dedup" on msg_dedup
  for all using (auth.role() = 'service_role');

create policy "service_role_all_global_settings" on global_settings
  for all using (auth.role() = 'service_role');

-- Limpeza automática de sessões expiradas (30 min) e dedup antigo (2 min)
-- Requer pg_cron (ativo no Supabase por padrão)
select cron.schedule(
  'cleanup-agent-sessions',
  '*/10 * * * *',
  $$delete from agent_sessions where updated_at < now() - interval '30 minutes'$$
) on conflict do nothing;

select cron.schedule(
  'cleanup-msg-dedup',
  '*/5 * * * *',
  $$delete from msg_dedup where ts < now() - interval '5 minutes'$$
) on conflict do nothing;
