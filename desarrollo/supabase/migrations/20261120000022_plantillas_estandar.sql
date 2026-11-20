-- Plantillas estándar intocables: una empresa no puede pisar una plantilla de Operapto. Para cambiarla, la copia:
-- la copia es una plantilla nueva de la empresa (otra clave), y la estándar sigue disponible para cualquier equipo.
alter table public.plantillas add column basada_en text;      -- clave de la estándar de la que salió la copia

create function public.plantilla_no_pisa_estandar() returns trigger language plpgsql set search_path = public as $$
begin
  if new.empresa_id is not null and exists (select 1 from plantillas b where b.empresa_id is null and b.clave = new.clave) then
    raise exception 'Las plantillas estándar no se modifican: guardá una copia con otro nombre' using errcode = 'P0001';
  end if;
  -- No se archiva una plantilla que usan equipos activos (se quedarían sin checklist).
  if tg_op = 'UPDATE' and old.activa and not new.activa and new.empresa_id is not null
     and not exists (select 1 from plantillas o where o.empresa_id = new.empresa_id and o.clave = new.clave and o.activa and o.id <> new.id)
     and exists (select 1 from equipos e where e.empresa_id = new.empresa_id and e.plantilla_clave = new.clave and e.activo) then
    raise exception 'La usan equipos: cambiales el checklist antes de archivarla' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger plantillas_estandar before insert or update on public.plantillas
  for each row execute function public.plantilla_no_pisa_estandar();

-- El checklist de un equipo tiene que existir (estándar o de su empresa) y medirse igual que el equipo.
create function public.validar_plantilla_equipo() returns trigger language plpgsql security definer set search_path = public as $$
declare v plantillas;
begin
  v := plantilla_vigente(new.empresa_id, new.plantilla_clave);
  if v.id is null then raise exception 'Esa plantilla de checklist no existe' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and v.medidor <> new.medidor then
    raise exception 'Esa plantilla se mide en % y el equipo en %', case v.medidor when 'km' then 'km' else 'horas' end,
      case new.medidor when 'km' then 'km' else 'horas' end using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger equipos_plantilla before insert or update of plantilla_clave on public.equipos
  for each row execute function public.validar_plantilla_equipo();
revoke execute on function public.plantilla_no_pisa_estandar(), public.validar_plantilla_equipo() from public, anon, authenticated;
