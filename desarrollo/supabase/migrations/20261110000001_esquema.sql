-- CheckObra · esquema base multiempresa
-- Cada empresa cliente ve solo sus datos (Row Level Security).
-- Los operarios no escriben tablas directamente: todo pasa por funciones (RPC)
-- que validan y calculan el resultado del checklist en el servidor.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tipos
create type public.rubro as enum ('construccion', 'mineria', 'agro', 'otro');
create type public.rol_miembro as enum ('dueno', 'admin', 'supervisor', 'operario');
create type public.estado_equipo as enum ('operativo', 'bloqueado', 'fuera_servicio');
create type public.tipo_medidor as enum ('horas', 'km');
create type public.resultado_checklist as enum ('apto', 'observaciones', 'no_apto');
create type public.estado_jornada as enum ('abierta', 'cerrada', 'rechazada');
create type public.estado_falla as enum ('abierta', 'reparada');

-- ---------------------------------------------------------------- tablas
create table public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  rubro       public.rubro not null default 'construccion',
  plan        text not null default 'prueba',
  creada_en   timestamptz not null default now()
);

create table public.miembros (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas on delete cascade,
  user_id     uuid references auth.users on delete set null,
  nombre      text not null check (length(trim(nombre)) between 2 and 120),
  legajo      text,
  rol         public.rol_miembro not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, user_id),
  unique (empresa_id, legajo)
);
create index on public.miembros (user_id);

create table public.obras (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 2 and 120),
  activa      boolean not null default true,
  lat         double precision,
  lng         double precision,
  radio_m     integer check (radio_m > 0),       -- para validar que el checklist se hizo en la obra
  creada_en   timestamptz not null default now()
);
create index on public.obras (empresa_id);

-- empresa_id nulo = plantilla base del producto, visible para todas las empresas.
-- secciones: [{"titulo": "...", "items": [{"id": "doc.1", "texto": "...", "critico": true}]}]
create table public.plantillas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references public.empresas on delete cascade,
  clave       text not null check (clave ~ '^[a-z0-9_-]{2,40}$'),
  nombre      text not null,
  rubro       public.rubro not null,
  medidor     public.tipo_medidor not null default 'horas',
  version     integer not null default 1 check (version > 0),
  secciones   jsonb not null check (jsonb_typeof(secciones) = 'array'),
  activa      boolean not null default true,
  creada_en   timestamptz not null default now(),
  unique nulls not distinct (empresa_id, clave, version)
);

create table public.equipos (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas on delete cascade,
  codigo               text not null check (codigo ~ '^[A-Z0-9-]{2,16}$'),
  nombre               text not null,
  plantilla_clave      text not null,                 -- usa la última versión activa (de la empresa o base)
  marca                text,
  modelo               text,
  serie                text,                          -- PIN / número de serie (se usa para telemetría)
  patente              text,
  medidor              public.tipo_medidor not null default 'horas',
  ultimo_medidor       numeric(12,1),
  estado               public.estado_equipo not null default 'operativo',
  motivo_bloqueo       text,
  bloqueado_en         timestamptz,
  bloqueo_jornada_id   uuid,
  telemetria_proveedor text,                          -- 'john_deere', 'iso15143', ...
  telemetria_ref       text,                          -- id del equipo en el proveedor
  activo               boolean not null default true,
  creado_en            timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index on public.equipos (empresa_id);

create table public.jornadas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas on delete cascade,
  client_id         uuid not null,                    -- generado en el teléfono: reenvíos sin señal no duplican
  equipo_id         uuid not null references public.equipos on delete cascade,
  operario_id       uuid not null references public.miembros,
  obra_id           uuid references public.obras on delete set null,
  plantilla_id      uuid not null references public.plantillas,
  estado            public.estado_jornada not null,
  resultado         public.resultado_checklist not null,
  inicio            timestamptz not null,             -- hora del teléfono al firmar
  recibido_en       timestamptz not null default now(),
  fin               timestamptz,
  med_ini           numeric(12,1) not null check (med_ini >= 0),
  med_fin           numeric(12,1),
  uso               numeric(12,1),
  lat               double precision,
  lng               double precision,
  precision_m       double precision,
  ubic_ref          text,
  selfie_path       text not null,
  firma_path        text not null,
  respuestas        jsonb not null,
  total_items       integer not null,
  n_fallas          integer not null default 0,
  n_criticas        integer not null default 0,
  dur_checklist_s   integer not null check (dur_checklist_s >= 0),
  rapido            boolean not null default false,
  motivo_rapido     text,
  litros            numeric(8,1),
  novedades         text,
  unique (empresa_id, client_id),
  check (lat is not null or length(coalesce(ubic_ref, '')) >= 3)
);
create index on public.jornadas (empresa_id, inicio desc);
create index on public.jornadas (equipo_id, estado);
create index on public.jornadas (operario_id, estado);

