-- Tarjeta de combustible propia: vales, cupos por equipo y controles automáticos de cada carga.
-- Parecido a una tarjeta de flota, pero hecho en Operapto:
--   · Cupos de litros por equipo (día, semana, mes).
--   · Vales digitales con código y QR para mostrar en la estación o en el surtidor propio. El operario los pide;
--     dentro del cupo se aprueban solos, fuera del cupo los aprueba un supervisor. Vencen.
--   · Cada carga pasa por controles (sin vale, vale excedido, cupo, consumo alto para las horas trabajadas,
--     medidor sin avanzar, precio alto, cargas seguidas). Si alguno salta, la carga queda OBSERVADA hasta que
--     un supervisor la apruebe o la rechace (nunca quien cargó). Una carga nunca se rechaza por el vale:
--     el gasoil ya está en el equipo; se controla después.

alter table public.equipos
  add column cupo_dia_l    numeric(8,1) check (cupo_dia_l is null or cupo_dia_l > 0),
  add column cupo_semana_l numeric(8,1) check (cupo_semana_l is null or cupo_semana_l > 0),
  add column cupo_mes_l    numeric(9,1) check (cupo_mes_l is null or cupo_mes_l > 0);

create table public.ajustes_combustible (
  empresa_id      uuid primary key references public.empresas on delete cascade,
  exigir_vale     boolean not null default false,                                  -- sin vale, la carga queda observada
  vale_horas      integer not null default 24 check (vale_horas between 1 and 720),  -- cuánto dura un vale
  aprobar_solo    boolean not null default true,                                   -- pedidos dentro del cupo se aprueban solos
  tolerancia_precio integer not null default 15 check (tolerancia_precio between 0 and 100),   -- % sobre el precio de referencia
  actualizado_en  timestamptz not null default now()
);
alter table public.ajustes_combustible enable row level security;
create policy ac_ver on public.ajustes_combustible for select to authenticated using (public.es_miembro(empresa_id));
create policy ac_admin on public.ajustes_combustible for all to authenticated using (public.es_gestor(empresa_id)) with check (public.es_gestor(empresa_id));
revoke all on public.ajustes_combustible from anon;
grant select, insert, update on public.ajustes_combustible to authenticated;
create trigger auditoria after insert or update on public.ajustes_combustible for each row execute function public.auditoria_trigger();

create function public.ajustes_combustible_de(e uuid) returns public.ajustes_combustible
  language sql stable security definer set search_path = public as $$
  select a from ajustes_combustible a where a.empresa_id = e
  union all
  select row(e, false, 24, true, 15, now())::ajustes_combustible where not exists (select 1 from ajustes_combustible where empresa_id = e)
$$;

create table public.vales_combustible (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas on delete cascade,
  numero         integer not null,
  codigo         text not null check (codigo ~ '^[A-HJ-NP-Z2-9]{6}$'),
  equipo_id      uuid not null references public.equipos on delete cascade,
  obra_id        uuid references public.obras on delete set null,
  para_miembro   uuid references public.miembros on delete set null,      -- nulo: cualquier operario del equipo
  litros_max     numeric(8,1) not null check (litros_max > 0 and litros_max <= 5000),
  origen         text check (origen in ('surtidor_propio', 'estacion', 'cisterna', 'otro')),   -- nulo: cualquiera
  proveedor      text,
  estado         text not null default 'emitido' check (estado in ('pedido', 'emitido', 'usado', 'anulado')),
  motivo         text,                       -- por qué lo pidió
  aprobado_solo  boolean not null default false,
  vence_en       timestamptz,
  pedido_por     uuid references public.miembros on delete set null,
  emitido_por    uuid references public.miembros on delete set null,
  emitido_en     timestamptz,
  usado_en       timestamptz,
  carga_id       uuid unique references public.cargas_combustible on delete set null,
  anulado_motivo text,
  creado_en      timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, codigo)
);
create index on public.vales_combustible (empresa_id, estado);
create index on public.vales_combustible (equipo_id, estado);
alter table public.vales_combustible enable row level security;
-- La supervisión ve todos; el resto, los suyos y los del equipo que no son para nadie en particular.
create policy vc_ver on public.vales_combustible for select to authenticated
  using (public.es_gestor(empresa_id) or (public.mi_rol(empresa_id) is not null and (para_miembro = public.mi_miembro_id(empresa_id)
         or pedido_por = public.mi_miembro_id(empresa_id) or para_miembro is null)));
