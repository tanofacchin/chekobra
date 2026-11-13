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

create function pg_temp.foto_medidor() returns text language sql as $$
  select (select empresa_id::text from public.miembros where user_id = auth.uid() limit 1) || '/' || auth.uid()::text || '/m.jpg'
$$;
create function pg_temp.respuestas(p_clave text, p_fallas jsonb default '{}') returns jsonb language sql as $$
  with pl as (select secciones from public.plantillas where empresa_id is null and clave = p_clave order by version desc limit 1),
  pref as (select (select empresa_id::text from public.miembros where user_id = auth.uid() limit 1) || '/' || auth.uid()::text || '/f.jpg' as f)
  select jsonb_object_agg(it->>'id',
           coalesce(p_fallas->(it->>'id'), '{"v":"ok"}'::jsonb)
           || case when it->>'foto' = 'obligatoria' then jsonb_build_object('foto', (select f from pref)) else '{}'::jsonb end)
    from pl, jsonb_array_elements(pl.secciones) s, jsonb_array_elements(s->'items') it
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
  if (select count(*) from public.plantillas) <> 26 then raise exception 'FALLÓ: B no ve las 26 plantillas base (v1 y v2)'; end if;
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
  'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora')))$$,
  (select v from ctx where k = 'eqA'), (select v from ctx where k = 'obraA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'menor al último');
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora') - 'cabina.3'))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'Falta responder');
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora', '{"cabina.1":{"v":"na"}}')))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'No aplica');
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', 'otra-empresa/x/s.jpg', 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora')))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 'f.png'), 'Foto o firma inválida');

-- sin aceptar la política de privacidad no se guarda nada
do $$ begin if not public.privacidad_pendiente((select v from ctx where k = 'A')) then raise exception 'FALLÓ: privacidad no pendiente'; end if; end $$;
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora')))$$,
  (select v from ctx where k = 'eqA'), :'pref' || 's.jpg', :'pref' || 'f.png'), 'política de privacidad');
select public.aceptar_privacidad((select v from ctx where k = 'A'), 'prueba');
select public.aceptar_privacidad((select v from ctx where k = 'A'), 'prueba');   -- repetir no falla
do $$ begin if public.privacidad_pendiente((select v from ctx where k = 'A')) then raise exception 'FALLÓ: privacidad sigue pendiente'; end if; end $$;
-- el operario no puede desbloquearse ni tocar sus intentos
select pg_temp.esperar_error(format($$select public.desbloquear_miembro(%L)$$, (select id from public.miembros where nombre = 'Operario A')), 'permiso');

-- envío válido con falla crítica → no apto y equipo bloqueado
select gen_random_uuid() as cid \gset
select public.enviar_checklist(jsonb_build_object(
  'client_id', :'cid', 'equipo_id', (select v from ctx where k = 'eqA'), 'obra_id', (select v from ctx where k = 'obraA'),
  'med_ini', 120, 'lat', -31.4, 'lng', -64.2, 'precision_m', 8,
  'selfie_path', :'pref' || 's.jpg', 'firma_path', :'pref' || 'f.png', 'medidor_foto_path', :'pref' || 'f.png', 'declaracion', true, 'dur_checklist_s', 70,
  'respuestas', pg_temp.respuestas('excavadora', '{"fluidos.5":{"v":"falla","nota":"pierde aceite"},"trabajo.3":{"v":"falla","nota":"sin traba"}}')
)) ->> 'resultado' as r \gset
\echo resultado esperado no_apto: :r
-- reenvío idéntico (sin señal) no duplica
select (public.enviar_checklist(jsonb_build_object(
  'client_id', :'cid', 'equipo_id', (select v from ctx where k = 'eqA'), 'med_ini', 120, 'lat', -31.4, 'lng', -64.2,
  'selfie_path', :'pref' || 's.jpg', 'firma_path', :'pref' || 'f.png', 'medidor_foto_path', :'pref' || 'f.png', 'declaracion', true, 'dur_checklist_s', 70,
  'respuestas', pg_temp.respuestas('excavadora')))->>'repetido') as rep \gset
\echo reenvío marcado como repetido: :rep
reset role;

do $$ declare j public.jornadas; e public.equipos; begin
  select * into j from public.jornadas;
  select * into e from public.equipos where codigo = 'EX-01';
  if (select count(*) from public.jornadas) <> 1 then raise exception 'FALLÓ: jornadas duplicadas'; end if;
  if j.resultado <> 'no_apto' or j.estado <> 'rechazada' or j.n_fallas <> 2 or j.n_criticas <> 1 or j.n_alertas <> 1 or not j.rapido then
    raise exception 'FALLÓ: jornada mal calculada %', row_to_json(j); end if;
  if e.estado <> 'bloqueado' or e.ultimo_medidor <> 120 then raise exception 'FALLÓ: equipo no bloqueado %', row_to_json(e); end if;
  if (select count(*) from public.fallas where jornada_id = j.id) <> 2 then raise exception 'FALLÓ: fallas no registradas'; end if;
  if (select count(*) from public.fallas where jornada_id = j.id and grave and not critica) <> 1 then raise exception 'FALLÓ: la pérdida de aceite debe quedar como advertencia'; end if;
  if (select count(*) from public.eventos_equipo where tipo = 'bloqueo') <> 1 then raise exception 'FALLÓ: falta evento de bloqueo'; end if;
  if (select count(*) from public.notificaciones where tipo = 'equipo_bloqueado' and estado = 'pendiente' and datos->>'codigo' = 'EX-01'
        and datos->>'operario' = 'Operario A' and datos->>'obra' = 'Ruta 5') <> 1 then raise exception 'FALLÓ: falta aviso de bloqueo'; end if;