create table public.fallas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas on delete cascade,
  jornada_id     uuid not null references public.jornadas on delete cascade,
  equipo_id      uuid not null references public.equipos on delete cascade,
  origen         text not null check (origen in ('checklist', 'cierre')),
  item_id        text,
  seccion        text,
  texto          text not null,
  critica        boolean not null default false,
  nota           text not null,
  foto_path      text,
  estado         public.estado_falla not null default 'abierta',
  reparada_por   uuid references public.miembros,
  reparada_en    timestamptz,
  reparacion     text,
  creada_en      timestamptz not null default now()
);
create index on public.fallas (empresa_id, estado);
create index on public.fallas (equipo_id, estado);

-- Registro de auditoría: quién bloqueó, liberó o sacó de servicio cada equipo.
create table public.eventos_equipo (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references public.empresas on delete cascade,
  equipo_id   uuid not null references public.equipos on delete cascade,
  tipo        text not null check (tipo in ('bloqueo', 'liberacion', 'fuera_servicio', 'en_servicio')),
  detalle     text,
  miembro_id  uuid references public.miembros,
  jornada_id  uuid references public.jornadas on delete set null,
  creado_en   timestamptz not null default now()
);
create index on public.eventos_equipo (equipo_id, creado_en desc);

-- Telemetría (JDLink y otros). Los tokens OAuth viven en una tabla sin acceso para los clientes.
create table public.telemetria_conexiones (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas on delete cascade,
  proveedor       text not null check (proveedor in ('john_deere', 'iso15143')),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'conectada', 'error', 'desconectada')),
  cuenta_externa  text,
  conectada_en    timestamptz,
  ultima_sync     timestamptz,
  error           text,
  unique (empresa_id, proveedor)
);

create table public.telemetria_tokens (
  conexion_id    uuid primary key references public.telemetria_conexiones on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expira_en      timestamptz
);

create table public.telemetria_lecturas (
  id              bigint generated always as identity primary key,
  empresa_id      uuid not null references public.empresas on delete cascade,
  equipo_id       uuid not null references public.equipos on delete cascade,
  proveedor       text not null,
  medido_en       timestamptz not null,
  horas           numeric(12,1),
  odometro_km     numeric(12,1),
  lat             double precision,
  lng             double precision,
  combustible_pct numeric(5,1),
  def_pct         numeric(5,1),
  raw             jsonb,
  unique (equipo_id, proveedor, medido_en)
);
create index on public.telemetria_lecturas (equipo_id, medido_en desc);

-- ---------------------------------------------------------------- ayudantes de permisos
create function public.mi_miembro_id(e uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from miembros where empresa_id = e and user_id = auth.uid() and activo
$$;

create function public.mi_rol(e uuid) returns public.rol_miembro
  language sql stable security definer set search_path = public as $$
  select rol from miembros where empresa_id = e and user_id = auth.uid() and activo
$$;

create function public.es_miembro(e uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol(e) is not null, false)
$$;

create function public.es_gestor(e uuid) returns boolean   -- dueño, admin o supervisor
  language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol(e) in ('dueno', 'admin', 'supervisor'), false)
