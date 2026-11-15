-- Herramientas de supervisión: mapa de la flota, historial por equipo, fallas repetidas,
-- asignación de equipos y obras por operario, y resumen diario.

-- ================================================================ 1. Mapa: última ubicación conocida de cada equipo
-- La más reciente entre el último checklist con GPS y la última lectura de telemetría (JDLink).
create function public.ubicaciones_flota(p_empresa uuid)
returns table (equipo_id uuid, codigo text, nombre text, estado public.estado_equipo, en_uso boolean, lat double precision, lng double precision,
               cuando timestamptz, origen text, operario text, obra text)
language sql stable security definer set search_path = public as $$
  with j as (
    select distinct on (j.equipo_id) j.equipo_id, j.lat, j.lng, j.inicio as cuando, 'checklist'::text as origen, m.nombre as operario, o.nombre as obra
      from jornadas j join miembros m on m.id = j.operario_id left join obras o on o.id = j.obra_id
     where j.empresa_id = p_empresa and j.lat is not null
     order by j.equipo_id, j.inicio desc
  ), t as (
    select distinct on (l.equipo_id) l.equipo_id, l.lat, l.lng, l.medido_en as cuando, 'telemetria'::text as origen, null::text as operario, null::text as obra
      from telemetria_lecturas l where l.empresa_id = p_empresa and l.lat is not null
     order by l.equipo_id, l.medido_en desc
  ), u as (
    select distinct on (x.equipo_id) x.* from (select * from j union all select * from t) x order by x.equipo_id, x.cuando desc
  )
  select e.id, e.codigo, e.nombre, e.estado, exists (select 1 from jornadas a where a.equipo_id = e.id and a.estado = 'abierta'),
         u.lat, u.lng, u.cuando, u.origen, u.operario, u.obra
    from equipos e join u on u.equipo_id = e.id
   where e.empresa_id = p_empresa and e.activo and es_gestor(p_empresa)
   order by e.codigo
$$;