end $$;

-- ===== Otro operario no puede usar el equipo bloqueado ni ver la jornada ajena
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
do $$ begin if exists (select 1 from public.jornadas) then raise exception 'FALLÓ: operario ve jornadas ajenas'; end if; end $$;
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 130, 'lat', 1, 'lng', 1,
  'selfie_path', 'x', 'firma_path', 'x', 'medidor_foto_path', 'x', 'declaracion', true, 'respuestas', '{}'::jsonb))$$,
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
select public.aceptar_privacidad((select v from ctx where k = 'A'), 'prueba');
select (public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'med_ini', 121, 'ubic_ref', 'Obrador km 12',
  'selfie_path', :'pref2' || 's.jpg', 'firma_path', :'pref2' || 'f.png', 'medidor_foto_path', :'pref2' || 'f.png', 'declaracion', true, 'dur_checklist_s', 400,
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

-- ===== Telemetría: alertas cruzadas con los checklists
insert into public.telemetria_lecturas (empresa_id, equipo_id, proveedor, medido_en, horas, lat, lng)
select (select v from ctx where k = 'A'), (select v from ctx where k = 'eqA'), 'john_deere', t, h, la, lo
  from (values (now() - interval '10 minutes', 110::numeric, -31.5, -64.2),
               (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires' - interval '20 hours', 100, null, null),
               (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires' - interval '12 hours', 104, null, null)) v(t, h, la, lo);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ declare n_h int; n_l int; n_s int; begin
  select count(*) filter (where tipo = 'horometro'), count(*) filter (where tipo = 'lejos'), count(*) filter (where tipo = 'sin_checklist')
    into n_h, n_l, n_s from public.alertas_telemetria((select v from ctx where k = 'A'));
  if (n_h, n_l, n_s) <> (2, 1, 1) then raise exception 'FALLÓ: alertas de telemetría % % %', n_h, n_l, n_s; end if;
  if (select horas from public.telemetria_ultimas((select v from ctx where k = 'A'))) <> 110 then raise exception 'FALLÓ: última lectura'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if exists (select 1 from public.alertas_telemetria((select v from ctx where k = 'A'))) then raise exception 'FALLÓ: B ve alertas de A'; end if;
  if exists (select 1 from public.telemetria_lecturas) then raise exception 'FALLÓ: B ve lecturas de A'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin if exists (select 1 from public.alertas_telemetria((select v from ctx where k = 'A'))) then raise exception 'FALLÓ: operario ve alertas'; end if; end $$;
select pg_temp.esperar_error($$select * from public.telemetria_oauth$$, 'permission denied');
reset role;

-- ===== Bloqueo de PIN: la dueña ve y desbloquea; nadie toca los campos a mano
update public.miembros set intentos_fallidos = 5, bloqueado_en = now() where nombre = 'Operario A';   -- lo hace el servidor
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.esperar_error($$update public.miembros set bloqueado_en = null where nombre = 'Operario A'$$, 'Desbloquear');
select public.desbloquear_miembro((select id from public.miembros where nombre = 'Operario A'));
do $$ begin if (select bloqueado_en from public.miembros where nombre = 'Operario A') is not null then raise exception 'FALLÓ: no se desbloqueó'; end if; end $$;
-- la dueña ve los consentimientos y los avisos de su empresa
do $$ begin
  if (select count(*) from public.consentimientos) <> 2 then raise exception 'FALLÓ: consentimientos visibles %', (select count(*) from public.consentimientos); end if;
  if (select count(*) from public.notificaciones) <> 1 then raise exception 'FALLÓ: avisos visibles'; end if;
end $$;
-- ===== Plantillas propias
insert into public.plantillas (empresa_id, clave, nombre, rubro, medidor, version, secciones)
  select v, 'excavadora', 'Excavadora Propia', 'construccion', 'horas', 1,
         '[{"titulo":"Seguridad","items":[{"id":"doc.1","texto":"Operador habilitado","critico":true},{"id":"c.x1","texto":"Arnés","critico":false}]}]'
    from ctx where k = 'A';
do $$ begin if (public.plantilla_vigente((select v from ctx where k = 'A'), 'excavadora')).nombre <> 'Excavadora Propia' then raise exception 'FALLÓ: no usa la plantilla propia'; end if; end $$;
select pg_temp.esperar_error($$insert into public.plantillas (empresa_id, clave, nombre, rubro, version, secciones)
  select v, 'mala', 'Mala', 'construccion', 1, '[{"titulo":"X","items":[{"id":"a","texto":"Uno","critico":false},{"id":"a","texto":"Dos","critico":false}]}]' from ctx where k = 'A'$$, 'repetidos');
select pg_temp.esperar_error($$insert into public.plantillas (empresa_id, clave, nombre, rubro, version, secciones)
  select v, 'mala', 'Mala', 'construccion', 1, '[{"titulo":"X","items":[]}]' from ctx where k = 'A'$$, 'no tiene puntos');
-- una versión base usada en jornadas no se puede cambiar (además, la base no es editable por empresas)
reset role;
select pg_temp.esperar_error($$update public.plantillas set secciones = '[{"titulo":"X","items":[{"id":"a","texto":"Uno","critico":false}]}]' where empresa_id is null and clave = 'excavadora'$$, 'versión nueva');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if exists (select 1 from public.plantillas where nombre = 'Excavadora Propia') then raise exception 'FALLÓ: B ve plantillas de A'; end if;
  if exists (select 1 from public.notificaciones) or exists (select 1 from public.consentimientos) then raise exception 'FALLÓ: B ve datos de A'; end if;
end $$;
select pg_temp.esperar_error($$select public.destinatarios_avisos(gen_random_uuid())$$, 'permission denied');
reset role;
do $$ begin
  if (select count(*) from public.destinatarios_avisos((select v from ctx where k = 'A'))) <> 1 then raise exception 'FALLÓ: destinatarios (solo la dueña, sin operarios)'; end if;
end $$;

-- ===== Mantenimiento, vencimientos e indicadores
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into public.planes_mantenimiento (empresa_id, equipo_id, nombre, cada, anticipo, ultimo_medidor)
  select (select v from ctx where k = 'A'), (select v from ctx where k = 'eqA'), 'Service 50 h', 50, 10, 100;
do $$ declare r record; begin
  select * into r from public.estado_mantenimiento((select v from ctx where k = 'A'));
  if r.estado <> 'al_dia' or r.proximo <> 150 or r.faltan <> 20.5 then raise exception 'FALLÓ: estado de service %', row_to_json(r); end if;
end $$;
update public.planes_mantenimiento set cada = 30;
do $$ begin if (select estado from public.estado_mantenimiento((select v from ctx where k = 'A'))) <> 'proximo' then raise exception 'FALLÓ: service próximo'; end if; end $$;
update public.planes_mantenimiento set cada = 20;
do $$ begin if (select estado from public.estado_mantenimiento((select v from ctx where k = 'A'))) <> 'vencido' then raise exception 'FALLÓ: service vencido'; end if; end $$;
insert into public.mantenimientos (empresa_id, equipo_id, plan_id, tipo, descripcion, medidor)
  select (select v from ctx where k = 'A'), (select v from ctx where k = 'eqA'), (select id from public.planes_mantenimiento), 'service', 'Cambio de aceite y filtros', 129.5;
do $$ declare r record; begin
  select * into r from public.estado_mantenimiento((select v from ctx where k = 'A'));
  if r.estado <> 'al_dia' or r.ultimo_medidor <> 129.5 then raise exception 'FALLÓ: el service no reinició el plan %', row_to_json(r); end if;
  if (select registrado_por from public.mantenimientos) is null then raise exception 'FALLÓ: falta quién registró'; end if;
end $$;
-- documento vencido que bloquea el equipo
insert into public.documentos (empresa_id, equipo_id, tipo, vence, bloquea)
  select (select v from ctx where k = 'A'), (select v from ctx where k = 'eqA'), 'seguro', current_date - 5, true;
insert into public.documentos (empresa_id, miembro_id, tipo, vence, bloquea)
  select (select v from ctx where k = 'A'), (select id from public.miembros where nombre = 'Operario A2'), 'licencia', current_date + 20, true;
do $$ begin
  if (public.indicadores((select v from ctx where k = 'A'), current_date - 7, current_date)->>'total')::int <> 2 then raise exception 'FALLÓ: indicadores total'; end if;
  if (public.indicadores((select v from ctx where k = 'A'), current_date - 7, current_date)->'por_resultado'->>'no_apto')::int <> 1 then raise exception 'FALLÓ: indicadores por resultado'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 130, 'ubic_ref', 'Obrador km 12',
  'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 400,
  'respuestas', '{"doc.1":{"v":"ok"},"c.x1":{"v":"ok"}}'::jsonb))$$, (select v from ctx where k = 'eqA'), :'pref2' || 's2.jpg', :'pref2' || 'f2.png'), 'documentación vencida');
