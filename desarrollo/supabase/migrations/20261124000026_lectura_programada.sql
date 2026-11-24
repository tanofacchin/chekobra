-- Lectura de fotos del medidor cada 10 minutos (función 'leer-medidor'), con las mismas claves de Vault que los avisos.
create or replace function public.leer_medidores_pendientes() returns void
language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_url text;
begin
  if not exists (select 1 from jornadas where lectura_estado is null and medidor_foto_path is not null and recibido_en > now() - interval '7 days') then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'url_funciones';
  if v_secreto is null or v_url is null then return; end if;
  perform net.http_post(url := v_url || '/leer-medidor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"accion":"pendientes"}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke execute on function public.leer_medidores_pendientes() from public, anon, authenticated;
select cron.schedule('leer-medidores-cada-10-minutos', '*/10 * * * *', $$select public.leer_medidores_pendientes()$$);
