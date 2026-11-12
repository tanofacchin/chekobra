-- Combustible: cargas, consumo real (tanque lleno a tanque lleno) y alertas de consumo anormal.

alter table public.equipos
  add column capacidad_tanque numeric(8,1) check (capacidad_tanque is null or capacidad_tanque > 0),
  add column consumo_referencia numeric(8,2) check (consumo_referencia is null or consumo_referencia > 0);  -- L/h o L/100 km

create table public.cargas_combustible (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas on delete cascade,
  client_id     uuid not null,                         -- generado en el teléfono: los reenvíos sin señal no duplican
  equipo_id     uuid not null references public.equipos on delete cascade,
  miembro_id    uuid references public.miembros,       -- quién cargó
  obra_id       uuid references public.obras on delete set null,
  cargado_en    timestamptz not null,
  litros        numeric(8,1) not null check (litros > 0 and litros <= 5000),
  medidor       numeric(12,1) check (medidor is null or medidor >= 0),
  tanque_lleno  boolean not null default true,
  origen        text not null default 'surtidor_propio' check (origen in ('surtidor_propio', 'estacion', 'cisterna', 'otro')),
  proveedor     text,
  precio_litro  numeric(12,2) check (precio_litro is null or precio_litro >= 0),
  foto_path     text,
  notas         text,
  recibido_en   timestamptz not null default now(),
  unique (empresa_id, client_id)
);
create index on public.cargas_combustible (equipo_id, cargado_en);
create index on public.cargas_combustible (empresa_id, cargado_en desc);

