-- Costo de operarios, presupuesto por obra y stock de repuestos del taller.

-- ================================================================ costo de los operarios (solo administración)
-- En tabla aparte: supervisores y operarios no ven cuánto cuesta cada persona.
create table public.costos_personal (
  miembro_id     uuid primary key references public.miembros on delete cascade,
  empresa_id     uuid not null references public.empresas on delete cascade,
  costo_hora     numeric(12,2) not null check (costo_hora >= 0),
  actualizado_en timestamptz not null default now()
);
alter table public.costos_personal enable row level security;
create policy cp_admin on public.costos_personal for all to authenticated using (public.es_admin(empresa_id))
  with check (public.es_admin(empresa_id) and exists (select 1 from public.miembros m where m.id = miembro_id and m.empresa_id = costos_personal.empresa_id));
revoke all on public.costos_personal from anon;
grant select, insert, update, delete on public.costos_personal to authenticated;
create trigger auditoria after insert or update or delete on public.costos_personal for each row execute function public.auditoria_trigger();

-- ================================================================ presupuesto por obra
alter table public.obras
  add column presupuesto_mensual numeric(16,2) check (presupuesto_mensual is null or presupuesto_mensual >= 0),
  add column presupuesto_total   numeric(16,2) check (presupuesto_total is null or presupuesto_total >= 0);

-- ================================================================ costos por obra: con mano de obra (solo administración) y presupuestos
create or replace function public.costos_por_obra(p_empresa uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; tz constant text := 'America/Argentina/Buenos_Aires'; v_admin boolean := es_admin(p_empresa);
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  with j as (
    select j.equipo_id, coalesce(j.obra_id::text, '-') as obra, (j.inicio at time zone tz)::date as dia, coalesce(j.uso, 0) as uso,
           -- mano de obra: horas reales de la jornada (inicio a cierre, hasta 16 h) × costo por hora del operario (solo administración)
           case when v_admin and j.fin is not null then least(extract(epoch from (j.fin - j.inicio)) / 3600, 16) * cp.costo_hora end as mano_obra
      from jornadas j left join costos_personal cp on cp.miembro_id = j.operario_id where j.empresa_id = p_empresa and (j.inicio at time zone tz)::date between p_desde and p_hasta and j.estado <> 'rechazada'
  ),
  c0 as (
    select c.equipo_id, coalesce(c.obra_id::text, '-') as obra, c.litros, public.precio_carga(c) as precio, c.precio_litro is null as estimado
      from cargas_combustible c where c.empresa_id = p_empresa and (c.cargado_en at time zone tz)::date between p_desde and p_hasta
  ),
  comb as (
    select equipo_id, obra, sum(litros) as litros, sum(litros * precio) as pesos,
           sum(case when estimado and precio is not null then litros * precio else 0 end) as pesos_est,
           sum(case when precio is null then litros else 0 end) as litros_sin_precio
      from c0 group by 1, 2
  ),
  eo as (    -- equipo × obra: donde trabajó, y donde se le cargó combustible aunque no haya jornada
    select equipo_id, obra, count(distinct dia) as dias, sum(uso) as uso, sum(mano_obra) as mano_obra from j group by 1, 2
    union all
    select c.equipo_id, c.obra, 0, 0, null from comb c
     where c.obra <> '-' and not exists (select 1 from j where j.equipo_id = c.equipo_id and j.obra = c.obra)
  ),
  tot as (select equipo_id, sum(uso) as uso, sum(dias) as dias from eo group by 1),
  rep as (
    select equipo_id, sum(costo) as pesos from mantenimientos where empresa_id = p_empresa and realizado_en between p_desde and p_hasta and costo is not null group by 1
  ),
  fila as (
    select eo.equipo_id, eo.obra, eo.dias, eo.uso, eo.mano_obra, e.medidor, e.tarifa_hora, e.tarifa_dia,
           case when coalesce(t.uso, 0) > 0 then eo.uso / t.uso when t.dias > 0 then eo.dias::numeric / t.dias else 0 end as prop,
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
           coalesce((select pesos_est from comb c where c.equipo_id = f.equipo_id and c.obra = f.obra), 0)
             + f.prop * coalesce((select pesos_est from comb c where c.equipo_id = f.equipo_id and c.obra = '-'), 0) as combustible_est,
           f.prop * coalesce((select pesos from rep r where r.equipo_id = f.equipo_id), 0) as reparaciones
      from fila f
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'obra_id', nullif(f.obra, '-'), 'obra', coalesce(o.nombre, 'Sin obra'),
        'equipo_id', f.equipo_id, 'codigo', e.codigo, 'equipo', e.nombre, 'medidor', f.medidor,
        'dias', f.dias, 'uso', round(f.uso, 1), 'tarifa_hora', f.tarifa_hora, 'tarifa_dia', f.tarifa_dia,
        'costo_equipo', round(f.costo_equipo, 0), 'litros', round(f.litros, 1), 'combustible', round(f.combustible, 0),
        'combustible_estimado', round(f.combustible_est, 0), 'reparaciones', round(f.reparaciones, 0), 'mano_obra', round(f.mano_obra, 0),
        'total', round(coalesce(f.costo_equipo, 0) + f.combustible + f.reparaciones + coalesce(f.mano_obra, 0), 0)) order by o.nombre nulls last, e.codigo)
      from final f join equipos e on e.id = f.equipo_id left join obras o on o.id::text = f.obra), '[]'),
    'sin_tarifa', coalesce((select jsonb_agg(distinct e.codigo) from eo join equipos e on e.id = eo.equipo_id
                              where eo.uso > 0 and e.tarifa_dia is null and (e.tarifa_hora is null or e.medidor = 'km')), '[]'),
    'reparaciones_sin_uso', coalesce((select sum(r.pesos) from rep r where not exists (select 1 from eo where eo.equipo_id = r.equipo_id)), 0),
    'combustible_sin_uso', coalesce((select sum(c.pesos) from comb c where not exists (select 1 from eo where eo.equipo_id = c.equipo_id)), 0),
    'litros_sin_precio', coalesce((select sum(litros_sin_precio) from comb), 0),
    'precio_referencia', (select precio_gasoil from empresas where id = p_empresa),
    'con_mano_obra', v_admin and exists (select 1 from costos_personal where empresa_id = p_empresa),
    'presupuestos', coalesce((select jsonb_object_agg(o.id, jsonb_build_object('mensual', o.presupuesto_mensual, 'total', o.presupuesto_total))
                              from obras o where o.empresa_id = p_empresa and (o.presupuesto_mensual is not null or o.presupuesto_total is not null)), '{}')
  ) into v;
  return v;
