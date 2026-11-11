// Conexión con Supabase, sesión y carga de datos (con copia local para trabajar sin señal).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { ls } from './util.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'checkobra-sesion' },
});

// Debe coincidir con public.correo_operario() y supabase/functions/operarios.
export const correoOperario = (slug, legajo) => `${legajo.trim().toLowerCase()}@${slug.trim().toLowerCase()}.operarios.invalid`;

// Los operarios entran por la función 'ingresar', que cuenta intentos y bloquea al quinto error.
export async function ingresarOperario(slug, legajo, pin) {
  const { data, error } = await sb.functions.invoke('ingresar', { body: { slug, legajo, pin } });
  if (error) {
    let msg = error.message;
    try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch { /* sin cuerpo */ }
    const e = new Error(msg); e.bloqueado = error.context && error.context.status === 423; throw e;
  }
  const { error: es } = await sb.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  if (es) throw es;
}
export async function privacidadPendiente(empresa, miembroId) {
  const k = 'co_priv_' + miembroId;
  const { data, error } = await sb.rpc('privacidad_pendiente', { p_empresa: empresa });
  if (error) return ls.get(k, true);     // sin señal: usar lo último conocido (por defecto, pedirla)
  ls.set(k, data); return data;
}
export async function aceptarPrivacidad(empresa, miembroId) {
  const { error } = await sb.rpc('aceptar_privacidad', { p_empresa: empresa, p_agente: navigator.userAgent });
  if (error) throw error;
  ls.set('co_priv_' + miembroId, false);
}
export async function ingresarConCorreo(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}
export async function registrarse(email, password) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  return { confirmar: !data.session };
}
export const salir = () => sb.auth.signOut();

// Empresas a las que pertenece el usuario.
export async function misMembresias(uid) {
  const k = 'co_membresias_' + uid;
  const { data, error } = await sb.from('miembros')
    .select('id, empresa_id, rol, nombre, legajo, empresa:empresas(id, nombre, slug, rubro)')
    .eq('user_id', uid).eq('activo', true);
  if (error) { const c = ls.get(k, null); if (c) return c; throw error; }
  ls.set(k, data);
  return data;
}

// Datos que el operario necesita para trabajar. Se guardan en el teléfono para usarlos sin señal.
export async function cargarOperario(empresa, miembroId) {
  const k = 'co_op_' + empresa;
  try {
    const [eq, ob, pl, uso, js] = await Promise.all([
      sb.from('equipos').select('*').eq('empresa_id', empresa).eq('activo', true).order('codigo'),
      sb.from('obras').select('id, nombre').eq('empresa_id', empresa).eq('activa', true).order('nombre'),
      sb.from('plantillas').select('id, empresa_id, clave, nombre, medidor, version, secciones').eq('activa', true),
      sb.rpc('equipos_en_uso', { p_empresa: empresa }),
      sb.from('jornadas').select('id, client_id, estado, resultado, inicio, fin, med_ini, med_fin, uso, n_fallas, n_criticas, equipo_id, obra_id, dur_checklist_s')
        .eq('operario_id', miembroId).order('inicio', { ascending: false }).limit(15),
    ]);
    for (const r of [eq, ob, pl, uso, js]) if (r.error) throw r.error;
    const d = { equipos: eq.data, obras: ob.data, plantillas: vigentes(pl.data, empresa), enUso: uso.data, jornadas: js.data, actualizado: Date.now() };
    ls.set(k, d);
    return { ...d, offline: false };
  } catch (e) {
    const c = ls.get(k, null);
    if (c) return { ...c, offline: true };
    throw e;
  }
}

// Para cada clave, la versión propia de la empresa si existe; si no, la base; siempre la última versión.
export function vigentes(lista, empresa) {
  const m = {};
  for (const p of lista) {
    const prio = (p.empresa_id === empresa ? 1e6 : 0) + p.version;
    if (!m[p.clave] || prio > m[p.clave]._prio) m[p.clave] = { ...p, _prio: prio };
  }
  return m;
}

export const itemsDe = pl => pl.secciones.flatMap(s => s.items.map(i => ({ ...i, sec: s.titulo })));