revoke all on public.vales_combustible from anon, authenticated;
grant select on public.vales_combustible to authenticated;    -- se escriben solo por las funciones de abajo

alter table public.cargas_combustible
  add column vale_id     uuid references public.vales_combustible on delete set null,
  add column control     text not null default 'ok' check (control in ('ok', 'observada', 'aprobada', 'rechazada')),
  add column alertas     jsonb not null default '[]',
  add column control_por uuid references public.miembros on delete set null,
  add column control_en  timestamptz,
  add column control_nota text;
create index on public.cargas_combustible (empresa_id) where control = 'observada';

-- Litros cargados por un equipo desde una fecha (para los cupos).
create function public.litros_equipo(p_equipo uuid, p_desde timestamptz, p_excluir uuid default null) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(litros), 0) from cargas_combustible where equipo_id = p_equipo and cargado_en >= p_desde and id is distinct from p_excluir
$$;
-- Inicio del día, la semana (lunes) y el mes en la hora de Argentina.
create function public.inicio_periodo(p text, p_en timestamptz default now()) returns timestamptz
  language sql stable as $$
  select (date_trunc(p, p_en at time zone 'America/Argentina/Buenos_Aires')) at time zone 'America/Argentina/Buenos_Aires'
$$;
-- Cuánto le queda de cupo a un equipo: el mínimo entre día, semana y mes (nulo: sin cupo).
create function public.cupo_disponible(p_equipo uuid) returns numeric
  language sql stable security definer set search_path = public as $$
  select nullif(least(coalesce(e.cupo_dia_l - litros_equipo(e.id, inicio_periodo('day')), 1e9),
                      coalesce(e.cupo_semana_l - litros_equipo(e.id, inicio_periodo('week')), 1e9),
                      coalesce(e.cupo_mes_l - litros_equipo(e.id, inicio_periodo('month')), 1e9)), 1e9)
    from equipos e where e.id = p_equipo
$$;

-- Número con coma decimal y sin ceros de más (para los textos de las alertas).
create function public.fnum(x numeric) returns text language sql immutable as $$ select replace(trim_scale(round(x, 1))::text, '.', ',') $$;

create function public.codigo_vale() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6)
$$;

