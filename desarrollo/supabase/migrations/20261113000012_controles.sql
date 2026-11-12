-- Checklist v2: puntos con advertencia roja (no bloquean), fotos obligatorias, controles semanales,
-- texto de ayuda y foto obligatoria del horómetro / odómetro.
--
-- Campos opcionales de cada punto de una plantilla:
--   alerta: true                      → si falla, advertencia roja (no bloquea el equipo)
--   foto: "obligatoria"               → hay que sacar una foto, esté bien o mal
--   frecuencia: {tipo:"semanal", dia} → se controla una vez por semana (dia ISO: 1 lunes … 7 domingo)
--   ayuda: "texto"                    → explicación de qué revisar

-- ================================================================ validación de plantillas
create or replace function public.validar_plantilla() returns trigger language plpgsql set search_path = public as $$
declare s jsonb; i jsonb; ids text[] := '{}'; n int := 0;
begin
  if jsonb_typeof(new.secciones) <> 'array' or jsonb_array_length(new.secciones) = 0 then
    raise exception 'La plantilla necesita al menos una sección' using errcode = 'P0001';
  end if;
  for s in select * from jsonb_array_elements(new.secciones) loop
    if length(trim(coalesce(s->>'titulo', ''))) = 0 then raise exception 'Hay una sección sin título' using errcode = 'P0001'; end if;
    if jsonb_typeof(s->'items') <> 'array' or jsonb_array_length(s->'items') = 0 then
      raise exception 'La sección "%" no tiene puntos', s->>'titulo' using errcode = 'P0001';
    end if;
    for i in select * from jsonb_array_elements(s->'items') loop
      if coalesce(i->>'id', '') !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Punto con identificador inválido' using errcode = 'P0001'; end if;
      if length(trim(coalesce(i->>'texto', ''))) = 0 or length(i->>'texto') > 200 then
        raise exception 'Cada punto necesita un texto de hasta 200 caracteres' using errcode = 'P0001';
      end if;
      if jsonb_typeof(i->'critico') <> 'boolean' then raise exception 'Falta indicar si el punto es crítico' using errcode = 'P0001'; end if;
      if i ? 'alerta' and jsonb_typeof(i->'alerta') <> 'boolean' then raise exception 'Advertencia inválida en "%"', i->>'texto' using errcode = 'P0001'; end if;
      if coalesce((i->>'critico')::boolean, false) and coalesce((i->>'alerta')::boolean, false) then
        raise exception 'Un punto no puede ser crítico y advertencia a la vez: "%"', i->>'texto' using errcode = 'P0001';
      end if;
      if i ? 'foto' and i->>'foto' is distinct from 'obligatoria' then raise exception 'Foto inválida en "%"', i->>'texto' using errcode = 'P0001'; end if;
      if i ? 'frecuencia' and (i->'frecuencia'->>'tipo' is distinct from 'semanal'
          or coalesce(i->'frecuencia'->>'dia', '') !~ '^[1-7]$') then
        raise exception 'Frecuencia inválida en "%"', i->>'texto' using errcode = 'P0001';
      end if;
      if i ? 'ayuda' and (jsonb_typeof(i->'ayuda') <> 'string' or length(i->>'ayuda') > 400) then
        raise exception 'La ayuda de "%" tiene que ser un texto de hasta 400 caracteres', i->>'texto' using errcode = 'P0001';
      end if;
      if (i->>'id') = any(ids) then raise exception 'Hay puntos repetidos' using errcode = 'P0001'; end if;
      ids := ids || (i->>'id'); n := n + 1;
    end loop;
  end loop;
  if n > 200 then raise exception 'Máximo 200 puntos por plantilla' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and new.secciones is distinct from old.secciones
     and exists (select 1 from jornadas where plantilla_id = old.id) then
    raise exception 'Esta versión ya se usó en checklists: guardá una versión nueva' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ================================================================ columnas nuevas
alter table public.jornadas
  add column medidor_foto_path text,
  add column n_alertas integer not null default 0;
