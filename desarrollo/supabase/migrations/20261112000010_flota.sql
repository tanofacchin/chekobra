-- Gestión de flota: mantenimiento preventivo, vencimientos de documentación e indicadores.

-- ================================================================ Mantenimiento preventivo
-- Un plan por tipo de service de cada equipo: "cada 250 h", "cada 10.000 km".
create table public.planes_mantenimiento (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas on delete cascade,
  equipo_id       uuid not null references public.equipos on delete cascade,
  nombre          text not null check (length(trim(nombre)) between 2 and 80),
  cada            numeric(12,1) not null check (cada > 0),          -- en la unidad del equipo (horas o km)
  anticipo        numeric(12,1) not null default 0 check (anticipo >= 0),  -- avisar cuando falte esto
  ultimo_medidor  numeric(12,1) not null default 0,                 -- medidor del último service hecho
  ultimo_en       date,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create index on public.planes_mantenimiento (equipo_id);

-- Registro de lo que se hizo: services, reparaciones y otros trabajos.
create table public.mantenimientos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas on delete cascade,
  equipo_id       uuid not null references public.equipos on delete cascade,
  plan_id         uuid references public.planes_mantenimiento on delete set null,
  tipo            text not null check (tipo in ('service', 'reparacion', 'otro')),
  descripcion     text not null check (length(trim(descripcion)) between 3 and 500),
  medidor         numeric(12,1),
  realizado_en    date not null default current_date,
  costo           numeric(14,2) check (costo is null or costo >= 0),
  responsable     text,                                             -- taller o mecánico
  registrado_por  uuid references public.miembros,
  creado_en       timestamptz not null default now()
);
create index on public.mantenimientos (equipo_id, realizado_en desc);

-- Un service registrado reinicia la cuenta de su plan.
create function public.mantenimiento_actualiza_plan() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is not null then
    update planes_mantenimiento
       set ultimo_medidor = greatest(ultimo_medidor, coalesce(new.medidor, ultimo_medidor)),
           ultimo_en = greatest(coalesce(ultimo_en, new.realizado_en), new.realizado_en)
     where id = new.plan_id and equipo_id = new.equipo_id;
  end if;
  new.registrado_por := coalesce(new.registrado_por, mi_miembro_id(new.empresa_id));
  return new;
end $$;
create trigger mantenimientos_plan before insert on public.mantenimientos
  for each row execute function public.mantenimiento_actualiza_plan();

-- Medidor actual del equipo: el mayor entre el último checklist y la telemetría.
create function public.medidor_actual(p_equipo uuid) returns numeric
  language sql stable security definer set search_path = public as $$
  select greatest(e.ultimo_medidor,
                  case e.medidor when 'horas' then (select max(horas) from telemetria_lecturas where equipo_id = e.id)
                                 else (select max(odometro_km) from telemetria_lecturas where equipo_id = e.id) end)
    from equipos e where e.id = p_equipo and es_miembro(e.empresa_id)
$$;

create function public.estado_mantenimiento(p_empresa uuid)
returns table (plan_id uuid, equipo_id uuid, codigo text, equipo text, medidor public.tipo_medidor, plan text, cada numeric,
               anticipo numeric, ultimo_medidor numeric, ultimo_en date, actual numeric, proximo numeric, faltan numeric, estado text)
language sql stable security definer set search_path = public as $$
  select p.id, e.id, e.codigo, e.nombre, e.medidor, p.nombre, p.cada, p.anticipo, p.ultimo_medidor, p.ultimo_en,
         a.actual, p.ultimo_medidor + p.cada, p.ultimo_medidor + p.cada - a.actual,
         case when a.actual >= p.ultimo_medidor + p.cada then 'vencido'
              when a.actual >= p.ultimo_medidor + p.cada - p.anticipo then 'proximo' else 'al_dia' end
    from planes_mantenimiento p
    join equipos e on e.id = p.equipo_id
    cross join lateral (select coalesce(medidor_actual(e.id), 0) as actual) a
   where p.empresa_id = p_empresa and p.activo and e.activo and es_gestor(p_empresa)
   order by (p.ultimo_medidor + p.cada - a.actual) / nullif(p.cada, 0)
$$;

