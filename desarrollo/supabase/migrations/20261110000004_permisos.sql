-- Supabase otorga por defecto todos los permisos sobre tablas nuevas a anon y authenticated.
-- Las políticas RLS ya bloquean esos accesos; esto es una segunda barrera explícita.

-- Sin sesión no se accede a nada.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Con sesión: estas tablas solo se escriben a través de las funciones del servidor.
revoke insert, update, delete, truncate on public.jornadas, public.fallas, public.eventos_equipo,
  public.telemetria_conexiones, public.telemetria_lecturas from authenticated;
grant delete on public.jornadas to authenticated;              -- borrar registros: solo admins (por RLS)
revoke delete, truncate on public.empresas, public.miembros, public.equipos from authenticated;
revoke all on public.telemetria_tokens from authenticated;
