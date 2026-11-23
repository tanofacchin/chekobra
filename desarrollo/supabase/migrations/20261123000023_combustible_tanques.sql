-- Combustible: precio de referencia, tanques propios con stock y precio estimado en los costos.
--
-- · Precio de referencia del gasoil por empresa: se usa en las cargas sin precio (marcado como estimado).
-- · Tanques propios (surtidor, cisterna): ingresos (compras con precio), despachos (las cargas a los equipos)
--   y mediciones físicas (varilla o medidor). La diferencia entre lo medido y lo que debería haber marca faltantes.
-- · El precio de una carga sin precio sale del tanque (promedio de las últimas compras) o, si no, del de referencia.

alter table public.empresas add column precio_gasoil numeric(12,2) check (precio_gasoil is null or precio_gasoil >= 0);

create table public.tanques (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 2 and 60),
  capacidad   numeric(10,1) check (capacidad is null or capacidad > 0),
  obra_id     uuid references public.obras on delete set null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.movimientos_tanque (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas on delete cascade,
  tanque_id    uuid not null references public.tanques on delete cascade,
  tipo         text not null check (tipo in ('ingreso', 'medicion')),
  fecha        timestamptz not null default now(),
  litros       numeric(10,1) not null check (litros >= 0),          -- ingreso: litros recibidos · medición: litros que hay
  precio_litro numeric(12,2) check (precio_litro is null or precio_litro >= 0),
  proveedor    text,
  remito       text,
  notas        text,
  miembro_id   uuid references public.miembros,
  creado_en    timestamptz not null default now(),
  check (tipo = 'medicion' or litros > 0)
);
create index on public.movimientos_tanque (tanque_id, fecha);

alter table public.cargas_combustible add column tanque_id uuid references public.tanques on delete set null;
create index on public.cargas_combustible (tanque_id, cargado_en);

-- ================================================================ precios
-- Precio promedio de las últimas 5 compras del tanque hasta esa fecha.
create function public.precio_tanque(p_tanque uuid, p_hasta timestamptz) returns numeric
  language sql stable security definer set search_path = public as $$
  select round(sum(litros * precio_litro) / nullif(sum(litros), 0), 2) from (
    select litros, precio_litro from movimientos_tanque
     where tanque_id = p_tanque and tipo = 'ingreso' and precio_litro is not null and fecha <= p_hasta
     order by fecha desc limit 5) x
$$;
-- Precio de una carga: el cargado; si no, el del tanque; si no, el de referencia de la empresa.
create function public.precio_carga(c public.cargas_combustible) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce(c.precio_litro, public.precio_tanque(c.tanque_id, c.cargado_en), (select precio_gasoil from empresas where id = c.empresa_id))
$$;

