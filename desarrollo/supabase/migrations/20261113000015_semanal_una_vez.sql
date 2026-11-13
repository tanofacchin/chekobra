-- Corrección: un punto semanal es obligatorio el día que le toca solo si no se controló ya esa semana.
-- Antes, un segundo checklist del mismo equipo ese día (otro turno) se rechazaba pidiendo de nuevo el control,
-- mientras que el celular (que usa periodicos_pendientes) ya no lo mostraba.

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
  v_pend      text[];
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

  -- Semanales que todavía no se controlaron esta semana (un segundo checklist del mismo día no los repite).
  v_pend := periodicos_pendientes(v_eq.id, (v_inicio at time zone 'America/Argentina/Buenos_Aires')::date);
  for v_sec in select * from jsonb_array_elements(v_pl.secciones) loop
    for v_item in select * from jsonb_array_elements(v_sec->'items') loop
      v_r := p->'respuestas'->(v_item->>'id');
      v_v := v_r->>'v';
      -- Un punto semanal es obligatorio el día que le toca; otro día se acepta si viene (control atrasado).
      v_semanal := v_item->'frecuencia'->>'tipo' = 'semanal';
      v_toca := not v_semanal or (dia_iso(v_inicio) = (v_item->'frecuencia'->>'dia')::int and (v_item->>'id') = any(v_pend));
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
