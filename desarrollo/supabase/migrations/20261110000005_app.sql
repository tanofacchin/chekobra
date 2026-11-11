-- Ayudas para la app.

-- Equipos con jornada abierta (el operario no ve las jornadas de otros, pero necesita saber
-- qué equipos están en uso para no elegirlos).
create function public.equipos_en_uso(p_empresa uuid)
returns table (equipo_id uuid, operario text, desde timestamptz)
language sql stable security definer set search_path = public as $$
  select j.equipo_id, m.nombre, j.inicio
    from jornadas j join miembros m on m.id = j.operario_id
   where j.empresa_id = p_empresa and j.estado = 'abierta' and es_miembro(p_empresa)
$$;
grant execute on function public.equipos_en_uso(uuid) to authenticated;

-- Correo interno de un operario (los operarios entran con empresa + legajo + PIN, sin mail propio).
-- Debe coincidir con supabase/functions/operarios y app/js/auth.js.
create function public.correo_operario(p_slug text, p_legajo text) returns text
language sql immutable as $$
  select lower(trim(p_legajo)) || '@' || lower(trim(p_slug)) || '.operarios.invalid'
$$;
grant execute on function public.correo_operario(text, text) to authenticated, anon;

-- El legajo solo admite letras, números, punto, guion y guion bajo.
alter table public.miembros add constraint miembros_legajo_formato
  check (legajo is null or legajo ~ '^[A-Za-z0-9._-]{1,30}$');
