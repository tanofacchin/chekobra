-- Verificación en dos pasos: opcional para todos y con tres formas posibles:
--   · app autenticadora (TOTP) y huella o cara (llave de acceso / WebAuthn): factores de Supabase, la sesión pasa a aal2;
--   · código por correo: propio de Operapto (Supabase no lo tiene como factor). Al verificarlo, la sesión
--     (claim session_id del token) queda anotada como verificada.
-- Quien activa alguna forma la necesita en cada ingreso: el servidor no le da permisos sin ella (ver mi_rol).

-- ================================================================ datos
create table public.ajustes_2fa (
  user_id        uuid primary key references auth.users on delete cascade,
  correo         boolean not null default false,
  actualizado_en timestamptz not null default now()
);
alter table public.ajustes_2fa enable row level security;
create policy ajustes_2fa_ver on public.ajustes_2fa for select to authenticated using (user_id = auth.uid());

-- Códigos enviados por correo: solo el hash, vencen a los 10 minutos, 5 intentos.
create table public.codigos_correo (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  hash       text not null,
  expira     timestamptz not null,
  intentos   integer not null default 0,
  usado      boolean not null default false,
  creado_en  timestamptz not null default now()
);
create index on public.codigos_correo (user_id, creado_en desc);
alter table public.codigos_correo enable row level security;           -- sin políticas: nadie desde la app

-- Sesiones verificadas con el código por correo (30 días como máximo).
create table public.sesiones_verificadas (
  session_id     uuid primary key,
  user_id        uuid not null references auth.users on delete cascade,
  verificada_en  timestamptz not null default now(),
  expira         timestamptz not null default now() + interval '30 days'
);
create index on public.sesiones_verificadas (user_id);
alter table public.sesiones_verificadas enable row level security;     -- sin políticas

-- ================================================================ reglas
create function public.jwt_session_id() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid
$$;

create function public.sesion_verificada() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.sesion_aal2() or exists (
    select 1 from sesiones_verificadas s where s.session_id = public.jwt_session_id() and s.user_id = auth.uid() and s.expira > now())
$$;

create or replace function public.tiene_segundo_factor() returns boolean
  language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      or exists (select 1 from public.ajustes_2fa a where a.user_id = auth.uid() and a.correo)
$$;

-- Opcional para todos: solo se exige a quien lo activó.
create or replace function public.mi_rol(e uuid) returns public.rol_miembro
  language sql stable security definer set search_path = public as $$
  select m.rol from miembros m
   where m.empresa_id = e and m.user_id = auth.uid() and m.activo
     and (not public.tiene_segundo_factor() or public.sesion_verificada())
$$;

create or replace function public.segundo_factor_pendiente() returns text
  language sql stable security definer set search_path = public as $$
  select case when public.tiene_segundo_factor() and not public.sesion_verificada() then 'verificar' else 'nada' end
$$;

