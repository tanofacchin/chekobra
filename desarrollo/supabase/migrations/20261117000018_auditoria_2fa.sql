-- Registro de auditoría y segundo factor (código de una app autenticadora) para la administración.

-- ================================================================ 1. Segundo factor
-- Sesión verificada con el segundo factor (Supabase pone aal = 'aal2' en el token).
create function public.sesion_aal2() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2'
$$;
-- ¿Quien llama tiene un segundo factor activado?
create function public.tiene_segundo_factor() returns boolean
  language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;

-- El rol en la empresa solo vale si la sesión cumple el nivel de seguridad:
--  · dueño y administración: siempre con segundo factor;
--  · cualquiera que lo haya activado (por ejemplo, un supervisor): con el código de esta sesión.
-- Todas las reglas (es_miembro, es_gestor, es_admin) se apoyan en mi_rol, así que esto las cubre a todas.
create or replace function public.mi_rol(e uuid) returns public.rol_miembro
  language sql stable security definer set search_path = public as $$
  select m.rol from miembros m
   where m.empresa_id = e and m.user_id = auth.uid() and m.activo
     and (public.sesion_aal2() or (m.rol not in ('dueno', 'admin') and not public.tiene_segundo_factor()))
$$;

-- Para la app: qué le falta a esta sesión (nada | activar | verificar).
create function public.segundo_factor_pendiente() returns text
  language sql stable security definer set search_path = public as $$
  select case
    when public.sesion_aal2() then 'nada'
    when public.tiene_segundo_factor() then 'verificar'
    when exists (select 1 from miembros where user_id = auth.uid() and activo and rol in ('dueno', 'admin')) then 'activar'
    else 'nada' end
$$;

-- crear_empresa deja a quien la crea como dueño: sin segundo factor todavía no puede operar,
-- así que la app le pide activarlo antes de seguir (la creación en sí no lo necesita).

-- ================================================================ 2. Auditoría
create table public.auditoria (
  id           bigint generated always as identity primary key,
  empresa_id   uuid not null references public.empresas on delete cascade,
  cuando       timestamptz not null default now(),
  user_id      uuid,
  quien        text,                    -- nombre al momento del cambio (queda aunque la persona se borre)
  rol          text,
  accion       text not null,           -- alta | cambio | baja | liberacion | fuera_servicio | en_servicio | asignacion | pin | restablecer_2fa
  tabla        text not null,
  registro_id  text,
  registro     text,                    -- código, nombre o título legible
  antes        jsonb,
  despues      jsonb
);
create index on public.auditoria (empresa_id, cuando desc);
alter table public.auditoria enable row level security;
create policy auditoria_ver on public.auditoria for select to authenticated using (public.es_admin(empresa_id));
revoke all on public.auditoria from anon;
revoke insert, update, delete, truncate on public.auditoria from authenticated;
grant select on public.auditoria to authenticated;

-- Columnas que cambian solas o que ya tienen su propio registro: no ensucian la auditoría.
create function public.auditoria_ignorar(p_tabla text) returns text[] language sql immutable as $$
  select case p_tabla
    when 'equipos'  then array['ultimo_medidor', 'estado', 'motivo_bloqueo', 'bloqueado_en', 'bloqueo_jornada_id']
    when 'miembros' then array['intentos_fallidos']
    when 'planes_mantenimiento' then array['ultimo_medidor', 'ultimo_en']
    else array[]::text[] end
$$;

