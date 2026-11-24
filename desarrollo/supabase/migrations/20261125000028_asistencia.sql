-- Tarjetero: entradas y salidas de todo el personal.
-- Tres formas de marcar: el reloj del obrador (legajo + PIN + foto), el celular propio (GPS + foto) y el QR de la obra.
-- Con eso salen las horas para sueldos (normales, al 50 % y al 100 %), los presentes y ausentes del día
-- y la mano de obra de cada obra.

-- ================================================================ ajustes
alter table public.miembros add column controla_asistencia boolean not null default true;   -- si se lo cuenta como ausente cuando no marca

create table public.ajustes_asistencia (
  empresa_id        uuid primary key references public.empresas on delete cascade,
  hora_entrada      time not null default '08:00',
  tolerancia_min    integer not null default 10 check (tolerancia_min between 0 and 120),
  horas_semana      numeric(4,2) not null default 9 check (horas_semana between 0 and 16),   -- horas normales de lunes a viernes
  horas_sabado      numeric(4,2) not null default 4 check (horas_sabado between 0 and 16),
  sabado_100_desde  time default '13:00',            -- desde esa hora el sábado se paga al 100 %; nulo = no aplica
  descanso_min      integer not null default 0 check (descanso_min between 0 and 180),     -- se descuenta si trabajó más de 6 h sin marcar salida al mediodía
  radio_m           integer not null default 300 check (radio_m between 30 and 5000),      -- para obras con ubicación pero sin radio propio
  pedir_foto        boolean not null default true,
  actualizado_en    timestamptz not null default now()
);
alter table public.ajustes_asistencia enable row level security;
create policy aa_ver on public.ajustes_asistencia for select to authenticated using (public.es_miembro(empresa_id));
create policy aa_admin on public.ajustes_asistencia for all to authenticated using (public.es_admin(empresa_id)) with check (public.es_admin(empresa_id));
revoke all on public.ajustes_asistencia from anon;
grant select, insert, update on public.ajustes_asistencia to authenticated;
create trigger auditoria after insert or update on public.ajustes_asistencia for each row execute function public.auditoria_trigger();

create function public.ajustes_asistencia_de(e uuid) returns public.ajustes_asistencia
  language sql stable security definer set search_path = public as $$
  select a from ajustes_asistencia a where a.empresa_id = e
  union all
  select row(e, '08:00'::time, 10, 9, 4, '13:00'::time, 0, 300, true, now())::ajustes_asistencia
   where not exists (select 1 from ajustes_asistencia where empresa_id = e)
$$;

create table public.feriados (
  empresa_id uuid not null references public.empresas on delete cascade,
  fecha      date not null,
  nombre     text not null check (length(trim(nombre)) between 2 and 80),
  primary key (empresa_id, fecha)
);
alter table public.feriados enable row level security;
create policy fer_ver on public.feriados for select to authenticated using (public.es_miembro(empresa_id));
create policy fer_admin on public.feriados for all to authenticated using (public.es_admin(empresa_id)) with check (public.es_admin(empresa_id));
revoke all on public.feriados from anon;
grant select, insert, update, delete on public.feriados to authenticated;
create trigger auditoria after insert or update or delete on public.feriados for each row execute function public.auditoria_trigger();

-- QR de cada obra. Aparte de 'obras' para que el personal no pueda leer el código y marcar sin estar ahí.
create table public.obras_qr (
  obra_id    uuid primary key references public.obras on delete cascade,
  empresa_id uuid not null references public.empresas on delete cascade,
  token      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  creado_en  timestamptz not null default now()
);
alter table public.obras_qr enable row level security;
create policy oqr_ver on public.obras_qr for select to authenticated using (public.es_gestor(empresa_id));
revoke all on public.obras_qr from anon, authenticated;
grant select on public.obras_qr to authenticated;

create function public.qr_de_obra(p_obra uuid, p_renovar boolean default false) returns text
  language plpgsql security definer set search_path = public as $$