$$;

create function public.es_admin(e uuid) returns boolean     -- dueño o admin
  language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol(e) in ('dueno', 'admin'), false)
$$;

-- ---------------------------------------------------------------- RLS
alter table public.empresas              enable row level security;
alter table public.miembros              enable row level security;
alter table public.obras                 enable row level security;
alter table public.plantillas            enable row level security;
alter table public.equipos               enable row level security;
alter table public.jornadas              enable row level security;
alter table public.fallas                enable row level security;
alter table public.eventos_equipo        enable row level security;
alter table public.telemetria_conexiones enable row level security;
alter table public.telemetria_tokens     enable row level security;  -- sin políticas: solo el servidor
alter table public.telemetria_lecturas   enable row level security;

create policy empresas_ver on public.empresas for select to authenticated using (public.es_miembro(id));
create policy empresas_editar on public.empresas for update to authenticated using (public.es_admin(id)) with check (public.es_admin(id));

create policy miembros_ver on public.miembros for select to authenticated
  using (user_id = auth.uid() or public.es_gestor(empresa_id));
create policy miembros_alta on public.miembros for insert to authenticated
  with check (public.es_admin(empresa_id) and rol <> 'dueno');
create policy miembros_editar on public.miembros for update to authenticated
  using (public.es_admin(empresa_id) and rol <> 'dueno')
  with check (public.es_admin(empresa_id) and rol <> 'dueno');

create policy obras_ver on public.obras for select to authenticated using (public.es_miembro(empresa_id));
create policy obras_gestion on public.obras for all to authenticated
  using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id));

create policy plantillas_ver on public.plantillas for select to authenticated
  using (empresa_id is null or public.es_miembro(empresa_id));
create policy plantillas_gestion on public.plantillas for all to authenticated
  using (empresa_id is not null and public.es_admin(empresa_id))
  with check (empresa_id is not null and public.es_admin(empresa_id));

create policy equipos_ver on public.equipos for select to authenticated using (public.es_miembro(empresa_id));
create policy equipos_alta on public.equipos for insert to authenticated
  with check (public.es_gestor(empresa_id) and estado = 'operativo');
-- Edición de datos del equipo. El estado (bloqueo/liberación) se cambia solo por RPC: ver trigger abajo.
create policy equipos_editar on public.equipos for update to authenticated
  using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id));

create policy jornadas_ver on public.jornadas for select to authenticated
  using (public.es_gestor(empresa_id) or operario_id = public.mi_miembro_id(empresa_id));
create policy jornadas_borrar on public.jornadas for delete to authenticated using (public.es_admin(empresa_id));

create policy fallas_ver on public.fallas for select to authenticated
  using (public.es_gestor(empresa_id)
         or exists (select 1 from public.jornadas j where j.id = jornada_id and j.operario_id = public.mi_miembro_id(j.empresa_id)));

create policy eventos_ver on public.eventos_equipo for select to authenticated using (public.es_gestor(empresa_id));

create policy tele_con_ver on public.telemetria_conexiones for select to authenticated using (public.es_gestor(empresa_id));
create policy tele_lec_ver on public.telemetria_lecturas for select to authenticated using (public.es_gestor(empresa_id));

-- El estado del equipo y el último medidor no se tocan por UPDATE directo desde la app:
-- solo las funciones de abajo (que corren como dueño de la tabla) pueden cambiarlos.
create function public.proteger_estado_equipo() returns trigger
  language plpgsql set search_path = public as $$
begin
  if current_setting('checkobra.rpc', true) is distinct from 'on'
     and (new.estado is distinct from old.estado
          or new.motivo_bloqueo is distinct from old.motivo_bloqueo
          or new.bloqueo_jornada_id is distinct from old.bloqueo_jornada_id
          or new.empresa_id is distinct from old.empresa_id)
     and current_user in ('authenticated', 'anon') then
    raise exception 'El estado del equipo se cambia desde Liberar / Fuera de servicio' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger equipos_proteger before update on public.equipos
  for each row execute function public.proteger_estado_equipo();

