-- Lectura automática de la foto del horómetro u odómetro: la función 'leer-medidor' lee el número de la foto
-- y lo compara con el que cargó el operario. Si no coinciden, la supervisión lo ve en el resumen.
alter table public.jornadas
  add column lectura_foto      numeric(12,1),
  add column lectura_estado    text check (lectura_estado in ('ok', 'diferente', 'ilegible', 'error', 'omitida')),
  add column lectura_confianza text check (lectura_confianza in ('alta', 'media', 'baja')),
  add column lectura_nota      text,
  add column lectura_en        timestamptz;
create index jornadas_lectura_pendiente on public.jornadas (recibido_en) where lectura_estado is null and medidor_foto_path is not null;

-- Para el resumen: checklists de los últimos días donde la foto dice otra cosa.
create function public.lecturas_diferentes(p_empresa uuid, p_dias integer default 7)
returns table (jornada_id uuid, equipo_id uuid, codigo text, operario text, inicio timestamptz, cargado numeric, foto numeric, confianza text, medidor public.tipo_medidor)
language sql stable security definer set search_path = public as $$
  select j.id, j.equipo_id, e.codigo, m.nombre, j.inicio, j.med_ini, j.lectura_foto, j.lectura_confianza, e.medidor
    from jornadas j join equipos e on e.id = j.equipo_id join miembros m on m.id = j.operario_id
   where j.empresa_id = p_empresa and es_gestor(p_empresa) and j.lectura_estado = 'diferente' and j.inicio > now() - make_interval(days => p_dias)
   order by j.inicio desc
$$;
revoke execute on function public.lecturas_diferentes(uuid, integer) from public, anon;
grant execute on function public.lecturas_diferentes(uuid, integer) to authenticated;