-- Qué formas tiene activadas quien llama (para la pantalla de ingreso y "Tu seguridad").
create function public.mis_metodos_2fa() returns jsonb
  language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'app',     (select count(*) from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified' and f.factor_type::text = 'totp'),
    'huella',  (select count(*) from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified' and f.factor_type::text = 'webauthn'),
    'correo',  coalesce((select a.correo from public.ajustes_2fa a where a.user_id = auth.uid()), false),
    'verificada', public.sesion_verificada())
$$;

-- Verifica el código que llegó por correo. Con p_activar, además activa esta forma (prueba que el correo es suyo).
create function public.verificar_codigo_correo(p_codigo text, p_activar boolean default false) returns boolean
  language plpgsql security definer set search_path = public as $$
declare v codigos_correo; v_sid uuid := public.jwt_session_id();
begin
  if auth.uid() is null or v_sid is null then raise exception 'Iniciá sesión' using errcode = '42501'; end if;
  select * into v from codigos_correo where user_id = auth.uid() and not usado and expira > now() order by creado_en desc limit 1 for update;
  if not found then raise exception 'El código venció o no se pidió. Pedí uno nuevo.' using errcode = 'P0001'; end if;
  if v.intentos >= 5 then raise exception 'Demasiados intentos. Pedí un código nuevo.' using errcode = 'P0001'; end if;
  if v.hash <> encode(sha256(convert_to(auth.uid()::text || ':' || coalesce(p_codigo, ''), 'UTF8')), 'hex') then
    update codigos_correo set intentos = intentos + 1 where id = v.id;
    return false;
  end if;
  update codigos_correo set usado = true where id = v.id;
  insert into sesiones_verificadas (session_id, user_id) values (v_sid, auth.uid())
    on conflict (session_id) do update set verificada_en = now(), expira = now() + interval '30 days';
  if p_activar then
    insert into ajustes_2fa (user_id, correo) values (auth.uid(), true)
      on conflict (user_id) do update set correo = true, actualizado_en = now();
  end if;
  return true;
end $$;

-- Desactivar el código por correo: solo desde una sesión ya verificada.
create function public.desactivar_correo_2fa() returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sesion_verificada() then raise exception 'Primero verificá esta sesión' using errcode = '42501'; end if;
  update ajustes_2fa set correo = false, actualizado_en = now() where user_id = auth.uid();
end $$;

-- Al cerrar sesión la app borra su verificación; las vencidas se limpian solas al pedir códigos.
create function public.olvidar_sesion() returns void
  language sql security definer set search_path = public as $$
  delete from sesiones_verificadas where session_id = public.jwt_session_id() and user_id = auth.uid();
$$;

-- ================================================================ permisos
revoke all on public.ajustes_2fa, public.codigos_correo, public.sesiones_verificadas from anon;
revoke insert, update, delete, truncate on public.ajustes_2fa from authenticated;
revoke all on public.codigos_correo, public.sesiones_verificadas from authenticated;
grant select on public.ajustes_2fa to authenticated;
revoke execute on function public.jwt_session_id(), public.sesion_verificada(), public.mis_metodos_2fa(), public.verificar_codigo_correo(text, boolean),
  public.desactivar_correo_2fa(), public.olvidar_sesion() from public, anon;
grant execute on function public.jwt_session_id(), public.sesion_verificada(), public.mis_metodos_2fa(), public.verificar_codigo_correo(text, boolean),
  public.desactivar_correo_2fa(), public.olvidar_sesion() to authenticated;

-- ================================================================ huella o cara (llaves de acceso, WebAuthn)
-- Supabase todavía no habilita WebAuthn como factor en todos los proyectos: se implementa acá con el estándar.
-- Se guarda solo la llave PÚBLICA de cada dispositivo; la privada nunca sale del celular o la computadora.
create table public.huellas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  credencial    text not null unique,          -- id de la credencial (base64url)
  clave_publica text not null,                 -- base64url (COSE)
  contador      bigint not null default 0,
  transportes   text[],
  nombre        text not null,
  rp_id         text not null,                 -- dominio donde se creó (no sirve en otro)
  creada_en     timestamptz not null default now(),
  usada_en      timestamptz
);
create index on public.huellas (user_id);
alter table public.huellas enable row level security;
create policy huellas_ver on public.huellas for select to authenticated using (user_id = auth.uid());

create table public.desafios_huella (
  user_id   uuid primary key references auth.users on delete cascade,
  desafio   text not null,
  tipo      text not null check (tipo in ('alta', 'ingreso')),
  expira    timestamptz not null
);
alter table public.desafios_huella enable row level security;          -- sin políticas: solo el servidor

create or replace function public.tiene_segundo_factor() returns boolean
  language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      or exists (select 1 from public.ajustes_2fa a where a.user_id = auth.uid() and a.correo)
      or exists (select 1 from public.huellas h where h.user_id = auth.uid())
$$;

create or replace function public.mis_metodos_2fa() returns jsonb
  language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'app',     (select count(*) from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified' and f.factor_type::text = 'totp'),
    'huella',  (select count(*) from public.huellas h where h.user_id = auth.uid()),
    'correo',  coalesce((select a.correo from public.ajustes_2fa a where a.user_id = auth.uid()), false),
    'verificada', public.sesion_verificada())
$$;

create function public.quitar_huella(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.sesion_verificada() then raise exception 'Primero verificá esta sesión' using errcode = '42501'; end if;
  delete from huellas where id = p_id and user_id = auth.uid();
end $$;

revoke all on public.huellas, public.desafios_huella from anon;
revoke insert, update, delete, truncate on public.huellas from authenticated;
revoke all on public.desafios_huella from authenticated;
grant select (id, nombre, rp_id, creada_en, usada_en) on public.huellas to authenticated;
revoke select on public.huellas from authenticated;
grant select (id, nombre, rp_id, creada_en, usada_en) on public.huellas to authenticated;
revoke execute on function public.quitar_huella(uuid) from public, anon;
grant execute on function public.quitar_huella(uuid) to authenticated;