-- ---------------------------------------------------------------- funciones (RPC)

-- Alta de una empresa nueva: quien la crea queda como dueño.
create function public.crear_empresa(p_nombre text, p_slug text, p_rubro public.rubro, p_mi_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para crear una empresa' using errcode = '42501'; end if;
  insert into empresas (nombre, slug, rubro) values (trim(p_nombre), lower(trim(p_slug)), p_rubro) returning id into v_id;
  insert into miembros (empresa_id, user_id, nombre, rol) values (v_id, auth.uid(), trim(p_mi_nombre), 'dueno');
  return v_id;
end $$;

-- Versión vigente de una plantilla para una empresa: la propia si existe, si no la base.
create function public.plantilla_vigente(p_empresa uuid, p_clave text) returns public.plantillas
  language sql stable security definer set search_path = public as $$
  select * from plantillas
   where clave = p_clave and activa and (empresa_id = p_empresa or empresa_id is null)
   order by (empresa_id is null), version desc
   limit 1
$$;

-- Envío del checklist de inicio de jornada.
-- p: {client_id, equipo_id, obra_id, inicio, med_ini, lat, lng, precision_m, ubic_ref,
--     selfie_path, firma_path, dur_checklist_s, motivo_rapido, declaracion,
--     respuestas: {"<item_id>": {"v": "ok|falla|na", "nota": "...", "foto": "<path>"}}}
create function public.enviar_checklist(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_eq        equipos;
  v_pl        plantillas;
  v_miembro   uuid;
  v_existente jornadas;
  v_sec       jsonb;
  v_item      jsonb;
  v_r         jsonb;
  v_v         text;
  v_total     int := 0;
  v_fallas    int := 0;
  v_crit      int := 0;
  v_motivos   text[] := '{}';
  v_resultado resultado_checklist;
  v_jid       uuid;
  v_dur       int := coalesce((p->>'dur_checklist_s')::int, 0);
  v_med       numeric := (p->>'med_ini')::numeric;
  v_prefijo   text;
begin
  select * into v_eq from equipos where id = (p->>'equipo_id')::uuid and activo for update;
  if not found then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;

  v_miembro := mi_miembro_id(v_eq.empresa_id);
  if v_miembro is null then raise exception 'No pertenecés a esta empresa' using errcode = '42501'; end if;

  -- Reenvío del mismo checklist (sin señal): devolver el que ya está.
  select * into v_existente from jornadas where empresa_id = v_eq.empresa_id and client_id = (p->>'client_id')::uuid;
  if found then
    return jsonb_build_object('jornada_id', v_existente.id, 'resultado', v_existente.resultado, 'repetido', true);
  end if;

  if v_eq.estado = 'bloqueado' then raise exception 'El equipo % está bloqueado: %', v_eq.codigo, v_eq.motivo_bloqueo using errcode = 'P0001'; end if;
  if v_eq.estado = 'fuera_servicio' then raise exception 'El equipo % está fuera de servicio', v_eq.codigo using errcode = 'P0001'; end if;
  if exists (select 1 from jornadas where equipo_id = v_eq.id and estado = 'abierta') then
    raise exception 'El equipo % ya tiene una jornada abierta', v_eq.codigo using errcode = 'P0001';
  end if;
  if exists (select 1 from jornadas where operario_id = v_miembro and estado = 'abierta') then
    raise exception 'Tenés una jornada abierta: cerrala antes de iniciar otra' using errcode = 'P0001';
  end if;
  if (p->>'obra_id') is not null and not exists (select 1 from obras where id = (p->>'obra_id')::uuid and empresa_id = v_eq.empresa_id and activa) then
    raise exception 'Obra no válida' using errcode = 'P0001';
  end if;
  if v_med is null or v_med < 0 then raise exception 'Falta el medidor inicial' using errcode = 'P0001'; end if;
  if v_eq.ultimo_medidor is not null and v_med < v_eq.ultimo_medidor then
    raise exception 'El medidor inicial (%) es menor al último registrado (%)', v_med, v_eq.ultimo_medidor using errcode = 'P0001';
  end if;
  if coalesce((p->>'declaracion')::boolean, false) is not true then
    raise exception 'Falta aceptar la declaración' using errcode = 'P0001';
  end if;

  -- Las fotos y la firma tienen que estar en la carpeta de esta empresa y de este usuario.
  v_prefijo := v_eq.empresa_id::text || '/' || auth.uid()::text || '/';
  if left(coalesce(p->>'selfie_path', ''), length(v_prefijo)) <> v_prefijo
     or left(coalesce(p->>'firma_path', ''), length(v_prefijo)) <> v_prefijo then
    raise exception 'Foto o firma inválida' using errcode = 'P0001';
  end if;

  v_pl := plantilla_vigente(v_eq.empresa_id, v_eq.plantilla_clave);
  if v_pl.id is null then raise exception 'El equipo no tiene plantilla de checklist' using errcode = 'P0001'; end if;

  -- Validar respuestas contra la plantilla y calcular el resultado en el servidor.
  for v_sec in select * from jsonb_array_elements(v_pl.secciones) loop
    for v_item in select * from jsonb_array_elements(v_sec->'items') loop
      v_total := v_total + 1;
      v_r := p->'respuestas'->(v_item->>'id');
      v_v := v_r->>'v';
      if v_v is null or v_v not in ('ok', 'falla', 'na') then
        raise exception 'Falta responder: %', v_item->>'texto' using errcode = 'P0001';
      end if;
      if v_v = 'na' and coalesce((v_item->>'critico')::boolean, false) then
        raise exception 'Un punto crítico no puede quedar como No aplica: %', v_item->>'texto' using errcode = 'P0001';
      end if;
      if v_v = 'falla' then
        if length(trim(coalesce(v_r->>'nota', ''))) = 0 then
          raise exception 'Describí la falla: %', v_item->>'texto' using errcode = 'P0001';
        end if;
        if (v_r->>'foto') is not null and left(v_r->>'foto', length(v_prefijo)) <> v_prefijo then
          raise exception 'Foto de falla inválida' using errcode = 'P0001';
        end if;
        v_fallas := v_fallas + 1;
        if coalesce((v_item->>'critico')::boolean, false) then
          v_crit := v_crit + 1;
          v_motivos := v_motivos || (v_item->>'texto');
        end if;
      end if;
    end loop;
  end loop;

  v_resultado := case when v_crit > 0 then 'no_apto' when v_fallas > 0 then 'observaciones' else 'apto' end;

  insert into jornadas (empresa_id, client_id, equipo_id, operario_id, obra_id, plantilla_id, estado, resultado,
    inicio, med_ini, lat, lng, precision_m, ubic_ref, selfie_path, firma_path, respuestas, total_items,
    n_fallas, n_criticas, dur_checklist_s, rapido, motivo_rapido)
  values (v_eq.empresa_id, (p->>'client_id')::uuid, v_eq.id, v_miembro, (p->>'obra_id')::uuid, v_pl.id,
    case when v_resultado = 'no_apto' then 'rechazada'::estado_jornada else 'abierta'::estado_jornada end, v_resultado,
    least(coalesce((p->>'inicio')::timestamptz, now()), now()), v_med,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'precision_m')::double precision,
    nullif(trim(coalesce(p->>'ubic_ref', '')), ''), p->>'selfie_path', p->>'firma_path', p->'respuestas', v_total,
    v_fallas, v_crit, v_dur, v_dur < 120, nullif(trim(coalesce(p->>'motivo_rapido', '')), ''))
  returning id into v_jid;

  insert into fallas (empresa_id, jornada_id, equipo_id, origen, item_id, seccion, texto, critica, nota, foto_path)
  select v_eq.empresa_id, v_jid, v_eq.id, 'checklist', it->>'id', s->>'titulo', it->>'texto',
         coalesce((it->>'critico')::boolean, false), trim(p->'respuestas'->(it->>'id')->>'nota'),
         p->'respuestas'->(it->>'id')->>'foto'
    from jsonb_array_elements(v_pl.secciones) s, jsonb_array_elements(s->'items') it
   where p->'respuestas'->(it->>'id')->>'v' = 'falla';

  perform set_config('checkobra.rpc', 'on', true);
  if v_resultado = 'no_apto' then
    update equipos set estado = 'bloqueado', motivo_bloqueo = array_to_string(v_motivos, ' · '),
           bloqueado_en = now(), bloqueo_jornada_id = v_jid, ultimo_medidor = v_med
     where id = v_eq.id;
    insert into eventos_equipo (empresa_id, equipo_id, tipo, detalle, miembro_id, jornada_id)
    values (v_eq.empresa_id, v_eq.id, 'bloqueo', array_to_string(v_motivos, ' · '), v_miembro, v_jid);
  else
    update equipos set ultimo_medidor = v_med where id = v_eq.id;
  end if;
  perform set_config('checkobra.rpc', 'off', true);

  return jsonb_build_object('jornada_id', v_jid, 'resultado', v_resultado, 'fallas', v_fallas, 'criticas', v_crit, 'repetido', false);
end $$;

-- Cierre de jornada por el mismo operario.
create function public.cerrar_jornada(p_jornada uuid, p_med_fin numeric, p_litros numeric, p_novedades text,
                                      p_falla boolean, p_equipo_asegurado boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_j jornadas; v_max numeric;
begin
  select * into v_j from jornadas where id = p_jornada for update;
  if not found or v_j.operario_id is distinct from mi_miembro_id(v_j.empresa_id) then
    raise exception 'Jornada no encontrada' using errcode = 'P0002';
  end if;
  if v_j.estado <> 'abierta' then raise exception 'La jornada ya está cerrada' using errcode = 'P0001'; end if;
  if p_med_fin is null or p_med_fin < v_j.med_ini then
    raise exception 'El medidor final no puede ser menor al inicial (%)', v_j.med_ini using errcode = 'P0001';
  end if;
  v_max := case (select medidor from equipos where id = v_j.equipo_id) when 'km' then 1500 else 24 end;
  if p_med_fin - v_j.med_ini > v_max then
    raise exception 'La diferencia es demasiado grande para una jornada' using errcode = 'P0001';
  end if;
  if p_equipo_asegurado is not true then raise exception 'Confirmá cómo dejaste el equipo' using errcode = 'P0001'; end if;
  if p_falla and length(trim(coalesce(p_novedades, ''))) = 0 then
    raise exception 'Describí la falla que apareció' using errcode = 'P0001';
  end if;

  update jornadas set estado = 'cerrada', fin = now(), med_fin = p_med_fin, uso = p_med_fin - med_ini,
         litros = p_litros, novedades = nullif(trim(coalesce(p_novedades, '')), '')
   where id = p_jornada;

  perform set_config('checkobra.rpc', 'on', true);
  update equipos set ultimo_medidor = greatest(coalesce(ultimo_medidor, 0), p_med_fin) where id = v_j.equipo_id;
  perform set_config('checkobra.rpc', 'off', true);

  if p_falla then
    insert into fallas (empresa_id, jornada_id, equipo_id, origen, texto, nota)
    values (v_j.empresa_id, v_j.id, v_j.equipo_id, 'cierre', 'Falla reportada al cierre', trim(p_novedades));
  end if;
end $$;

-- Marcar una falla como reparada (supervisor o superior).
create function public.reparar_falla(p_falla uuid, p_reparacion text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_f fallas;
begin
  select * into v_f from fallas where id = p_falla for update;
  if not found or not es_gestor(v_f.empresa_id) then raise exception 'Falla no encontrada' using errcode = 'P0002'; end if;
  if length(trim(coalesce(p_reparacion, ''))) < 3 then raise exception 'Contá qué se reparó' using errcode = 'P0001'; end if;
  update fallas set estado = 'reparada', reparada_por = mi_miembro_id(v_f.empresa_id), reparada_en = now(), reparacion = trim(p_reparacion)
   where id = p_falla and estado = 'abierta';
end $$;

-- Liberar un equipo bloqueado: cierra las fallas críticas abiertas del equipo y deja registro.
create function public.liberar_equipo(p_equipo uuid, p_reparacion text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_m uuid;
begin
  select * into v_eq from equipos where id = p_equipo for update;
  if not found or not es_gestor(v_eq.empresa_id) then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;
  if v_eq.estado <> 'bloqueado' then raise exception 'El equipo no está bloqueado' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_reparacion, ''))) < 3 then raise exception 'Contá qué se reparó antes de liberar' using errcode = 'P0001'; end if;
  v_m := mi_miembro_id(v_eq.empresa_id);

  update fallas set estado = 'reparada', reparada_por = v_m, reparada_en = now(), reparacion = trim(p_reparacion)
   where equipo_id = p_equipo and estado = 'abierta' and critica;

  perform set_config('checkobra.rpc', 'on', true);
  update equipos set estado = 'operativo', motivo_bloqueo = null, bloqueado_en = null, bloqueo_jornada_id = null where id = p_equipo;
  perform set_config('checkobra.rpc', 'off', true);

  insert into eventos_equipo (empresa_id, equipo_id, tipo, detalle, miembro_id, jornada_id)
  values (v_eq.empresa_id, p_equipo, 'liberacion', trim(p_reparacion), v_m, v_eq.bloqueo_jornada_id);
end $$;

-- Sacar de servicio / volver a servicio.
create function public.cambiar_servicio(p_equipo uuid, p_fuera boolean, p_motivo text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_eq equipos;
begin
  select * into v_eq from equipos where id = p_equipo for update;
  if not found or not es_gestor(v_eq.empresa_id) then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;
  if v_eq.estado = 'bloqueado' then raise exception 'El equipo está bloqueado: liberalo primero' using errcode = 'P0001'; end if;
  if p_fuera and exists (select 1 from jornadas where equipo_id = p_equipo and estado = 'abierta') then
    raise exception 'El equipo tiene una jornada abierta' using errcode = 'P0001';
  end if;
  perform set_config('checkobra.rpc', 'on', true);
  update equipos set estado = case when p_fuera then 'fuera_servicio'::estado_equipo else 'operativo'::estado_equipo end,
         motivo_bloqueo = case when p_fuera then nullif(trim(coalesce(p_motivo, '')), '') end
   where id = p_equipo;
  perform set_config('checkobra.rpc', 'off', true);
  insert into eventos_equipo (empresa_id, equipo_id, tipo, detalle, miembro_id)
  values (v_eq.empresa_id, p_equipo, case when p_fuera then 'fuera_servicio' else 'en_servicio' end,
          nullif(trim(coalesce(p_motivo, '')), ''), mi_miembro_id(v_eq.empresa_id));
end $$;

-- Permisos de ejecución: solo usuarios con sesión.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.crear_empresa(text, text, public.rubro, text),
                          public.enviar_checklist(jsonb),
                          public.cerrar_jornada(uuid, numeric, numeric, text, boolean, boolean),
                          public.reparar_falla(uuid, text),
                          public.liberar_equipo(uuid, text),
                          public.cambiar_servicio(uuid, boolean, text),
                          public.plantilla_vigente(uuid, text),
                          public.mi_miembro_id(uuid), public.mi_rol(uuid),
                          public.es_miembro(uuid), public.es_gestor(uuid), public.es_admin(uuid)
  to authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.miembros, public.obras, public.plantillas, public.equipos, public.empresas to authenticated;
grant delete on public.obras, public.plantillas, public.jornadas to authenticated;
revoke all on public.telemetria_tokens from authenticated, anon;