create function public.auditar(p_empresa uuid, p_accion text, p_tabla text, p_id text, p_registro text, p_antes jsonb, p_despues jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_m miembros;
begin
  -- Al borrar una empresa entera, sus datos se borran en cascada: no hay dónde (ni para qué) registrarlo.
  if not exists (select 1 from empresas where id = p_empresa) then return; end if;
  select * into v_m from miembros where empresa_id = p_empresa and user_id = auth.uid() limit 1;
  insert into auditoria (empresa_id, user_id, quien, rol, accion, tabla, registro_id, registro, antes, despues)
  values (p_empresa, auth.uid(), coalesce(v_m.nombre, case when auth.uid() is null then 'Sistema' end), v_m.rol::text,
          p_accion, p_tabla, p_id, left(p_registro, 160), p_antes, p_despues);
end $$;

create function public.auditoria_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_a jsonb := '{}'; v_d jsonb := '{}'; k text; v_ign text[]; v_fila jsonb; v_reg text;
begin
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_fila := coalesce(v_new, v_old);
  if v_fila->>'empresa_id' is null then return null; end if;           -- plantillas base: no son de ninguna empresa
  -- Las altas de personal las hace la función 'operarios' con permisos de servidor: ella misma registra quién las pidió.
  if auth.uid() is null and tg_table_name = 'miembros' and tg_op = 'INSERT' then return null; end if;
  v_ign := auditoria_ignorar(tg_table_name) || array['creado_en', 'creada_en', 'recibido_en'];
  v_reg := coalesce(v_fila->>'codigo', v_fila->>'titulo', v_fila->>'nombre', v_fila->>'descripcion', v_fila->>'tipo', v_fila->>'id');
  if tg_table_name = 'jornadas' then
    v_reg := (select codigo from equipos where id = (v_fila->>'equipo_id')::uuid) || ' · ' || to_char((v_fila->>'inicio')::timestamptz at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI');
  elsif tg_table_name in ('documentos', 'planes_mantenimiento', 'mantenimientos', 'cargas_combustible') and v_fila->>'equipo_id' is not null then
    v_reg := (select codigo from equipos where id = (v_fila->>'equipo_id')::uuid) || ' · ' || v_reg;
  elsif tg_table_name = 'ordenes_trabajo' then
    v_reg := 'OT ' || (v_fila->>'numero') || ' · ' || (v_fila->>'titulo');
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k = any(v_ign) or v_new->k is not distinct from v_old->k then continue; end if;
      if k in ('secciones', 'respuestas', 'raw') then v_a := v_a || jsonb_build_object(k, '(contenido anterior)'); v_d := v_d || jsonb_build_object(k, '(contenido nuevo)');
      else v_a := v_a || jsonb_build_object(k, v_old->k); v_d := v_d || jsonb_build_object(k, v_new->k); end if;
    end loop;
    if v_d = '{}' then return null; end if;
    perform auditar((v_fila->>'empresa_id')::uuid, 'cambio', tg_table_name, v_fila->>'id', v_reg, v_a, v_d);
  else
    v_fila := v_fila - 'secciones' - 'respuestas' - 'raw' - 'empresa_id' - 'id';
    perform auditar((coalesce(v_new, v_old)->>'empresa_id')::uuid, case tg_op when 'INSERT' then 'alta' else 'baja' end, tg_table_name,
                    coalesce(v_new, v_old)->>'id', v_reg, case when tg_op = 'DELETE' then v_fila end, case when tg_op = 'INSERT' then v_fila end);
  end if;
  return null;
end $$;

-- Altas, cambios y bajas de la configuración; solo bajas (o cambios hechos a mano) de los registros de trabajo.
create trigger auditoria after insert or update or delete on public.equipos for each row execute function public.auditoria_trigger();
create trigger auditoria after insert or update or delete on public.miembros for each row execute function public.auditoria_trigger();
create trigger auditoria after insert or update or delete on public.obras for each row execute function public.auditoria_trigger();
create trigger auditoria after insert or update or delete on public.plantillas for each row execute function public.auditoria_trigger();
create trigger auditoria after insert or update or delete on public.planes_mantenimiento for each row execute function public.auditoria_trigger();
create trigger auditoria after insert or update or delete on public.documentos for each row execute function public.auditoria_trigger();
create trigger auditoria after update or delete on public.mantenimientos for each row execute function public.auditoria_trigger();
create trigger auditoria after update or delete on public.cargas_combustible for each row execute function public.auditoria_trigger();
create trigger auditoria after delete on public.jornadas for each row execute function public.auditoria_trigger();
create trigger auditoria after delete on public.ordenes_trabajo for each row execute function public.auditoria_trigger();

-- empresas no tiene empresa_id: la fila es la empresa.
create or replace function public.auditoria_empresa() returns trigger language plpgsql security definer set search_path = public as $$
declare v_a jsonb := '{}'; v_d jsonb := '{}'; k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if to_jsonb(new)->k is distinct from to_jsonb(old)->k then v_a := v_a || jsonb_build_object(k, to_jsonb(old)->k); v_d := v_d || jsonb_build_object(k, to_jsonb(new)->k); end if;
    end loop;
    if v_d <> '{}' then perform auditar(new.id, 'cambio', 'empresas', new.id::text, new.nombre, v_a, v_d); end if;
  end if;
  return null;
end $$;
create trigger auditoria after update on public.empresas for each row execute function public.auditoria_empresa();

-- Liberaciones y cambios de servicio (los bloqueos los genera el checklist y ya están en el historial del equipo).
create function public.auditoria_evento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo <> 'bloqueo' then
    perform auditar(new.empresa_id, new.tipo, 'equipos', new.equipo_id::text, (select codigo from equipos where id = new.equipo_id), null, jsonb_build_object('detalle', new.detalle));
  end if;
  return null;
end $$;
create trigger auditoria after insert on public.eventos_equipo for each row execute function public.auditoria_evento();

-- Asignaciones: un solo registro por guardado (no uno por fila borrada y creada).
create or replace function public.asignar(p_miembro uuid, p_equipos uuid[], p_obras uuid[]) returns void
  language plpgsql security definer set search_path = public as $$
declare v_m miembros; v_antes jsonb;
begin
  select * into v_m from miembros where id = p_miembro;
  if not found or not es_gestor(v_m.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_equipos, '{}')) x where not exists (select 1 from equipos where id = x and empresa_id = v_m.empresa_id))
     or exists (select 1 from unnest(coalesce(p_obras, '{}')) x where not exists (select 1 from obras where id = x and empresa_id = v_m.empresa_id)) then
    raise exception 'Equipo u obra de otra empresa' using errcode = 'P0001';
  end if;
  select jsonb_build_object('equipos', coalesce(jsonb_agg(e.codigo order by e.codigo) filter (where e.codigo is not null), '[]'), 'obras', coalesce(jsonb_agg(o.nombre order by o.nombre) filter (where o.nombre is not null), '[]'))
    into v_antes from asignaciones a left join equipos e on e.id = a.equipo_id left join obras o on o.id = a.obra_id where a.miembro_id = p_miembro;
  delete from asignaciones where miembro_id = p_miembro;
  insert into asignaciones (empresa_id, miembro_id, equipo_id) select distinct v_m.empresa_id, p_miembro, x from unnest(coalesce(p_equipos, '{}')) x;
  insert into asignaciones (empresa_id, miembro_id, obra_id) select distinct v_m.empresa_id, p_miembro, x from unnest(coalesce(p_obras, '{}')) x;
  perform auditar(v_m.empresa_id, 'asignacion', 'miembros', p_miembro::text, v_m.nombre, v_antes,
    jsonb_build_object('equipos', coalesce((select jsonb_agg(codigo order by codigo) from equipos where id = any(coalesce(p_equipos, '{}'))), '[]'),
                       'obras', coalesce((select jsonb_agg(nombre order by nombre) from obras where id = any(coalesce(p_obras, '{}'))), '[]')));