-- Pedido del operario (o emisión directa del supervisor).
-- p: { equipo_id, litros, origen?, proveedor?, obra_id?, motivo?, para_miembro? (solo supervisión) }
create function public.pedir_vale(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_m uuid; v_gestor boolean; a ajustes_combustible; v_l numeric := (p->>'litros')::numeric; v_disp numeric;
        v_v vales_combustible; v_estado text; v_solo boolean := false; v_cod text; i int := 0;
begin
  select * into v_eq from equipos where id = (p->>'equipo_id')::uuid and activo;
  if v_eq.id is null then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;
  v_m := mi_miembro_id(v_eq.empresa_id);
  if v_m is null or mi_rol(v_eq.empresa_id) is null or mi_rol(v_eq.empresa_id)::text = 'reloj' then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  v_gestor := es_gestor(v_eq.empresa_id); a := ajustes_combustible_de(v_eq.empresa_id);
  if v_l is null or v_l <= 0 then raise exception 'Indicá los litros' using errcode = '22023'; end if;
  if v_eq.capacidad_tanque is not null and v_l > v_eq.capacidad_tanque * 1.05 then
    raise exception 'El tanque de % es de % L', v_eq.codigo, v_eq.capacidad_tanque using errcode = '22023';
  end if;
  if not v_gestor and v_eq.estado in ('bloqueado', 'fuera_servicio') then
    raise exception '% está %: no se puede pedir combustible', v_eq.codigo, case v_eq.estado when 'bloqueado' then 'bloqueado' else 'fuera de servicio' end using errcode = '22023';
  end if;
  if (p->>'obra_id') is not null and not exists (select 1 from obras where id = (p->>'obra_id')::uuid and empresa_id = v_eq.empresa_id) then
    raise exception 'Obra no válida' using errcode = '22023';
  end if;
  v_disp := cupo_disponible(v_eq.id);
  if v_gestor then v_estado := 'emitido';
  elsif a.aprobar_solo and (v_disp is null or v_l <= v_disp)
        and not exists (select 1 from vales_combustible where equipo_id = v_eq.id and estado = 'emitido' and (vence_en is null or vence_en > now())) then
    v_estado := 'emitido'; v_solo := true;          -- dentro del cupo y sin otro vale abierto: se aprueba solo
  else v_estado := 'pedido'; end if;
  loop
    v_cod := codigo_vale(); i := i + 1;
    exit when not exists (select 1 from vales_combustible where empresa_id = v_eq.empresa_id and codigo = v_cod) or i > 20;
  end loop;
  perform pg_advisory_xact_lock(hashtext('vales' || v_eq.empresa_id::text));
  insert into vales_combustible (empresa_id, numero, codigo, equipo_id, obra_id, para_miembro, litros_max, origen, proveedor, estado, motivo, aprobado_solo,
                                 vence_en, pedido_por, emitido_por, emitido_en)
  values (v_eq.empresa_id, coalesce((select max(numero) from vales_combustible where empresa_id = v_eq.empresa_id), 0) + 1, v_cod, v_eq.id,
          (p->>'obra_id')::uuid, case when v_gestor then (p->>'para_miembro')::uuid else v_m end, v_l, nullif(p->>'origen', ''),
          nullif(trim(coalesce(p->>'proveedor', '')), ''), v_estado, left(nullif(trim(coalesce(p->>'motivo', '')), ''), 300), v_solo,
          case when v_estado = 'emitido' then now() + make_interval(hours => a.vale_horas) end,
          v_m, case when v_estado = 'emitido' then v_m end, case when v_estado = 'emitido' then now() end)
  returning * into v_v;
  return jsonb_build_object('id', v_v.id, 'numero', v_v.numero, 'codigo', v_v.codigo, 'estado', v_v.estado, 'aprobado_solo', v_v.aprobado_solo,
                            'vence_en', v_v.vence_en, 'cupo_disponible', v_disp);
end $$;

-- Aprobar un pedido (supervisión; nunca el propio). Puede ajustar los litros.
create function public.aprobar_vale(p_id uuid, p_litros numeric default null) returns void
  language plpgsql security definer set search_path = public as $$
declare v vales_combustible; a ajustes_combustible; v_yo uuid;
begin
  select * into v from vales_combustible where id = p_id;
  if v.id is null or not es_gestor(v.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  v_yo := mi_miembro_id(v.empresa_id);
  if v.pedido_por = v_yo then raise exception 'No podés aprobar tu propio pedido' using errcode = '42501'; end if;
  if v.estado <> 'pedido' then raise exception 'Ese vale ya no está pendiente' using errcode = '22023'; end if;
  if p_litros is not null and (p_litros <= 0 or p_litros > 5000) then raise exception 'Litros inválidos' using errcode = '22023'; end if;
  a := ajustes_combustible_de(v.empresa_id);
  update vales_combustible set estado = 'emitido', litros_max = coalesce(p_litros, litros_max), emitido_por = v_yo, emitido_en = now(),
         vence_en = now() + make_interval(hours => a.vale_horas) where id = p_id;
  perform auditar(v.empresa_id, 'aprobar_vale', 'vales_combustible', p_id::text, 'Vale ' || v.numero || ' · ' || (select codigo from equipos where id = v.equipo_id),
                  null, jsonb_build_object('litros', coalesce(p_litros, v.litros_max)));
end $$;

-- Anular un vale o rechazar un pedido (supervisión; o quien lo pidió, mientras no se usó).
create function public.anular_vale(p_id uuid, p_motivo text) returns void
  language plpgsql security definer set search_path = public as $$
declare v vales_combustible;
begin
  select * into v from vales_combustible where id = p_id;
  if v.id is null or not (es_gestor(v.empresa_id) or v.pedido_por = mi_miembro_id(v.empresa_id)) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  if v.estado not in ('pedido', 'emitido') then raise exception 'Ese vale ya se usó o está anulado' using errcode = '22023'; end if;
  if es_gestor(v.empresa_id) and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo' using errcode = '22023'; end if;
  update vales_combustible set estado = 'anulado', anulado_motivo = coalesce(nullif(trim(p_motivo), ''), 'Lo canceló quien lo pidió') where id = p_id;
  perform auditar(v.empresa_id, case when v.estado = 'pedido' then 'rechazar_vale' else 'anular_vale' end, 'vales_combustible', p_id::text,
                  'Vale ' || v.numero || ' · ' || (select codigo from equipos where id = v.equipo_id), null, jsonb_build_object('motivo', trim(p_motivo)));
end $$;

-- ================================================================ registrar carga: con vale y controles
-- p: lo de antes + vale_id? | vale_codigo?
create or replace function public.registrar_carga(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_m uuid; v_ex cargas_combustible; v_id uuid; v_l numeric := (p->>'litros')::numeric; v_med numeric := (p->>'medidor')::numeric;
        v_pref text; v_ult numeric; v_tq uuid := (p->>'tanque_id')::uuid; v_origen text := coalesce(p->>'origen', 'surtidor_propio');
        v_cuando timestamptz; a ajustes_combustible; v_vale vales_combustible; v_al jsonb := '[]'; v_ant cargas_combustible; v_esp numeric; v_ref numeric; v_precio numeric;
        v_tot numeric;
begin
  select * into v_eq from equipos where id = (p->>'equipo_id')::uuid and activo;
  if not found then raise exception 'Equipo no encontrado' using errcode = 'P0002'; end if;
  v_m := mi_miembro_id(v_eq.empresa_id);
  if v_m is null then raise exception 'No pertenecés a esta empresa' using errcode = '42501'; end if;
  select * into v_ex from cargas_combustible where empresa_id = v_eq.empresa_id and client_id = (p->>'client_id')::uuid;
  if found then return jsonb_build_object('carga_id', v_ex.id, 'repetido', true, 'control', v_ex.control, 'alertas', v_ex.alertas); end if;
  if v_l is null or v_l <= 0 then raise exception 'Indicá los litros cargados' using errcode = 'P0001'; end if;
  if v_eq.capacidad_tanque is not null and v_l > v_eq.capacidad_tanque * 1.05 then
    raise exception 'Se cargaron % L y el tanque de % es de % L. Revisá el número.', v_l, v_eq.codigo, v_eq.capacidad_tanque using errcode = 'P0001';
  end if;
  v_cuando := least(coalesce((p->>'cargado_en')::timestamptz, now()), now());
  if v_med is not null then
    select max(medidor) into v_ult from cargas_combustible where equipo_id = v_eq.id and cargado_en < v_cuando;
    if v_ult is not null and v_med < v_ult then
      raise exception 'El % (%) es menor al de la carga anterior (%)', case v_eq.medidor when 'km' then 'odómetro' else 'horómetro' end, v_med, v_ult using errcode = 'P0001';
    end if;
  end if;
  if (p->>'obra_id') is not null and not exists (select 1 from obras where id = (p->>'obra_id')::uuid and empresa_id = v_eq.empresa_id) then
    raise exception 'Obra no válida' using errcode = 'P0001';
  end if;
  if v_tq is not null and not exists (select 1 from tanques where id = v_tq and empresa_id = v_eq.empresa_id and activo) then
    raise exception 'Tanque no válido' using errcode = 'P0001';
  end if;
  if v_tq is null and v_origen in ('surtidor_propio', 'cisterna') and (select count(*) from tanques where empresa_id = v_eq.empresa_id and activo) = 1 then
    select id into v_tq from tanques where empresa_id = v_eq.empresa_id and activo;
  end if;
  if v_tq is not null and v_origen not in ('surtidor_propio', 'cisterna') then v_tq := null; end if;
  v_pref := v_eq.empresa_id::text || '/' || auth.uid()::text || '/';
  if (p->>'foto_path') is not null and left(p->>'foto_path', length(v_pref)) <> v_pref then raise exception 'Foto inválida' using errcode = 'P0001'; end if;
  a := ajustes_combustible_de(v_eq.empresa_id);

  -- ---------- vale (nunca rechaza la carga: el combustible ya está en el equipo; lo que no cierra queda observado)
  if (p->>'vale_id') is not null then select * into v_vale from vales_combustible where id = (p->>'vale_id')::uuid and empresa_id = v_eq.empresa_id;
  elsif nullif(p->>'vale_codigo', '') is not null then select * into v_vale from vales_combustible where empresa_id = v_eq.empresa_id and codigo = upper(trim(p->>'vale_codigo'));
  end if;
  if (p->>'vale_id') is not null or nullif(p->>'vale_codigo', '') is not null then
    if v_vale.id is null then v_al := v_al || jsonb_build_object('k', 'vale_invalido', 't', 'El vale no existe');
    elsif v_vale.estado = 'usado' then v_al := v_al || jsonb_build_object('k', 'vale_usado', 't', format('El vale %s ya se había usado', v_vale.numero)); v_vale.id := null;
    elsif v_vale.estado = 'anulado' then v_al := v_al || jsonb_build_object('k', 'vale_anulado', 't', format('El vale %s estaba anulado', v_vale.numero)); v_vale.id := null;
    elsif v_vale.estado = 'pedido' then v_al := v_al || jsonb_build_object('k', 'vale_sin_aprobar', 't', format('El vale %s todavía no estaba aprobado', v_vale.numero));
    elsif v_vale.vence_en is not null and v_vale.vence_en < v_cuando then v_al := v_al || jsonb_build_object('k', 'vale_vencido', 't', format('El vale %s estaba vencido', v_vale.numero));
    end if;
    if v_vale.id is not null then
      if v_vale.equipo_id <> v_eq.id then v_al := v_al || jsonb_build_object('k', 'vale_otro_equipo', 't', format('El vale %s era para %s', v_vale.numero, (select codigo from equipos where id = v_vale.equipo_id))); end if;
      if v_l > v_vale.litros_max * 1.02 then v_al := v_al || jsonb_build_object('k', 'vale_excedido', 't', format('Cargó %s L con un vale de %s L', fnum(v_l), fnum(v_vale.litros_max))); end if;
      if v_vale.origen is not null and v_vale.origen <> v_origen then v_al := v_al || jsonb_build_object('k', 'vale_origen', 't', 'Cargó en otro lugar que el indicado en el vale'); end if;
    end if;
  elsif a.exigir_vale then
    v_al := v_al || jsonb_build_object('k', 'sin_vale', 't', 'Carga sin vale');
  end if;

  -- ---------- cupos del equipo (con esta carga)
  if v_eq.cupo_dia_l is not null then v_tot := litros_equipo(v_eq.id, inicio_periodo('day', v_cuando)) + v_l;
    if v_tot > v_eq.cupo_dia_l then v_al := v_al || jsonb_build_object('k', 'cupo_dia', 't', format('Pasó el cupo diario: %s L de %s L', fnum(v_tot), fnum(v_eq.cupo_dia_l))); end if; end if;
  if v_eq.cupo_semana_l is not null then v_tot := litros_equipo(v_eq.id, inicio_periodo('week', v_cuando)) + v_l;
    if v_tot > v_eq.cupo_semana_l then v_al := v_al || jsonb_build_object('k', 'cupo_semana', 't', format('Pasó el cupo semanal: %s L de %s L', fnum(v_tot), fnum(v_eq.cupo_semana_l))); end if; end if;
  if v_eq.cupo_mes_l is not null then v_tot := litros_equipo(v_eq.id, inicio_periodo('month', v_cuando)) + v_l;
    if v_tot > v_eq.cupo_mes_l then v_al := v_al || jsonb_build_object('k', 'cupo_mes', 't', format('Pasó el cupo mensual: %s L de %s L', fnum(v_tot), fnum(v_eq.cupo_mes_l))); end if; end if;

  -- ---------- consumo: litros contra lo que avanzó el medidor desde la carga anterior
  select * into v_ant from cargas_combustible where equipo_id = v_eq.id and cargado_en < v_cuando order by cargado_en desc limit 1;
  if v_ant.id is not null and v_cuando - v_ant.cargado_en < interval '2 hours' then
    v_al := v_al || jsonb_build_object('k', 'seguida', 't', format('Otra carga de %s L hace %s min', fnum(v_ant.litros), round(extract(epoch from v_cuando - v_ant.cargado_en) / 60)));
  end if;
  if v_med is not null and v_ant.medidor is not null then
    if v_med <= v_ant.medidor and v_l > greatest(20, coalesce(v_eq.capacidad_tanque, 200) * 0.1) then
      v_al := v_al || jsonb_build_object('k', 'sin_avance', 't', format('El %s no avanzó desde la carga anterior', case v_eq.medidor when 'km' then 'odómetro' else 'horómetro' end));
    elsif v_eq.consumo_referencia is not null and v_med > v_ant.medidor then
      v_esp := (v_med - v_ant.medidor) * v_eq.consumo_referencia / case v_eq.medidor when 'km' then 100 else 1 end;
      if v_l > v_esp * 1.5 + coalesce(v_eq.capacidad_tanque, 200) * 0.1 then
        v_al := v_al || jsonb_build_object('k', 'consumo_alto', 't', format('Cargó %s L y, por lo que trabajó (%s %s), se esperaban unos %s L',
                  fnum(v_l), fnum(v_med - v_ant.medidor), case v_eq.medidor when 'km' then 'km' else 'h' end, round(v_esp)));
      end if;
    end if;
  end if;

  -- ---------- precio
  v_precio := (p->>'precio_litro')::numeric;
  if v_precio is not null then
    v_ref := coalesce(precio_tanque(v_tq, v_cuando), (select precio_gasoil from empresas where id = v_eq.empresa_id));
    if v_ref is not null and v_precio > v_ref * (1 + a.tolerancia_precio / 100.0) then
      v_al := v_al || jsonb_build_object('k', 'precio_alto', 't', format('Precio $ %s por litro: %s %% más que el de referencia ($ %s)', fnum(v_precio), round(100 * (v_precio / v_ref - 1)), fnum(v_ref)));
    end if;
  end if;

  insert into cargas_combustible (empresa_id, client_id, equipo_id, miembro_id, obra_id, cargado_en, litros, medidor, tanque_lleno, origen, proveedor, precio_litro,
                                  foto_path, notas, tanque_id, vale_id, control, alertas)
  values (v_eq.empresa_id, (p->>'client_id')::uuid, v_eq.id, v_m, coalesce((p->>'obra_id')::uuid, v_vale.obra_id), v_cuando, v_l, v_med,
          coalesce((p->>'tanque_lleno')::boolean, true), v_origen, coalesce(nullif(trim(coalesce(p->>'proveedor', '')), ''), v_vale.proveedor),
          v_precio, p->>'foto_path', nullif(trim(coalesce(p->>'notas', '')), ''), v_tq, v_vale.id,
          case when jsonb_array_length(v_al) > 0 then 'observada' else 'ok' end, v_al)
  returning id into v_id;
  if v_vale.id is not null and v_vale.estado in ('emitido', 'pedido') then
    update vales_combustible set estado = 'usado', usado_en = v_cuando, carga_id = v_id where id = v_vale.id;
  end if;

  if v_med is not null then
    perform set_config('checkobra.rpc', 'on', true);
    update equipos set ultimo_medidor = greatest(coalesce(ultimo_medidor, 0), v_med) where id = v_eq.id;
    perform set_config('checkobra.rpc', 'off', true);
  end if;
  return jsonb_build_object('carga_id', v_id, 'repetido', false, 'tanque_id', v_tq, 'control', case when jsonb_array_length(v_al) > 0 then 'observada' else 'ok' end, 'alertas', v_al);
end $$;

-- Aprobar o rechazar una carga observada (supervisión; nunca la propia). Rechazada = irregular: queda para investigar.
create function public.controlar_carga(p_id uuid, p_aprobar boolean, p_nota text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare c cargas_combustible; v_yo uuid;
begin
  select * into c from cargas_combustible where id = p_id;
  if c.id is null or not es_gestor(c.empresa_id) then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  v_yo := mi_miembro_id(c.empresa_id);
  if c.miembro_id = v_yo then raise exception 'No podés controlar tu propia carga: pedíselo a otro supervisor o al dueño' using errcode = '42501'; end if;
  if c.control <> 'observada' then raise exception 'Esa carga no está observada' using errcode = '22023'; end if;
  if not p_aprobar and length(trim(coalesce(p_nota, ''))) < 3 then raise exception 'Escribí el motivo del rechazo' using errcode = '22023'; end if;
  update cargas_combustible set control = case when p_aprobar then 'aprobada' else 'rechazada' end, control_por = v_yo, control_en = now(),
         control_nota = nullif(trim(coalesce(p_nota, '')), '') where id = p_id;
  perform auditar(c.empresa_id, case when p_aprobar then 'aprobar_carga' else 'rechazar_carga' end, 'cargas_combustible', p_id::text,
                  (select codigo from equipos where id = c.equipo_id) || ' · ' || c.litros || ' L · ' || to_char(c.cargado_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                  null, jsonb_build_object('alertas', c.alertas, 'nota', nullif(trim(coalesce(p_nota, '')), '')));
end $$;

-- ================================================================ permisos
revoke execute on function public.pedir_vale(jsonb), public.aprobar_vale(uuid, numeric), public.anular_vale(uuid, text), public.controlar_carga(uuid, boolean, text),
  public.cupo_disponible(uuid), public.litros_equipo(uuid, timestamptz, uuid), public.ajustes_combustible_de(uuid), public.codigo_vale(), public.fnum(numeric) from public, anon;
grant execute on function public.pedir_vale(jsonb), public.aprobar_vale(uuid, numeric), public.anular_vale(uuid, text), public.controlar_carga(uuid, boolean, text),
  public.cupo_disponible(uuid) to authenticated;
revoke execute on function public.litros_equipo(uuid, timestamptz, uuid), public.ajustes_combustible_de(uuid), public.codigo_vale() from authenticated;