do $$ begin
  if (select count(*) from public.documentos) <> 2 then raise exception 'FALLÓ: el operario debe ver el doc del equipo y el suyo'; end if;
  if exists (select 1 from public.estado_mantenimiento((select v from ctx where k = 'A'))) then raise exception 'FALLÓ: operario ve mantenimiento'; end if;
  if exists (select 1 from public.mantenimientos) then raise exception 'FALLÓ: operario ve mantenimientos'; end if;
end $$;
select pg_temp.esperar_error($$select public.indicadores((select v from ctx where k = 'A'), current_date - 7, current_date)$$, 'permiso');
select pg_temp.esperar_error($$insert into public.documentos (empresa_id, miembro_id, tipo, vence) select (select v from ctx where k = 'A'), (select id from public.miembros where nombre = 'Operario A2'), 'licencia', current_date + 900$$, 'row-level security');
reset role;
-- licencia del operario vencida
update public.documentos set vence = current_date + 30 where tipo = 'seguro';
update public.documentos set vence = current_date - 5 where tipo = 'licencia';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object(
  'client_id', gen_random_uuid(), 'equipo_id', %L, 'med_ini', 130, 'ubic_ref', 'Obrador km 12',
  'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 400,
  'respuestas', '{"doc.1":{"v":"ok"},"c.x1":{"v":"ok"}}'::jsonb))$$, (select v from ctx where k = 'eqA'), :'pref2' || 's2.jpg', :'pref2' || 'f2.png'), 'Tu licencia venció');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if exists (select 1 from public.planes_mantenimiento) or exists (select 1 from public.documentos) or exists (select 1 from public.mantenimientos) then raise exception 'FALLÓ: B ve flota de A'; end if;
  if exists (select 1 from public.estado_mantenimiento((select v from ctx where k = 'A'))) then raise exception 'FALLÓ: B ve estado de A'; end if;
  if public.medidor_actual((select v from ctx where k = 'eqA')) is not null then raise exception 'FALLÓ: B ve medidor de A'; end if;