-- ================================================================ Vencimientos de documentación
create table public.documentos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas on delete cascade,
  equipo_id     uuid references public.equipos on delete cascade,
  miembro_id    uuid references public.miembros on delete cascade,
  tipo          text not null check (tipo in ('seguro', 'vtv', 'matafuego', 'habilitacion_equipo', 'ruta',
                                             'licencia', 'habilitacion_operador', 'curso', 'apto_medico', 'otro')),
  descripcion   text,
  vence         date not null,
  aviso_dias    integer not null default 30 check (aviso_dias between 0 and 365),
  bloquea       boolean not null default false,   -- vencido impide iniciar jornada
  creado_en     timestamptz not null default now(),
  check ((equipo_id is null) <> (miembro_id is null))
);
create index on public.documentos (empresa_id, vence);

-- Al vencer un documento que bloquea, no se puede iniciar jornada con ese equipo ni con ese operario.
create function public.exigir_documentacion() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_doc documentos;
begin
  select * into v_doc from documentos
   where bloquea and vence < (now() at time zone 'America/Argentina/Buenos_Aires')::date
     and (equipo_id = new.equipo_id or miembro_id = new.operario_id)
   order by vence limit 1;
  if found then
    raise exception '%', case when v_doc.equipo_id is not null
      then 'El equipo tiene documentación vencida (' || replace(v_doc.tipo, '_', ' ') || ', venció el ' || to_char(v_doc.vence, 'DD/MM/YYYY') || '). Avisá al supervisor.'
      else 'Tu ' || replace(v_doc.tipo, '_', ' ') || ' venció el ' || to_char(v_doc.vence, 'DD/MM/YYYY') || '. No podés iniciar jornada hasta renovarla.' end
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger jornadas_documentacion before insert on public.jornadas
  for each row execute function public.exigir_documentacion();

-- ================================================================ Indicadores
create function public.indicadores(p_empresa uuid, p_desde date, p_hasta date, p_obra uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  tz constant text := 'America/Argentina/Buenos_Aires';
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  with j as (
    select j.*, (j.inicio at time zone tz)::date as dia
      from jornadas j
     where j.empresa_id = p_empresa and (j.inicio at time zone tz)::date between p_desde and p_hasta
       and (p_obra is null or j.obra_id = p_obra)
  ),
  habiles as (   -- lunes a sábado del período
    select d::date as dia from generate_series(p_desde, least(p_hasta, (now() at time zone tz)::date), interval '1 day') d
     where extract(isodow from d) < 7
  ),
  eqs as (select id, codigo, nombre, medidor from equipos where empresa_id = p_empresa and activo and estado <> 'fuera_servicio')
  select jsonb_build_object(
    'total', (select count(*) from j),
    'por_resultado', (select coalesce(jsonb_object_agg(resultado, n), '{}') from (select resultado, count(*) n from j group by 1) x),
    'rapidos', (select count(*) from j where rapido),
    'dur_promedio_s', (select round(avg(dur_checklist_s)) from j),
    'horas', (select coalesce(sum(j.uso), 0) from j join equipos e on e.id = j.equipo_id where e.medidor = 'horas' and j.estado = 'cerrada'),
    'km', (select coalesce(sum(j.uso), 0) from j join equipos e on e.id = j.equipo_id where e.medidor = 'km' and j.estado = 'cerrada'),
    'fallas', (select count(*) from fallas f join j on j.id = f.jornada_id),
    'fallas_criticas', (select count(*) from fallas f join j on j.id = f.jornada_id where f.critica),
    'bloqueos', (select count(*) from j where resultado = 'no_apto'),
    'dias_habiles', (select count(*) from habiles),
    'cobertura', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where hay) / count(*), 1) end
                    from (select exists (select 1 from j where j.equipo_id = eqs.id and j.dia = h.dia) as hay from eqs cross join habiles h) c),
    'por_dia', (select coalesce(jsonb_agg(x order by x->>'dia'), '[]') from (
        select jsonb_build_object('dia', d.dia,
               'apto', count(j.*) filter (where j.resultado = 'apto'),
               'observaciones', count(j.*) filter (where j.resultado = 'observaciones'),
               'no_apto', count(j.*) filter (where j.resultado = 'no_apto')) x
          from (select d::date as dia from generate_series(p_desde, p_hasta, interval '1 day') d) d
          left join j on j.dia = d.dia group by d.dia) y),
    'por_equipo', (select coalesce(jsonb_agg(x order by (x->>'jornadas')::int desc, x->>'codigo'), '[]') from (
        select jsonb_build_object('codigo', e.codigo, 'nombre', e.nombre, 'medidor', e.medidor,
               'jornadas', count(j.*), 'uso', coalesce(sum(j.uso), 0),
               'fallas', (select count(*) from fallas f join j j2 on j2.id = f.jornada_id where j2.equipo_id = e.id),
               'bloqueos', count(j.*) filter (where j.resultado = 'no_apto'),
               'dias_con_checklist', (select count(distinct j3.dia) from j j3 where j3.equipo_id = e.id),
               'dias_habiles', (select count(*) from habiles)) x
          from eqs e left join j on j.equipo_id = e.id group by e.id, e.codigo, e.nombre, e.medidor) y),
    'por_operario', (select coalesce(jsonb_agg(x order by (x->>'jornadas')::int desc), '[]') from (
        select jsonb_build_object('nombre', m.nombre, 'legajo', m.legajo, 'jornadas', count(*),
               'rapidos', count(*) filter (where j.rapido), 'dur_promedio_s', round(avg(j.dur_checklist_s)),
               'fallas', (select count(*) from fallas f join j j2 on j2.id = f.jornada_id where j2.operario_id = m.id)) x
          from j join miembros m on m.id = j.operario_id group by m.id, m.nombre, m.legajo) y),
    'por_obra', (select coalesce(jsonb_agg(x order by (x->>'jornadas')::int desc), '[]') from (
        select jsonb_build_object('obra', coalesce(o.nombre, 'Sin obra'), 'jornadas', count(*), 'horas', coalesce(sum(j.uso) filter (where e.medidor = 'horas'), 0)) x
          from j left join obras o on o.id = j.obra_id join equipos e on e.id = j.equipo_id group by o.nombre) y),
    'fallas_frecuentes', (select coalesce(jsonb_agg(x order by (x->>'veces')::int desc), '[]') from (
        select jsonb_build_object('texto', f.texto, 'critica', bool_or(f.critica), 'veces', count(*)) x
          from fallas f join j on j.id = f.jornada_id group by f.texto order by count(*) desc limit 8) y)
  ) into v;
  return v;
