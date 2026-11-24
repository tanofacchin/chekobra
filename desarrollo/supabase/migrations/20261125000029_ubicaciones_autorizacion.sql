-- Tarjetero: ubicaciones permitidas para marcar y autorización de lo marcado afuera.
-- Se puede marcar en la ubicación de cada obra (con su radio) y en otros lugares permitidos (taller, depósito, oficina).
-- Lo marcado desde el celular (o con el QR) fuera de esas ubicaciones, o sin GPS, queda PENDIENTE:
-- no suma horas hasta que lo autorice el dueño, administración o un supervisor (nunca la misma persona que marcó).

create table public.lugares_marcacion (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 2 and 80),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radio_m    integer not null default 150 check (radio_m between 30 and 5000),
  obra_id    uuid references public.obras on delete cascade,   -- nulo: vale para cualquier obra (taller, depósito)
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create index on public.lugares_marcacion (empresa_id);
alter table public.lugares_marcacion enable row level security;
create policy lm_ver on public.lugares_marcacion for select to authenticated using (public.es_miembro(empresa_id));
create policy lm_gestion on public.lugares_marcacion for all to authenticated using (public.es_gestor(empresa_id))
  with check (public.es_gestor(empresa_id) and (obra_id is null or exists (select 1 from public.obras o where o.id = obra_id and o.empresa_id = lugares_marcacion.empresa_id)));
revoke all on public.lugares_marcacion from anon;
grant select, insert, update, delete on public.lugares_marcacion to authenticated;
create trigger auditoria after insert or update or delete on public.lugares_marcacion for each row execute function public.auditoria_trigger();

alter table public.marcaciones
  add column autorizacion   text check (autorizacion in ('pendiente', 'autorizada', 'rechazada')),   -- nulo: no hacía falta
  add column autorizada_por uuid references public.miembros on delete set null,
  add column autorizada_en  timestamptz,
  add column lugar          text,       -- dónde marcó: la obra o el lugar permitido más cercano
  add column nota           text;       -- lo que explicó quien marcó (por ejemplo, por qué estaba afuera)
create index on public.marcaciones (empresa_id) where autorizacion = 'pendiente' and anulada_en is null;