declare v_o obras; v_t text;
begin
  select * into v_o from obras where id = p_obra;
  if v_o.id is null or not es_gestor(v_o.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if p_renovar then
    delete from obras_qr where obra_id = p_obra;
    perform auditar(v_o.empresa_id, 'renovar_qr', 'obras', p_obra::text, v_o.nombre, null, null);
  end if;
  insert into obras_qr (obra_id, empresa_id) values (p_obra, v_o.empresa_id) on conflict (obra_id) do nothing;
  select token into v_t from obras_qr where obra_id = p_obra;
  return v_t;
end $$;

-- ================================================================ marcaciones
create table public.marcaciones (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas on delete cascade,
  miembro_id       uuid not null references public.miembros on delete cascade,
  obra_id          uuid references public.obras on delete set null,
  tipo             text not null check (tipo in ('entrada', 'salida')),
  cuando           timestamptz not null,
  modo             text not null check (modo in ('reloj', 'celular', 'qr', 'manual')),
  lat              double precision,
  lng              double precision,
  precision_m      real,
  distancia_m      integer,
  dentro           boolean,                      -- nulo: la obra no tiene ubicación o el teléfono no dio GPS
  foto_path        text,
  client_id        uuid unique,
  registrado_por   uuid references public.miembros on delete set null,
  verificada       boolean not null default true, -- falso: hay que revisarla (sin señal, fuera de la obra, reloj sin PIN)
  observacion      text,
  anulada_en       timestamptz,
  anulada_por      uuid references public.miembros on delete set null,
  motivo_anulacion text,
  creada_en        timestamptz not null default now()
);
create index on public.marcaciones (empresa_id, cuando);
create index on public.marcaciones (miembro_id, cuando);
alter table public.marcaciones enable row level security;
create policy marc_ver on public.marcaciones for select to authenticated
  using (public.es_gestor(empresa_id) or miembro_id = public.mi_miembro_id(empresa_id));
revoke all on public.marcaciones from anon, authenticated;
grant select on public.marcaciones to authenticated;     -- se escriben solo por las funciones de abajo

-- distancia_m() ya existe (telemetría).

-- Núcleo común a las tres formas de marcar. Solo lo usan marcar() y la función 'reloj' (con permisos de servidor).
create function public.registrar_marcacion(
  p_empresa uuid, p_miembro uuid, p_obra uuid, p_tipo text, p_cuando timestamptz, p_modo text,
  p_lat double precision, p_lng double precision, p_precision real, p_foto text, p_client uuid,
  p_registrado_por uuid, p_verificada boolean, p_obs text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m miembros; v_o obras; v_ult marcaciones; v_ex marcaciones; a ajustes_asistencia := ajustes_asistencia_de(p_empresa);
        v_t timestamptz := now(); v_tipo text; v_dist integer; v_dentro boolean; v_ver boolean := coalesce(p_verificada, true); v_obs text := p_obs;
begin
  if p_client is not null then
    select * into v_ex from marcaciones where client_id = p_client;
    if found then
      return jsonb_build_object('id', v_ex.id, 'tipo', v_ex.tipo, 'cuando', v_ex.cuando, 'verificada', v_ex.verificada, 'ya', true,
                                'nombre', (select nombre from miembros where id = v_ex.miembro_id), 'obra', (select nombre from obras where id = v_ex.obra_id));
    end if;
  end if;
  select * into v_m from miembros where id = p_miembro and empresa_id = p_empresa;
  if v_m.id is null or not v_m.activo then raise exception 'Persona no encontrada o inactiva' using errcode = '42501'; end if;
  if v_m.rol::text = 'reloj' then raise exception 'Un reloj del obrador no marca: cada persona marca con su legajo y PIN' using errcode = '42501'; end if;

  -- La hora es la del servidor. Si se marcó sin señal, vale la del teléfono (hasta 3 días) y queda para revisar.
  if p_cuando is not null and p_cuando < now() - interval '10 minutes' then
    if p_cuando < now() - interval '3 days' then raise exception 'Esa marcación es de hace más de 3 días: pedile al supervisor que la cargue a mano' using errcode = '22023'; end if;
    v_t := p_cuando; v_ver := false; v_obs := concat_ws(' · ', v_obs, 'Marcada sin señal: la hora es la del teléfono');
  end if;

  select * into v_ult from marcaciones where miembro_id = p_miembro and anulada_en is null and cuando <= v_t order by cuando desc limit 1;
  v_tipo := coalesce(p_tipo, case when v_ult.tipo = 'entrada' and v_t - v_ult.cuando < interval '20 hours' then 'salida' else 'entrada' end);
  if v_tipo not in ('entrada', 'salida') then raise exception 'Tipo de marcación inválido' using errcode = '22023'; end if;
  if v_ult.id is not null and v_ult.tipo = v_tipo and v_t - v_ult.cuando < interval '2 minutes' then
    raise exception 'Ya marcaste la % hace un momento', v_tipo using errcode = '22023';
  end if;

  if p_obra is not null then
    select * into v_o from obras where id = p_obra and empresa_id = p_empresa;
    if v_o.id is null then raise exception 'Obra no encontrada' using errcode = '22023'; end if;
  elsif v_tipo = 'salida' and v_ult.tipo = 'entrada' then
    select * into v_o from obras where id = v_ult.obra_id;          -- la salida va a la obra donde entró
  end if;

  if v_o.lat is not null and v_o.lng is not null and p_lat is not null and p_lng is not null then
    v_dist := round(distancia_m(p_lat, p_lng, v_o.lat, v_o.lng));
    v_dentro := v_dist <= coalesce(v_o.radio_m, a.radio_m) + least(coalesce(p_precision, 0), 150);
    if not v_dentro and p_modo = 'celular' then v_ver := false; v_obs := concat_ws(' · ', v_obs, format('Fuera de la obra (a %s m)', v_dist)); end if;
  elsif p_modo = 'celular' and v_o.lat is not null then
    v_ver := false; v_obs := concat_ws(' · ', v_obs, 'El teléfono no dio la ubicación');
  end if;

  insert into marcaciones (empresa_id, miembro_id, obra_id, tipo, cuando, modo, lat, lng, precision_m, distancia_m, dentro, foto_path,
                           client_id, registrado_por, verificada, observacion)
  values (p_empresa, p_miembro, v_o.id, v_tipo, v_t, p_modo, p_lat, p_lng, p_precision, v_dist, v_dentro, nullif(p_foto, ''),
          p_client, p_registrado_por, v_ver, v_obs)
  returning * into v_ex;
  return jsonb_build_object('id', v_ex.id, 'tipo', v_ex.tipo, 'cuando', v_ex.cuando, 'verificada', v_ex.verificada, 'observacion', v_ex.observacion,
                            'dentro', v_ex.dentro, 'distancia_m', v_ex.distancia_m, 'nombre', v_m.nombre, 'obra', v_o.nombre);
end $$;

-- Desde el celular propio o escaneando el QR de la obra.
-- p: { empresa_id, tipo?, obra_id?, qr?, lat?, lng?, precision_m?, foto_path?, client_id?, cuando? }
create function public.marcar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e uuid := (p->>'empresa_id')::uuid; v_m miembros; v_obra uuid := nullif(p->>'obra_id', '')::uuid; v_modo text := 'celular';
        v_foto text := nullif(p->>'foto_path', ''); a ajustes_asistencia;
begin
  select * into v_m from miembros where empresa_id = v_e and user_id = auth.uid() and activo;
  if v_m.id is null or mi_rol(v_e) is null then raise exception 'No pertenecés a esta empresa' using errcode = '42501'; end if;
  a := ajustes_asistencia_de(v_e);
  if nullif(p->>'qr', '') is not null then
    select q.obra_id into v_obra from obras_qr q join obras o on o.id = q.obra_id where q.token = p->>'qr' and q.empresa_id = v_e and o.activa;
    if v_obra is null then raise exception 'Ese QR no es de una obra activa de tu empresa: puede que lo hayan renovado' using errcode = '22023'; end if;
    v_modo := 'qr';
  end if;
  if v_foto is not null and v_foto not like v_e::text || '/' || auth.uid()::text || '/%' then raise exception 'Foto inválida' using errcode = '22023'; end if;
  if a.pedir_foto and v_foto is null then raise exception 'Falta la foto' using errcode = '22023'; end if;
  return registrar_marcacion(v_e, v_m.id, v_obra, nullif(p->>'tipo', ''), (p->>'cuando')::timestamptz, v_modo,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'precision_m')::real, v_foto,
    (p->>'client_id')::uuid, v_m.id, true, null);
end $$;

-- ================================================================ correcciones del supervisor (todas a la auditoría)
create function public.marcacion_manual(p_empresa uuid, p_miembro uuid, p_tipo text, p_cuando timestamptz, p_obra uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nom text;
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo de la corrección' using errcode = '22023'; end if;
  if p_tipo not in ('entrada', 'salida') then raise exception 'Tipo de marcación inválido' using errcode = '22023'; end if;
  if p_cuando > now() + interval '5 minutes' then raise exception 'No se puede cargar una marcación en el futuro' using errcode = '22023'; end if;
  select nombre into v_nom from miembros where id = p_miembro and empresa_id = p_empresa;
  if v_nom is null then raise exception 'Persona no encontrada' using errcode = '22023'; end if;
  if p_obra is not null and not exists (select 1 from obras where id = p_obra and empresa_id = p_empresa) then raise exception 'Obra no encontrada' using errcode = '22023'; end if;
  insert into marcaciones (empresa_id, miembro_id, obra_id, tipo, cuando, modo, registrado_por, verificada, observacion)
  values (p_empresa, p_miembro, p_obra, p_tipo, p_cuando, 'manual', mi_miembro_id(p_empresa), true, trim(p_motivo))
  returning id into v_id;
  perform auditar(p_empresa, 'marcacion_manual', 'marcaciones', v_id::text, v_nom || ' · ' || p_tipo || ' ' || to_char(p_cuando at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                  null, jsonb_build_object('motivo', trim(p_motivo)));
  return v_id;
end $$;

create function public.anular_marcacion(p_id uuid, p_motivo text) returns void
  language plpgsql security definer set search_path = public as $$
declare v marcaciones;
begin
  select * into v from marcaciones where id = p_id;
  if v.id is null or not es_gestor(v.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v.anulada_en is not null then raise exception 'Esa marcación ya está anulada' using errcode = '22023'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo' using errcode = '22023'; end if;
  update marcaciones set anulada_en = now(), anulada_por = mi_miembro_id(v.empresa_id), motivo_anulacion = trim(p_motivo) where id = p_id;
  perform auditar(v.empresa_id, 'anular_marcacion', 'marcaciones', p_id::text,
                  (select nombre from miembros where id = v.miembro_id) || ' · ' || v.tipo || ' ' || to_char(v.cuando at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                  null, jsonb_build_object('motivo', trim(p_motivo)));
end $$;

create function public.validar_marcacion(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v marcaciones;
begin
  select * into v from marcaciones where id = p_id;
  if v.id is null or not es_gestor(v.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v.verificada then return; end if;
  update marcaciones set verificada = true, observacion = concat_ws(' · ', observacion, 'Revisada por ' || (select nombre from miembros where id = mi_miembro_id(v.empresa_id))) where id = p_id;
  perform auditar(v.empresa_id, 'validar_marcacion', 'marcaciones', p_id::text,
                  (select nombre from miembros where id = v.miembro_id) || ' · ' || v.tipo || ' ' || to_char(v.cuando at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                  null, null);
end $$;

-- ================================================================ horas
-- Cada tramo entrada → salida (hasta 20 h) con su parte de horas normales, al 50 % y al 100 %.
-- Reglas (ajustables por empresa): de lunes a viernes, hasta horas_semana normales y el resto al 50 %;
-- el sábado, hasta horas_sabado normales antes de sabado_100_desde, el resto de la mañana al 50 % y desde esa hora al 100 %;
-- domingos y feriados, todo al 100 %. El día es el de la entrada.
create function public.asistencia_tramos(p_empresa uuid, p_desde date, p_hasta date)
returns table (miembro_id uuid, dia date, obra_id uuid, ini timestamptz, fin timestamptz, horas numeric, normales numeric, al50 numeric, al100 numeric, verificada boolean, fuera boolean)
language sql stable security definer set search_path = public as $$
  with a as (select * from ajustes_asistencia_de(p_empresa)),
  m as (
    select k.*, lead(k.tipo) over w as sig_tipo, lead(k.cuando) over w as sig_cuando, lead(k.obra_id) over w as sig_obra,
           lead(k.verificada) over w as sig_ver, lead(k.dentro) over w as sig_dentro
      from marcaciones k
     where k.empresa_id = p_empresa and k.anulada_en is null
       and k.cuando >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires') - interval '1 day'
       and k.cuando <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') + interval '1 day'
    window w as (partition by k.miembro_id order by k.cuando)
  ),
  par as (
    select m.miembro_id, (m.cuando at time zone 'America/Argentina/Buenos_Aires')::date as dia, coalesce(m.obra_id, m.sig_obra) as obra_id,
           m.cuando as ini, m.sig_cuando as fin, extract(epoch from m.sig_cuando - m.cuando)::numeric / 3600 as h,
           m.verificada and m.sig_ver as verificada, (m.dentro is false or m.sig_dentro is false) as fuera
      from m where m.tipo = 'entrada' and m.sig_tipo = 'salida' and m.sig_cuando - m.cuando <= interval '20 hours'
  ),
  par2 as (
    select p.*, case when (select sabado_100_desde from a) is not null and extract(isodow from p.dia) = 6
                     then greatest(0, extract(epoch from p.fin - greatest(p.ini, (p.dia + (select sabado_100_desde from a)) at time zone 'America/Argentina/Buenos_Aires'))::numeric / 3600)
                     else 0 end as h_tarde
      from par p where p.dia between p_desde and p_hasta
  ),
  d as (
    select p.miembro_id, p.dia, sum(p.h) as bruto, sum(p.h_tarde) as tarde, count(*) as tramos,
           extract(isodow from p.dia)::int as dow, exists (select 1 from feriados f where f.empresa_id = p_empresa and f.fecha = p.dia) as feriado
      from par2 p group by 1, 2
  ),
  d2 as (
    select d.*, greatest(0, d.bruto - case when d.tramos = 1 and d.bruto > 6 then (select descanso_min from a) / 60.0 else 0 end) as neto from d
  ),
  d3 as (
    select d2.*,
      case when d2.feriado or d2.dow = 7 then 0
           when d2.dow = 6 then least(greatest(d2.neto - d2.tarde, 0), (select horas_sabado from a))
           else least(d2.neto, (select horas_semana from a)) end as n,
      case when d2.feriado or d2.dow = 7 then d2.neto
           when d2.dow = 6 then least(d2.tarde, d2.neto)
           else 0 end as c
      from d2
  )
  select p.miembro_id, p.dia, p.obra_id, p.ini, p.fin,
         round(d3.neto * p.h / nullif(d3.bruto, 0), 2),
         round(d3.n * p.h / nullif(d3.bruto, 0), 2),
         round((d3.neto - d3.n - d3.c) * p.h / nullif(d3.bruto, 0), 2),
         round(d3.c * p.h / nullif(d3.bruto, 0), 2),
         p.verificada, p.fuera
    from par2 p join d3 on d3.miembro_id = p.miembro_id and d3.dia = p.dia
$$;

-- Reporte de asistencia: un renglón por persona y día con horas, llegadas tarde y marcaciones sin pareja; y los ausentes.
-- El supervisor ve a toda la empresa; cada persona puede pedir solo lo suyo (p_miembro = su id).
create function public.asistencia(p_empresa uuid, p_desde date, p_hasta date, p_miembro uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz constant text := 'America/Argentina/Buenos_Aires'; a ajustes_asistencia := ajustes_asistencia_de(p_empresa); v jsonb;
        v_hoy date := (now() at time zone tz)::date;
begin
  if not (es_gestor(p_empresa) or (p_miembro is not null and p_miembro = mi_miembro_id(p_empresa) and mi_rol(p_empresa) is not null)) then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 62 then raise exception 'Elegí un período de hasta dos meses' using errcode = '22023'; end if;
  with t as (select * from asistencia_tramos(p_empresa, p_desde, p_hasta) x where p_miembro is null or x.miembro_id = p_miembro),
  k as (
    select k.*, (k.cuando at time zone tz)::date as dia from marcaciones k
     where k.empresa_id = p_empresa and k.anulada_en is null and (p_miembro is null or k.miembro_id = p_miembro)
       and k.cuando >= (p_desde::timestamp at time zone tz) and k.cuando < ((p_hasta + 1)::timestamp at time zone tz)
  ),
  ult as (    -- última marcación de cada uno: si es una entrada de las últimas 20 h, está adentro
    select distinct on (miembro_id) miembro_id, tipo, cuando, obra_id from k order by miembro_id, cuando desc
  ),
  dias as (
    select k.miembro_id, k.dia,
           min(k.cuando) filter (where k.tipo = 'entrada') as entrada,
           max(k.cuando) filter (where k.tipo = 'salida') as salida,
           count(*) as marcas, bool_or(not k.verificada) as sin_verificar, bool_or(k.dentro is false) as fuera,
           array_agg(distinct k.obra_id) filter (where k.obra_id is not null) as obras
      from k group by 1, 2
  ),
  horas as (
    select miembro_id, dia, sum(horas) as horas, sum(normales) as normales, sum(al50) as al50, sum(al100) as al100, count(*) as tramos
      from t group by 1, 2
  ),
  lab as (    -- días que se trabaja
    select g::date as dia from generate_series(p_desde, least(p_hasta, v_hoy), interval '1 day') g
     where (extract(isodow from g) between 1 and 5 and a.horas_semana > 0 or extract(isodow from g) = 6 and a.horas_sabado > 0)
       and not exists (select 1 from feriados f where f.empresa_id = p_empresa and f.fecha = g::date)
  ),
  quienes as (
    select m.id, m.nombre, m.legajo, m.rol::text as rol from miembros m
     where m.empresa_id = p_empresa and m.activo and m.controla_asistencia and m.rol::text in ('operario', 'mecanico', 'personal')
       and (p_miembro is null or m.id = p_miembro)
  )
  select jsonb_build_object(
    'ajustes', jsonb_build_object('hora_entrada', to_char(a.hora_entrada, 'HH24:MI'), 'tolerancia_min', a.tolerancia_min, 'horas_semana', a.horas_semana,
                                  'horas_sabado', a.horas_sabado, 'sabado_100_desde', to_char(a.sabado_100_desde, 'HH24:MI'), 'descanso_min', a.descanso_min,
                                  'radio_m', a.radio_m, 'pedir_foto', a.pedir_foto),
    'dias', coalesce((select jsonb_agg(jsonb_build_object(
        'miembro_id', d.miembro_id, 'fecha', d.dia, 'entrada', d.entrada, 'salida', d.salida, 'marcas', d.marcas,
        'horas', coalesce(h.horas, 0), 'normales', coalesce(h.normales, 0), 'al50', coalesce(h.al50, 0), 'al100', coalesce(h.al100, 0),
        'tarde', d.entrada is not null and extract(isodow from d.dia) between 1 and 6
                 and not exists (select 1 from feriados f where f.empresa_id = p_empresa and f.fecha = d.dia)
                 and (d.entrada at time zone tz)::time > a.hora_entrada + make_interval(mins => a.tolerancia_min),
        'adentro', coalesce(u.tipo = 'entrada' and (u.cuando at time zone tz)::date = d.dia and now() - u.cuando < interval '20 hours', false),
        'ultima', case when (u.cuando at time zone tz)::date = d.dia then u.cuando end,
        'incompleta', coalesce(h.tramos, 0) * 2 < d.marcas
                      and not coalesce(u.tipo = 'entrada' and (u.cuando at time zone tz)::date = d.dia and now() - u.cuando < interval '20 hours', false),
        'sin_verificar', d.sin_verificar, 'fuera', d.fuera, 'obras', coalesce(to_jsonb(d.obras), '[]'))
        order by d.dia, d.miembro_id)
      from dias d left join horas h on h.miembro_id = d.miembro_id and h.dia = d.dia left join ult u on u.miembro_id = d.miembro_id), '[]'),
    'ausencias', coalesce((select jsonb_agg(jsonb_build_object('miembro_id', q.id, 'fecha', l.dia) order by l.dia, q.nombre)
      from quienes q cross join lab l
     where not exists (select 1 from dias d where d.miembro_id = q.id and d.dia = l.dia)
       and l.dia >= (select (min(m.creado_en) at time zone tz)::date from miembros m where m.id = q.id)), '[]'),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'legajo', m.legajo, 'rol', m.rol::text, 'controla', m.controla_asistencia) order by m.nombre)
      from miembros m where m.empresa_id = p_empresa and m.rol::text <> 'reloj' and (p_miembro is null or m.id = p_miembro)
        and (m.activo or exists (select 1 from dias d where d.miembro_id = m.id))), '[]'),
    'feriados', coalesce((select jsonb_agg(jsonb_build_object('fecha', f.fecha, 'nombre', f.nombre) order by f.fecha) from feriados f
                           where f.empresa_id = p_empresa and f.fecha between p_desde and p_hasta), '[]')
  ) into v;
  return v;
end $$;

-- ================================================================ costos por obra: mano de obra desde el tarjetero
-- Si en el período hay marcaciones, la mano de obra sale de las horas del tarjetero (todo el personal, con recargos del 50 % y 100 %),
-- repartida por obra; si no, se sigue estimando con las jornadas de los operarios como hasta ahora.
create or replace function public.costos_por_obra(p_empresa uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; tz constant text := 'America/Argentina/Buenos_Aires'; v_admin boolean := es_admin(p_empresa);
        v_tarjetero boolean := exists (select 1 from marcaciones where empresa_id = p_empresa and anulada_en is null
                                        and cuando >= (p_desde::timestamp at time zone tz) and cuando < ((p_hasta + 1)::timestamp at time zone tz));
begin
  if not es_gestor(p_empresa) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  with j as (
    select j.equipo_id, coalesce(j.obra_id::text, '-') as obra, (j.inicio at time zone tz)::date as dia, coalesce(j.uso, 0) as uso,
           -- mano de obra: horas reales de la jornada (inicio a cierre, hasta 16 h) × costo por hora del operario (solo administración)
           case when v_admin and not v_tarjetero and j.fin is not null then least(extract(epoch from (j.fin - j.inicio)) / 3600, 16) * cp.costo_hora end as mano_obra
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
  ),
  mo as (    -- tarjetero: horas y pesos por obra (pesos solo para administración)
    select coalesce(t.obra_id::text, '-') as obra, sum(t.horas) as horas, count(distinct t.miembro_id) as personas,
           sum((t.normales + 1.5 * t.al50 + 2 * t.al100) * cp.costo_hora) as pesos,
           sum(t.horas) filter (where cp.costo_hora is null) as horas_sin_costo
      from asistencia_tramos(p_empresa, p_desde, p_hasta) t left join costos_personal cp on cp.miembro_id = t.miembro_id
     where v_tarjetero group by 1
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
    'mano_obra_fuente', case when v_tarjetero then 'tarjetero' else 'jornadas' end,
    'mano_obra_obras', coalesce((select jsonb_object_agg(mo.obra, jsonb_build_object(
        'obra', coalesce((select nombre from obras where id::text = mo.obra), 'Sin obra'), 'horas', round(mo.horas, 1), 'personas', mo.personas,
        'pesos', case when v_admin then round(mo.pesos, 0) end, 'horas_sin_costo', case when v_admin then round(coalesce(mo.horas_sin_costo, 0), 1) end)) from mo), '{}'),
    'presupuestos', coalesce((select jsonb_object_agg(o.id, jsonb_build_object('mensual', o.presupuesto_mensual, 'total', o.presupuesto_total))
                              from obras o where o.empresa_id = p_empresa and (o.presupuesto_mensual is not null or o.presupuesto_total is not null)), '{}')
  ) into v;
  return v;
end $$;

-- ================================================================ permisos
revoke execute on function public.registrar_marcacion(uuid, uuid, uuid, text, timestamptz, text, double precision, double precision, real, text, uuid, uuid, boolean, text),
  public.asistencia_tramos(uuid, date, date), public.ajustes_asistencia_de(uuid) from public, anon, authenticated;
grant execute on function public.registrar_marcacion(uuid, uuid, uuid, text, timestamptz, text, double precision, double precision, real, text, uuid, uuid, boolean, text) to service_role;
revoke execute on function public.marcar(jsonb), public.marcacion_manual(uuid, uuid, text, timestamptz, uuid, text), public.anular_marcacion(uuid, text),
  public.validar_marcacion(uuid), public.asistencia(uuid, date, date, uuid), public.qr_de_obra(uuid, boolean) from public, anon;
grant execute on function public.marcar(jsonb), public.marcacion_manual(uuid, uuid, text, timestamptz, uuid, text), public.anular_marcacion(uuid, text),
  public.validar_marcacion(uuid), public.asistencia(uuid, date, date, uuid), public.qr_de_obra(uuid, boolean) to authenticated;
