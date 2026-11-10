-- Fotos (selfie, fallas) y firmas. Bucket privado.
-- Ruta obligatoria: <empresa_id>/<user_id>/<archivo>
-- Cada usuario sube solo a su carpeta; supervisores y administradores ven todo lo de su empresa.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function public.uuid_o_nulo(t text) returns uuid
  language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.uuid_o_nulo(text) to authenticated;

create policy evidencias_subir on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and public.es_miembro(public.uuid_o_nulo((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy evidencias_ver on storage.objects for select to authenticated
  using (
    bucket_id = 'evidencias'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.es_gestor(public.uuid_o_nulo((storage.foldername(name))[1]))
    )
  );
