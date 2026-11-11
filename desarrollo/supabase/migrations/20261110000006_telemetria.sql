-- Telemetría (JDLink / ISO 15143-3): estado de la conexión OAuth, lecturas y alertas cruzadas con los checklists.

-- Estados OAuth en curso (anti-CSRF). Solo los usa el servidor.
create table public.telemetria_oauth (
  state       text primary key,
  empresa_id  uuid not null references public.empresas on delete cascade,
  miembro_id  uuid not null references public.miembros on delete cascade,
  volver_a    text not null,
  creado_en   timestamptz not null default now()
);
alter table public.telemetria_oauth enable row level security;   -- sin políticas: solo el servidor
revoke all on public.telemetria_oauth from anon, authenticated;

-- Máquinas que informa el proveedor pero que no están cargadas como equipo (para avisar al cliente).
alter table public.telemetria_conexiones add column maquinas_sin_vincular jsonb not null default '[]';

-- Equipos que se vinculan con telemetría por número de serie / PIN.
create index if not exists equipos_serie_idx on public.equipos (empresa_id, upper(serie));

-- Última lectura de cada equipo.
create function public.telemetria_ultimas(p_empresa uuid)
returns table (equipo_id uuid, proveedor text, medido_en timestamptz, horas numeric, odometro_km numeric,
               lat double precision, lng double precision, combustible_pct numeric, def_pct numeric)
language sql stable security definer set search_path = public as $$
  select distinct on (l.equipo_id) l.equipo_id, l.proveedor, l.medido_en, l.horas, l.odometro_km, l.lat, l.lng, l.combustible_pct, l.def_pct
    from telemetria_lecturas l
   where l.empresa_id = p_empresa and es_gestor(p_empresa)
   order by l.equipo_id, l.medido_en desc
$$;

-- Distancia en metros entre dos puntos.
create function public.distancia_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Alertas que cruzan los datos de la máquina con los checklists.
--   horometro: el horómetro que cargó el operario difiere del que informó la máquina (> p_tol_h horas)
--   lejos:     el checklist se hizo a más de p_tol_m metros de donde estaba la máquina
--   sin_checklist: la máquina sumó horas de motor en un día sin ningún checklist
create function public.alertas_telemetria(p_empresa uuid, p_desde date default (current_date - 7),
                                          p_tol_h numeric default 2, p_tol_m numeric default 500)
returns table (tipo text, equipo_id uuid, jornada_id uuid, fecha date, detalle text, valor_operario numeric, valor_maquina numeric)
language sql stable security definer set search_path = public as $$
  with j as (
    select j.*, (select l from telemetria_lecturas l
                  where l.equipo_id = j.equipo_id and l.medido_en between j.inicio - interval '3 hours' and j.inicio + interval '1 hour'
                  order by abs(extract(epoch from l.medido_en - j.inicio)) limit 1) as lec
      from jornadas j
     where j.empresa_id = p_empresa and j.inicio >= p_desde and es_gestor(p_empresa)
  ),
  dias as (
    select l.equipo_id, (l.medido_en at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
           max(l.horas) - min(l.horas) as horas_dia
      from telemetria_lecturas l
     where l.empresa_id = p_empresa and l.medido_en >= p_desde and l.horas is not null and es_gestor(p_empresa)
     group by 1, 2
  )
  select 'horometro', j.equipo_id, j.id, (j.inicio at time zone 'America/Argentina/Buenos_Aires')::date,
         'El operario cargó ' || j.med_ini || ' h y la máquina informaba ' || (j.lec).horas || ' h', j.med_ini, (j.lec).horas
    from j where (j.lec).horas is not null and abs(j.med_ini - (j.lec).horas) > p_tol_h
  union all
  select 'lejos', j.equipo_id, j.id, (j.inicio at time zone 'America/Argentina/Buenos_Aires')::date,
         'El checklist se hizo a ' || round(distancia_m(j.lat, j.lng, (j.lec).lat, (j.lec).lng)::numeric) || ' m de la máquina',
         null, round(distancia_m(j.lat, j.lng, (j.lec).lat, (j.lec).lng)::numeric)
    from j where j.lat is not null and (j.lec).lat is not null and distancia_m(j.lat, j.lng, (j.lec).lat, (j.lec).lng) > p_tol_m
  union all
  select 'sin_checklist', d.equipo_id, null, d.fecha,
         'La máquina trabajó ' || round(d.horas_dia, 1) || ' h sin checklist', null, round(d.horas_dia, 1)
    from dias d
   where d.horas_dia >= 0.5
     and not exists (select 1 from jornadas x where x.equipo_id = d.equipo_id
                      and (x.inicio at time zone 'America/Argentina/Buenos_Aires')::date = d.fecha)
$$;

revoke execute on function public.telemetria_ultimas(uuid), public.alertas_telemetria(uuid, date, numeric, numeric) from public, anon;
grant execute on function public.telemetria_ultimas(uuid), public.alertas_telemetria(uuid, date, numeric, numeric), public.distancia_m(double precision, double precision, double precision, double precision) to authenticated;