-- ================================================================ 2. Historial del equipo en una sola línea de tiempo
create function public.historial_equipo(p_equipo uuid, p_dias integer default 90, p_limite integer default 300)
returns table (cuando timestamptz, tipo text, nivel text, titulo text, detalle text, quien text, jornada_id uuid, orden_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_eq equipos; v_desde timestamptz := now() - make_interval(days => p_dias); tz constant text := 'America/Argentina/Buenos_Aires'; u text;
begin
  select * into v_eq from equipos where id = p_equipo;
  if not found or not es_gestor(v_eq.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  u := case v_eq.medidor when 'km' then 'km' else 'h' end;
  return query
  select * from (
    select j.inicio, 'checklist'::text, case j.resultado when 'apto' then 'ok' when 'observaciones' then 'warn' else 'bad' end,
           'Checklist: ' || case j.resultado when 'apto' then 'apto' when 'observaciones' then 'apto con observaciones' else 'no apto' end,
           concat_ws(' · ', o.nombre, case when j.n_fallas > 0 then j.n_fallas || ' falla' || case when j.n_fallas > 1 then 's' else '' end end,
                     case when j.uso is not null then replace(round(j.uso, 1)::text, '.', ',') || ' ' || u || ' de trabajo' end),
           m.nombre, j.id, null::uuid
      from jornadas j join miembros m on m.id = j.operario_id left join obras o on o.id = j.obra_id
     where j.equipo_id = p_equipo and j.inicio >= v_desde
    union all
    select f.creada_en + interval '1 second', 'falla', case when f.critica then 'bad' when f.grave then 'bad' else 'warn' end,
           case when f.critica then 'Falla crítica: ' when f.grave then 'Advertencia: ' else 'Falla: ' end || f.texto, f.nota, null, f.jornada_id, f.orden_id
      from fallas f where f.equipo_id = p_equipo and f.creada_en >= v_desde
    union all
    select f.reparada_en, 'falla_reparada', 'ok', 'Falla reparada: ' || f.texto, f.reparacion, m.nombre, f.jornada_id, f.orden_id
      from fallas f left join miembros m on m.id = f.reparada_por
     where f.equipo_id = p_equipo and f.estado = 'reparada' and f.reparada_en >= v_desde and f.orden_id is null
    union all
    select ot.creada_en, 'orden', case ot.prioridad when 'alta' then 'bad' else 'info' end, 'OT ' || ot.numero || ' creada: ' || ot.titulo,
           concat_ws(' · ', 'prioridad ' || ot.prioridad, 'asignada a ' || a.nombre), c.nombre, null, ot.id
      from ordenes_trabajo ot left join miembros a on a.id = ot.asignado_a left join miembros c on c.id = ot.creada_por
     where ot.equipo_id = p_equipo and ot.creada_en >= v_desde
    union all
    select ot.terminada_en, 'orden_terminada', 'ok', 'OT ' || ot.numero || ' terminada' || case when ot.libero_equipo then ' · equipo liberado' else '' end,
           ot.trabajo_realizado, a.nombre, null, ot.id
      from ordenes_trabajo ot left join miembros a on a.id = ot.asignado_a
     where ot.equipo_id = p_equipo and ot.estado = 'terminada' and ot.terminada_en >= v_desde
    union all
    select (mt.realizado_en::timestamp + time '12:00') at time zone tz, 'mantenimiento', 'info',
           case mt.tipo when 'service' then 'Service' when 'reparacion' then 'Reparación' else 'Trabajo' end || coalesce(': ' || p.nombre, ''),
           concat_ws(' · ', mt.descripcion, case when mt.costo is not null then '$ ' || round(mt.costo)::text end), coalesce(mt.responsable, m.nombre), null, null
      from mantenimientos mt left join planes_mantenimiento p on p.id = mt.plan_id left join miembros m on m.id = mt.registrado_por
     where mt.equipo_id = p_equipo and mt.realizado_en >= v_desde::date and mt.descripcion not like 'OT % · %'
    union all
    select c.cargado_en, 'combustible', 'info', 'Carga de combustible: ' || replace(round(c.litros, 1)::text, '.', ',') || ' L',
           concat_ws(' · ', case when c.medidor is not null then replace(round(c.medidor, 1)::text, '.', ',') || ' ' || u end, case when c.tanque_lleno then 'tanque lleno' else 'carga parcial' end),
           m.nombre, null, null
      from cargas_combustible c left join miembros m on m.id = c.miembro_id
     where c.equipo_id = p_equipo and c.cargado_en >= v_desde
    union all
    select ev.creado_en + interval '2 seconds', 'evento', case ev.tipo when 'bloqueo' then 'bad' when 'liberacion' then 'ok' else 'warn' end,
           case ev.tipo when 'bloqueo' then 'Equipo bloqueado' when 'liberacion' then 'Equipo liberado' when 'fuera_servicio' then 'Fuera de servicio' else 'Vuelve a servicio' end,
           ev.detalle, m.nombre, ev.jornada_id, null
      from eventos_equipo ev left join miembros m on m.id = ev.miembro_id
     where ev.equipo_id = p_equipo and ev.creado_en >= v_desde
  ) h(cuando, tipo, nivel, titulo, detalle, quien, jornada_id, orden_id)
  order by 1 desc limit p_limite;
end $$;

-- ================================================================ 3. Fallas repetidas
-- La misma falla (mismo punto del checklist) en el mismo equipo: 3 veces o más en el período,
-- o que volvió a aparecer después de haberse marcado como reparada.
create function public.fallas_repetidas(p_empresa uuid, p_dias integer default 30)
returns table (equipo_id uuid, codigo text, texto text, veces integer, reparaciones integer, primera timestamptz, ultima timestamptz, abierta boolean, motivo text)
language sql stable security definer set search_path = public as $$
  with g as (
    select f.equipo_id, coalesce(f.item_id, f.texto) as clave, (array_agg(f.texto order by f.creada_en desc))[1] as texto,
           count(*)::int as veces, min(f.creada_en) as primera, max(f.creada_en) as ultima, bool_or(f.estado = 'abierta') as abierta,
           count(*) filter (where f.estado = 'reparada')::int as reparaciones, min(f.reparada_en) as primera_rep
      from fallas f
     where f.empresa_id = p_empresa and f.creada_en >= now() - make_interval(days => p_dias) and f.origen = 'checklist'
     group by 1, 2
  )
  select g.equipo_id, e.codigo, g.texto, g.veces, g.reparaciones, g.primera, g.ultima, g.abierta,
         case when g.primera_rep is not null and g.ultima > g.primera_rep then 'reaparecio' else 'repetida' end
    from g join equipos e on e.id = g.equipo_id
   where es_gestor(p_empresa) and g.veces >= 2 and (g.veces >= 3 or (g.primera_rep is not null and g.ultima > g.primera_rep))
   order by g.ultima desc
$$;

-- ================================================================ 4. Asignación de equipos y obras por persona
-- Sin asignaciones, la persona puede usar cualquier equipo y obra (como hasta ahora).
-- Con asignaciones de equipos, solo esos equipos; con asignaciones de obras, solo esas obras.
create table public.asignaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas on delete cascade,
  miembro_id  uuid not null references public.miembros on delete cascade,
  equipo_id   uuid references public.equipos on delete cascade,
  obra_id     uuid references public.obras on delete cascade,
  creada_en   timestamptz not null default now(),
  check ((equipo_id is null) <> (obra_id is null)),
  unique (miembro_id, equipo_id),
  unique (miembro_id, obra_id)
);
create index on public.asignaciones (empresa_id);
alter table public.asignaciones enable row level security;
create policy asignaciones_ver on public.asignaciones for select to authenticated
  using (public.es_gestor(empresa_id) or miembro_id = public.mi_miembro_id(empresa_id));

-- Reemplaza las asignaciones de una persona (listas vacías = sin restricción).
create function public.asignar(p_miembro uuid, p_equipos uuid[], p_obras uuid[]) returns void
  language plpgsql security definer set search_path = public as $$
declare v_m miembros;
begin
  select * into v_m from miembros where id = p_miembro;
  if not found or not es_gestor(v_m.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_equipos, '{}')) x where not exists (select 1 from equipos where id = x and empresa_id = v_m.empresa_id))
     or exists (select 1 from unnest(coalesce(p_obras, '{}')) x where not exists (select 1 from obras where id = x and empresa_id = v_m.empresa_id)) then
    raise exception 'Equipo u obra de otra empresa' using errcode = 'P0001';
  end if;
  delete from asignaciones where miembro_id = p_miembro;
  insert into asignaciones (empresa_id, miembro_id, equipo_id) select distinct v_m.empresa_id, p_miembro, x from unnest(coalesce(p_equipos, '{}')) x;
  insert into asignaciones (empresa_id, miembro_id, obra_id) select distinct v_m.empresa_id, p_miembro, x from unnest(coalesce(p_obras, '{}')) x;
