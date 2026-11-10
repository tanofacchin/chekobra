-- Pruebas de permisos y reglas de negocio. Correr con: supabase/tests/correr.sh
\set ON_ERROR_STOP on
\set QUIET on

-- usuarios
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'duena-a@ejemplo.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'operario-a@ejemplo.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'operario2-a@ejemplo.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'dueno-b@ejemplo.com');

create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;

create function pg_temp.esperar_error(sql text, fragmento text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FALLÓ: se esperaba error "%" y no hubo', fragmento;
exception when others then
  if sqlerrm like 'FALLÓ:%' then raise; end if;
  if position(fragmento in sqlerrm) = 0 then
    raise exception 'FALLÓ: se esperaba "%", vino "%"', fragmento, sqlerrm;
  end if;
end $$;

create function pg_temp.respuestas(p_clave text, p_fallas jsonb default '{}') returns jsonb language sql as $$
  select jsonb_object_agg(it->>'id', coalesce(p_fallas->(it->>'id'), '{"v":"ok"}'::jsonb))
    from public.plantillas p, jsonb_array_elements(p.secciones) s, jsonb_array_elements(s->'items') it
   where p.empresa_id is null and p.clave = p_clave
$$;

-- ===== Empresa A: la crea su dueña
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into ctx values ('A', public.crear_empresa('Constructora A', 'constructora-a', 'construccion', 'Duena A'));
insert into public.miembros (empresa_id, user_id, nombre, rol)
  select v, '00000000-0000-0000-0000-0000000000a2', 'Operario A', 'operario' from ctx where k = 'A';
insert into public.miembros (empresa_id, user_id, nombre, rol)
  select v, '00000000-0000-0000-0000-0000000000a3', 'Operario A2', 'operario' from ctx where k = 'A';
insert into public.obras (empresa_id, nombre) select v, 'Ruta 5' from ctx where k = 'A' returning id \gset obraA_
insert into ctx values ('obraA', :'obraA_id');
insert into public.equipos (empresa_id, codigo, nombre, plantilla_clave, ultimo_medidor)
  select v, 'EX-01', 'Excavadora 320', 'excavadora', 100 from ctx where k = 'A' returning id \gset eqA_
insert into ctx values ('eqA', :'eqA_id');
select pg_temp.esperar_error($$select public.crear_empresa('Otra empresa', 'constructora-a', 'agro', 'Otro dueño')$$, 'duplicate');
reset role;

-- ===== Empresa B: otro cliente
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into ctx values ('B', public.crear_empresa('Minera B', 'minera-b', 'mineria', 'Dueno B'));
insert into public.equipos (empresa_id, codigo, nombre, plantilla_clave)
  select v, 'CM-01', 'Camioneta B', 'camioneta' from ctx where k = 'B' returning id \gset eqB_
insert into ctx values ('eqB', :'eqB_id');

-- B no ve nada de A
do $$ begin
  if (select count(*) from public.empresas) <> 1 then raise exception 'FALLÓ: B ve otras empresas'; end if;
  if exists (select 1 from public.equipos where codigo = 'EX-01') then raise exception 'FALLÓ: B ve equipos de A'; end if;
  if exists (select 1 from public.miembros where nombre like 'Operario A%') then raise exception 'FALLÓ: B ve personal de A'; end if;
  if (select count(*) from public.plantillas) <> 13 then raise exception 'FALLÓ: B no ve las 13 plantillas base'; end if;
end $$;
-- B no puede meterse en A
select pg_temp.esperar_error($$insert into public.miembros (empresa_id, user_id, nombre, rol)
  select v, '00000000-0000-0000-0000-0000000000b1', 'Intruso', 'admin' from ctx where k = 'A'$$, 'row-level security');
select pg_temp.esperar_error($$insert into public.equipos (empresa_id, codigo, nombre, plantilla_clave)
  select v, 'ZZ-01', 'Intruso', 'excavadora' from ctx where k = 'A'$$, 'row-level security');
-- B no puede liberar ni cerrar cosas de A
select pg_temp.esperar_error($$select public.cambiar_servicio((select v from ctx where k = 'eqA'), true, 'x')$$, 'no encontrado');
reset role;

-- ===== Operario A: checklist con falla crítica
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  if (select count(*) from public.equipos) <> 1 then raise exception 'FALLÓ: operario no ve su equipo'; end if;
  if exists (select 1 from public.miembros where nombre = 'Duena A') then raise exception 'FALLÓ: operario ve todo el personal'; end if;
end $$;
-- no puede tocar el estado del equipo directamente (ni ninguna columna)
update public.equipos set estado = 'operativo', ultimo_medidor = 0;
do $$ begin if (select ultimo_medidor from public.equipos) <> 100 then raise exception 'FALLÓ: operario editó el equipo'; end if; end $$;
-- no puede crear jornadas a mano
select pg_temp.esperar_error($$insert into public.jornadas (empresa_id) values (gen_random_uuid())$$, 'permission denied');

select (select v from ctx where k = 'A')::text || '/00000000-0000-0000-0000-0000000000a2/' as pref \gset
-- validaciones del RPC
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'obra_id', %L, 'med_ini', 50, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', %L, 'firma_path', %L, 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora')))$$,
  (select v from ctx where k = 'eqA'), (select v from ctx where k = 'obraA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'menor al último');
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', %L, 'firma_path', %L, 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora') - 'cabina.3'))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'Falta responder');
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', %L, 'firma_path', %L, 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora', '{"cabina.1":{"v":"na"}}')))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'No aplica');
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', 'otra-empresa/x/s.jpg', 'firma_path', %L, 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora')))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 'f.png'), 'Foto o firma inválida');