-- Registro de una carga (operario o supervisión). p: {client_id, equipo_id, obra_id, cargado_en, litros, medidor,
-- tanque_lleno, origen, proveedor, precio_litro, foto_path, notas}
create function public.registrar_carga(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_m uuid; v_ex cargas_combustible; v_id uuid; v_l numeric := (p->>'litros')::numeric; v_med numeric := (p->>'medidor')::numeric;
        v_pref text; v_ult numeric;
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
  v_pref := v_eq.empresa_id::text || '/' || auth.uid()::text || '/';
  if (p->>'foto_path') is not null and left(p->>'foto_path', length(v_pref)) <> v_pref then raise exception 'Foto inválida' using errcode = 'P0001'; end if;

  insert into cargas_combustible (empresa_id, client_id, equipo_id, miembro_id, obra_id, cargado_en, litros, medidor, tanque_lleno, origen, proveedor, precio_litro, foto_path, notas)
  values (v_eq.empresa_id, (p->>'client_id')::uuid, v_eq.id, v_m, (p->>'obra_id')::uuid, least(coalesce((p->>'cargado_en')::timestamptz, now()), now()), v_l, v_med,
          coalesce((p->>'tanque_lleno')::boolean, true), coalesce(p->>'origen', 'surtidor_propio'), nullif(trim(coalesce(p->>'proveedor', '')), ''),
          (p->>'precio_litro')::numeric, p->>'foto_path', nullif(trim(coalesce(p->>'notas', '')), ''))
  returning id into v_id;

  if v_med is not null then
    perform set_config('checkobra.rpc', 'on', true);
    update equipos set ultimo_medidor = greatest(coalesce(ultimo_medidor, 0), v_med) where id = v_eq.id;
    perform set_config('checkobra.rpc', 'off', true);
  end if;
  return jsonb_build_object('carga_id', v_id, 'repetido', false);
end $$;

-- Tramos de consumo: entre dos cargas con tanque lleno, los litros cargados después de la primera
-- (incluida la segunda) dividido el uso entre ambas.
create function public.tramos_combustible(p_empresa uuid)
returns table (equipo_id uuid, desde timestamptz, hasta timestamptz, litros numeric, uso numeric, consumo numeric)
language sql stable security definer set search_path = public as $$
  with llenos as (
    select c.equipo_id, c.cargado_en, c.medidor,
           lag(c.cargado_en) over w as ant_en, lag(c.medidor) over w as ant_med
      from cargas_combustible c
     where c.empresa_id = p_empresa and c.tanque_lleno and c.medidor is not null and es_gestor(p_empresa)
    window w as (partition by c.equipo_id order by c.cargado_en)
  )
  select l.equipo_id, l.ant_en, l.cargado_en,
         (select sum(x.litros) from cargas_combustible x where x.equipo_id = l.equipo_id and x.cargado_en > l.ant_en and x.cargado_en <= l.cargado_en),
         l.medidor - l.ant_med,
         case when l.medidor - l.ant_med > 0
              then (select sum(x.litros) from cargas_combustible x where x.equipo_id = l.equipo_id and x.cargado_en > l.ant_en and x.cargado_en <= l.cargado_en) / (l.medidor - l.ant_med) end
    from llenos l where l.ant_en is not null
$$;

-- Resumen por equipo en un período, con la referencia de consumo y alertas.
--   referencia: la cargada en el equipo o, si no hay, la mediana de los tramos anteriores al último (mínimo 2).
--   alerta 'consumo_alto' si el último tramo supera la referencia en más de p_tolerancia; 'sin_uso' si se llenó
--   el tanque sin que el medidor avanzara.
create function public.consumo_combustible(p_empresa uuid, p_desde date, p_hasta date, p_tolerancia numeric default 0.25)
returns table (equipo_id uuid, codigo text, nombre text, medidor public.tipo_medidor, litros numeric, costo numeric, cargas bigint,
               consumo_periodo numeric, ultimo_tramo numeric, ultimo_tramo_hasta timestamptz, referencia numeric, origen_referencia text,
               desvio numeric, alerta text)
language sql stable security definer set search_path = public as $$
  with tz as (select 'America/Argentina/Buenos_Aires'::text z),
  t as (select * from tramos_combustible(p_empresa)),
  ult as (select distinct on (t.equipo_id) t.* from t order by t.equipo_id, t.hasta desc),
  hist as (select t.equipo_id, percentile_cont(0.5) within group (order by t.consumo)::numeric as mediana, count(*) n
             from t join ult u on u.equipo_id = t.equipo_id and t.hasta < u.hasta where t.consumo is not null group by t.equipo_id),
  per as (select c.equipo_id, sum(c.litros) litros, sum(c.litros * c.precio_litro) costo, count(*) cargas
            from cargas_combustible c, tz where c.empresa_id = p_empresa and (c.cargado_en at time zone tz.z)::date between p_desde and p_hasta group by c.equipo_id),
  tp as (select t.equipo_id, sum(t.litros) / nullif(sum(t.uso), 0) consumo from t, tz
          where (t.hasta at time zone tz.z)::date between p_desde and p_hasta and t.uso > 0 group by t.equipo_id)
  select e.id, e.codigo, e.nombre, e.medidor, coalesce(per.litros, 0), per.costo, coalesce(per.cargas, 0),
         round(tp.consumo * case when e.medidor = 'km' then 100 else 1 end, 2),
         round(u.consumo * case when e.medidor = 'km' then 100 else 1 end, 2), u.hasta,
         round(coalesce(e.consumo_referencia, case when h.n >= 2 then h.mediana * case when e.medidor = 'km' then 100 else 1 end end), 2),
         case when e.consumo_referencia is not null then 'cargada' when h.n >= 2 then 'historial' end,
         round(u.consumo * case when e.medidor = 'km' then 100 else 1 end
               / nullif(coalesce(e.consumo_referencia, case when h.n >= 2 then h.mediana * case when e.medidor = 'km' then 100 else 1 end end), 0) - 1, 3),
         case when u.equipo_id is not null and coalesce(u.uso, 0) <= 0 then 'sin_uso'
              when u.consumo * case when e.medidor = 'km' then 100 else 1 end
                   > (1 + p_tolerancia) * coalesce(e.consumo_referencia, case when h.n >= 2 then h.mediana * case when e.medidor = 'km' then 100 else 1 end end)
              then 'consumo_alto' end
    from equipos e
    left join per on per.equipo_id = e.id
    left join tp on tp.equipo_id = e.id
    left join ult u on u.equipo_id = e.id
    left join hist h on h.equipo_id = e.id
   where e.empresa_id = p_empresa and e.activo and es_gestor(p_empresa)
     and (per.equipo_id is not null or u.equipo_id is not null or e.consumo_referencia is not null)
   order by coalesce(per.litros, 0) desc
$$;

-- RLS
alter table public.cargas_combustible enable row level security;
create policy cargas_ver on public.cargas_combustible for select to authenticated
  using (public.es_gestor(empresa_id) or miembro_id = public.mi_miembro_id(empresa_id));
create policy cargas_editar on public.cargas_combustible for update to authenticated
  using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id));
create policy cargas_borrar on public.cargas_combustible for delete to authenticated using (public.es_admin(empresa_id));

revoke all on public.cargas_combustible from anon;
revoke insert, truncate on public.cargas_combustible from authenticated;
grant select, update, delete on public.cargas_combustible to authenticated;
revoke execute on function public.registrar_carga(jsonb), public.tramos_combustible(uuid), public.consumo_combustible(uuid, date, date, numeric) from public, anon;
grant execute on function public.registrar_carga(jsonb), public.tramos_combustible(uuid), public.consumo_combustible(uuid, date, date, numeric) to authenticated;
