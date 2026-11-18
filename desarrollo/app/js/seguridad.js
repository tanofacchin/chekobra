// Verificación en dos pasos (opcional) para quienes entran con correo. Tres formas:
//   · huella o cara (llave de acceso del celular o la computadora, WebAuthn),
//   · código de una app autenticadora (Google Authenticator, Microsoft Authenticator…),
//   · código por correo (lo manda la función 'verificacion' y lo comprueba la base).
// Quien activa alguna, la necesita en cada ingreso: el servidor no le da permisos sin ella (ver mi_rol en la base).
import { esc, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const M = () => S.mfa;
export const hayHuella = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
const NOMBRE = { huella: 'Huella o cara', app: 'App autenticadora', correo: 'Código por correo' };

// Qué le falta a esta sesión: 'nada' | 'verificar'. Sin señal no se bloquea (los datos del servidor igual se protegen).
export async function pendiente() {
  const { data, error } = await sb.rpc('segundo_factor_pendiente');
  return error ? 'nada' : data;
}
async function metodos() {
  const [{ data: fs, error: e1 }, { data: m, error: e2 }, { data: hs, error: e3 }] = await Promise.all([
    sb.auth.mfa.listFactors(), sb.rpc('mis_metodos_2fa'), sb.from('huellas').select('id, nombre, rp_id, creada_en, usada_en').order('creada_en')]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;
  return { factores: fs.all, correo: m.correo, huellas: hs };
}
// Huella o cara: la arma Operapto (función 'verificacion') con la librería SimpleWebAuthn en el navegador.
let libHuella = null;
const cargarHuella = () => libHuella ||= new Promise((ok, no) => {
  const sc = document.createElement('script'); sc.src = 'vendor/simplewebauthn-browser-13.2.2.js';
  sc.onload = () => ok(window.SimpleWebAuthnBrowser); sc.onerror = () => no(new Error('No se pudo cargar la huella')); document.head.append(sc);
}).catch(e => { libHuella = null; throw e; });
async function llamar(body) {
  const { data, error } = await sb.functions.invoke('verificacion', { body });
  if (error || (data && data.error)) {
    let msg = data && data.error;
    if (!msg) { try { msg = (await error.context.json()).error; } catch { msg = msgError(error); } }
    throw new Error(msg);
  }
  return data;
}
async function registrarHuella(nombre) {
  const W = await cargarHuella();
  const { opciones } = await llamar({ accion: 'huella_opciones_alta' });
  const respuesta = await W.startRegistration({ optionsJSON: opciones });
  await llamar({ accion: 'huella_alta', respuesta, nombre });
}
async function usarHuella() {
  const W = await cargarHuella();
  const { opciones } = await llamar({ accion: 'huella_opciones' });
  const respuesta = await W.startAuthentication({ optionsJSON: opciones });
  await llamar({ accion: 'huella_verificar', respuesta });
}
// Supabase exige que el pedido y la verificación salgan de la misma conexión; con datos móviles la IP puede
// cambiar entre uno y otro: se reintenta unas veces antes de mostrar el error.
async function reintentar(f) {
  let r;
  for (let i = 0; i < 4; i++) { r = await f(); if (!r.error || !/IP address/i.test(r.error.message)) break; }
  return r;
}
function textoError(e) {
  const t = (e && e.message) || '';
  if (/IP address/i.test(t)) return 'La conexión cambió mientras se verificaba. Probá de nuevo (si usás datos móviles, mejor con wifi).';
  if (/invalid.*code|expired|Invalid TOTP/i.test(t)) return 'Código incorrecto o vencido. Probá con el que muestra ahora la app.';
  if (/NotAllowed|not allowed|cancel|timed out|abort/i.test(t)) return 'Se canceló la huella o la cara. Probá de nuevo.';
  if (/not support/i.test(t)) return 'Este navegador no permite huella o cara. Usá otra forma.';
  return msgError(e);
}
const enviarCorreo = async () => (await llamar({ accion: 'enviar' })).correo;

/* ------------------------------------------------------------ al entrar: verificar */
export async function iniciarVerificacion() {
  S.mfa = { modo: 'verificar', codigo: '', err: '', ocupado: true }; S.vista = 'mfa'; render();
  try {
    const x = await metodos(), ok = x.factores.filter(f => f.status === 'verified');
    const formas = [];
    if (hayHuella() && x.huellas.some(h => h.rp_id === location.hostname)) formas.push('huella');
    if (ok.some(f => f.factor_type === 'totp')) formas.push('app');
    if (x.correo) formas.push('correo');
    Object.assign(M(), { formas, forma: formas[0] || 'app', factores: ok, ocupado: false,
      err: formas.length ? '' : 'Tu cuenta usa huella o cara, pero no desde este navegador. Entrá desde el celular o la computadora donde la activaste, o pedile a un administrador que te restablezca la verificación.' });
  } catch (e) { Object.assign(M(), { err: msgError(e), ocupado: false, formas: [] }); }
  render();
}

export function vMfa() {
  const m = M(); if (!m) return '<main class="login"><p class="muted">Cargando…</p></main>';
  return m.modo === 'verificar' ? vVerificar(m) : m.modo === 'app' ? vActivarApp(m) : vActivarCorreo(m);
}
const campoCodigo = (m, texto) => `<form class="stack" data-form="mfa" autocomplete="off">
    <label class="f">Código de 6 números<input class="inp num codigo-mfa" id="mfa-cod" data-mfa="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(m.codigo)}" placeholder="000000"></label>
    ${m.err ? `<p class="err" role="alert">${esc(m.err)}</p>` : ''}
    <button class="btn primary block" type="submit" ${m.ocupado ? 'disabled' : ''}>${m.ocupado ? 'Verificando…' : texto}</button></form>`;

function vVerificar(m) {
  const otras = (m.formas || []).filter(f => f !== m.forma);
  let cuerpo;
  if (m.ocupado && !m.formas) cuerpo = '<p class="muted">Preparando…</p>';
  else if (m.forma === 'huella') cuerpo = `<p class="muted">Usá la huella, la cara o el bloqueo de pantalla de este dispositivo.</p>
    ${m.err ? `<p class="err" role="alert">${esc(m.err)}</p>` : ''}
    <button class="btn primary block" data-act="mfaHuella" ${m.ocupado ? 'disabled' : ''}>${m.ocupado ? 'Esperando la huella…' : 'Verificar con huella o cara'}</button>`;
  else if (m.forma === 'correo') cuerpo = m.enviado ? `<p class="muted">Te mandamos un código a <b>${esc(m.enviado)}</b>. Vence en 10 minutos.</p>${campoCodigo(m, 'Entrar')}
      <button class="btn ghost sm" data-act="mfaMandarCorreo">Mandar otro código</button>`
    : `<p class="muted">Te mandamos un código de 6 números a tu correo.</p>${m.err ? `<p class="err" role="alert">${esc(m.err)}</p>` : ''}
      <button class="btn primary block" data-act="mfaMandarCorreo" ${m.ocupado ? 'disabled' : ''}>${m.ocupado ? 'Mandando…' : 'Mandarme el código'}</button>`;
  else cuerpo = `<p class="muted">Abrí tu app autenticadora (Google Authenticator, Microsoft Authenticator u otra) y escribí el código de Operapto.</p>${campoCodigo(m, 'Entrar')}`;
  return `<main class="login"><section class="card"><p class="eyebrow">Verificación en dos pasos</p><h1>${m.forma === 'huella' ? 'Confirmá que sos vos' : 'Código de seguridad'}</h1>
      ${cuerpo}
      ${otras.length ? `<p class="small muted">¿No podés ahora? Probá con: ${otras.map(f => `<button class="linkbtn" data-act="mfaForma" data-k="${f}">${NOMBRE[f].toLowerCase()}</button>`).join(' · ')}</p>` : ''}
      <p class="small muted">¿Perdiste el celular? Pedile a otro administrador de tu empresa o a soporte de Operapto que te restablezca la verificación.</p>
      <button class="btn ghost sm" data-act="salir">Salir</button></section></main>`;
}

/* ------------------------------------------------------------ activar: app autenticadora */
async function iniciarApp() {
  S.mfa = { modo: 'app', codigo: '', err: '', ocupado: true }; S.vista = 'mfa'; render();
  try {
    const { data: fs } = await sb.auth.mfa.listFactors();
    for (const f of fs.all.filter(f => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
    const n = fs.totp.length;
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `App autenticadora ${n + 1} · ${new Date().toLocaleDateString('es-AR')}`, issuer: 'Operapto' });
    if (error) throw error;
    // Según la versión, el QR viene como SVG suelto o ya como data URL.
    const qr = data.totp.qr_code, svg = qr.startsWith('data:') && !qr.includes(';base64,') ? qr.slice(qr.indexOf(',') + 1) : qr;
    const src = svg.startsWith('data:') ? svg : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    Object.assign(M(), { factorId: data.id, qr: src, secreto: data.totp.secret, ocupado: false });
  } catch (e) { Object.assign(M(), { err: textoError(e), ocupado: false }); }
  render();
}
function vActivarApp(m) {
  return `<main class="login"><section class="card"><p class="eyebrow">Tu seguridad</p><h1>Agregar app autenticadora</h1>
      <ol class="pasos"><li>Instalá en tu celular <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> (gratis).</li>
        <li>En la app, tocá <b>+</b> y escaneá este código. Si estás en el mismo celular, copiá la clave.</li>
        <li>Escribí el código de 6 números que te muestra.</li></ol>
      ${m.qr ? `<div class="qr-mfa"><img src="${m.qr}" alt="Código QR para la app autenticadora" width="200" height="200"></div>
        <p class="small muted" style="text-align:center">Clave para cargar a mano:<br><b class="mono" id="mfa-secreto" style="user-select:all;word-break:break-all">${esc(m.secreto)}</b></p>` : m.ocupado ? '<p class="muted">Preparando…</p>' : ''}
      ${m.factorId ? campoCodigo(m, 'Activar') : m.err ? `<p class="err" role="alert">${esc(m.err)}</p>` : ''}
      <button class="btn ghost sm" data-act="mfaCancelar">Cancelar</button></section></main>`;
}

/* ------------------------------------------------------------ activar: código por correo */
function vActivarCorreo(m) {
  return `<main class="login"><section class="card"><p class="eyebrow">Tu seguridad</p><h1>Activar código por correo</h1>
      <p class="muted">Cada vez que entres te vamos a mandar un código a <b>${esc(S.user.email)}</b>. Para activarlo, escribí el que te acabamos de mandar.</p>
      ${m.enviado ? campoCodigo(m, 'Activar') : `${m.err ? `<p class="err" role="alert">${esc(m.err)}</p>` : '<p class="muted">Mandando…</p>'}`}
      ${m.enviado ? '<button class="btn ghost sm" data-act="mfaMandarCorreo">Mandar otro código</button>' : ''}
      <button class="btn ghost sm" data-act="mfaCancelar">Cancelar</button></section></main>`;
}

// Envío del formulario de código (app o correo, al entrar o al activar).
export async function enviar(continuar) {
  const m = M(); m.err = '';
  if (!/^\d{6}$/.test(m.codigo)) { m.err = 'El código tiene 6 números.'; return render(); }
  m.ocupado = true; render();
  let error = null;
  const porCorreo = m.modo === 'correo' || (m.modo === 'verificar' && m.forma === 'correo');
  if (porCorreo) {
    const r = await sb.rpc('verificar_codigo_correo', { p_codigo: m.codigo, p_activar: m.modo === 'correo' });
    error = r.error || (r.data ? null : { message: 'invalid code' });
  } else {
    const id = m.modo === 'app' ? m.factorId : (m.factores.find(f => f.factor_type === 'totp') || {}).id;
    ({ error } = await reintentar(() => sb.auth.mfa.challengeAndVerify({ factorId: id, code: m.codigo })));
  }
  m.ocupado = false;
  if (error) { m.err = porCorreo && error.message === 'invalid code' ? 'Código incorrecto. Revisá el último correo que te llegó.' : textoError(error); m.codigo = ''; return render(); }
  terminar(m, continuar);
}
function terminar(m, continuar) {
  const activando = m.modo !== 'verificar';
  S.mfa = null; S.vista = 'cargando';
  if (activando) toast({ app: 'App autenticadora agregada.', correo: 'Código por correo activado.', huella: 'Huella o cara agregada.' }[m.modo] || 'Listo.', 5000);
  continuar(activando);
}

/* ------------------------------------------------------------ "Tu seguridad" en Personal y obras */
export async function cargarSeguridad() {
  const a = S.adm; a.seg = { x: null };
  try { a.seg.x = await metodos(); } catch { a.seg.x = { factores: [], correo: false }; }
  render();
}
export function vSeguridad() {
  const a = S.adm, s = a.seg; if (!S.user || !S.user.email || /\.operarios\.invalid$/.test(S.user.email)) return '';
  if (!s || !s.x) return '<section class="card"><h2>Tu seguridad</h2><p class="muted">Cargando…</p></section>';
  const ok = s.x.factores.filter(f => f.status === 'verified' && f.factor_type === 'totp'), admin = ['dueno', 'admin'].includes(S.m.rol);
  const fila = (nombre, detalle, act, id) => `<div class="att" style="grid-template-columns:auto 1fr auto"><span class="sev ok"></span><div><div class="t">${esc(nombre)}</div><div class="s">${esc(detalle)}</div></div>
    <button class="btn sm ghost" data-act="${act}" data-id="${id || ''}">${a.confirm === act + (id || '') ? 'Tocá de nuevo para quitar' : 'Quitar'}</button></div>`;
  const filas = [...s.x.huellas.map(h => fila('Huella o cara', `${h.nombre} · desde el ${new Date(h.creada_en).toLocaleDateString('es-AR')}${h.rp_id !== location.hostname ? ' · otro sitio' : ''}`, 'mfaQuitarHuella', h.id)),
    ...ok.map(f => fila('App autenticadora', `${f.friendly_name || ''} · desde el ${new Date(f.created_at).toLocaleDateString('es-AR')}`, 'mfaQuitar', f.id)),
    ...(s.x.correo ? [fila('Código por correo', S.user.email, 'mfaQuitarCorreo')] : [])];
  return `<section class="card"><h2>Tu seguridad</h2>
    <p class="small muted">Verificación en dos pasos: además de la contraseña, confirmás que sos vos con la huella, una app del celular o un código por correo. Es opcional${admin ? ', pero muy recomendable para quien administra la empresa' : ''}. Si activás varias formas, al entrar elegís cualquiera.</p>
    ${filas.length ? `<div>${filas.join('')}</div>` : `<p><span class="chip ${admin ? 'warn' : 'plain'}">Sin verificación en dos pasos</span></p>`}
    <div class="row">${hayHuella() ? '<button class="btn sm dark" data-act="mfaAgregarHuella">Agregar huella o cara</button>' : ''}
      <button class="btn sm ${hayHuella() ? 'ghost' : 'dark'}" data-act="mfaAgregar">Agregar app autenticadora</button>
      ${s.x.correo ? '' : '<button class="btn sm ghost" data-act="mfaAgregarCorreo">Activar código por correo</button>'}</div>
    ${filas.length === 1 ? '<p class="small muted">Conviene tener dos formas: si perdés el celular, entrás con la otra.</p>' : ''}
    ${s.x.huellas.length ? '<p class="small muted">La huella o cara queda en el dispositivo donde la activaste: para entrar desde otro, agregalo también o usá otra forma.</p>' : ''}</section>`;
}
// Aviso del resumen para dueño y administración sin ninguna forma activada.
export async function sugerencia() {
  if (!S.user || !S.m || !['dueno', 'admin'].includes(S.m.rol)) return null;
  const { data } = await sb.rpc('mis_metodos_2fa');
  return data && !data.app && !data.huella && !data.correo;
}

async function volverAPersonal() { S.mfa = null; S.vista = 'app'; render(); cargarSeguridad(); }
export const A = {
  mfaAgregar: () => iniciarApp(),
  mfaAgregarCorreo: async () => {
    S.mfa = { modo: 'correo', codigo: '', err: '', ocupado: false }; S.vista = 'mfa'; render();
    try { M().enviado = await enviarCorreo(); } catch (e) { M().err = e.message; }
    render();
  },
  mfaAgregarHuella: async () => {
    const n = (S.adm.seg && S.adm.seg.x ? S.adm.seg.x.huellas.length : 0) + 1;
    const nombre = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Celular Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Computadora Windows' : 'Dispositivo ' + n;
    try { await registrarHuella(nombre); }
    catch (e) { return toast(textoError(e), 7000); }
    toast('Huella o cara agregada. La próxima vez que entres desde este dispositivo, te la va a pedir.', 6000);
    cargarSeguridad();
  },
  mfaQuitarHuella: async b => {
    const a = S.adm, k = 'mfaQuitarHuella' + b.dataset.id;
    if (a.confirm !== k) { a.confirm = k; return render(); }
    a.confirm = null;
    const { error } = await sb.rpc('quitar_huella', { p_id: b.dataset.id });
    if (error) return toast(msgError(error), 6000);
    toast('Huella o cara quitada.'); cargarSeguridad();
  },
  mfaCancelar: async () => {
    const m = M(); if (m && m.modo === 'app' && m.factorId) await sb.auth.mfa.unenroll({ factorId: m.factorId }).catch(() => {});
    volverAPersonal();
  },
  mfaForma: b => { Object.assign(M(), { forma: b.dataset.k, err: '', codigo: '', enviado: null }); render(); },
  mfaMandarCorreo: async () => {
    const m = M(); m.ocupado = true; m.err = ''; render();
    try { m.enviado = await enviarCorreo(); m.codigo = ''; } catch (e) { m.err = e.message; }
    m.ocupado = false; render();
  },
  mfaHuella: async () => {
    const m = M(); m.ocupado = true; m.err = ''; render();
    try { await usarHuella(); } catch (e) { m.ocupado = false; m.err = textoError(e); return render(); }
    m.ocupado = false; terminar(m, S.mfaContinuar);
  },
  mfaQuitar: async b => {
    const a = S.adm, k = 'mfaQuitar' + b.dataset.id;
    if (a.confirm !== k) { a.confirm = k; return render(); }
    a.confirm = null;
    const { error } = await sb.auth.mfa.unenroll({ factorId: b.dataset.id });
    if (error) return toast(/aal2|AAL2/i.test(error.message) ? 'Para quitar la app autenticadora, entrá verificando con su código.' : msgError(error), 7000);
    toast('Forma de verificación quitada.'); cargarSeguridad();
  },
  mfaQuitarCorreo: async () => {
    const a = S.adm; if (a.confirm !== 'mfaQuitarCorreo') { a.confirm = 'mfaQuitarCorreo'; return render(); }
    a.confirm = null;
    const { error } = await sb.rpc('desactivar_correo_2fa');
    if (error) return toast(msgError(error), 6000);
    toast('Código por correo desactivado.'); cargarSeguridad();
  },
};
export function alEscribir(el, v) {
  if (!el.dataset.mfa || !S.mfa) return false;
  S.mfa.codigo = v.replace(/\D/g, '').slice(0, 6);
  if (el.value !== S.mfa.codigo) el.value = S.mfa.codigo;
  return true;
}
