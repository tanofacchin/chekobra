// Segundo factor (código de 6 números de una app autenticadora) para quienes entran con correo.
// Dueño y administración lo tienen obligatorio: el servidor no les da permisos sin él (ver mi_rol en la base).
import { esc, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const M = () => S.mfa;

// Qué le falta a esta sesión: 'nada' | 'activar' | 'verificar'. Sin señal no se bloquea (los datos del servidor igual se protegen).
export async function pendiente() {
  const { data, error } = await sb.rpc('segundo_factor_pendiente');
  return error ? 'nada' : data;
}

async function factores() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return data.all.filter(f => f.factor_type === 'totp');
}

// Arranca la pantalla de activación: borra intentos sin terminar y crea un factor nuevo con su QR.
export async function iniciarActivacion(volver) {
  S.mfa = { modo: 'activar', volver, codigo: '', err: '', ocupado: true }; S.vista = 'mfa'; render();
  try {
    for (const f of (await factores()).filter(f => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
    const n = (await factores()).length;
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: n ? `Celular ${n + 1} · ${new Date().toLocaleDateString('es-AR')}` : 'Celular principal', issuer: 'Operapto' });
    if (error) throw error;
    // Según la versión, el QR viene como SVG suelto o ya como data URL.
    const qr = data.totp.qr_code, svg = qr.startsWith('data:') && !qr.includes(';base64,') ? qr.slice(qr.indexOf(',') + 1) : qr;
    const src = svg.startsWith('data:') ? svg : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    Object.assign(M(), { factorId: data.id, qr: src, secreto: data.totp.secret, ocupado: false });
  } catch (e) { Object.assign(M(), { err: msgError(e), ocupado: false }); }
  render();
}
export async function iniciarVerificacion() {
  S.mfa = { modo: 'verificar', codigo: '', err: '', ocupado: true }; S.vista = 'mfa'; render();
  try {
    const f = (await factores()).find(x => x.status === 'verified');
    if (!f) return iniciarActivacion();
    Object.assign(M(), { factorId: f.id, ocupado: false });
  } catch (e) { Object.assign(M(), { err: msgError(e), ocupado: false }); }
  render();
}

export function vMfa() {
  const m = M(); if (!m) return '<main class="login"><p class="muted">Cargando…</p></main>';
  const act = m.modo === 'activar';
  const form = `<form class="stack" data-form="mfa" autocomplete="off">
      <label class="f">Código de 6 números<input class="inp num codigo-mfa" id="mfa-cod" data-mfa="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(m.codigo)}" placeholder="000000"></label>
      ${m.err ? `<p class="err" role="alert">${esc(m.err)}</p>` : ''}
      <button class="btn primary block" type="submit" ${m.ocupado || !m.factorId ? 'disabled' : ''}>${m.ocupado && m.factorId ? 'Verificando…' : !m.factorId ? 'Preparando…' : act ? 'Activar' : 'Entrar'}</button></form>`;
  if (!act) return `<main class="login"><section class="card"><p class="eyebrow">Verificación en dos pasos</p><h1>Código de seguridad</h1>
      <p class="muted">Abrí tu app autenticadora (Google Authenticator, Microsoft Authenticator u otra) y escribí el código de Operapto.</p>${form}
      <p class="small muted">¿Perdiste el celular? Pedile a otro administrador de tu empresa o a soporte de Operapto que te lo restablezca.</p>
      <button class="btn ghost sm" data-act="salir">Salir</button></section></main>`;
  return `<main class="login"><section class="card"><p class="eyebrow">Seguridad de la cuenta</p><h1>Activá la verificación en dos pasos</h1>
      <p class="muted">${m.volver ? 'Vas a agregar otro celular para entrar.' : 'Para proteger los datos de la empresa, quienes administran Operapto entran con la contraseña y un código que cambia cada 30 segundos.'}</p>
      <ol class="pasos"><li>Instalá en tu celular una app autenticadora: <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> (gratis).</li>
        <li>En la app, tocá <b>+</b> y escaneá este código. Si estás en el mismo celular, copiá la clave.</li>
        <li>Escribí el código de 6 números que te muestra.</li></ol>
      ${m.qr ? `<div class="qr-mfa"><img src="${m.qr}" alt="Código QR para la app autenticadora" width="200" height="200"></div>
        <p class="small muted" style="text-align:center">Clave para cargar a mano:<br><b class="mono" id="mfa-secreto" style="user-select:all;word-break:break-all">${esc(m.secreto)}</b></p>` : m.ocupado ? '<p class="muted">Preparando…</p>' : ''}
      ${form}
      ${m.volver ? '<button class="btn ghost sm" data-act="mfaCancelar">Cancelar</button>' : '<button class="btn ghost sm" data-act="salir">Salir</button>'}</section></main>`;
}

