-- Permite que o browser (anon) leia global_settings para buscar a chave compartilhada.
-- Escrita continua restrita a service_role apenas.
do $$ begin
  create policy "anon_read_global_settings" on global_settings
    for select using (true);
exception when duplicate_object then null;
end $$;
