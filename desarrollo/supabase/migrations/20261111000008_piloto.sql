-- Requisitos para el piloto: consentimiento de privacidad, bloqueo por intentos de PIN,
-- validación de plantillas propias y avisos al supervisor.

-- ================================================================ 1. Consentimiento (Ley 25.326)
-- Al cambiar el texto de la política, subir la versión: todos vuelven a aceptar.
create function public.version_privacidad() returns text language sql immutable as $$ select 'v1-2026-11' $$;

create table public.consentimientos (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references public.empresas on delete cascade,
  miembro_id  uuid not null references public.miembros on delete cascade,
  version     text not null,
  aceptado_en timestamptz not null default now(),
  agente      text,                                   -- navegador / dispositivo desde donde aceptó
  unique (miembro_id, version)
);
alter table public.consentimientos enable row level security;
create policy consentimientos_ver on public.consentimientos for select to authenticated
  using (public.es_gestor(empresa_id) or miembro_id = public.mi_miembro_id(empresa_id));

create function public.privacidad_pendiente(p_empresa uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select not exists (select 1 from consentimientos
                      where miembro_id = mi_miembro_id(p_empresa) and version = version_privacidad())
$$;

create function public.aceptar_privacidad(p_empresa uuid, p_agente text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_m uuid := mi_miembro_id(p_empresa);
begin
  if v_m is null then raise exception 'No pertenecés a esta empresa' using errcode = '42501'; end if;
  insert into consentimientos (empresa_id, miembro_id, version, agente)
  values (p_empresa, v_m, version_privacidad(), left(p_agente, 300))
  on conflict (miembro_id, version) do nothing;
end $$;

-- Ningún checklist se guarda sin el consentimiento vigente del operario.
create function public.exigir_consentimiento() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from consentimientos where miembro_id = new.operario_id and version = version_privacidad()) then
    raise exception 'Antes de usar la app tenés que aceptar la política de privacidad' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger jornadas_consentimiento before insert on public.jornadas
  for each row execute function public.exigir_consentimiento();

-- ================================================================ 2. Bloqueo por intentos de PIN
-- Lo maneja la función 'ingresar' (servidor). El administrador desbloquea desde el panel.
alter table public.miembros
  add column intentos_fallidos integer not null default 0,
  add column bloqueado_en timestamptz,
  add column recibir_avisos boolean not null default true;

create function public.desbloquear_miembro(p_miembro uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_e uuid;
begin
  select empresa_id into v_e from miembros where id = p_miembro;
  if v_e is null or not es_admin(v_e) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  update miembros set intentos_fallidos = 0, bloqueado_en = null where id = p_miembro;
end $$;

-- Un miembro no puede tocar sus propios intentos ni desbloquearse (las políticas ya solo dejan editar a admins;
-- esto evita además que un admin cambie esos campos sin pasar por desbloquear_miembro).
create function public.proteger_bloqueo() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.intentos_fallidos is distinct from old.intentos_fallidos or new.bloqueado_en is distinct from old.bloqueado_en) then
    raise exception 'El bloqueo se quita con Desbloquear' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger miembros_proteger_bloqueo before update on public.miembros
  for each row execute function public.proteger_bloqueo();

-- ================================================================ 4. Plantillas propias: validación
create function public.validar_plantilla() returns trigger language plpgsql set search_path = public as $$
declare s jsonb; i jsonb; ids text[] := '{}'; n int := 0;
begin
  if jsonb_typeof(new.secciones) <> 'array' or jsonb_array_length(new.secciones) = 0 then
    raise exception 'La plantilla necesita al menos una sección' using errcode = 'P0001';
  end if;
  for s in select * from jsonb_array_elements(new.secciones) loop
    if length(trim(coalesce(s->>'titulo', ''))) = 0 then raise exception 'Hay una sección sin título' using errcode = 'P0001'; end if;
    if jsonb_typeof(s->'items') <> 'array' or jsonb_array_length(s->'items') = 0 then
      raise exception 'La sección "%" no tiene puntos', s->>'titulo' using errcode = 'P0001';
    end if;
    for i in select * from jsonb_array_elements(s->'items') loop
      if coalesce(i->>'id', '') !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Punto con identificador inválido' using errcode = 'P0001'; end if;
      if length(trim(coalesce(i->>'texto', ''))) = 0 or length(i->>'texto') > 200 then
        raise exception 'Cada punto necesita un texto de hasta 200 caracteres' using errcode = 'P0001';
      end if;
      if jsonb_typeof(i->'critico') <> 'boolean' then raise exception 'Falta indicar si el punto es crítico' using errcode = 'P0001'; end if;
      if (i->>'id') = any(ids) then raise exception 'Hay puntos repetidos' using errcode = 'P0001'; end if;
      ids := ids || (i->>'id'); n := n + 1;
    end loop;
  end loop;
  if n > 200 then raise exception 'Máximo 200 puntos por plantilla' using errcode = 'P0001'; end if;
  -- Una versión ya usada en jornadas no se modifica: se crea una nueva (el historial debe seguir igual).
  if tg_op = 'UPDATE' and new.secciones is distinct from old.secciones
     and exists (select 1 from jornadas where plantilla_id = old.id) then
    raise exception 'Esta versión ya se usó en checklists: guardá una versión nueva' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger plantillas_validar before insert or update on public.plantillas
  for each row execute function public.validar_plantilla();

-- ================================================================ 5. Avisos al supervisor
create table public.notificaciones (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references public.empresas on delete cascade,
  tipo        text not null check (tipo in ('equipo_bloqueado')),
  equipo_id   uuid references public.equipos on delete cascade,
  jornada_id  uuid references public.jornadas on delete set null,
  datos       jsonb not null default '{}',
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'sin_destinatarios', 'error')),
  intentos    integer not null default 0,
  error       text,
  creada_en   timestamptz not null default now(),
  enviada_en  timestamptz
);
create index on public.notificaciones (estado, creada_en);
alter table public.notificaciones enable row level security;
create policy notificaciones_ver on public.notificaciones for select to authenticated using (public.es_gestor(empresa_id));