-- envío válido con falla crítica → no apto y equipo bloqueado
select gen_random_uuid() as cid \gset
select public.enviar_checklist(jsonb_build_object(
  'client_id', :'cid', 'equipo_id', (select v from ctx where k = 'eqA'), 'obra_id', (select v from ctx where k = 'obraA'),
  'med_ini', 120, 'lat', -31.4, 'lng', -64.2, 'precision_m', 8,
  'selfie_path', :'pref' || 's.jpg', 'firma_path', :'pref' || 'f.png', 'declaracion', true, 'dur_checklist_s', 70,
  'respuestas', pg_temp.respuestas('excavadora', '{"fluidos.5":{"v":"falla","nota":"pierde aceite"},"trabajo.1":{"v":"falla","nota":"diente flojo"}}')
)) ->> 'resultado' as r \gset
\echo resultado esperado no_apto: :r
-- reenvío idéntico (sin señal) no duplica
select (public.enviar_checklist(jsonb_build_object(
  'client_id', :'cid', 'equipo_id', (select v from ctx where k = 'eqA'), 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', :'pref' || 's.jpg', 'firma_path', :'pref' || 'f.png', 'declaracion', true, 'dur_checklist_s', 70,
  'respuestas', pg_temp.respuestas('excavadora')))->>'repetido') as rep \gset
\echo reenvío marcado como repetido: :rep
reset role;

do $$ declare j public.jornadas; e public.equipos; begin
  select * into j from public.jornadas;
  select * into e from public.equipos where codigo = 'EX-01';
  if (select count(*) from public.jornadas) <> 1 then raise exception 'FALLÓ: jornadas duplicadas'; end if;
  if j.resultado <> 'no_apto' or j.estado <> 'rechazada' or j.n_fallas <> 2 or j.n_criticas <> 1 or not j.rapido then
    raise exception 'FALLÓ: jornada mal calculada %', row_to_json(j); end if;
  if e.estado <> 'bloqueado' or e.ultimo_medidor <> 120 then raise exception 'FALLÓ: equipo no bloqueado %', row_to_json(e); end if;
  if (select count(*) from public.fallas where jornada_id = j.id) <> 2 then raise exception 'FALLÓ: fallas no registradas'; end if;
  if (select count(*) from public.eventos_equipo where tipo = 'bloqueo') <> 1 then raise exception 'FALLÓ: falta evento de bloqueo'; end if;
end $$;