end $$;
select pg_temp.esperar_error($$select public.indicadores((select v from ctx where k = 'A'), current_date - 7, current_date)$$, 'permiso');
select pg_temp.esperar_error($$insert into public.planes_mantenimiento (empresa_id, equipo_id, nombre, cada) select (select v from ctx where k = 'B'), (select v from ctx where k = 'eqA'), 'Truco', 10$$, 'row-level security');
reset role;

-- ===== Combustible
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
update public.equipos set capacidad_tanque = 300 where codigo = 'EX-01';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
create temp table cid as select gen_random_uuid() v;
grant select on cid to authenticated;
select public.registrar_carga(jsonb_build_object('client_id', (select v from cid), 'equipo_id', (select v from ctx where k = 'eqA'), 'cargado_en', now() - interval '4 days', 'litros', 200, 'medidor', 130, 'tanque_lleno', true, 'precio_litro', 1500));
do $$ begin if (public.registrar_carga(jsonb_build_object('client_id', (select v from cid), 'equipo_id', (select v from ctx where k = 'eqA'), 'litros', 200)) ->> 'repetido')::boolean is not true then raise exception 'FALLÓ: carga repetida'; end if; end $$;
select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'cargado_en', now() - interval '3 days', 'litros', 150, 'medidor', 140, 'tanque_lleno', true));
select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'cargado_en', now() - interval '2 days', 'litros', 160, 'medidor', 150, 'tanque_lleno', true));
select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'cargado_en', now() - interval '1 day', 'litros', 300, 'medidor', 160, 'tanque_lleno', true));
select pg_temp.esperar_error($$select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'litros', 400, 'medidor', 170))$$, 'Revisá el número');
select pg_temp.esperar_error($$select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'litros', 50, 'medidor', 120))$$, 'menor al de la carga anterior');
select pg_temp.esperar_error($$select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'litros', 50, 'foto_path', 'otra/empresa/x.jpg'))$$, 'Foto inválida');
select pg_temp.esperar_error($$insert into public.cargas_combustible (empresa_id, client_id, equipo_id, cargado_en, litros) values ((select v from ctx where k = 'A'), gen_random_uuid(), (select v from ctx where k = 'eqA'), now(), 10)$$, 'permission denied');
do $$ begin
  if (select count(*) from public.cargas_combustible) <> 4 then raise exception 'FALLÓ: el operario debe ver sus 4 cargas'; end if;
  if exists (select 1 from public.consumo_combustible((select v from ctx where k = 'A'), current_date - 30, current_date)) then raise exception 'FALLÓ: operario ve consumo'; end if;
  if (select ultimo_medidor from public.equipos where codigo = 'EX-01') <> 160 then raise exception 'FALLÓ: la carga no actualizó el horómetro'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ declare r record; begin
  select * into r from public.consumo_combustible((select v from ctx where k = 'A'), current_date - 30, current_date);
  if r.litros <> 810 or r.cargas <> 4 or r.costo <> 300000 then raise exception 'FALLÓ: totales %', row_to_json(r); end if;
  if r.ultimo_tramo <> 30 or r.referencia <> 15.5 or r.origen_referencia <> 'historial' or r.alerta <> 'consumo_alto' then raise exception 'FALLÓ: alerta de consumo %', row_to_json(r); end if;
  if r.consumo_periodo <> round(610 / 30.0, 2) then raise exception 'FALLÓ: consumo del período %', r.consumo_periodo; end if;
end $$;
update public.equipos set consumo_referencia = 35 where codigo = 'EX-01';
do $$ declare r record; begin
  select * into r from public.consumo_combustible((select v from ctx where k = 'A'), current_date - 30, current_date);
  if r.alerta is not null or r.origen_referencia <> 'cargada' then raise exception 'FALLÓ: con referencia cargada no debía alertar %', row_to_json(r); end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if exists (select 1 from public.cargas_combustible) or exists (select 1 from public.consumo_combustible((select v from ctx where k = 'A'), current_date - 30, current_date))
     or exists (select 1 from public.tramos_combustible((select v from ctx where k = 'A'))) then raise exception 'FALLÓ: B ve combustible de A'; end if;