end $$;


-- ================================================================ stock de repuestos del taller
create table public.articulos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas on delete cascade,
  codigo         text,
  descripcion    text not null check (length(trim(descripcion)) between 2 and 160),
  unidad         text not null default 'u' check (unidad in ('u', 'l', 'kg', 'm', 'juego')),
  stock          numeric(12,2) not null default 0,
  minimo         numeric(12,2) check (minimo is null or minimo >= 0),
  costo_promedio numeric(14,2),
  ubicacion      text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create table public.movimientos_stock (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas on delete cascade,
  articulo_id    uuid not null references public.articulos on delete cascade,
  tipo           text not null check (tipo in ('ingreso', 'egreso', 'devolucion', 'ajuste')),
  cantidad       numeric(12,2) not null check (cantidad >= 0),  -- ajuste: cantidad que hay contada
  costo_unitario numeric(14,2) check (costo_unitario is null or costo_unitario >= 0),
  orden_id       uuid references public.ordenes_trabajo on delete set null,
  miembro_id     uuid references public.miembros,
  notas          text,
  fecha          timestamptz not null default now(),
  check (tipo = 'ajuste' or cantidad > 0)
);
create index on public.movimientos_stock (articulo_id, fecha desc);
alter table public.repuestos_orden add column articulo_id uuid references public.articulos on delete set null;

-- El stock lo mueven solo los movimientos (y el costo promedio, las compras).
create function public.aplicar_movimiento_stock() returns trigger language plpgsql security definer set search_path = public as $$
declare a articulos;
begin
  select * into a from articulos where id = new.articulo_id for update;
  if a.empresa_id <> new.empresa_id then raise exception 'Artículo de otra empresa' using errcode = '42501'; end if;
  perform set_config('checkobra.stock', 'on', true);
  if new.tipo = 'ingreso' then
    update articulos set stock = stock + new.cantidad,
           costo_promedio = case when new.costo_unitario is null then costo_promedio
                                 when greatest(stock, 0) + new.cantidad = 0 or costo_promedio is null then new.costo_unitario
                                 else round((greatest(stock, 0) * costo_promedio + new.cantidad * new.costo_unitario) / (greatest(stock, 0) + new.cantidad), 2) end
     where id = a.id;
  elsif new.tipo = 'devolucion' then update articulos set stock = stock + new.cantidad where id = a.id;
  elsif new.tipo = 'egreso' then update articulos set stock = stock - new.cantidad where id = a.id;
  else update articulos set stock = new.cantidad where id = a.id;
  end if;
  perform set_config('checkobra.stock', 'off', true);
  return new;
end $$;
create trigger movimientos_stock_aplicar after insert on public.movimientos_stock for each row execute function public.aplicar_movimiento_stock();
create function public.proteger_stock() returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('checkobra.stock', true) is distinct from 'on'
     and (new.stock is distinct from old.stock or new.costo_promedio is distinct from old.costo_promedio) then
    raise exception 'El stock cambia con ingresos, egresos o ajustes' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger articulos_proteger before update on public.articulos for each row execute function public.proteger_stock();

