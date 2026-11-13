-- Órdenes de trabajo para el taller (rol mecánico) y costos por obra (tarifas por equipo).

alter type public.rol_miembro add value if not exists 'mecanico';

-- ================================================================ tarifas de los equipos
alter table public.equipos
  add column tarifa_hora numeric(14,2) check (tarifa_hora is null or tarifa_hora >= 0),
  add column tarifa_dia  numeric(14,2) check (tarifa_dia is null or tarifa_dia >= 0);

-- ================================================================ órdenes de trabajo
create type public.estado_orden as enum ('abierta', 'en_curso', 'esperando_repuestos', 'terminada', 'cancelada');
create type public.prioridad_orden as enum ('alta', 'media', 'baja');

create table public.ordenes_trabajo (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas on delete cascade,
  numero            integer not null,
  equipo_id         uuid not null references public.equipos on delete cascade,
  titulo            text not null check (length(trim(titulo)) between 3 and 120),
  descripcion       text,
  prioridad         public.prioridad_orden not null default 'media',
  estado            public.estado_orden not null default 'abierta',
  asignado_a        uuid references public.miembros,
  creada_por        uuid references public.miembros,
  creada_en         timestamptz not null default now(),
  iniciada_en       timestamptz,
  terminada_en      timestamptz,
  trabajo_realizado text,
  horas             numeric(8,1) check (horas is null or horas >= 0),
  costo_mano_obra   numeric(14,2) check (costo_mano_obra is null or costo_mano_obra >= 0),
  medidor           numeric(12,1),
  foto_path         text,
  libero_equipo     boolean not null default false,
  unique (empresa_id, numero)
);
create index on public.ordenes_trabajo (empresa_id, estado);
create index on public.ordenes_trabajo (asignado_a, estado);

create table public.repuestos_orden (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas on delete cascade,
  orden_id        uuid not null references public.ordenes_trabajo on delete cascade,
  descripcion     text not null check (length(trim(descripcion)) between 2 and 160),
  cantidad        numeric(10,2) not null default 1 check (cantidad > 0),
  costo_unitario  numeric(14,2) check (costo_unitario is null or costo_unitario >= 0),
  cargado_por     uuid references public.miembros,
  creado_en       timestamptz not null default now()
);
create index on public.repuestos_orden (orden_id);

alter table public.fallas add column orden_id uuid references public.ordenes_trabajo on delete set null;
create index on public.fallas (orden_id);

-- ¿Quien llama es supervisor/administrador de la empresa de la orden, o el mecánico asignado?
create function public.puede_trabajar_orden(p_orden uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from ordenes_trabajo o
                  where o.id = p_orden and (es_gestor(o.empresa_id) or o.asignado_a = mi_miembro_id(o.empresa_id)))
$$;

