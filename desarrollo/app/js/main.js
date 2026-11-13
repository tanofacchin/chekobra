import { $, esc, ls, toast, msgError } from './util.js';
import { sb, ingresarOperario, ingresarConCorreo, registrarse, salir, misMembresias, privacidadPendiente, aceptarPrivacidad } from './datos.js';
import { politicaHtml, RESUMEN } from './politica.js';
import { sincronizar, cola } from './cola.js';
import { S, setRender, render, esGestor, esMecanico } from './estado.js';
import * as Op from './operario.js';
import * as Adm from './admin.js';
import * as Tal from './taller.js';

const MARK = (n = 26) => `<svg width="${n}" height="${n}" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="5" fill="var(--accent)"/><path d="M7 13.5l4 4 8-9" fill="none" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------------------------------------------------------------- render */
let lastKey = '', pendiente = false;
function claveVista() {
  return [S.vista, S.m && S.m.id, S.modoOperario, Op.clave(), Adm.clave(), Tal.clave()].join('|');
}
function dibujar() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#app').contains(a) && a.dataset.vivo === undefined) { pendiente = true; return; }
  const k = claveVista(), y = scrollY;
  $('#app').innerHTML = vista();
  scrollTo(0, k === lastKey ? y : 0); lastKey = k;
  Op.despues && Op.despues(); Adm.despues && Adm.despues();
}
setRender(dibujar);
document.addEventListener('focusout', () => setTimeout(() => { if (pendiente) { pendiente = false; dibujar(); } }, 0));

function vista() {
  switch (S.vista) {
    case 'cargando': return `<main class="login"><div class="login-brand">${MARK(54)}<h1>CheckObra</h1><p class="muted">Cargando…</p></div></main>`;
    case 'login': return vLogin();
    case 'registro': return vRegistro();
    case 'onboarding': return vTop() + vOnboarding();
    case 'elegir': return vTop() + vElegir();
    case 'privacidad': return vTop() + vPrivacidad();
    case 'politica': return `<main class="wrap politica"><button class="btn ghost sm" data-act="cerrarPolitica" style="align-self:flex-start">← Volver</button>${politicaHtml()}</main>`;
    default: return vTop() + (S.modoOperario ? Op.vista() : esGestor() ? Adm.vista() : esMecanico() ? Tal.vistaMecanico() : Op.vista());
  }
}

function vTop() {
  const nom = S.m ? S.m.nombre : (S.user && S.user.email) || '';
  const rol = S.m ? { dueno: 'Dueño', admin: 'Administración', supervisor: 'Supervisor', operario: 'Operario', mecanico: 'Mecánico' }[S.m.rol] : '';
  const estado = !S.online ? ['local', 'Sin señal'] : S.pendientes ? ['lento', `${S.pendientes} por enviar`] : ['ok', 'Conectado'];
  const ban = !S.online ? `Sin señal. Podés seguir cargando: se envía solo cuando vuelva la conexión.${S.pendientes ? ` (${S.pendientes} pendiente${S.pendientes > 1 ? 's' : ''})` : ''}`
    : S.pendientes ? `${S.pendientes} registro${S.pendientes > 1 ? 's' : ''} enviándose…` : '';
  return `<header class="top"><div class="top-in">
    <div class="brand">${MARK()}<span>CheckObra</span></div>
    <div class="who"><b>${esc(nom)}</b><span>${esc(rol)}${S.m ? ' · ' + esc(S.m.empresa.nombre) : ''}</span></div>
    <span class="conn ${estado[0]}" title="${estado[1]}" aria-label="${estado[1]}"></span>
    ${S.m && (esGestor() || esMecanico()) ? `<button class="btn-s" data-act="modo">${S.modoOperario ? (esGestor() ? 'Panel' : 'Taller') : 'Checklist'}</button>` : ''}
    ${S.membresias.length > 1 ? '<button class="btn-s" data-act="cambiarEmpresa">Empresa</button>' : ''}
    <button class="btn-s" data-act="salir">Salir</button>
  </div></header>${ban ? `<div class="banner-band"><div class="banner">${esc(ban)}</div></div>` : ''}`;
}

/* ---------------------------------------------------------------- ingreso */
function vLogin() {
  const L = S.login, op = L.modo === 'operario';
  return `<main class="login"><div class="login-brand">${MARK(54)}<h1>CheckObra</h1><p class="muted">Control pre-operacional de equipos</p></div>
    <div class="seg-tabs" role="tablist">
      <button role="tab" aria-selected="${op}" class="${op ? 'on' : ''}" data-act="modoLogin" data-m="operario">Operario</button>
      <button role="tab" aria-selected="${!op}" class="${!op ? 'on' : ''}" data-act="modoLogin" data-m="correo">Supervisión</button></div>
    <form class="card login-card" data-form="login" novalidate>
      ${op ? `
        <label class="f">Código de empresa<input class="inp" id="l-slug" data-l="slug" value="${esc(L.slug)}" autocapitalize="none" autocomplete="organization" placeholder="ej.: miempresa"></label>
        <label class="f">Legajo<input class="inp" id="l-leg" data-l="legajo" value="${esc(L.legajo)}" autocapitalize="none" autocomplete="username"></label>
        <label class="f">PIN<input class="inp num pin" id="l-pin" data-l="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" value="${esc(L.pin)}"></label>`
      : `
        <label class="f">Correo<input class="inp" id="l-mail" data-l="email" type="email" autocomplete="email" value="${esc(L.email)}"></label>
        <label class="f">Contraseña<input class="inp" id="l-pass" data-l="pass" type="password" autocomplete="current-password" value="${esc(L.pass)}"></label>`}
      ${L.err ? `<p class="err" role="alert">${esc(L.err)}</p>` : ''}${L.aviso ? `<div class="warnbox">${esc(L.aviso)}</div>` : ''}
      <button class="btn primary block" type="submit" ${L.ocupado ? 'disabled' : ''}>${L.ocupado ? 'Ingresando…' : 'Ingresar'}</button>
    </form>
    <p class="hint">${op ? 'El código de empresa, el legajo y el PIN te los da tu supervisor.<br><button class="linkbtn" data-act="verPolitica">Política de privacidad</button>' : '¿Tu empresa todavía no usa CheckObra? <button class="linkbtn" data-act="irRegistro">Crear cuenta</button>'}</p>
  </main>`;
}
function vRegistro() {
  const L = S.login;
  return `<main class="login"><div class="login-brand">${MARK(54)}<h1>Crear cuenta</h1><p class="muted">Para el dueño o administrador de la empresa</p></div>
    <form class="card login-card" data-form="registro" novalidate>
      <label class="f">Correo<input class="inp" id="r-mail" data-l="email" type="email" autocomplete="email" value="${esc(L.email)}"></label>
      <label class="f">Contraseña <small>Mínimo 8 caracteres</small><input class="inp" id="r-pass" data-l="pass" type="password" autocomplete="new-password" value="${esc(L.pass)}"></label>
      ${L.err ? `<p class="err" role="alert">${esc(L.err)}</p>` : ''}${L.aviso ? `<div class="warnbox">${esc(L.aviso)}</div>` : ''}
      <button class="btn primary block" type="submit" ${L.ocupado ? 'disabled' : ''}>Crear cuenta</button>
    </form><p class="hint"><button class="linkbtn" data-act="irLogin">Ya tengo cuenta</button></p></main>`;
}
function vOnboarding() {
  const o = S.onb;
  return `<main class="wrap"><section><p class="eyebrow">Primer paso</p><h1>Registrá tu empresa</h1>
    <p class="muted">Si sos operario, no hace falta: pedile a tu supervisor que te dé de alta.</p></section>
    <form class="card" data-form="empresa" novalidate>
      <label class="f">Nombre de la empresa<input class="inp" id="o-nom" data-o="nombre" value="${esc(o.nombre)}" placeholder="Mi Empresa S.A."></label>
      <label class="f">Código de empresa <small>Lo usan los operarios para entrar. Minúsculas, números y guiones.</small>
        <input class="inp" id="o-slug" data-o="slug" value="${esc(o.slug)}" autocapitalize="none" placeholder="miempresa"></label>
      <label class="f">Rubro<select class="inp" id="o-rubro" data-o="rubro">${[['construccion', 'Construcción'], ['mineria', 'Minería'], ['agro', 'Agro'], ['otro', 'Otro']].map(([v, l]) => `<option value="${v}" ${o.rubro === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Tu nombre y apellido<input class="inp" id="o-mi" data-o="miNombre" value="${esc(o.miNombre)}"></label>
      ${o.err ? `<p class="err" role="alert">${esc(o.err)}</p>` : ''}
      <button class="btn primary block" type="submit" ${o.ocupado ? 'disabled' : ''}>Registrar empresa</button></form></main>`;
}
function vPrivacidad() {
  const p = S.priv || {};
  return `<main class="wrap"><section><p class="eyebrow">Antes de empezar</p><h1>Tus datos en CheckObra</h1>
    <p class="muted">${esc(S.m.empresa.nombre)} usa CheckObra para registrar el control de los equipos. Esto es lo que se guarda:</p></section>
    <section class="card"><dl class="kv priv">${RESUMEN.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
      <button class="linkbtn" data-act="verPolitica" style="align-self:flex-start">Leer la política de privacidad completa</button></section>
    <label class="check"><input type="checkbox" id="priv-ok" data-priv="ok" ${p.ok ? 'checked' : ''}><span>Leí y acepto que se traten mis datos para estos fines.</span></label>
    ${p.err ? `<p class="err" role="alert">${esc(p.err)}</p>` : ''}
    <div class="row"><button class="btn" data-act="salir">Salir</button><button class="btn primary" data-act="aceptarPrivacidad" ${p.ocupado ? 'disabled' : ''}>Aceptar y continuar</button></div></main>`;
}
function vElegir() {
  return `<main class="wrap"><h1>¿Con qué empresa vas a trabajar?</h1><div class="list">${S.membresias.map(m =>
    `<button class="li" data-act="elegirEmpresa" data-id="${m.id}"><span class="t">${esc(m.empresa.nombre)}</span><span class="chip plain">${esc(m.rol)}</span><span class="s">${esc(m.empresa.slug)}</span></button>`).join('')}</div></main>`;
}

/* ---------------------------------------------------------------- sesión */
async function alIniciarSesion(user) {
  S.user = user;
  try { S.membresias = await misMembresias(user.id); }
  catch (e) { S.vista = 'login'; S.login.err = msgError(e); render(); return; }
  if (!S.membresias.length) { S.vista = 'onboarding'; render(); return; }
  const previa = ls.get('co_membresia', null);
  const m = S.membresias.find(x => x.id === previa) || (S.membresias.length === 1 ? S.membresias[0] : null);
  if (!m) { S.vista = 'elegir'; render(); return; }
  await entrar(m);
}
async function entrar(m) {
  S.m = m; ls.set('co_membresia', m.id); S.modoOperario = false;
  Op.reiniciar(); Adm.reiniciar(); Tal.reiniciar();
  // Consentimiento de privacidad (Ley 25.326): sin aceptarlo no se puede usar la app.
  if (await privacidadPendiente(m.empresa_id, m.id)) { S.vista = 'privacidad'; S.priv = {}; render(); return; }
  S.vista = 'app';
  // Vuelta desde John Deere después de autorizar (?jd=ok | ?jd=error&msg=...)
  const q = new URLSearchParams(location.search);
  if (q.has('jd')) {
    history.replaceState(null, '', location.pathname);
    if (esGestor()) S.adm.tab = 'equipos';
    if (q.get('jd') === 'ok') { toast('John Deere conectado. Descargando datos de las máquinas…', 5000); if (esGestor()) setTimeout(() => Adm.A.admJdSync(), 500); }
    else toast('No se pudo conectar John Deere: ' + (q.get('msg') || 'error desconocido'), 8000);
  }
  render();
  cargarVista();
  sync();
  abrirQrPendiente();
}

// QR pegado en la máquina: ?equipo=<id>. Se guarda al abrir la app (aunque haya que iniciar sesión primero).
function guardarQr() {
  const q = new URLSearchParams(location.search), id = q.get('equipo');
  if (!id) return;
  if (/^[0-9a-f-]{36}$/i.test(id)) ls.set('co_qr', { id, ts: Date.now() });
  q.delete('equipo'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
}
function abrirQrPendiente() {
  const qr = ls.get('co_qr', null); if (!qr) return;
  ls.del('co_qr');
  if (Date.now() - qr.ts > 30 * 60000) return;
  if (esGestor() || esMecanico()) { S.modoOperario = true; Op.cargar(); }
  Op.abrirDesdeQr(qr.id);
}

async function sync() {
  const r = await sincronizar(sb, ev => {
    if (ev.tipo === 'enviado' && ev.envio.tipo === 'checklist') Op.alEnviar(ev);
    if (ev.tipo === 'rechazado') toast('Un registro fue rechazado: ' + ev.envio.error, 7000);
  }).catch(() => null);
  const l = await cola.listar().catch(() => []);
  const pend = l.filter(x => x.estado === 'pendiente');
  const cambio = pend.length !== S.pendientes || (r && r.enviados);
  S.pendientes = pend.length; S.rechazados = l.filter(x => x.estado === 'rechazado');
  if (r && r.enviados) { toast(r.enviados === 1 ? 'Registro enviado.' : `${r.enviados} registros enviados.`); if (S.vista === 'app') cargarVista(); }
  if (cambio) render();
}
export { sync };
// Carga los datos de la vista activa: panel, taller del mecánico o checklist.
function cargarVista() {
  if (S.modoOperario) return Op.cargar();
  if (esGestor()) return Adm.cargar();
  if (esMecanico()) return Tal.cargar();
  return Op.cargar();
}

/* ---------------------------------------------------------------- acciones */
const A = {
  modoLogin: b => { S.login.modo = b.dataset.m; S.login.err = ''; S.login.aviso = ''; render(); },
  irRegistro: () => { S.vista = 'registro'; S.login.err = ''; S.login.aviso = ''; render(); },
  irLogin: () => { S.vista = 'login'; S.login.modo = 'correo'; S.login.err = ''; render(); },
  salir: async () => {
    if (S.pendientes) { toast('Hay registros sin enviar. Esperá a tener señal antes de salir.', 5000); return; }
    await salir(); ls.del('co_membresia'); S.m = null; S.membresias = []; S.vista = 'login'; S.login.pin = ''; S.login.pass = ''; render();
  },
  cambiarEmpresa: () => { S.vista = 'elegir'; render(); },
  elegirEmpresa: b => entrar(S.membresias.find(m => m.id === b.dataset.id)),
  verPolitica: () => { S.vistaPrevia = S.vista; S.vista = 'politica'; render(); },
  cerrarPolitica: () => { S.vista = S.vistaPrevia || 'login'; render(); },
  aceptarPrivacidad: async () => {
    const p = S.priv; p.err = '';
    if (!p.ok) { p.err = 'Marcá la casilla para aceptar.'; return render(); }
    p.ocupado = true; render();
    try { await aceptarPrivacidad(S.m.empresa_id, S.m.id); S.priv = null; await entrar(S.m); }
    catch (e) { p.ocupado = false; p.err = msgError(e); render(); }
  },
  modo: () => { S.modoOperario = !S.modoOperario; render(); cargarVista(); },
};

const FORMS = {
  async login() {
    const L = S.login; L.err = ''; L.aviso = '';
    if (L.modo === 'operario') {
      if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(L.slug.trim().toLowerCase())) { L.err = 'Revisá el código de empresa.'; return render(); }
      if (!L.legajo.trim()) { L.err = 'Escribí tu legajo.'; return render(); }
      if (!/^\d{6}$/.test(L.pin)) { L.err = 'El PIN tiene 6 números.'; return render(); }
    } else if (!L.email.includes('@') || !L.pass) { L.err = 'Completá correo y contraseña.'; return render(); }
    L.ocupado = true; render();
    try {
      if (L.modo === 'operario') { await ingresarOperario(L.slug, L.legajo, L.pin); ls.set('co_ultimo', { slug: L.slug.trim().toLowerCase(), legajo: L.legajo.trim() }); }
      else await ingresarConCorreo(L.email, L.pass);
      L.pin = ''; L.pass = '';
    } catch (e) {
      L.err = e.message === 'Invalid login credentials' ? (L.modo === 'operario' ? 'Código de empresa, legajo o PIN incorrectos.' : 'Correo o contraseña incorrectos.')
        : e.message === 'Email not confirmed' ? 'Todavía no confirmaste tu correo. Revisá tu bandeja de entrada.' : msgError(e);
    }
    L.ocupado = false; render();
  },
  async registro() {
    const L = S.login; L.err = ''; L.aviso = '';
    if (!L.email.includes('@')) { L.err = 'Escribí un correo válido.'; return render(); }
    if (L.pass.length < 8) { L.err = 'La contraseña tiene que tener al menos 8 caracteres.'; return render(); }
    L.ocupado = true; render();
    try {
      const r = await registrarse(L.email, L.pass);
      if (r.confirmar) { L.aviso = `Te mandamos un correo a ${L.email}. Abrí el enlace para confirmar la cuenta y después ingresá.`; S.vista = 'login'; L.modo = 'correo'; }
    } catch (e) { L.err = msgError(e); }
    L.ocupado = false; render();
  },
  async empresa() {
    const o = S.onb; o.err = '';
    const slug = o.slug.trim().toLowerCase();
    if (o.nombre.trim().length < 2) o.err = 'Escribí el nombre de la empresa.';
    else if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) o.err = 'El código lleva de 3 a 40 letras minúsculas, números o guiones.';
    else if (o.miNombre.trim().length < 2) o.err = 'Escribí tu nombre.';
    if (o.err) return render();
    o.ocupado = true; render();
    const { error } = await sb.rpc('crear_empresa', { p_nombre: o.nombre, p_slug: slug, p_rubro: o.rubro, p_mi_nombre: o.miNombre });
    o.ocupado = false;
    if (error) { o.err = /duplicate|unique/.test(error.message) ? 'Ese código de empresa ya está en uso. Elegí otro.' : msgError(error); return render(); }
    await alIniciarSesion(S.user);
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const f = A[b.dataset.act] || Op.A[b.dataset.act] || Adm.A[b.dataset.act] || Tal.A[b.dataset.act];
  if (f) { e.preventDefault(); f(b, e); }
});
document.addEventListener('submit', e => {
  const f = FORMS[e.target.dataset.form]; if (f) { e.preventDefault(); f(); }
});
document.addEventListener('input', e => {
  const el = e.target, v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.l) S.login[el.dataset.l] = v;
  else if (el.dataset.priv) S.priv.ok = v;
  else if (el.dataset.o) S.onb[el.dataset.o] = v;
  else (Tal.alEscribir(el, v) || Op.alEscribir(el, v) || Adm.alEscribir(el, v));
});
document.addEventListener('change', e => { if (e.target.dataset.file === 'ot') Tal.alArchivo(e.target); else if (e.target.dataset.file) Op.alArchivo(e.target); });

addEventListener('online', () => { S.online = true; render(); sync(); });
addEventListener('offline', () => { S.online = false; render(); });
setInterval(() => { if (S.online && S.user) sync(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.vista === 'app') { sync(); cargarVista(); } });

/* ---------------------------------------------------------------- arranque */
guardarQr();
const ult = ls.get('co_ultimo', null); if (ult) { S.login.slug = ult.slug; S.login.legajo = ult.legajo; }
sb.auth.onAuthStateChange((ev, ses) => {
  if (ev === 'SIGNED_IN' && ses && (!S.user || S.user.id !== ses.user.id)) alIniciarSesion(ses.user);
  if (ev === 'SIGNED_OUT') { S.user = null; S.m = null; S.vista = 'login'; render(); }
});
(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) await alIniciarSesion(data.session.user); else { S.vista = 'login'; render(); }
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