-- Repuestos de la orden: si salen del depósito, se descuentan y toman su costo promedio.
drop function public.agregar_repuesto(uuid, text, numeric, numeric);
create function public.agregar_repuesto(p_orden uuid, p_descripcion text, p_cantidad numeric, p_costo numeric, p_articulo uuid default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo; v_id uuid; v_a articulos; v_c numeric := coalesce(p_cantidad, 1); v_desc text := trim(coalesce(p_descripcion, ''));
begin
  select * into v_o from ordenes_trabajo where id = p_orden;
  if not found or not puede_trabajar_orden(p_orden) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  if p_articulo is not null then
    select * into v_a from articulos where id = p_articulo and empresa_id = v_o.empresa_id and activo for update;
    if not found then raise exception 'Ese repuesto no está en el depósito' using errcode = 'P0001'; end if;
    if v_a.stock < v_c then raise exception 'En el depósito hay % % de "%"', v_a.stock, v_a.unidad, v_a.descripcion using errcode = 'P0001'; end if;
    v_desc := coalesce(nullif(v_desc, ''), v_a.descripcion);
  end if;
  insert into repuestos_orden (empresa_id, orden_id, descripcion, cantidad, costo_unitario, cargado_por, articulo_id)
  values (v_o.empresa_id, p_orden, v_desc, v_c, coalesce(p_costo, v_a.costo_promedio), mi_miembro_id(v_o.empresa_id), p_articulo) returning id into v_id;
  if p_articulo is not null then
    insert into movimientos_stock (empresa_id, articulo_id, tipo, cantidad, costo_unitario, orden_id, miembro_id, notas)
    values (v_o.empresa_id, p_articulo, 'egreso', v_c, v_a.costo_promedio, p_orden, mi_miembro_id(v_o.empresa_id), 'OT ' || v_o.numero);
  end if;
  return v_id;
end $$;

create or replace function public.quitar_repuesto(p_repuesto uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_o ordenes_trabajo; v_r repuestos_orden;
begin
  select * into v_r from repuestos_orden where id = p_repuesto;
  select * into v_o from ordenes_trabajo where id = v_r.orden_id;
  if v_o.id is null or not puede_trabajar_orden(v_o.id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v_o.estado in ('terminada', 'cancelada') then raise exception 'La orden ya está cerrada' using errcode = 'P0001'; end if;
  if v_r.articulo_id is not null then   -- vuelve al depósito
    insert into movimientos_stock (empresa_id, articulo_id, tipo, cantidad, orden_id, miembro_id, notas)
    values (v_o.empresa_id, v_r.articulo_id, 'devolucion', v_r.cantidad, v_o.id, mi_miembro_id(v_o.empresa_id), 'Quitado de la OT ' || v_o.numero);
  end if;
  delete from repuestos_orden where id = p_repuesto;
end $$;

alter table public.articulos enable row level security;
alter table public.movimientos_stock enable row level security;
create policy art_ver on public.articulos for select to authenticated using (public.es_miembro(empresa_id));
create policy art_alta on public.articulos for insert to authenticated with check (public.es_gestor(empresa_id));
create policy art_editar on public.articulos for update to authenticated using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id));
create policy ms_ver on public.movimientos_stock for select to authenticated
  using (public.es_gestor(empresa_id) or public.mi_rol(empresa_id) = 'mecanico');
create policy ms_alta on public.movimientos_stock for insert to authenticated
  with check (public.es_gestor(empresa_id) and tipo in ('ingreso', 'ajuste') and miembro_id = public.mi_miembro_id(empresa_id));
revoke all on public.articulos, public.movimientos_stock from anon;
revoke update, delete, truncate on public.articulos, public.movimientos_stock from authenticated;
revoke insert on public.articulos from authenticated;
grant select on public.articulos, public.movimientos_stock to authenticated;
grant insert (empresa_id, codigo, descripcion, unidad, minimo, ubicacion) on public.articulos to authenticated;
grant update (codigo, descripcion, unidad, minimo, ubicacion, activo) on public.articulos to authenticated;
grant insert on public.movimientos_stock to authenticated;
create trigger auditoria after insert or update or delete on public.articulos for each row execute function public.auditoria_trigger();
revoke execute on function public.aplicar_movimiento_stock(), public.proteger_stock() from public, anon, authenticated;
revoke execute on function public.agregar_repuesto(uuid, text, numeric, numeric, uuid) from public, anon;
grant execute on function public.agregar_repuesto(uuid, text, numeric, numeric, uuid) to authenticated;

-- El stock que cambia con cada movimiento no ensucia la auditoría (sí las altas y cambios de datos del artículo).
create or replace function public.auditoria_ignorar(p_tabla text) returns text[] language sql immutable as $$
  select case p_tabla
    when 'equipos'  then array['ultimo_medidor', 'estado', 'motivo_bloqueo', 'bloqueado_en', 'bloqueo_jornada_id']
    when 'miembros' then array['intentos_fallidos']
    when 'planes_mantenimiento' then array['ultimo_medidor', 'ultimo_en']
    when 'articulos' then array['stock', 'costo_promedio']
    else array[]::text[] end
$$;