-- Cada bloqueo genera un aviso.
create function public.avisar_bloqueo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'bloqueo' then
    insert into notificaciones (empresa_id, tipo, equipo_id, jornada_id, datos)
    select new.empresa_id, 'equipo_bloqueado', new.equipo_id, new.jornada_id,
           jsonb_build_object('codigo', e.codigo, 'equipo', e.nombre, 'motivo', new.detalle,
                              'operario', m.nombre, 'obra', o.nombre, 'cuando', new.creado_en, 'empresa', em.nombre)
      from equipos e join empresas em on em.id = e.empresa_id
      left join miembros m on m.id = new.miembro_id
      left join jornadas j on j.id = new.jornada_id
      left join obras o on o.id = j.obra_id
     where e.id = new.equipo_id;
  end if;
  return new;
end $$;
create trigger eventos_avisar after insert on public.eventos_equipo
  for each row execute function public.avisar_bloqueo();

-- Correos de los supervisores y administradores que reciben avisos (solo para el servidor).
create function public.destinatarios_avisos(p_empresa uuid) returns table (nombre text, correo text)
  language sql stable security definer set search_path = public, auth as $$
  select m.nombre, u.email::text
    from miembros m join auth.users u on u.id = m.user_id
   where m.empresa_id = p_empresa and m.activo and m.recibir_avisos
     and m.rol in ('dueno', 'admin', 'supervisor')
     and u.email is not null and u.email not like '%.invalid'
$$;

-- ================================================================ permisos
revoke all on public.consentimientos, public.notificaciones from anon;
revoke insert, update, delete, truncate on public.consentimientos, public.notificaciones from authenticated;
grant select on public.consentimientos, public.notificaciones to authenticated;
revoke execute on function public.destinatarios_avisos(uuid), public.exigir_consentimiento(), public.avisar_bloqueo() from public, anon, authenticated;
revoke execute on function public.privacidad_pendiente(uuid), public.aceptar_privacidad(uuid, text), public.desbloquear_miembro(uuid) from public, anon;
grant execute on function public.privacidad_pendiente(uuid), public.aceptar_privacidad(uuid, text),
                          public.desbloquear_miembro(uuid), public.version_privacidad() to authenticated;