create or replace function public.registrar_marcacion(
  p_empresa uuid, p_miembro uuid, p_obra uuid, p_tipo text, p_cuando timestamptz, p_modo text,
  p_lat double precision, p_lng double precision, p_precision real, p_foto text, p_client uuid,
  p_registrado_por uuid, p_verificada boolean, p_obs text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m miembros; v_o obras; v_ult marcaciones; v_ex marcaciones; a ajustes_asistencia := ajustes_asistencia_de(p_empresa);
        v_t timestamptz := now(); v_tipo text; v_dist integer; v_dentro boolean; v_ver boolean := coalesce(p_verificada, true); v_obs text := p_obs;
        v_aut text; v_lugar text; v_obra_cerca uuid; v_margen double precision := least(coalesce(p_precision, 0), 150);
begin
  if p_client is not null then
    select * into v_ex from marcaciones where client_id = p_client;
    if found then
      return jsonb_build_object('id', v_ex.id, 'tipo', v_ex.tipo, 'cuando', v_ex.cuando, 'verificada', v_ex.verificada, 'autorizacion', v_ex.autorizacion, 'ya', true,
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

  -- Ubicaciones permitidas: la obra elegida (o cualquiera, si no eligió) y los otros lugares permitidos.
  -- Solo para el celular y el QR (el reloj está fijo en el obrador) y solo si la empresa cargó alguna ubicación.
  if p_modo in ('celular', 'qr') and (exists (select 1 from obras where empresa_id = p_empresa and activa and lat is not null)
                                      or exists (select 1 from lugares_marcacion where empresa_id = p_empresa and activo)) then
    if p_lat is null or p_lng is null then
      if p_modo = 'celular' then v_aut := 'pendiente'; v_obs := concat_ws(' · ', v_obs, 'El teléfono no dio la ubicación'); end if;
    else
      select c.nombre, c.obra_id, round(c.d)::integer, c.d <= c.radio + v_margen into v_lugar, v_obra_cerca, v_dist, v_dentro
        from (select o.nombre, o.id as obra_id, distancia_m(p_lat, p_lng, o.lat, o.lng) as d, coalesce(o.radio_m, a.radio_m) as radio
                from obras o where o.empresa_id = p_empresa and o.activa and o.lat is not null and (v_o.id is null or o.id = v_o.id)
              union all
              select l.nombre, l.obra_id, distancia_m(p_lat, p_lng, l.lat, l.lng), l.radio_m
                from lugares_marcacion l where l.empresa_id = p_empresa and l.activo and (l.obra_id is null or v_o.id is null or l.obra_id = v_o.id)) c
       order by c.d <= c.radio + v_margen desc, c.d limit 1;
      if v_dentro is false then
        v_aut := 'pendiente';
        v_obs := concat_ws(' · ', v_obs, format('Fuera de las ubicaciones permitidas (a %s de %s)',
                   case when v_dist >= 1000 then replace(to_char(v_dist / 1000.0, 'FM999990.0'), '.', ',') || ' km' else v_dist || ' m' end, v_lugar));
      elsif v_dentro and v_o.id is null and v_obra_cerca is not null then
        select * into v_o from obras where id = v_obra_cerca;        -- no eligió obra: se toma la del lugar donde está
      end if;
    end if;
  end if;
  if v_aut = 'pendiente' then v_ver := false; end if;

  insert into marcaciones (empresa_id, miembro_id, obra_id, tipo, cuando, modo, lat, lng, precision_m, distancia_m, dentro, foto_path,
                           client_id, registrado_por, verificada, observacion, autorizacion, lugar)
  values (p_empresa, p_miembro, v_o.id, v_tipo, v_t, p_modo, p_lat, p_lng, p_precision, v_dist, v_dentro, nullif(p_foto, ''),
          p_client, p_registrado_por, v_ver, v_obs, v_aut, case when v_dentro then v_lugar end)
  returning * into v_ex;
  return jsonb_build_object('id', v_ex.id, 'tipo', v_ex.tipo, 'cuando', v_ex.cuando, 'verificada', v_ex.verificada, 'observacion', v_ex.observacion,
                            'autorizacion', v_ex.autorizacion, 'lugar', v_ex.lugar, 'dentro', v_ex.dentro, 'distancia_m', v_ex.distancia_m,
                            'nombre', v_m.nombre, 'obra', v_o.nombre);
end $$;

-- p: { empresa_id, tipo?, obra_id?, qr?, lat?, lng?, precision_m?, foto_path?, client_id?, cuando?, nota? }
create or replace function public.marcar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e uuid := (p->>'empresa_id')::uuid; v_m miembros; v_obra uuid := nullif(p->>'obra_id', '')::uuid; v_modo text := 'celular';
        v_foto text := nullif(p->>'foto_path', ''); a ajustes_asistencia; r jsonb; v_nota text := left(nullif(trim(p->>'nota'), ''), 300);
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
  r := registrar_marcacion(v_e, v_m.id, v_obra, nullif(p->>'tipo', ''), (p->>'cuando')::timestamptz, v_modo,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'precision_m')::real, v_foto,
    (p->>'client_id')::uuid, v_m.id, true, null);
  if v_nota is not null and not coalesce((r->>'ya')::boolean, false) then update marcaciones set nota = v_nota where id = (r->>'id')::uuid; end if;
  return r;
end $$;

-- Autorizar (o confirmar) una marcación. Lo hace el dueño, administración o un supervisor; nunca sobre su propia marcación.
create or replace function public.validar_marcacion(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v marcaciones; v_yo uuid;
begin
  select * into v from marcaciones where id = p_id;
  if v.id is null or not es_gestor(v.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  v_yo := mi_miembro_id(v.empresa_id);
  if v.miembro_id = v_yo then raise exception 'No podés autorizar tu propia marcación: pedíselo a otro supervisor o al dueño' using errcode = '42501'; end if;
  if v.anulada_en is not null then raise exception 'Esa marcación está anulada' using errcode = '22023'; end if;
  if v.verificada and v.autorizacion is distinct from 'pendiente' then return; end if;
  update marcaciones set verificada = true,
         autorizacion = case when autorizacion = 'pendiente' then 'autorizada' else autorizacion end,
         autorizada_por = v_yo, autorizada_en = now(),
         observacion = concat_ws(' · ', observacion, case when v.autorizacion = 'pendiente' then 'Autorizada por ' else 'Revisada por ' end || (select nombre from miembros where id = v_yo))
   where id = p_id;
  perform auditar(v.empresa_id, case when v.autorizacion = 'pendiente' then 'autorizar_marcacion' else 'validar_marcacion' end, 'marcaciones', p_id::text,
                  (select nombre from miembros where id = v.miembro_id) || ' · ' || v.tipo || ' ' || to_char(v.cuando at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                  null, case when v.observacion is not null then jsonb_build_object('observacion', v.observacion) end);
end $$;

-- Anular; si estaba pendiente de autorización, queda como rechazada (y quien marcó lo ve).
create or replace function public.anular_marcacion(p_id uuid, p_motivo text) returns void
  language plpgsql security definer set search_path = public as $$
declare v marcaciones;
begin
  select * into v from marcaciones where id = p_id;
  if v.id is null or not es_gestor(v.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v.anulada_en is not null then raise exception 'Esa marcación ya está anulada' using errcode = '22023'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo' using errcode = '22023'; end if;
  update marcaciones set anulada_en = now(), anulada_por = mi_miembro_id(v.empresa_id), motivo_anulacion = trim(p_motivo),
         autorizacion = case when autorizacion = 'pendiente' then 'rechazada' else autorizacion end
   where id = p_id;
  perform auditar(v.empresa_id, case when v.autorizacion = 'pendiente' then 'rechazar_marcacion' else 'anular_marcacion' end, 'marcaciones', p_id::text,
                  (select nombre from miembros where id = v.miembro_id) || ' · ' || v.tipo || ' ' || to_char(v.cuando at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                  null, jsonb_build_object('motivo', trim(p_motivo)));
end $$;

-- Las horas solo suman lo autorizado (lo pendiente no cuenta hasta que alguien lo autorice).
create or replace function public.asistencia_tramos(p_empresa uuid, p_desde date, p_hasta date)
returns table (miembro_id uuid, dia date, obra_id uuid, ini timestamptz, fin timestamptz, horas numeric, normales numeric, al50 numeric, al100 numeric, verificada boolean, fuera boolean)
language sql stable security definer set search_path = public as $$
  with a as (select * from ajustes_asistencia_de(p_empresa)),
  m as (
    select k.*, lead(k.tipo) over w as sig_tipo, lead(k.cuando) over w as sig_cuando, lead(k.obra_id) over w as sig_obra,
           lead(k.verificada) over w as sig_ver, lead(k.dentro) over w as sig_dentro
      from marcaciones k
     where k.empresa_id = p_empresa and k.anulada_en is null and k.autorizacion is distinct from 'pendiente'
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

create or replace function public.asistencia(p_empresa uuid, p_desde date, p_hasta date, p_miembro uuid default null)
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
           bool_or(k.autorizacion = 'pendiente') as pendiente,
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
        'incompleta', coalesce(h.tramos, 0) * 2 < d.marcas - (select count(*) from k k2 where k2.miembro_id = d.miembro_id and k2.dia = d.dia and k2.autorizacion = 'pendiente')
                      and not coalesce(u.tipo = 'entrada' and (u.cuando at time zone tz)::date = d.dia and now() - u.cuando < interval '20 hours', false),
        'sin_verificar', d.sin_verificar, 'fuera', d.fuera, 'pendiente', d.pendiente, 'obras', coalesce(to_jsonb(d.obras), '[]'))
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

revoke execute on function public.asistencia_tramos(uuid, date, date) from public, anon, authenticated;