end $$;

-- ================================================================ RLS y permisos
alter table public.planes_mantenimiento enable row level security;
alter table public.mantenimientos enable row level security;
alter table public.documentos enable row level security;

create policy planes_ver on public.planes_mantenimiento for select to authenticated using (public.es_gestor(empresa_id));
create policy planes_gestion on public.planes_mantenimiento for all to authenticated
  using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id)
    and exists (select 1 from public.equipos e where e.id = equipo_id and e.empresa_id = planes_mantenimiento.empresa_id));

create policy mant_ver on public.mantenimientos for select to authenticated using (public.es_gestor(empresa_id));
create policy mant_alta on public.mantenimientos for insert to authenticated
  with check (public.es_gestor(empresa_id)
    and exists (select 1 from public.equipos e where e.id = equipo_id and e.empresa_id = mantenimientos.empresa_id)
    and (plan_id is null or exists (select 1 from public.planes_mantenimiento p where p.id = plan_id and p.equipo_id = mantenimientos.equipo_id)));
create policy mant_borrar on public.mantenimientos for delete to authenticated using (public.es_admin(empresa_id));

-- El operario ve los documentos de los equipos y los suyos (para saber por qué no puede iniciar).
create policy docs_ver on public.documentos for select to authenticated
  using (public.es_gestor(empresa_id) or (equipo_id is not null and public.es_miembro(empresa_id)) or miembro_id = public.mi_miembro_id(empresa_id));
create policy docs_gestion on public.documentos for all to authenticated
  using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id)
    and (equipo_id is null or exists (select 1 from public.equipos e where e.id = equipo_id and e.empresa_id = documentos.empresa_id))
    and (miembro_id is null or exists (select 1 from public.miembros m where m.id = miembro_id and m.empresa_id = documentos.empresa_id)));

revoke all on public.planes_mantenimiento, public.mantenimientos, public.documentos from anon;
grant select, insert, update, delete on public.planes_mantenimiento, public.documentos to authenticated;
grant select, insert, delete on public.mantenimientos to authenticated;
revoke execute on function public.mantenimiento_actualiza_plan(), public.exigir_documentacion() from public, anon, authenticated;
revoke execute on function public.medidor_actual(uuid), public.estado_mantenimiento(uuid), public.indicadores(uuid, date, date, uuid) from public, anon;
grant execute on function public.medidor_actual(uuid), public.estado_mantenimiento(uuid), public.indicadores(uuid, date, date, uuid) to authenticated;