end $$;

-- Lo que hace la función de altas (cambio de PIN): la llama el servidor con el usuario que pidió el cambio.
create function public.auditar_servidor(p_empresa uuid, p_user uuid, p_accion text, p_tabla text, p_id text, p_registro text, p_detalle jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_m miembros;
begin
  select * into v_m from miembros where empresa_id = p_empresa and user_id = p_user limit 1;
  insert into auditoria (empresa_id, user_id, quien, rol, accion, tabla, registro_id, registro, despues)
  values (p_empresa, p_user, v_m.nombre, v_m.rol::text, p_accion, p_tabla, p_id, p_registro, p_detalle);
end $$;

-- ================================================================ permisos
revoke execute on function public.auditar(uuid, text, text, text, text, jsonb, jsonb), public.auditoria_trigger(), public.auditoria_empresa(),
  public.auditoria_evento(), public.auditar_servidor(uuid, uuid, text, text, text, text, jsonb), public.auditoria_ignorar(text) from public, anon, authenticated;
grant execute on function public.auditar_servidor(uuid, uuid, text, text, text, text, jsonb) to service_role;
revoke execute on function public.segundo_factor_pendiente(), public.tiene_segundo_factor(), public.sesion_aal2() from public, anon;
grant execute on function public.segundo_factor_pendiente(), public.tiene_segundo_factor(), public.sesion_aal2() to authenticated;