end $$;
select pg_temp.esperar_error($$select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqA'), 'litros', 10))$$, 'No pertenecés');
reset role;

-- ===== Checklist v2: controles semanales, fotos obligatorias, foto del horómetro, advertencia roja
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.aceptar_privacidad((select v from ctx where k = 'B'), 'prueba');
insert into public.equipos (empresa_id, codigo, nombre, plantilla_clave, ultimo_medidor)
  select v, 'EX-B', 'Excavadora B', 'excavadora', 10 from ctx where k = 'B' returning id \gset eqB2_
insert into ctx values ('eqB2', :'eqB2_id');
select (select v from ctx where k = 'B')::text || '/00000000-0000-0000-0000-0000000000b1/' as prefB \gset
do $$ begin
  if public.dia_iso('2026-11-06 10:00-03') <> 5 then raise exception 'FALLÓ: el 6/11/2026 es viernes'; end if;
  if public.periodicos_pendientes((select v from ctx where k = 'eqB2'), '2026-11-06') <> array['rodaje.2'] then raise exception 'FALLÓ: zapatas pendientes el viernes'; end if;
  if public.periodicos_pendientes((select v from ctx where k = 'eqB2'), '2026-11-05') <> array['rodaje.2'] then raise exception 'FALLÓ: zapatas atrasadas del viernes anterior'; end if;
end $$;
-- jueves: el control semanal no es obligatorio
select (public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqB2'), 'inicio', '2026-11-05 07:00-03',
  'med_ini', 10, 'ubic_ref', 'Obrador', 'selfie_path', :'prefb' || 's.jpg', 'firma_path', :'prefb' || 'f.png', 'medidor_foto_path', :'prefb' || 'm.jpg', 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora') - 'rodaje.2'))->>'jornada_id') as jb1 \gset
select public.cerrar_jornada(:'jb1', 18, null, null, false, true);
-- viernes: sin las zapatas no se acepta
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', %L, 'inicio', '2026-11-06 07:00-03',
  'med_ini', 18, 'ubic_ref', 'Obrador', 'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora') - 'rodaje.2'))$$, (select v from ctx where k = 'eqB2'), :'prefb' || 's.jpg', :'prefb' || 'f.png', :'prefb' || 'm.jpg'), 'Falta responder: Zapatas');
-- sin la foto obligatoria del balde
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', %L, 'inicio', '2026-11-06 07:00-03',
  'med_ini', 18, 'ubic_ref', 'Obrador', 'selfie_path', %L, 'firma_path', %L, 'medidor_foto_path', pg_temp.foto_medidor(), 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora') || '{"trabajo.1":{"v":"ok"}}'))$$, (select v from ctx where k = 'eqB2'), :'prefb' || 's.jpg', :'prefb' || 'f.png', :'prefb' || 'm.jpg'), 'Falta la foto: Balde');
-- sin la foto del horómetro
select pg_temp.esperar_error(format($$select public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', %L, 'inicio', '2026-11-06 07:00-03',
  'med_ini', 18, 'ubic_ref', 'Obrador', 'selfie_path', %L, 'firma_path', %L, 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora')))$$, (select v from ctx where k = 'eqB2'), :'prefb' || 's.jpg', :'prefb' || 'f.png'), 'Falta la foto del horómetro');
-- viernes completo, con una pérdida de aceite: advertencia roja, el equipo NO se bloquea
select public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqB2'), 'inicio', '2026-11-06 07:00-03',
  'med_ini', 18, 'ubic_ref', 'Obrador', 'selfie_path', :'prefb' || 's.jpg', 'firma_path', :'prefb' || 'f.png', 'medidor_foto_path', :'prefb' || 'm.jpg', 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora', '{"fluidos.5":{"v":"falla","nota":"gotea el cárter"}}'))) ->> 'resultado' as rb \gset
\echo resultado con advertencia (esperado observaciones): :rb
do $$ declare j public.jornadas; begin
  select * into j from public.jornadas where equipo_id = (select v from ctx where k = 'eqB2') and estado = 'abierta';
  if j.resultado <> 'observaciones' or j.n_alertas <> 1 or j.n_criticas <> 0 or j.medidor_foto_path is null then raise exception 'FALLÓ: advertencia %', row_to_json(j); end if;
  if (select estado from public.equipos where id = j.equipo_id) <> 'operativo' then raise exception 'FALLÓ: la advertencia no debe bloquear'; end if;
  if not (select grave from public.fallas where jornada_id = j.id) then raise exception 'FALLÓ: falla grave'; end if;
  if public.periodicos_pendientes(j.equipo_id, '2026-11-07') <> '{}' then raise exception 'FALLÓ: las zapatas ya se controlaron esta semana'; end if;
end $$;
-- segundo checklist del mismo viernes (otro turno): ya no pide las zapatas
select public.cerrar_jornada((select id from public.jornadas where equipo_id = (select v from ctx where k = 'eqB2') and estado = 'abierta'), 26, null, null, false, true);
select public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', (select v from ctx where k = 'eqB2'), 'inicio', '2026-11-06 15:00-03',
  'med_ini', 26, 'ubic_ref', 'Obrador', 'selfie_path', :'prefb' || 's.jpg', 'firma_path', :'prefb' || 'f.png', 'medidor_foto_path', :'prefb' || 'm.jpg', 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('excavadora') - 'rodaje.2')) ->> 'resultado' as rb2 \gset
