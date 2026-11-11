-- Envío de avisos pendientes cada 2 minutos (función 'avisos'). Usa las mismas claves de Vault
-- que la telemetría: 'cron_secret' y 'url_funciones'.
create or replace function public.avisos_enviar_pendientes() returns void
language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_url text;
begin
  if not exists (select 1 from notificaciones where estado = 'pendiente') then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'url_funciones';
  if v_secreto is null or v_url is null then return; end if;
  perform net.http_post(
    url := v_url || '/avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"accion":"enviar_pendientes"}'::jsonb,
    timeout_milliseconds := 60000);
end $$;
revoke execute on function public.avisos_enviar_pendientes() from public, anon, authenticated;

select cron.schedule('avisos-cada-2-minutos', '*/2 * * * *', $$select public.avisos_enviar_pendientes()$$);