-- ===== Otro operario no puede usar el equipo bloqueado ni ver la jornada ajena
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
do $$ begin if exists (select 1 from public.jornadas) then raise exception 'FALLÓ: operario ve jornadas ajenas'; end if; end $$;
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 130, 'lat', 1, 'lng', 1,
  'selfie_path', 'x', 'firma_path', 'x', 'declaracion', true, 'respuestas', '{}'::jsonb))$$,
  (select v from ctx where k = 'eqA')), 'bloqueado');
select pg_temp.esperar_error(format($$select public.liberar_equipo(%L, 'lo arreglé yo')$$, (select v from ctx where k = 'eqA')), 'no encontrado');
reset role;

-- ===== La dueña libera el equipo
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.esperar_error(format($$update public.equipos set estado = 'operativo' where id = %L$$, (select v from ctx where k = 'eqA')), 'Liberar');
select public.liberar_equipo((select v from ctx where k = 'eqA'), 'Se cambió el retén de la bomba');
do $$ begin
  if (select estado from public.equipos where codigo = 'EX-01') <> 'operativo' then raise exception 'FALLÓ: no se liberó'; end if;
  if exists (select 1 from public.fallas where critica and estado = 'abierta') then raise exception 'FALLÓ: falla crítica sigue abierta'; end if;
  if (select count(*) from public.fallas where not critica and estado = 'abierta') <> 1 then raise exception 'FALLÓ: la falla no crítica debía seguir abierta'; end if;
end $$;
reset role;

-- ===== Operario A2: jornada apta y cierre
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select (select v from ctx where k = 'A')::text || '/00000000-0000-0000-0000-0000000000a3/' as pref2 \gset
select (public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'med_ini', 121, 'ubic_ref', 'Obrador km 12',
  'selfie_path', :'pref2' || 's.jpg', 'firma_path', :'pref2' || 'f.png', 'declaracion', true, 'dur_checklist_s', 400,
  'respuestas', pg_temp.respuestas('excavadora')))->>'jornada_id') as jid \gset
select pg_temp.esperar_error(format($$select public.cerrar_jornada(%L, 200, null, null, false, true)$$, :'jid'), 'demasiado grande');
select pg_temp.esperar_error(format($$select public.cerrar_jornada(%L, 129, null, null, false, false)$$, :'jid'), 'Confirmá');
select public.cerrar_jornada(:'jid', 129.5, 90, 'Ruido en el giro', true, true);
reset role;
do $$ begin
  if (select uso from public.jornadas where estado = 'cerrada') <> 8.5 then raise exception 'FALLÓ: uso mal calculado'; end if;
  if (select ultimo_medidor from public.equipos where codigo = 'EX-01') <> 129.5 then raise exception 'FALLÓ: medidor no actualizado'; end if;
  if not exists (select 1 from public.fallas where origen = 'cierre') then raise exception 'FALLÓ: falla de cierre no registrada'; end if;
end $$;

-- ===== Almacenamiento: cada uno sube solo a su carpeta
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
insert into storage.objects (bucket_id, name) values ('evidencias', :'pref' || 'ok.jpg');
select pg_temp.esperar_error(format($$insert into storage.objects (bucket_id, name) values ('evidencias', %L)$$,
  (select v from ctx where k = 'A')::text || '/00000000-0000-0000-0000-0000000000a3/x.jpg'), 'row-level security');
select pg_temp.esperar_error(format($$insert into storage.objects (bucket_id, name) values ('evidencias', %L)$$,
  (select v from ctx where k = 'B')::text || '/00000000-0000-0000-0000-0000000000a2/x.jpg'), 'row-level security');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin if exists (select 1 from storage.objects) then raise exception 'FALLÓ: B ve fotos de A'; end if; end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin if (select count(*) from storage.objects) <> 1 then raise exception 'FALLÓ: la dueña no ve las fotos de su empresa'; end if; end $$;
reset role;

-- ===== Tokens de telemetría: invisibles para la app
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.esperar_error($$select * from public.telemetria_tokens$$, 'permission denied');
reset role;

\echo TODAS LAS PRUEBAS PASARON