\echo segundo turno del viernes sin repetir el semanal (esperado apto): :rb2
-- plantilla propia con campos nuevos válidos e inválidos
insert into public.plantillas (empresa_id, clave, nombre, rubro, version, secciones)
  select v, 'p-ok', 'Con campos nuevos', 'construccion', 1, '[{"titulo":"X","items":[{"id":"a","texto":"Uno","critico":false,"alerta":true,"foto":"obligatoria","frecuencia":{"tipo":"semanal","dia":5},"ayuda":"Mirá bien"}]}]' from ctx where k = 'B';
select pg_temp.esperar_error($$insert into public.plantillas (empresa_id, clave, nombre, rubro, version, secciones)
  select v, 'p-mal', 'Mal', 'construccion', 1, '[{"titulo":"X","items":[{"id":"a","texto":"Uno","critico":true,"alerta":true}]}]' from ctx where k = 'B'$$, 'crítico y advertencia');
select pg_temp.esperar_error($$insert into public.plantillas (empresa_id, clave, nombre, rubro, version, secciones)
  select v, 'p-mal', 'Mal', 'construccion', 1, '[{"titulo":"X","items":[{"id":"a","texto":"Uno","critico":false,"frecuencia":{"tipo":"semanal","dia":9}}]}]' from ctx where k = 'B'$$, 'Frecuencia inválida');
reset role;
-- la base v2 no tiene el seguro, el matafuego no es crítico y la pérdida es advertencia
do $$ declare it jsonb; begin
  select x into it from public.plantillas p, jsonb_array_elements(p.secciones) s, jsonb_array_elements(s->'items') x where p.empresa_id is null and p.clave = 'excavadora' and p.version = 2 and x->>'texto' ilike 'matafuego%';
  if (it->>'critico')::boolean then raise exception 'FALLÓ: matafuego crítico'; end if;
  if exists (select 1 from public.plantillas p, jsonb_array_elements(p.secciones) s, jsonb_array_elements(s->'items') x where p.empresa_id is null and p.version = 2 and x->>'texto' ilike 'seguro%') then raise exception 'FALLÓ: quedó el seguro'; end if;
  if (select s->>'clave' from public.plantillas p, jsonb_array_elements(p.secciones) with ordinality s(s, n) where p.empresa_id is null and p.clave = 'excavadora' and p.version = 2 and n = 1) <> 'fotos' then raise exception 'FALLÓ: el orden debe empezar por las fotos'; end if;
end $$;


-- ===== Taller: órdenes de trabajo con mecánico, y costos por obra
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'mecanico-a@ejemplo.com'),
  ('00000000-0000-0000-0000-0000000000a5', 'operario3-a@ejemplo.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into public.miembros (empresa_id, user_id, nombre, rol)
  select v, '00000000-0000-0000-0000-0000000000a4', 'Mecánico A', 'mecanico' from ctx where k = 'A' returning id \gset mecA_
insert into public.miembros (empresa_id, user_id, nombre, rol)
  select v, '00000000-0000-0000-0000-0000000000a5', 'Operario A3', 'operario' from ctx where k = 'A' returning id \gset opA3_
insert into public.equipos (empresa_id, codigo, nombre, plantilla_clave, ultimo_medidor, tarifa_hora)
  select v, 'RE-OT', 'Retro taller', 'retroexcavadora', 500, 1000 from ctx where k = 'A' returning id \gset eqOT_
insert into public.obras (empresa_id, nombre) select v, 'Ruta 9' from ctx where k = 'A' returning id \gset obraA2_
reset role;

-- el operario encuentra dos fallas (una crítica) y el equipo queda bloqueado
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
select public.aceptar_privacidad((select v from ctx where k = 'A'), 'prueba');
select (select v from ctx where k = 'A')::text || '/00000000-0000-0000-0000-0000000000a5/' as prefo \gset
select (public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', :'eqOT_id', 'obra_id', :'obraA_id', 'inicio', '2026-11-10 07:00-03',
  'med_ini', 500, 'ubic_ref', 'Obrador', 'selfie_path', :'prefo' || 's.jpg', 'firma_path', :'prefo' || 'f.png', 'medidor_foto_path', :'prefo' || 'm.jpg', 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('retroexcavadora', jsonb_build_object('cabina.1', jsonb_build_object('v','falla','nota','cinturón cortado','foto', :'prefo' || 'c.jpg'),
                                                                    'fluidos.5', '{"v":"falla","nota":"gotea"}'::jsonb))))->>'jornada_id') as jot1 \gset
reset role;
do $$ begin
  if (select estado from public.equipos where codigo = 'RE-OT') <> 'bloqueado' then raise exception 'FALLÓ: RE-OT debería estar bloqueado'; end if;