end $$;

-- El servidor no acepta una jornada con un equipo u obra que la persona no tiene asignados.
create function public.exigir_asignacion() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from asignaciones where miembro_id = new.operario_id and equipo_id is not null)
     and not exists (select 1 from asignaciones where miembro_id = new.operario_id and equipo_id = new.equipo_id) then
    raise exception 'No tenés asignado el equipo %', (select codigo from equipos where id = new.equipo_id) using errcode = 'P0001';
  end if;
  if new.obra_id is not null and exists (select 1 from asignaciones where miembro_id = new.operario_id and obra_id is not null)
     and not exists (select 1 from asignaciones where miembro_id = new.operario_id and obra_id = new.obra_id) then
    raise exception 'No tenés asignada la obra %', (select nombre from obras where id = new.obra_id) using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger jornadas_asignacion before insert on public.jornadas
  for each row execute function public.exigir_asignacion();

-- ================================================================ 5. Resumen diario
-- Todo lo que pasó en un día, para el panel y para el correo de las 19 h.
create function public.resumen_diario_interno(p_empresa uuid, p_fecha date) returns jsonb
  language sql stable security definer set search_path = public as $$
  with tz as (select 'America/Argentina/Buenos_Aires'::text as z),
  j as (select j.*, e.codigo, e.medidor, m.nombre as operario, o.nombre as obra
          from jornadas j join equipos e on e.id = j.equipo_id join miembros m on m.id = j.operario_id left join obras o on o.id = j.obra_id, tz
         where j.empresa_id = p_empresa and (j.inicio at time zone tz.z)::date = p_fecha)
  select jsonb_build_object(
    'fecha', p_fecha, 'empresa', (select nombre from empresas where id = p_empresa),
    'checklists', (select count(*) from j), 'aptos', (select count(*) from j where resultado = 'apto'),
    'observaciones', (select count(*) from j where resultado = 'observaciones'), 'no_aptos', (select count(*) from j where resultado = 'no_apto'),
    'rapidos', (select count(*) from j where rapido),
    'horas', coalesce((select sum(uso) from j where medidor = 'horas'), 0), 'km', coalesce((select sum(uso) from j where medidor = 'km'), 0),
    'operarios', (select count(distinct operario_id) from j), 'equipos_trabajaron', (select count(distinct equipo_id) from j where estado <> 'rechazada'),
    'por_obra', coalesce((select jsonb_agg(jsonb_build_object('obra', x.obra, 'equipos', x.equipos, 'horas', x.horas) order by x.equipos desc)
        from (select coalesce(obra, 'Sin obra') as obra, count(distinct equipo_id) as equipos, coalesce(sum(uso) filter (where medidor = 'horas'), 0) as horas
                from j where estado <> 'rechazada' group by 1) x), '[]'),
    'bloqueados', coalesce((select jsonb_agg(jsonb_build_object('codigo', e.codigo, 'equipo', e.nombre, 'motivo', e.motivo_bloqueo, 'desde', e.bloqueado_en,
          'orden', (select 'OT ' || ot.numero from ordenes_trabajo ot where ot.equipo_id = e.id and ot.estado not in ('terminada', 'cancelada') order by ot.numero limit 1)) order by e.codigo)
        from equipos e where e.empresa_id = p_empresa and e.activo and e.estado = 'bloqueado'), '[]'),
    'fallas_nuevas', coalesce((select jsonb_agg(jsonb_build_object('codigo', e.codigo, 'texto', f.texto, 'nota', f.nota, 'critica', f.critica, 'grave', f.grave,
          'estado', f.estado, 'operario', m.nombre) order by f.critica desc, f.grave desc, e.codigo)
        from fallas f join equipos e on e.id = f.equipo_id join jornadas jj on jj.id = f.jornada_id join miembros m on m.id = jj.operario_id, tz
       where f.empresa_id = p_empresa and (jj.inicio at time zone tz.z)::date = p_fecha), '[]'),   -- por el día del checklist, no el de llegada
    'sin_checklist', coalesce((select jsonb_agg(e.codigo order by e.codigo) from equipos e
       where e.empresa_id = p_empresa and e.activo and e.estado = 'operativo' and not exists (select 1 from j where j.equipo_id = e.id)), '[]'),
    'sin_cerrar', coalesce((select jsonb_agg(jsonb_build_object('codigo', e.codigo, 'operario', m.nombre, 'desde', a.inicio) order by a.inicio)
        from jornadas a join equipos e on e.id = a.equipo_id join miembros m on m.id = a.operario_id
       where a.empresa_id = p_empresa and a.estado = 'abierta'), '[]'),
    'ordenes_abiertas', (select count(*) from ordenes_trabajo where empresa_id = p_empresa and estado not in ('terminada', 'cancelada')),
    'ordenes_terminadas', coalesce((select jsonb_agg(jsonb_build_object('numero', ot.numero, 'codigo', e.codigo, 'titulo', ot.titulo, 'libero', ot.libero_equipo) order by ot.numero)
        from ordenes_trabajo ot join equipos e on e.id = ot.equipo_id, tz
       where ot.empresa_id = p_empresa and ot.estado = 'terminada' and (ot.terminada_en at time zone tz.z)::date = p_fecha), '[]'),
    'litros', coalesce((select sum(c.litros) from cargas_combustible c, tz where c.empresa_id = p_empresa and (c.cargado_en at time zone tz.z)::date = p_fecha), 0),
    'repetidas', coalesce((select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'texto', r.texto, 'veces', r.veces, 'motivo', r.motivo))
        from (select f.equipo_id, e.codigo, (array_agg(f.texto))[1] as texto, count(*) as veces,
                     case when min(f.reparada_en) is not null and max(f.creada_en) > min(f.reparada_en) then 'reaparecio' else 'repetida' end as motivo
                from fallas f join equipos e on e.id = f.equipo_id
               where f.empresa_id = p_empresa and f.creada_en >= now() - interval '30 days' and f.origen = 'checklist'
               group by f.equipo_id, e.codigo, coalesce(f.item_id, f.texto)
              having count(*) >= 3 or (count(*) >= 2 and min(f.reparada_en) is not null and max(f.creada_en) > min(f.reparada_en))) r), '[]')
  )