-- ================================================================ stock de los tanques
create function public.stock_tanques(p_empresa uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'; t tanques; m1 movimientos_tanque; m0 movimientos_tanque; ing numeric; des numeric; teo numeric; teo_m numeric; dif numeric; des_m numeric; d30 numeric; i30 numeric;
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  for t in select * from tanques where empresa_id = p_empresa order by activo desc, nombre loop
    m1 := null; m0 := null;
    select * into m1 from movimientos_tanque where tanque_id = t.id and tipo = 'medicion' order by fecha desc limit 1;
    if m1.id is not null then
      select * into m0 from movimientos_tanque where tanque_id = t.id and tipo = 'medicion' and fecha < m1.fecha order by fecha desc limit 1;
    end if;
    -- stock que debería haber hoy: última medición + compras después − despachos después
    select coalesce(sum(litros), 0) into ing from movimientos_tanque where tanque_id = t.id and tipo = 'ingreso' and (m1.id is null or fecha > m1.fecha);
    select coalesce(sum(litros), 0) into des from cargas_combustible where tanque_id = t.id and (m1.id is null or cargado_en > m1.fecha);
    teo := coalesce(m1.litros, 0) + ing - des;
    -- en la última medición: qué tendría que haber habido según la anterior, y la diferencia con lo medido
    dif := null; teo_m := null; des_m := null;
    if m1.id is not null and m0.id is not null then
      select coalesce(sum(litros), 0) into ing from movimientos_tanque where tanque_id = t.id and tipo = 'ingreso' and fecha > m0.fecha and fecha <= m1.fecha;
      select coalesce(sum(litros), 0) into des_m from cargas_combustible where tanque_id = t.id and cargado_en > m0.fecha and cargado_en <= m1.fecha;
      teo_m := m0.litros + ing - des_m;
      dif := m1.litros - teo_m;
    end if;
    select coalesce(sum(litros), 0) into d30 from cargas_combustible where tanque_id = t.id and cargado_en > now() - interval '30 days';
    select coalesce(sum(litros), 0) into i30 from movimientos_tanque where tanque_id = t.id and tipo = 'ingreso' and fecha > now() - interval '30 days';
    v := v || jsonb_build_object(
      'id', t.id, 'nombre', t.nombre, 'capacidad', t.capacidad, 'activo', t.activo, 'obra_id', t.obra_id,
      'obra', (select nombre from obras where id = t.obra_id),
      'stock', round(teo, 1), 'pct', case when t.capacidad > 0 then round(100 * teo / t.capacidad) end,
      'ultima_medicion', m1.fecha, 'medido', m1.litros, 'esperado_en_medicion', round(teo_m, 1), 'diferencia', round(dif, 1),
      'despachado_en_tramo', round(des_m, 1),
      -- faltante a revisar: más de 50 L y más del 2 % de lo despachado entre las dos mediciones
      'faltante', coalesce(dif < -50 and -dif > 0.02 * greatest(des_m, 1), false),
      'despachado_30d', round(d30, 1), 'ingresado_30d', round(i30, 1),
      'autonomia_dias', case when d30 > 0 and teo > 0 then round(teo / (d30 / 30)) end,
      'precio', public.precio_tanque(t.id, now()), 'sin_medicion', m1.id is null);
  end loop;
  return v;
end $$;

-- ================================================================ carga con tanque
create or replace function public.registrar_carga(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_m uuid; v_ex cargas_combustible; v_id uuid; v_l numeric := (p->>'litros')::numeric; v_med numeric := (p->>'medidor')::numeric;
        v_pref text; v_ult numeric; v_tq uuid := (p->>'tanque_id')::uuid; v_origen text := coalesce(p->>'origen', 'surtidor_propio');
begin
  select * into v_eq from equipos where id = (p->>'equipo_id')::uuid and activo;
  if not found then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;
  v_m := mi_miembro_id(v_eq.empresa_id);
  if v_m is null then raise exception 'No pertenecés a esta empresa' using errcode = '42501'; end if;
  select * into v_ex from cargas_combustible where empresa_id = v_eq.empresa_id and client_id = (p->>'client_id')::uuid;
  if found then return jsonb_build_object('carga_id', v_ex.id, 'repetido', true); end if;
  if v_l is null or v_l <= 0 then raise exception 'Indicá los litros cargados' using errcode = 'P0001'; end if;
  if v_eq.capacidad_tanque is not null and v_l > v_eq.capacidad_tanque * 1.05 then
    raise exception 'Se cargaron % L y el tanque de % es de % L. Revisá el número.', v_l, v_eq.codigo, v_eq.capacidad_tanque using errcode = 'P0001';
  end if;
  if v_med is not null then
    select max(medidor) into v_ult from cargas_combustible where equipo_id = v_eq.id and cargado_en < coalesce((p->>'cargado_en')::timestamptz, now());
    if v_ult is not null and v_med < v_ult then
      raise exception 'El % (%) es menor al de la carga anterior (%)', case v_eq.medidor when 'km' then 'odómetro' else 'horómetro' end, v_med, v_ult using errcode = 'P0001';
    end if;
  end if;
  if (p->>'obra_id') is not null and not exists (select 1 from obras where id = (p->>'obra_id')::uuid and empresa_id = v_eq.empresa_id) then
    raise exception 'Obra no válida' using errcode = 'P0001';
  end if;
  -- Tanque: el indicado, o el único tanque activo de la empresa si la carga es del surtidor propio o de la cisterna.
  if v_tq is not null and not exists (select 1 from tanques where id = v_tq and empresa_id = v_eq.empresa_id and activo) then
    raise exception 'Tanque no válido' using errcode = 'P0001';
  end if;
  if v_tq is null and v_origen in ('surtidor_propio', 'cisterna') and (select count(*) from tanques where empresa_id = v_eq.empresa_id and activo) = 1 then
    select id into v_tq from tanques where empresa_id = v_eq.empresa_id and activo;
  end if;
  if v_tq is not null and v_origen not in ('surtidor_propio', 'cisterna') then v_tq := null; end if;
  v_pref := v_eq.empresa_id::text || '/' || auth.uid()::text || '/';
  if (p->>'foto_path') is not null and left(p->>'foto_path', length(v_pref)) <> v_pref then raise exception 'Foto inválida' using errcode = 'P0001'; end if;

  insert into cargas_combustible (empresa_id, client_id, equipo_id, miembro_id, obra_id, cargado_en, litros, medidor, tanque_lleno, origen, proveedor, precio_litro, foto_path, notas, tanque_id)
  values (v_eq.empresa_id, (p->>'client_id')::uuid, v_eq.id, v_m, (p->>'obra_id')::uuid, least(coalesce((p->>'cargado_en')::timestamptz, now()), now()), v_l, v_med,
          coalesce((p->>'tanque_lleno')::boolean, true), v_origen, nullif(trim(coalesce(p->>'proveedor', '')), ''),
          (p->>'precio_litro')::numeric, p->>'foto_path', nullif(trim(coalesce(p->>'notas', '')), ''), v_tq)
  returning id into v_id;

  if v_med is not null then
    perform set_config('checkobra.rpc', 'on', true);
    update equipos set ultimo_medidor = greatest(coalesce(ultimo_medidor, 0), v_med) where id = v_eq.id;
    perform set_config('checkobra.rpc', 'off', true);
  end if;
  return jsonb_build_object('carga_id', v_id, 'repetido', false, 'tanque_id', v_tq);
end $$;

-- ================================================================ costos por obra (con precio estimado)
-- Cambios: las cargas sin precio usan precio_carga() y se informan como estimadas; el combustible cargado en una obra
-- donde el equipo no tuvo jornadas también cuenta; y se informa el combustible de equipos que no trabajaron.
create or replace function public.costos_por_obra(p_empresa uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; tz constant text := 'America/Argentina/Buenos_Aires';
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  with j as (
    select j.equipo_id, coalesce(j.obra_id::text, '-') as obra, (j.inicio at time zone tz)::date as dia, coalesce(j.uso, 0) as uso
      from jornadas j where j.empresa_id = p_empresa and (j.inicio at time zone tz)::date between p_desde and p_hasta and j.estado <> 'rechazada'
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
    select equipo_id, obra, count(distinct dia) as dias, sum(uso) as uso from j group by 1, 2
    union all
    select c.equipo_id, c.obra, 0, 0 from comb c
     where c.obra <> '-' and not exists (select 1 from j where j.equipo_id = c.equipo_id and j.obra = c.obra)
  ),
  tot as (select equipo_id, sum(uso) as uso, sum(dias) as dias from eo group by 1),
  rep as (
    select equipo_id, sum(costo) as pesos from mantenimientos where empresa_id = p_empresa and realizado_en between p_desde and p_hasta and costo is not null group by 1
  ),
  fila as (
    select eo.equipo_id, eo.obra, eo.dias, eo.uso, e.medidor, e.tarifa_hora, e.tarifa_dia,
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
        'combustible_estimado', round(f.combustible_est, 0), 'reparaciones', round(f.reparaciones, 0),
        'total', round(coalesce(f.costo_equipo, 0) + f.combustible + f.reparaciones, 0)) order by o.nombre nulls last, e.codigo)
      from final f join equipos e on e.id = f.equipo_id left join obras o on o.id::text = f.obra), '[]'),
    'sin_tarifa', coalesce((select jsonb_agg(distinct e.codigo) from eo join equipos e on e.id = eo.equipo_id
                              where eo.uso > 0 and e.tarifa_dia is null and (e.tarifa_hora is null or e.medidor = 'km')), '[]'),
    'reparaciones_sin_uso', coalesce((select sum(r.pesos) from rep r where not exists (select 1 from eo where eo.equipo_id = r.equipo_id)), 0),
    'combustible_sin_uso', coalesce((select sum(c.pesos) from comb c where not exists (select 1 from eo where eo.equipo_id = c.equipo_id)), 0),
    'litros_sin_precio', coalesce((select sum(litros_sin_precio) from comb), 0),
    'precio_referencia', (select precio_gasoil from empresas where id = p_empresa)
  ) into v;
  return v;