end $$;

-- el mecánico no ve nada que no le asignaron y no puede crear órdenes
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
select pg_temp.esperar_error(format($$select public.crear_orden(jsonb_build_object('equipo_id', %L, 'titulo', 'Yo solo'))$$, :'eqOT_id'), 'No tenés permiso');
do $$ begin
  if exists (select 1 from public.fallas) then raise exception 'FALLÓ: el mecánico ve fallas sin orden'; end if;
end $$;
reset role;

-- la supervisión crea la orden con las fallas del equipo
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select string_agg(id::text, ',') as fallas_ot from public.fallas where equipo_id = :'eqOT_id' \gset
select public.crear_orden(jsonb_build_object('equipo_id', :'eqOT_id', 'falla_ids', string_to_array(:'fallas_ot', ','), 'titulo', 'Cinturón y pérdida',
  'prioridad', 'alta', 'asignado_a', :'mecA_id'))->>'orden_id' as ot1 \gset
select pg_temp.esperar_error(format($$select public.crear_orden(jsonb_build_object('equipo_id', %L, 'falla_ids', string_to_array(%L, ','), 'titulo', 'Otra'))$$, :'eqOT_id', :'fallas_ot'), 'otra orden abierta');
select pg_temp.esperar_error(format($$select public.crear_orden(jsonb_build_object('equipo_id', %L, 'falla_ids', string_to_array(%L, ','), 'titulo', 'Mezcla'))$$, (select v from ctx where k = 'eqA'), :'fallas_ot'), 'mismo equipo');
-- orden preventiva sin fallas, numerada 2
select (public.crear_orden(jsonb_build_object('equipo_id', :'eqOT_id', 'titulo', 'Engrase general', 'prioridad', 'baja'))->>'numero') as n2 \gset
\echo número de la segunda orden (esperado 2): :n2
reset role;

-- B no ve ni toca las órdenes de A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin if exists (select 1 from public.ordenes_trabajo) then raise exception 'FALLÓ: B ve órdenes de A'; end if; end $$;
select pg_temp.esperar_error(format($$select public.agregar_repuesto(%L, 'Intruso', 1, 1)$$, :'ot1'), 'No tenés permiso');
select pg_temp.esperar_error(format($$select public.terminar_orden(%L, '{"trabajo_realizado":"intruso total"}')$$, :'ot1'), 'No tenés permiso');
select pg_temp.esperar_error(format($$select public.costos_por_obra(%L, '2026-11-01', '2026-11-30')$$, (select v from ctx where k = 'A')), 'No tenés permiso');
reset role;

-- otro operario no puede trabajar la orden
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
select pg_temp.esperar_error(format($$select public.cambiar_estado_orden(%L, 'en_curso')$$, :'ot1'), 'No tenés permiso');
reset role;

-- el mecánico la trabaja
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
select (select v from ctx where k = 'A')::text || '/00000000-0000-0000-0000-0000000000a4/' as prefm \gset
do $$ begin
  if (select count(*) from public.ordenes_trabajo) <> 1 then raise exception 'FALLÓ: el mecánico debe ver solo su orden'; end if;
  if (select count(*) from public.fallas) <> 2 then raise exception 'FALLÓ: el mecánico debe ver las fallas de su orden'; end if;
  if not public.foto_de_mi_orden((select foto_path from public.fallas where critica)) then raise exception 'FALLÓ: el mecánico debe ver la foto de la falla'; end if;
  if public.foto_de_mi_orden((select selfie_path from public.jornadas limit 1)) then raise exception 'FALLÓ: el mecánico no debe ver selfies'; end if;
end $$;
select public.cambiar_estado_orden(:'ot1', 'en_curso');
select pg_temp.esperar_error(format($$select public.cambiar_estado_orden(%L, 'cancelada')$$, :'ot1'), 'Solo la supervisión');
select public.agregar_repuesto(:'ot1', 'Cinturón de seguridad', 1, 45000) as rep1 \gset
select public.agregar_repuesto(:'ot1', 'Junta del cárter', 2, 5000);
select public.agregar_repuesto(:'ot1', 'Repuesto equivocado', 1, 99999) as rep3 \gset
select public.quitar_repuesto(:'rep3');
select pg_temp.esperar_error(format($$select public.terminar_orden(%L, '{"trabajo_realizado":"ok"}')$$, :'ot1'), 'Contá qué trabajo');
select pg_temp.esperar_error(format($$select public.terminar_orden(%L, jsonb_build_object('trabajo_realizado', 'Cambio de cinturón', 'foto_path', %L))$$, :'ot1', :'prefo' || 'x.jpg'), 'Foto inválida');
select public.terminar_orden(:'ot1', jsonb_build_object('trabajo_realizado', 'Cambio de cinturón y junta del cárter', 'horas', 3, 'costo_mano_obra', 30000,
  'medidor', 508, 'foto_path', :'prefm' || 'ot.jpg'))->>'libero_equipo' as libero \gset
