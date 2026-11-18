-- Actualización automática de Caterpillar cada hora (minuto 23). Usa las mismas claves de Vault que John Deere.
create or replace function public.telemetria_sincronizar_caterpillar() returns void
language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_url text;
begin
  if not exists (select 1 from telemetria_conexiones where proveedor = 'caterpillar' and estado in ('conectada', 'error')) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'url_funciones';
  if v_secreto is null or v_url is null then return; end if;
  perform net.http_post(
    url := v_url || '/caterpillar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"accion":"sincronizar_todo"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public.telemetria_sincronizar_caterpillar() from public, anon, authenticated;

select cron.schedule('caterpillar-cada-hora', '23 * * * *', $$select public.telemetria_sincronizar_caterpillar()$$);
