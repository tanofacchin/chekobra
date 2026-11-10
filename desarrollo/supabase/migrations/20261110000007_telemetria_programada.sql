-- Actualización automática de telemetría cada hora (minuto 17).
-- La clave que autoriza la llamada se guarda en Vault con el nombre 'cron_secret' (fuera del repositorio)
-- y debe coincidir con el secreto CRON_SECRET de la función 'johndeere'.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.telemetria_sincronizar_todo() returns void
language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_url text;
begin
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'url_funciones';
  if v_secreto is null or v_url is null then return; end if;
  perform net.http_post(
    url := v_url || '/johndeere',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"accion":"sincronizar_todo"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public.telemetria_sincronizar_todo() from public, anon, authenticated;

select cron.schedule('telemetria-cada-hora', '17 * * * *', $$select public.telemetria_sincronizar_todo()$$);