\echo la orden liberó el equipo (esperado true): :libero
select pg_temp.esperar_error(format($$select public.agregar_repuesto(%L, 'Tarde', 1, 1)$$, :'ot1'), 'ya está cerrada');
reset role;

do $$ declare o public.ordenes_trabajo; m public.mantenimientos; begin
  select * into o from public.ordenes_trabajo where numero = 1 and empresa_id = (select v from ctx where k = 'A');
  if o.estado <> 'terminada' or not o.libero_equipo or o.iniciada_en is null then raise exception 'FALLÓ: orden %', row_to_json(o); end if;
  if exists (select 1 from public.fallas where orden_id = o.id and estado = 'abierta') then raise exception 'FALLÓ: quedaron fallas abiertas'; end if;
  if (select reparacion from public.fallas where orden_id = o.id limit 1) not like 'OT 1:%' then raise exception 'FALLÓ: la reparación cita la OT'; end if;
  select * into m from public.mantenimientos where equipo_id = o.equipo_id;
  if m.tipo <> 'reparacion' or m.costo <> 85000 or m.responsable <> 'Mecánico A' then raise exception 'FALLÓ: historial %', row_to_json(m); end if;
  if (select estado from public.equipos where id = o.equipo_id) <> 'operativo' then raise exception 'FALLÓ: el equipo no se liberó'; end if;
  if not exists (select 1 from public.eventos_equipo where equipo_id = o.equipo_id and tipo = 'liberacion' and detalle like 'OT 1:%') then raise exception 'FALLÓ: falta el evento de liberación'; end if;
end $$;

-- cancelar libera las fallas para otra orden; el mecánico no ve las órdenes de otro
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select (select id from public.ordenes_trabajo where numero = 2 and empresa_id = (select v from ctx where k = 'A')) as ot2 \gset
select public.editar_orden(:'ot2', jsonb_build_object('prioridad', 'media', 'asignado_a', :'mecA_id'));
select public.cambiar_estado_orden(:'ot2', 'cancelada');
select pg_temp.esperar_error(format($$select public.cambiar_estado_orden(%L, 'en_curso')$$, :'ot2'), 'ya está cerrada');

-- costos: segunda jornada en otra obra, carga de combustible sin obra y tarifa por hora
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
select (public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', :'eqOT_id', 'obra_id', :'obraA2_id', 'inicio', '2026-11-11 07:00-03',
  'med_ini', 508, 'ubic_ref', 'Obrador', 'selfie_path', :'prefo' || 's.jpg', 'firma_path', :'prefo' || 'f.png', 'medidor_foto_path', :'prefo' || 'm.jpg', 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('retroexcavadora')))->>'jornada_id') as jot2 \gset
select public.cerrar_jornada(:'jot2', 532, null, null, false, true);
select (public.enviar_checklist(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', :'eqOT_id', 'obra_id', :'obraA_id', 'inicio', '2026-11-12 07:00-03',
  'med_ini', 532, 'ubic_ref', 'Obrador', 'selfie_path', :'prefo' || 's.jpg', 'firma_path', :'prefo' || 'f.png', 'medidor_foto_path', :'prefo' || 'm.jpg', 'declaracion', true, 'dur_checklist_s', 300,
  'respuestas', pg_temp.respuestas('retroexcavadora')))->>'jornada_id') as jot3 \gset
select public.cerrar_jornada(:'jot3', 540, null, null, false, true);
select public.registrar_carga(jsonb_build_object('client_id', gen_random_uuid(), 'equipo_id', :'eqOT_id', 'cargado_en', '2026-11-11 18:00-03',
  'litros', 320, 'medidor', 532, 'tanque_lleno', true, 'precio_litro', 1000));
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ declare c jsonb; r1 jsonb; r2 jsonb; begin
  c := public.costos_por_obra((select v from ctx where k = 'A'), '2026-11-01', '2026-11-30');
  select x into r1 from jsonb_array_elements(c->'filas') x where x->>'codigo' = 'RE-OT' and x->>'obra' = 'Ruta 5';
  select x into r2 from jsonb_array_elements(c->'filas') x where x->>'codigo' = 'RE-OT' and x->>'obra' = 'Ruta 9';
  -- Ruta 5: 8 h (la jornada no apta no cuenta), Ruta 9: 24 h. Combustible 320 l / $320.000 y reparación $85.000 se reparten 25 % / 75 %
  if (r1->>'uso')::numeric <> 8 or (r1->>'costo_equipo')::numeric <> 8000 or (r1->>'litros')::numeric <> 80
     or (r1->>'combustible')::numeric <> 80000 or (r1->>'reparaciones')::numeric <> 21250 or (r1->>'total')::numeric <> 109250 then
    raise exception 'FALLÓ: costos Ruta 5 %', r1; end if;
  if (r2->>'dias')::int <> 1 or (r2->>'costo_equipo')::numeric <> 24000 or (r2->>'total')::numeric <> 24000 + 240000 + 63750 then
    raise exception 'FALLÓ: costos Ruta 9 %', r2; end if;
  if c->'sin_tarifa' ? 'RE-OT' then raise exception 'FALLÓ: RE-OT tiene tarifa'; end if;
end $$;
reset role;

\echo TODAS LAS PRUEBAS PASARON