alter table public.fallas add column grave boolean not null default false;   -- advertencia roja

-- ================================================================ controles semanales pendientes
-- Día de la semana (ISO) en Argentina para una fecha y hora.
create function public.dia_iso(p timestamptz) returns int language sql immutable as $$
  select extract(isodow from (p at time zone 'America/Argentina/Buenos_Aires'))::int
$$;

-- Ids de los puntos semanales que el equipo tiene que controlar en p_fecha: los de ese día, y los
-- atrasados (su último día programado ya pasó y nadie los controló desde entonces).
create function public.periodicos_pendientes(p_equipo uuid, p_fecha date default ((now() at time zone 'America/Argentina/Buenos_Aires')::date))
returns text[] language plpgsql stable security definer set search_path = public as $$
declare v_eq equipos; v_pl plantillas; s jsonb; i jsonb; v_ult date; v_res text[] := '{}';
begin
  select * into v_eq from equipos where id = p_equipo;
  if not found or not es_miembro(v_eq.empresa_id) then return '{}'; end if;
  v_pl := plantilla_vigente(v_eq.empresa_id, v_eq.plantilla_clave);
  for s in select * from jsonb_array_elements(coalesce(v_pl.secciones, '[]')) loop
    for i in select * from jsonb_array_elements(s->'items') loop
      if i->'frecuencia'->>'tipo' = 'semanal' then
        v_ult := p_fecha - ((extract(isodow from p_fecha)::int - (i->'frecuencia'->>'dia')::int + 7) % 7);
        if not exists (select 1 from jornadas j where j.equipo_id = p_equipo
                         and (j.inicio at time zone 'America/Argentina/Buenos_Aires')::date between v_ult and p_fecha
                         and j.respuestas ? (i->>'id')) then
          v_res := v_res || (i->>'id');
        end if;
      end if;
    end loop;
  end loop;
  return v_res;
end $$;

-- ================================================================ envío del checklist (v2)
create or replace function public.enviar_checklist(p jsonb) returns jsonb
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
  v_alertas   int := 0;
  v_motivos   text[] := '{}';
  v_resultado resultado_checklist;
  v_jid       uuid;
  v_dur       int := coalesce((p->>'dur_checklist_s')::int, 0);
  v_med       numeric := (p->>'med_ini')::numeric;
  v_prefijo   text;
  v_inicio    timestamptz := least(coalesce((p->>'inicio')::timestamptz, now()), now());
  v_semanal   boolean;
  v_toca      boolean;