export async function enviar(continuar) {
  const m = M(); m.err = '';
  if (!/^\d{6}$/.test(m.codigo)) { m.err = 'El código tiene 6 números.'; return render(); }
  m.ocupado = true; render();
  // Supabase exige que el pedido y la verificación salgan de la misma conexión; con datos móviles la IP puede
  // cambiar entre uno y otro: se reintenta unas veces antes de mostrar el error.
  let error = null;
  for (let i = 0; i < 4; i++) {
    ({ error } = await sb.auth.mfa.challengeAndVerify({ factorId: m.factorId, code: m.codigo }));
    if (!error || !/IP address/i.test(error.message)) break;
  }
  m.ocupado = false;
  if (error) {
    m.err = /IP address/i.test(error.message) ? 'La conexión cambió mientras se verificaba. Probá de nuevo (si usás datos móviles, mejor con wifi).'
      : /invalid|expired/i.test(error.message) ? 'Código incorrecto o vencido. Probá con el que muestra ahora la app.' : msgError(error);
    m.codigo = ''; return render();
  }
  const volver = m.volver, act = m.modo === 'activar';
  S.mfa = null; S.vista = 'cargando';
  if (act) toast(volver ? 'Celular agregado.' : 'Verificación en dos pasos activada.', 5000);
  continuar(volver);
}

/* ------------------------------------------------------------ "Tu seguridad" en Personal y obras */
export async function cargarSeguridad() {
  const a = S.adm; a.seg = { lista: null };
  try { a.seg.lista = (await factores()).filter(f => f.status === 'verified'); } catch { a.seg.lista = []; }
  render();
}
export function vSeguridad() {
  const a = S.adm, s = a.seg; if (!S.user || !S.user.email || /\.operarios\.invalid$/.test(S.user.email)) return '';
  const obligatorio = ['dueno', 'admin'].includes(S.m.rol);
  if (!s || !s.lista) return '<section class="card"><h2>Tu seguridad</h2><p class="muted">Cargando…</p></section>';
  const fs = s.lista;
  return `<section class="card"><h2>Tu seguridad</h2>
    <p class="small muted">Verificación en dos pasos: además de la contraseña, un código de la app autenticadora del celular.${obligatorio ? ' Es obligatoria para dueño y administración.' : ' Para supervisores es opcional y muy recomendable.'}</p>
    ${fs.length ? `<div>${fs.map(f => `<div class="att" style="grid-template-columns:auto 1fr auto"><span class="sev ok"></span><div><div class="t">${esc(f.friendly_name || 'Celular')}</div><div class="s">Activado el ${new Date(f.created_at).toLocaleDateString('es-AR')}</div></div>
      ${fs.length > 1 || !obligatorio ? `<button class="btn sm ghost" data-act="mfaQuitar" data-id="${f.id}">${a.confirm === 'mfa' + f.id ? 'Tocá de nuevo para quitar' : 'Quitar'}</button>` : '<span></span>'}</div>`).join('')}</div>`
      : '<p><span class="chip warn">Sin verificación en dos pasos</span></p>'}
    <div class="row"><button class="btn sm ${fs.length ? 'ghost' : 'dark'}" data-act="mfaAgregar">${fs.length ? 'Agregar otro celular (respaldo)' : 'Activar verificación en dos pasos'}</button></div>
    ${fs.length === 1 && obligatorio ? '<p class="small muted">Te conviene agregar un segundo celular: si perdés este, vas a poder seguir entrando.</p>' : ''}</section>`;
}
export const A = {
  mfaAgregar: () => iniciarActivacion(true),
  mfaCancelar: async () => {
    const m = M(); if (m && m.factorId) await sb.auth.mfa.unenroll({ factorId: m.factorId }).catch(() => {});
    S.mfa = null; S.vista = 'app'; render(); cargarSeguridad();
  },
  mfaQuitar: async b => {
    const a = S.adm, k = 'mfa' + b.dataset.id;
    if (a.confirm !== k) { a.confirm = k; return render(); }
    a.confirm = null;
    const { error } = await sb.auth.mfa.unenroll({ factorId: b.dataset.id });
    if (error) return toast(msgError(error), 6000);
    toast('Celular quitado.'); cargarSeguridad();
  },
};
export function alEscribir(el, v) {
  if (!el.dataset.mfa || !S.mfa) return false;
  S.mfa.codigo = v.replace(/\D/g, '').slice(0, 6);
  if (el.value !== S.mfa.codigo) el.value = S.mfa.codigo;
  return true;
}