-- Crear una orden (supervisión). p: {equipo_id, falla_ids[], titulo, descripcion, prioridad, asignado_a}
create function public.crear_orden(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_num int; v_id uuid; v_fallas uuid[];
begin
  select * into v_eq from equipos where id = (p->>'equipo_id')::uuid;
  if not found or not es_gestor(v_eq.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if (p->>'asignado_a') is not null and not exists (select 1 from miembros where id = (p->>'asignado_a')::uuid and empresa_id = v_eq.empresa_id and activo) then
    raise exception 'La persona asignada no es de la empresa' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(x::uuid), '{}') into v_fallas from jsonb_array_elements_text(coalesce(p->'falla_ids', '[]')) x;
  if exists (select 1 from unnest(v_fallas) f where not exists (select 1 from fallas where id = f and equipo_id = v_eq.id and estado = 'abierta')) then
    raise exception 'Las fallas tienen que ser del mismo equipo y estar abiertas' using errcode = 'P0001';
  end if;
  if exists (select 1 from fallas fa join ordenes_trabajo o on o.id = fa.orden_id where fa.id = any(v_fallas) and o.estado not in ('terminada', 'cancelada')) then
    raise exception 'Alguna de esas fallas ya está en otra orden abierta' using errcode = 'P0001';
  end if;
  perform 1 from empresas where id = v_eq.empresa_id for update;          -- numeración sin repetir
  select coalesce(max(numero), 0) + 1 into v_num from ordenes_trabajo where empresa_id = v_eq.empresa_id;
  insert into ordenes_trabajo (empresa_id, numero, equipo_id, titulo, descripcion, prioridad, asignado_a, creada_por)
  values (v_eq.empresa_id, v_num, v_eq.id, trim(p->>'titulo'), nullif(trim(coalesce(p->>'descripcion', '')), ''),
          coalesce((p->>'prioridad')::prioridad_orden, 'media'), (p->>'asignado_a')::uuid, mi_miembro_id(v_eq.empresa_id))
  returning id into v_id;
  update fallas set orden_id = v_id where id = any(v_fallas);
  return jsonb_build_object('orden_id', v_id, 'numero', v_num);
end $$;

-- Cambios de la supervisión: título, prioridad, asignación, descripción.
create function public.editar_orden(p_orden uuid, p jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo;
begin
  select * into v_o from ordenes_trabajo where id = p_orden for update;
  if not found or not es_gestor(v_o.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  if (p->>'asignado_a') is not null and not exists (select 1 from miembros where id = (p->>'asignado_a')::uuid and empresa_id = v_o.empresa_id and activo) then
    raise exception 'La persona asignada no es de la empresa' using errcode = 'P0001';
  end if;
  update ordenes_trabajo set titulo = coalesce(nullif(trim(p->>'titulo'), ''), titulo), descripcion = coalesce(p->>'descripcion', descripcion),
         prioridad = coalesce((p->>'prioridad')::prioridad_orden, prioridad),
         asignado_a = case when p ? 'asignado_a' then (p->>'asignado_a')::uuid else asignado_a end
   where id = p_orden;
end $$;

-- Avance: en curso / esperando repuestos (supervisión o mecánico asignado); cancelar solo supervisión.
create function public.cambiar_estado_orden(p_orden uuid, p_estado public.estado_orden) returns void
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo;
begin
  select * into v_o from ordenes_trabajo where id = p_orden for update;
  if not found or not puede_trabajar_orden(p_orden) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  if p_estado = 'terminada' then raise exception 'Para terminar la orden usá Terminar' using errcode = 'P0001'; end if;
  if p_estado = 'cancelada' and not es_gestor(v_o.empresa_id) then raise exception 'Solo la supervisión puede cancelar una orden' using errcode = '42501'; end if;
  update ordenes_trabajo set estado = p_estado, iniciada_en = coalesce(iniciada_en, case when p_estado = 'en_curso' then now() end) where id = p_orden;
  if p_estado = 'cancelada' then update fallas set orden_id = null where orden_id = p_orden and estado = 'abierta'; end if;
end $$;

create function public.agregar_repuesto(p_orden uuid, p_descripcion text, p_cantidad numeric, p_costo numeric) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo; v_id uuid;
begin
  select * into v_o from ordenes_trabajo where id = p_orden;
  if not found or not puede_trabajar_orden(p_orden) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  insert into repuestos_orden (empresa_id, orden_id, descripcion, cantidad, costo_unitario, cargado_por)
  values (v_o.empresa_id, p_orden, trim(p_descripcion), coalesce(p_cantidad, 1), p_costo, mi_miembro_id(v_o.empresa_id)) returning id into v_id;
  return v_id;
end $$;

create function public.quitar_repuesto(p_repuesto uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo;
begin
  select o.* into v_o from ordenes_trabajo o join repuestos_orden r on r.orden_id = o.id where r.id = p_repuesto;
  if not found or not puede_trabajar_orden(v_o.id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  delete from repuestos_orden where id = p_repuesto;
end $$;

-- Terminar la orden: repara sus fallas, deja el trabajo en el historial y libera el equipo si ya no tiene fallas críticas abiertas.
-- p: {trabajo_realizado, horas, costo_mano_obra, medidor, foto_path}
create function public.terminar_orden(p_orden uuid, p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo; v_eq equipos; v_m uuid; v_rep numeric; v_libera boolean := false; v_txt text; v_pref text;
begin
  select * into v_o from ordenes_trabajo where id = p_orden for update;
  if not found or not puede_trabajar_orden(p_orden) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  v_txt := trim(coalesce(p->>'trabajo_realizado', ''));
  if length(v_txt) < 5 then raise exception 'Contá qué trabajo se hizo' using errcode = 'P0001'; end if;
  v_pref := v_o.empresa_id::text || '/' || auth.uid()::text || '/';
  if (p->>'foto_path') is not null and left(p->>'foto_path', length(v_pref)) <> v_pref then raise exception 'Foto inválida' using errcode = 'P0001'; end if;
  v_m := mi_miembro_id(v_o.empresa_id);
  select coalesce(sum(cantidad * coalesce(costo_unitario, 0)), 0) into v_rep from repuestos_orden where orden_id = p_orden;

  update fallas set estado = 'reparada', reparada_por = v_m, reparada_en = now(), reparacion = 'OT ' || v_o.numero || ': ' || v_txt
   where orden_id = p_orden and estado = 'abierta';

  insert into mantenimientos (empresa_id, equipo_id, tipo, descripcion, medidor, realizado_en, costo, responsable, registrado_por)
  values (v_o.empresa_id, v_o.equipo_id, 'reparacion', left('OT ' || v_o.numero || ' · ' || v_o.titulo || ': ' || v_txt, 500), (p->>'medidor')::numeric,
          (now() at time zone 'America/Argentina/Buenos_Aires')::date, nullif(v_rep + coalesce((p->>'costo_mano_obra')::numeric, 0), 0),
          (select nombre from miembros where id = v_m), v_m);

  select * into v_eq from equipos where id = v_o.equipo_id for update;
  if v_eq.estado = 'bloqueado' and not exists (select 1 from fallas where equipo_id = v_eq.id and critica and estado = 'abierta') then
    perform set_config('checkobra.rpc', 'on', true);
    update equipos set estado = 'operativo', motivo_bloqueo = null, bloqueado_en = null, bloqueo_jornada_id = null where id = v_eq.id;
    perform set_config('checkobra.rpc', 'off', true);
    insert into eventos_equipo (empresa_id, equipo_id, tipo, detalle, miembro_id, jornada_id)
    values (v_eq.empresa_id, v_eq.id, 'liberacion', 'OT ' || v_o.numero || ': ' || v_txt, v_m, v_eq.bloqueo_jornada_id);
    v_libera := true;
  end if;

  update ordenes_trabajo set estado = 'terminada', terminada_en = now(), iniciada_en = coalesce(iniciada_en, now()), trabajo_realizado = v_txt,
         horas = (p->>'horas')::numeric, costo_mano_obra = (p->>'costo_mano_obra')::numeric, medidor = (p->>'medidor')::numeric,
         foto_path = p->>'foto_path', libero_equipo = v_libera
   where id = p_orden;
  return jsonb_build_object('libero_equipo', v_libera, 'costo_repuestos', v_rep);
end $$;

-- El mecánico ve las fotos de las fallas de sus órdenes (no las selfies ni las demás fotos de los checklists).
create function public.foto_de_mi_orden(p_path text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from fallas f join ordenes_trabajo o on o.id = f.orden_id
                  where f.foto_path = p_path and o.asignado_a = mi_miembro_id(o.empresa_id))
$$;
create policy evidencias_ver_mecanico on storage.objects for select to authenticated
  using (bucket_id = 'evidencias' and public.foto_de_mi_orden(name));

-- ================================================================ costos por obra
-- Uso y costo de cada equipo por obra en el período: días con jornada, horas o km (jornadas cerradas),
-- costo según la tarifa (por hora o, si no hay, por día), combustible y reparaciones/services con costo.
-- Lo que no tiene obra (cargas sin jornada, reparaciones) se reparte entre obras según las horas del equipo.
create function public.costos_por_obra(p_empresa uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; tz constant text := 'America/Argentina/Buenos_Aires';
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  with j as (
    select j.equipo_id, coalesce(j.obra_id::text, '-') as obra, (j.inicio at time zone tz)::date as dia, coalesce(j.uso, 0) as uso
      from jornadas j where j.empresa_id = p_empresa and (j.inicio at time zone tz)::date between p_desde and p_hasta and j.estado <> 'rechazada'
  ),
  eo as (    -- equipo × obra
    select equipo_id, obra, count(distinct dia) as dias, sum(uso) as uso from j group by 1, 2
  ),
  tot as (select equipo_id, sum(uso) as uso, sum(dias) as dias from eo group by 1),
  comb as (  -- combustible: con obra, directo; sin obra, se reparte
    select c.equipo_id, coalesce(c.obra_id::text, '-') as obra, sum(c.litros) as litros, sum(c.litros * c.precio_litro) as pesos
      from cargas_combustible c where c.empresa_id = p_empresa and (c.cargado_en at time zone tz)::date between p_desde and p_hasta group by 1, 2
  ),
  rep as (   -- reparaciones y services del período con costo
    select equipo_id, sum(costo) as pesos from mantenimientos where empresa_id = p_empresa and realizado_en between p_desde and p_hasta and costo is not null group by 1
  ),
  fila as (
    select eo.equipo_id, eo.obra, eo.dias, eo.uso, e.medidor, e.tarifa_hora, e.tarifa_dia,
           -- proporción de esta obra en el uso del equipo (horas; si no hay horas, días)
           case when coalesce(t.uso, 0) > 0 then eo.uso / t.uso when t.dias > 0 then eo.dias::numeric / t.dias else 1 end as prop,
           case when e.tarifa_hora is not null and e.medidor = 'horas' then eo.uso * e.tarifa_hora
                when e.tarifa_dia is not null then eo.dias * e.tarifa_dia end as costo_equipo
      from eo join equipos e on e.id = eo.equipo_id join tot t on t.equipo_id = eo.equipo_id
  ),
  final as (
    select f.*,
           coalesce((select litros from comb c where c.equipo_id = f.equipo_id and c.obra = f.obra), 0)
             + f.prop * coalesce((select litros from comb c where c.equipo_id = f.equipo_id and c.obra = '-'), 0) as litros,
           coalesce((select pesos from comb c where c.equipo_id = f.equipo_id and c.obra = f.obra), 0)
             + f.prop * coalesce((select pesos from comb c where c.equipo_id = f.equipo_id and c.obra = '-'), 0) as combustible,
           f.prop * coalesce((select pesos from rep r where r.equipo_id = f.equipo_id), 0) as reparaciones
      from fila f
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'obra_id', nullif(f.obra, '-'), 'obra', coalesce(o.nombre, 'Sin obra'),
        'equipo_id', f.equipo_id, 'codigo', e.codigo, 'equipo', e.nombre, 'medidor', f.medidor,
        'dias', f.dias, 'uso', round(f.uso, 1), 'tarifa_hora', f.tarifa_hora, 'tarifa_dia', f.tarifa_dia,
        'costo_equipo', round(f.costo_equipo, 0), 'litros', round(f.litros, 1), 'combustible', round(f.combustible, 0),
        'reparaciones', round(f.reparaciones, 0),
        'total', round(coalesce(f.costo_equipo, 0) + f.combustible + f.reparaciones, 0)) order by o.nombre nulls last, e.codigo)
      from final f join equipos e on e.id = f.equipo_id left join obras o on o.id::text = f.obra), '[]'),
    'sin_tarifa', coalesce((select jsonb_agg(distinct e.codigo) from eo join equipos e on e.id = eo.equipo_id
                              where e.tarifa_dia is null and (e.tarifa_hora is null or e.medidor = 'km')), '[]'),
    'reparaciones_sin_uso', coalesce((select sum(r.pesos) from rep r where not exists (select 1 from eo where eo.equipo_id = r.equipo_id)), 0)
  ) into v;
  return v;
end $$;

-- ================================================================ RLS y permisos
alter table public.ordenes_trabajo enable row level security;
alter table public.repuestos_orden enable row level security;
create policy ot_ver on public.ordenes_trabajo for select to authenticated
  using (public.es_gestor(empresa_id) or asignado_a = public.mi_miembro_id(empresa_id));
create policy ot_borrar on public.ordenes_trabajo for delete to authenticated using (public.es_admin(empresa_id));
create policy rep_ver on public.repuestos_orden for select to authenticated using (public.puede_trabajar_orden(orden_id));
-- El mecánico ve las fallas de sus órdenes.
create policy fallas_ver_mecanico on public.fallas for select to authenticated
  using (orden_id is not null and exists (select 1 from public.ordenes_trabajo o where o.id = orden_id and o.asignado_a = public.mi_miembro_id(o.empresa_id)));

revoke all on public.ordenes_trabajo, public.repuestos_orden from anon;
revoke insert, update, truncate on public.ordenes_trabajo, public.repuestos_orden from authenticated;
grant select, delete on public.ordenes_trabajo to authenticated;
grant select on public.repuestos_orden to authenticated;
revoke execute on function public.crear_orden(jsonb), public.editar_orden(uuid, jsonb), public.cambiar_estado_orden(uuid, public.estado_orden),
  public.agregar_repuesto(uuid, text, numeric, numeric), public.quitar_repuesto(uuid), public.terminar_orden(uuid, jsonb),
  public.costos_por_obra(uuid, date, date), public.puede_trabajar_orden(uuid), public.foto_de_mi_orden(text) from public, anon;
grant execute on function public.crear_orden(jsonb), public.editar_orden(uuid, jsonb), public.cambiar_estado_orden(uuid, public.estado_orden),
  public.agregar_repuesto(uuid, text, numeric, numeric), public.quitar_repuesto(uuid), public.terminar_orden(uuid, jsonb),
  public.costos_por_obra(uuid, date, date), public.puede_trabajar_orden(uuid), public.foto_de_mi_orden(text) to authenticated;