end $$;

-- ================================================================ permisos
alter table public.tanques enable row level security;
alter table public.movimientos_tanque enable row level security;
create policy tanques_ver on public.tanques for select to authenticated using (public.es_miembro(empresa_id));
create policy tanques_alta on public.tanques for insert to authenticated with check (public.es_gestor(empresa_id));
create policy tanques_editar on public.tanques for update to authenticated using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id));
create policy mov_ver on public.movimientos_tanque for select to authenticated using (public.es_gestor(empresa_id));
create policy mov_alta on public.movimientos_tanque for insert to authenticated
  with check (public.es_gestor(empresa_id) and miembro_id = public.mi_miembro_id(empresa_id)
              and exists (select 1 from public.tanques t where t.id = tanque_id and t.empresa_id = movimientos_tanque.empresa_id));
create policy mov_borrar on public.movimientos_tanque for delete to authenticated using (public.es_admin(empresa_id));
revoke all on public.tanques, public.movimientos_tanque from anon;
revoke delete, truncate on public.tanques from authenticated;
revoke update, truncate on public.movimientos_tanque from authenticated;
grant select, insert, update on public.tanques to authenticated;
grant select, insert, delete on public.movimientos_tanque to authenticated;
create trigger auditoria after insert or update or delete on public.tanques for each row execute function public.auditoria_trigger();
create trigger auditoria after delete on public.movimientos_tanque for each row execute function public.auditoria_trigger();
revoke execute on function public.precio_tanque(uuid, timestamptz), public.precio_carga(public.cargas_combustible) from public, anon, authenticated;
revoke execute on function public.stock_tanques(uuid) from public, anon;
grant execute on function public.stock_tanques(uuid) to authenticated;