begin
  select * into v_eq from equipos where id = (p->>'equipo_id')::uuid and activo for update;
  if not found then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;

  v_miembro := mi_miembro_id(v_eq.empresa_id);
  if v_miembro is null then raise exception 'No pertenecés a esta empresa' using errcode = '42501'; end if;

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

  v_prefijo := v_eq.empresa_id::text || '/' || auth.uid()::text || '/';
  if left(coalesce(p->>'selfie_path', ''), length(v_prefijo)) <> v_prefijo
     or left(coalesce(p->>'firma_path', ''), length(v_prefijo)) <> v_prefijo then
    raise exception 'Foto o firma inválida' using errcode = 'P0001';
  end if;
  if left(coalesce(p->>'medidor_foto_path', ''), length(v_prefijo)) <> v_prefijo then
    raise exception 'Falta la foto del % ', case v_eq.medidor when 'km' then 'odómetro' else 'horómetro' end using errcode = 'P0001';
  end if;

  v_pl := plantilla_vigente(v_eq.empresa_id, v_eq.plantilla_clave);
  if v_pl.id is null then raise exception 'El equipo no tiene plantilla de checklist' using errcode = 'P0001'; end if;

  for v_sec in select * from jsonb_array_elements(v_pl.secciones) loop
    for v_item in select * from jsonb_array_elements(v_sec->'items') loop
      v_r := p->'respuestas'->(v_item->>'id');
      v_v := v_r->>'v';
      -- Un punto semanal es obligatorio el día que le toca; otro día se acepta si viene (control atrasado).
      v_semanal := v_item->'frecuencia'->>'tipo' = 'semanal';
      v_toca := not v_semanal or dia_iso(v_inicio) = (v_item->'frecuencia'->>'dia')::int;
      if v_v is null and not v_toca then continue; end if;
      v_total := v_total + 1;
      if v_v is null or v_v not in ('ok', 'falla', 'na') then
        raise exception 'Falta responder: %', v_item->>'texto' using errcode = 'P0001';
      end if;
      if v_v = 'na' and coalesce((v_item->>'critico')::boolean, false) then
        raise exception 'Un punto crítico no puede quedar como No aplica: %', v_item->>'texto' using errcode = 'P0001';
      end if;
      if (v_r->>'foto') is not null and left(v_r->>'foto', length(v_prefijo)) <> v_prefijo then
        raise exception 'Foto inválida en: %', v_item->>'texto' using errcode = 'P0001';
      end if;
      if v_item->>'foto' = 'obligatoria' and v_v <> 'na' and (v_r->>'foto') is null then
        raise exception 'Falta la foto: %', v_item->>'texto' using errcode = 'P0001';
      end if;
      if v_v = 'falla' then
        if length(trim(coalesce(v_r->>'nota', ''))) = 0 then
          raise exception 'Describí la falla: %', v_item->>'texto' using errcode = 'P0001';
        end if;
        v_fallas := v_fallas + 1;
        if coalesce((v_item->>'critico')::boolean, false) then
          v_crit := v_crit + 1;
          v_motivos := v_motivos || (v_item->>'texto');
        elsif coalesce((v_item->>'alerta')::boolean, false) then
          v_alertas := v_alertas + 1;
        end if;
      end if;
    end loop;
  end loop;

  v_resultado := case when v_crit > 0 then 'no_apto' when v_fallas > 0 then 'observaciones' else 'apto' end;

  insert into jornadas (empresa_id, client_id, equipo_id, operario_id, obra_id, plantilla_id, estado, resultado,
    inicio, med_ini, lat, lng, precision_m, ubic_ref, selfie_path, firma_path, medidor_foto_path, respuestas, total_items,
    n_fallas, n_criticas, n_alertas, dur_checklist_s, rapido, motivo_rapido)
  values (v_eq.empresa_id, (p->>'client_id')::uuid, v_eq.id, v_miembro, (p->>'obra_id')::uuid, v_pl.id,
    case when v_resultado = 'no_apto' then 'rechazada'::estado_jornada else 'abierta'::estado_jornada end, v_resultado,
    v_inicio, v_med,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'precision_m')::double precision,
    nullif(trim(coalesce(p->>'ubic_ref', '')), ''), p->>'selfie_path', p->>'firma_path', p->>'medidor_foto_path', p->'respuestas', v_total,
    v_fallas, v_crit, v_alertas, v_dur, v_dur < 120, nullif(trim(coalesce(p->>'motivo_rapido', '')), ''))
  returning id into v_jid;

  insert into fallas (empresa_id, jornada_id, equipo_id, origen, item_id, seccion, texto, critica, grave, nota, foto_path)
  select v_eq.empresa_id, v_jid, v_eq.id, 'checklist', it->>'id', s->>'titulo', it->>'texto',
         coalesce((it->>'critico')::boolean, false), coalesce((it->>'alerta')::boolean, false),
         trim(p->'respuestas'->(it->>'id')->>'nota'), p->'respuestas'->(it->>'id')->>'foto'
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

  return jsonb_build_object('jornada_id', v_jid, 'resultado', v_resultado, 'fallas', v_fallas, 'criticas', v_crit, 'alertas', v_alertas, 'repetido', false);
end $$;

revoke execute on function public.periodicos_pendientes(uuid, date) from public, anon;
grant execute on function public.periodicos_pendientes(uuid, date), public.dia_iso(timestamptz) to authenticated;