$$;
create function public.resumen_diario(p_empresa uuid, p_fecha date default ((now() at time zone 'America/Argentina/Buenos_Aires')::date)) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  return resumen_diario_interno(p_empresa, p_fecha);
end $$;

-- Correo diario: un aviso por empresa con actividad o con equipos bloqueados (lo dispara pg_cron a las 19 h).
alter table public.notificaciones drop constraint notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in ('equipo_bloqueado', 'resumen_diario'));
create function public.encolar_resumenes(p_fecha date default ((now() at time zone 'America/Argentina/Buenos_Aires')::date)) returns integer
  language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  -- Un resumen que no salió en un día ya no sirve: no se acumulan (por ejemplo, si el correo todavía no está configurado).
  delete from notificaciones where tipo = 'resumen_diario' and estado = 'pendiente' and creada_en < now() - interval '20 hours';
  insert into notificaciones (empresa_id, tipo, datos)
  select e.id, 'resumen_diario', resumen_diario_interno(e.id, p_fecha)
    from empresas e
   where (exists (select 1 from jornadas j where j.empresa_id = e.id and (j.inicio at time zone 'America/Argentina/Buenos_Aires')::date = p_fecha)
          or exists (select 1 from equipos q where q.empresa_id = e.id and q.activo and q.estado = 'bloqueado'))
     and not exists (select 1 from notificaciones n where n.empresa_id = e.id and n.tipo = 'resumen_diario' and n.datos->>'fecha' = p_fecha::text);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ================================================================ permisos
revoke all on public.asignaciones from anon;
revoke insert, update, delete, truncate on public.asignaciones from authenticated;
grant select on public.asignaciones to authenticated;
revoke execute on function public.ubicaciones_flota(uuid), public.historial_equipo(uuid, integer, integer), public.fallas_repetidas(uuid, integer),
  public.asignar(uuid, uuid[], uuid[]), public.resumen_diario(uuid, date) from public, anon;
grant execute on function public.ubicaciones_flota(uuid), public.historial_equipo(uuid, integer, integer), public.fallas_repetidas(uuid, integer),
  public.asignar(uuid, uuid[], uuid[]), public.resumen_diario(uuid, date) to authenticated;
revoke execute on function public.resumen_diario_interno(uuid, date), public.encolar_resumenes(date), public.exigir_asignacion() from public, anon, authenticated;
