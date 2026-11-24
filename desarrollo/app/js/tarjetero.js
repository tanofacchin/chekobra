// Tarjetero: entradas y salidas de todo el personal.
// - Cada uno desde su celular (GPS + foto) o escaneando el QR de la obra.
// - El reloj del obrador: un teléfono fijo donde cada persona marca con su legajo, su PIN y una foto.
// - En el panel: presentes y ausentes del día, horas para sueldos (normales, 50 % y 100 %) con Excel, revisión y ajustes.
// Sin señal, la marcación queda en la bandeja del teléfono (cola.js) y se envía sola.
import { $, esc, fFecha, fHora, fNum, dayKey, uuid, toast, msgError, comprimir, ls, normal, filtrar, descargar, esErrorDeRed, fechaLarga } from './util.js';
import { sb } from './datos.js';
import { cola } from './cola.js';
import { S, render, esAdmin, esGestor } from './estado.js';
import { sync } from './main.js';
import { qrSvg } from './etiquetas.js';

const E = () => S.m.empresa_id;
const TZ = 'America/Argentina/Buenos_Aires';
export const ROL_TXT = { dueno: 'Dueño', admin: 'Administración', supervisor: 'Supervisor', operario: 'Operario', mecanico: 'Mecánico', personal: 'Personal de obra', reloj: 'Reloj del obrador' };
const fH = h => { const n = Number(h || 0); if (!n) return '—'; const hh = Math.floor(n + 1e-9), mm = Math.round((n - hh) * 60); return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`; };
const fHd = h => Number(h || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diaSem = f => DIAS[new Date(f + 'T12:00:00').getDay()];
const ddmm = f => f.split('-').reverse().slice(0, 2).join('/');
export const urlMarcar = t => `${location.origin}${location.pathname.replace(/index\.html$/, '')}?marcar=${encodeURIComponent(t)}`;
export function quincena(cual = 'actual') {
  const h = new Date(); let y = h.getFullYear(), m = h.getMonth(), primera = h.getDate() <= 15;
  if (cual === 'anterior') { if (primera) { m--; if (m < 0) { m = 11; y--; } primera = false; } else primera = true; }
  const fin = new Date(y, m + 1, 0).getDate(), p = n => String(n).padStart(2, '0');
  return primera ? { desde: `${y}-${p(m + 1)}-01`, hasta: `${y}-${p(m + 1)}-15` } : { desde: `${y}-${p(m + 1)}-16`, hasta: `${y}-${p(m + 1)}-${p(fin)}` };
}
function mes(cual) {
  const h = new Date(); if (cual === 'anterior') h.setMonth(h.getMonth() - 1, 1);
  const y = h.getFullYear(), m = h.getMonth(), p = n => String(n).padStart(2, '0');
  return { desde: `${y}-${p(m + 1)}-01`, hasta: `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}` };
}
const err = e => { let m = msgError(e); return m; };

/* ================================================================ mi tarjeta (celular propio y QR) */
const T = () => (S.tj ||= { ult: null, obras: null, flujo: null, horas: null, pedirFoto: true, cargando: false });
const kUlt = () => 'co_tj_' + S.m.id;

let cargaMio = null;   // una sola carga a la vez: quien llega mientras tanto espera la misma
export function cargarMio() { return cargaMio ||= leerMio().finally(() => { cargaMio = null; }); }
async function leerMio() {
  const t = T(); t.cargando = true;
  try {
    const q = quincena();
    const [mk, ob, aj, hs] = await Promise.all([
      sb.from('marcaciones').select('id, tipo, cuando, obra_id, verificada, modo, observacion').eq('miembro_id', S.m.id).is('anulada_en', null).order('cuando', { ascending: false }).limit(20),
      sb.from('obras').select('id, nombre').eq('empresa_id', E()).eq('activa', true).order('nombre'),
      sb.from('ajustes_asistencia').select('pedir_foto').eq('empresa_id', E()).maybeSingle(),
      sb.rpc('asistencia', { p_empresa: E(), p_desde: q.desde, p_hasta: q.hasta, p_miembro: S.m.id }),
    ]);
    if (mk.error) throw mk.error;
    t.ult = mk.data; t.obras = ob.data || []; t.pedirFoto = aj.data ? aj.data.pedir_foto : true; t.horas = hs.error ? null : { ...hs.data, ...q };
    ls.set(kUlt(), { ult: t.ult, obras: t.obras, pedirFoto: t.pedirFoto });
  } catch (e) {
    const c = ls.get(kUlt(), null);
    if (c) Object.assign(t, c); else { t.ult ||= []; t.obras ||= []; }
    if (!esErrorDeRed(e)) toast(err(e));
  }
  t.pend = (await cola.listar().catch(() => [])).filter(x => x.tipo === 'marca' && x.uid === S.user.id);
  t.cargando = false; render();
}
// Estado actual combinando lo del servidor con lo que espera señal en el teléfono.
function estado() {
  const t = T();
  const todas = [...(t.pend || []).map(p => ({ tipo: p.payload.tipo, cuando: p.payload.cuando, obra_id: p.payload.obra_id, pendiente: true, rechazo: p.estado === 'rechazado' ? p.error : null })), ...(t.ult || [])]
    .sort((a, b) => new Date(b.cuando) - new Date(a.cuando));
  const u = todas.find(x => !x.rechazo);
  const adentro = u && u.tipo === 'entrada' && Date.now() - new Date(u.cuando) < 20 * 3600e3;
  return { u, adentro, todas };
}
const obraNom = id => { const o = (T().obras || []).find(x => x.id === id); return o ? o.nombre : ''; };

// Franja que va arriba de la vista del operario y del mecánico; la vista del personal de obra la usa como tarjeta principal.
export function vFranja(grande = false) {
  const t = T();
  if (!t.ult) { una('mio', cargarMio); return ''; }
  if (t.flujo) return `<div class="wrap tj-wrap">${vFlujo()}</div>`;
  const { u, adentro } = estado();
  const rech = (t.pend || []).filter(p => p.estado === 'rechazado');
  const txt = adentro ? `Adentro desde las <b>${fHora(u.cuando)}</b>${u.obra_id && obraNom(u.obra_id) ? ' · ' + esc(obraNom(u.obra_id)) : ''}${u.pendiente ? ' · <span class="chip warn">esperando señal</span>' : ''}`
    : u ? `Última salida: ${dayKey(u.cuando) === dayKey(new Date()) ? 'hoy' : fFecha(u.cuando)} a las ${fHora(u.cuando)}${u.pendiente ? ' · <span class="chip warn">esperando señal</span>' : ''}` : 'Todavía no marcaste';
  const rechHtml = rech.map(p => `<div class="badbox small"><b>Una marcación no se guardó:</b> ${esc(p.error)} <button class="btn sm" data-act="tjDescartar" data-id="${p.id}">Descartar</button></div>`).join('');
  if (!grande) return `<div class="wrap tj-wrap">${rechHtml}<section class="tj-franja ${adentro ? 'on' : ''}"><span class="tj-dot"></span><div class="tj-txt"><span class="eyebrow">Tarjetero</span><span>${txt}</span></div>
      <button class="btn ${adentro ? '' : 'primary'}" data-act="tjMarcar" data-k="${adentro ? 'salida' : 'entrada'}">${adentro ? 'Marcar salida' : 'Marcar entrada'}</button></section></div>`;
  return `${rechHtml}<button class="start tj-start ${adentro ? 'on' : ''}" data-act="tjMarcar" data-k="${adentro ? 'salida' : 'entrada'}"><span class="eyebrow" style="color:inherit;opacity:.75">${adentro ? 'Estás trabajando' : 'Al llegar a la obra'}</span>
      <b>${adentro ? 'Marcar salida' : 'Marcar entrada'}</b><span>${txt}</span></button>`;
}

function vFlujo() {
  const f = T().flujo, obras = T().obras || [];
  const gps = f.gps ? `<span class="chip ok">Ubicación tomada ±${Math.round(f.gps.acc)} m</span>` : f.gpsBusy ? '<span class="chip plain">Buscando GPS…</span>'
    : `<span class="chip warn">${esc(f.gpsErr || 'Sin ubicación')}</span> <button class="btn sm ghost" data-act="tjGps">Reintentar</button>`;
  const fotoUrl = f.foto ? (f.fotoUrl ||= URL.createObjectURL(f.foto)) : null;
  return `<section class="card tj-flujo"><p class="eyebrow">Tarjetero · ${f.tipo === 'entrada' ? 'Entrada' : 'Salida'}</p><h2>${f.tipo === 'entrada' ? 'Marcar entrada' : 'Marcar salida'} · ${fHora(new Date())} h</h2>
    ${f.qr ? `<div class="okbox small">Escaneaste el QR de la obra${f.qrObra ? ': <b>' + esc(f.qrObra) + '</b>' : ''}.</div>`
      : `<label class="f">Obra<select class="inp" id="tj-obra" data-tj="obraId"><option value="">${f.tipo === 'salida' ? 'La misma de la entrada' : 'Elegí la obra'}</option>${obras.map(o => `<option value="${o.id}" ${f.obraId === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>`}
    <div class="row">${gps}</div>
    <div class="tj-foto">${fotoUrl ? `<img src="${fotoUrl}" alt="Tu foto">` : ''}
      <label class="btn ${f.foto ? 'ghost' : 'primary'}" for="tj-selfie">${f.foto ? 'Sacar otra foto' : T().pedirFoto ? 'Sacate una foto' : 'Foto (opcional)'}</label>
      <input class="vh" type="file" id="tj-selfie" accept="image/*" capture="user" data-file="marca"></div>
    ${f.err ? `<p class="err" role="alert">${esc(f.err)}</p>` : ''}
    <div class="row"><button class="btn" data-act="tjCancelar">Cancelar</button><button class="btn dark" data-act="tjConfirmar" ${f.ocupado ? 'disabled' : ''}>${f.ocupado ? 'Guardando…' : f.tipo === 'entrada' ? 'Confirmar entrada' : 'Confirmar salida'}</button></div></section>`;
}

function tomarGps() {
  const f = T().flujo; if (!f) return;
  if (!navigator.geolocation) { f.gpsErr = 'Este teléfono no da la ubicación'; return render(); }
  f.gpsBusy = true; f.gpsErr = ''; render();
  navigator.geolocation.getCurrentPosition(p => { if (T().flujo !== f) return; f.gpsBusy = false; f.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; render(); },
    e => { if (T().flujo !== f) return; f.gpsBusy = false; f.gpsErr = e.code === 1 ? 'Sin permiso de ubicación' : 'No se encontró señal GPS'; render(); },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
export function abrirFlujo(tipo, qr) {
  const t = T(), { adentro, u } = estado();
  const sug = ls.get('co_ultima_obra_' + S.m.id, '') || (adentro && u.obra_id) || '';
  t.flujo = { id: uuid(), tipo: tipo || (adentro ? 'salida' : 'entrada'), obraId: (t.obras || []).some(o => o.id === sug) ? sug : '', qr: qr || null, gps: null, gpsBusy: false, gpsErr: '', foto: null, err: '', ocupado: false };
  render(); tomarGps(); scrollTo(0, 0);
}
// Desde el QR pegado en la obra (?marcar=<código>).
export async function abrirDesdeQr(token) { if (!T().ult) await cargarMio(); abrirFlujo(null, token); }

async function confirmar() {
  const t = T(), f = t.flujo; f.err = '';
  if (!f.qr && !f.obraId && f.tipo === 'entrada' && (t.obras || []).length) { f.err = 'Elegí la obra.'; return render(); }
  if (t.pedirFoto && !f.foto) { f.err = 'Sacate la foto para marcar.'; return render(); }
  f.ocupado = true; render();
  const path = f.foto ? `${E()}/${S.user.id}/marca-${f.id}.jpg` : null;
  await cola.agregar({ id: f.id, tipo: 'marca', uid: S.user.id, empresa_id: E(), archivos: f.foto ? [{ path, blob: f.foto, tipo: 'image/jpeg' }] : [],
    payload: { empresa_id: E(), client_id: f.id, tipo: f.tipo, obra_id: f.qr ? null : f.obraId || null, qr: f.qr, cuando: new Date().toISOString(),
      lat: f.gps ? f.gps.lat : null, lng: f.gps ? f.gps.lng : null, precision_m: f.gps ? Math.round(f.gps.acc) : null, foto_path: path } });
  if (f.obraId) ls.set('co_ultima_obra_' + S.m.id, f.obraId);
  if (f.fotoUrl) URL.revokeObjectURL(f.fotoUrl);
  t.flujo = null;
  toast(f.tipo === 'entrada' ? `Entrada marcada a las ${fHora(new Date())}.` : `Salida marcada a las ${fHora(new Date())}. ¡Buen descanso!`, 5000);
  await sync(); cargarMio();
}
// Respuesta del servidor a una marcación que salió de la bandeja.
export function alEnviar(ev) {
  const r = ev.respuesta || {};
  if (r.verificada === false && r.observacion) { toast('Marcación guardada. Queda para que la revise el supervisor: ' + r.observacion, 8000); return true; }
  // La marca recién hecha ya avisó al confirmar; las que salen de la bandeja después de estar sin señal, también se cuentan.
  return Date.now() - (ev.envio.creado || 0) < 15000;
}

/* ================================================================ vista del personal de obra (sin máquinas) */
export function vPersonalObra() {
  const t = T();
  if (!t.ult) { una('mio', cargarMio); return '<main class="wrap"><p class="muted">Cargando…</p></main>'; }
  if (t.flujo) return `<main class="wrap">${vFlujo()}</main>`;
  const { todas } = estado(), h = t.horas;
  const mis = h ? h.dias || [] : [];
  const tot = mis.reduce((s, d) => ({ horas: s.horas + Number(d.horas), al50: s.al50 + Number(d.al50), al100: s.al100 + Number(d.al100), tarde: s.tarde + (d.tarde ? 1 : 0) }), { horas: 0, al50: 0, al100: 0, tarde: 0 });
  const lista = todas.slice(0, 12).map(x => `<div class="li tj-li"><span class="t">${x.tipo === 'entrada' ? 'Entrada' : 'Salida'} · ${fHora(x.cuando)} h</span>
      ${x.pendiente ? '<span class="chip warn">Esperando señal</span>' : x.verificada === false ? '<span class="chip warn">En revisión</span>' : '<span class="chip ok">Registrada</span>'}
      <span class="s">${fechaCorta(x.cuando)}${x.obra_id && obraNom(x.obra_id) ? ' · ' + esc(obraNom(x.obra_id)) : ''}${x.modo === 'reloj' ? ' · reloj del obrador' : x.modo === 'qr' ? ' · QR de la obra' : x.modo === 'manual' ? ' · cargada por el supervisor' : ''}</span></div>`).join('');
  return `<main class="wrap"><section><p class="eyebrow">${esc(fechaLarga())}</p><h1>Hola, ${esc(S.m.nombre.split(' ')[0])}</h1></section>
    ${vFranja(true)}
    ${h ? `<section class="card"><h2>Esta quincena</h2><p class="small muted">Del ${ddmm(h.desde)} al ${ddmm(h.hasta)}. Lo que ve la administración para tu sueldo.</p>
      <div class="kpis"><div class="kpi"><b>${fH(tot.horas)}</b><span>Trabajadas</span></div><div class="kpi"><b>${fH(tot.al50)}</b><span>Extras al 50 %</span></div>
      <div class="kpi"><b>${fH(tot.al100)}</b><span>Extras al 100 %</span></div><div class="kpi"><b>${(h.ausencias || []).length}</b><span>Días sin marcar</span></div></div></section>` : ''}
    <h2>Tus últimas marcaciones</h2>${lista ? `<div class="list">${lista}</div>` : '<div class="empty">Todavía no marcaste. Tu historial va a aparecer acá.</div>'}</main>`;
}
const fechaCorta = v => { const d = new Date(v); return dayKey(d) === dayKey(new Date()) ? 'Hoy' : `${DIAS[d.getDay()]} ${fFecha(d).slice(0, 5)}`; };

/* ================================================================ reloj del obrador (kiosco) */
const R = () => (S.rl ||= { obra: ls.get('co_reloj_obra_' + S.m.id, ''), legajo: '', pin: '', ocupado: false, err: '', res: null, ult: ls.get('co_reloj_ult_' + S.m.id, []), obras: null, pedirFoto: true });
export async function cargarReloj() {
  const r = R();
  const [ob, aj] = await Promise.all([sb.from('obras').select('id, nombre').eq('empresa_id', E()).eq('activa', true).order('nombre'), sb.from('ajustes_asistencia').select('pedir_foto').eq('empresa_id', E()).maybeSingle()]);
  if (!ob.error) { r.obras = ob.data; ls.set('co_reloj_obras_' + E(), ob.data); } else r.obras = ls.get('co_reloj_obras_' + E(), []);
  if (!aj.error) r.pedirFoto = aj.data ? aj.data.pedir_foto : true;
  render();
}
let relojT = null;
export function vReloj() {
  const r = R();
  if (!r.obras) { una('reloj', cargarReloj); return '<main class="wrap"><p class="muted">Preparando el reloj…</p></main>'; }
  clearInterval(relojT); relojT = setInterval(() => { const el = $('#rl-hora'); if (el) el.textContent = fHora(new Date()); else clearInterval(relojT); }, 15000);
  const obra = r.obras.find(o => o.id === r.obra);
  if (!obra || r.elegir) return `<main class="wrap"><section class="card"><p class="eyebrow">Reloj del obrador</p><h1>¿En qué obra queda este teléfono?</h1>
      <p class="muted">Todas las marcaciones de este reloj se cargan a esa obra. Se puede cambiar después.</p>
      <div class="list">${r.obras.map(o => `<button class="li" data-act="rlObra" data-id="${o.id}"><span class="t">${esc(o.nombre)}</span></button>`).join('') || '<div class="empty">No hay obras activas. Cargalas en el panel.</div>'}</div></section></main>`;
  if (r.res) return `<main class="wrap rl"><section class="rl-res ${r.res.ok ? (r.res.tipo === 'entrada' ? 'ok' : 'sal') : 'bad'}" role="status">
      <b>${r.res.ok ? (r.res.tipo === 'entrada' ? 'Entrada' : 'Salida') : 'No se pudo marcar'}</b>
      <span class="rl-nom">${esc(r.res.nombre || '')}</span><span>${esc(r.res.texto)}</span>
      <button class="btn" data-act="rlListo">Listo</button></section></main>`;
  return `<main class="wrap rl"><section class="rl-cab"><span class="eyebrow">Reloj del obrador · ${esc(obra.nombre)}</span><b id="rl-hora" class="rl-hora">${fHora(new Date())}</b><span class="muted">${esc(fechaLarga())}</span></section>
    <form class="card rl-form" data-form="reloj" novalidate>
      <label class="f">Legajo<input class="inp rl-inp" id="rl-leg" data-rl="legajo" value="${esc(r.legajo)}" autocapitalize="none" autocomplete="off" enterkeyhint="next"></label>
      <label class="f">PIN<input class="inp num pin rl-inp" id="rl-pin" data-rl="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" value="${esc(r.pin)}"></label>
      ${r.err ? `<p class="err" role="alert">${esc(r.err)}</p>` : ''}
      <button class="btn primary block rl-btn" type="submit" ${r.ocupado ? 'disabled' : ''}>${r.ocupado ? 'Marcando…' : r.pedirFoto ? 'Sacar foto y marcar' : 'Marcar entrada o salida'}</button></form>
    <p class="hint">Cada persona marca con su legajo y su PIN: el mismo con el que entra a Operapto. La app sabe si es entrada o salida.</p>
    ${r.ult.length ? `<section class="card"><h2>Últimas en este reloj</h2><div>${r.ult.slice(0, 5).map(x => `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${esc(x.nombre)}</div><div class="s">${x.tipo === 'entrada' ? 'Entrada' : 'Salida'} · ${fHora(x.cuando)} h</div></div>${x.pendiente ? '<span class="chip warn">Sin señal</span>' : '<span class="chip ok">OK</span>'}</div>`).join('')}</div></section>` : ''}
    <div class="row"><button class="btn sm ghost" data-act="rlCambiarObra">Cambiar de obra</button></div></main>`;
}
// Campo de la foto fuera de la pantalla que se redibuja: si la vista se actualiza con la cámara abierta, la foto no se pierde.
function campoFoto() {
  let i = document.getElementById('rl-foto');
  if (!i) {
    i = Object.assign(document.createElement('input'), { type: 'file', id: 'rl-foto', accept: 'image/*', className: 'vh' });
    i.setAttribute('capture', 'user'); i.addEventListener('change', () => alArchivoReloj(i)); document.body.append(i);
  }
  return i;
}
// Validar legajo y PIN antes de abrir la cámara.
export function enviarReloj() {
  const r = R(); r.err = '';
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(r.legajo.trim())) { r.err = 'Escribí tu legajo.'; return render(); }
  if (!/^\d{6}$/.test(r.pin)) { r.err = 'El PIN tiene 6 números.'; return render(); }
  if (r.pedirFoto) { const i = campoFoto(); i.value = ''; i.click(); } else marcarReloj(null);
}
async function alArchivoReloj(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const r = R(), now = new Date(), obra = (r.obras || []).find(o => o.id === r.obra);
  try { marcarReloj(await comprimir(file, 900, 0.65, [`Operapto · Reloj · ${obra ? obra.nombre : ''}`, `Legajo ${r.legajo.trim()} · ${fFecha(now)} ${fHora(now)} h`])); }
  catch { r.err = 'No se pudo leer la foto. Probá de nuevo.'; render(); }
}
async function marcarReloj(foto) {
  const r = R(), id = uuid(), legajo = r.legajo.trim(), pin = r.pin, path = foto ? `${E()}/${S.user.id}/reloj-${id}.jpg` : null;
  const soltar = () => { const el = document.activeElement; if (el && el.blur) el.blur(); };   // la pantalla no se redibuja con un campo activo
  soltar(); r.ocupado = true; r.pin = ''; render();
  const fin = res => { soltar(); r.ocupado = false; r.res = res; r.legajo = ''; render(); setTimeout(() => { if (r.res === res) { r.res = null; render(); } }, res.ok ? 6000 : 9000); };
  const guardarLocal = async () => {
    if (!foto) return fin({ ok: false, texto: 'Sin señal: con el reloj sin foto no se puede marcar. Probá cuando vuelva la conexión.' });
    await cola.agregar({ id, tipo: 'marca_reloj', uid: S.user.id, empresa_id: E(), archivos: [{ path, blob: foto, tipo: 'image/jpeg' }],
      payload: { empresa_id: E(), obra_id: r.obra, legajo, sin_pin: true, foto_path: path, client_id: id, cuando: new Date().toISOString() } });
    r.ult.unshift({ nombre: 'Legajo ' + legajo, tipo: '', cuando: new Date().toISOString(), pendiente: true }); r.ult = r.ult.slice(0, 10); ls.set('co_reloj_ult_' + S.m.id, r.ult);
    fin({ ok: true, tipo: 'entrada', nombre: 'Legajo ' + legajo, texto: `Guardada sin señal a las ${fHora(new Date())}. Se envía sola cuando vuelva la conexión; el supervisor la confirma con la foto.` });
    sync();
  };
  try {
    if (foto) {
      const { error } = await sb.storage.from('evidencias').upload(path, foto, { contentType: 'image/jpeg', upsert: false });
      if (error) { if (/fetch|network/i.test(error.message)) return guardarLocal(); throw error; }
    }
    const { data, error } = await sb.functions.invoke('reloj', { body: { empresa_id: E(), obra_id: r.obra, legajo, pin, foto_path: path, client_id: id } });
    if (error) {
      let m = error.message; try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch { if (!error.context || !error.context.status) return guardarLocal(); }
      return fin({ ok: false, texto: m });
    }
    r.ult.unshift({ nombre: data.nombre, tipo: data.tipo, cuando: data.cuando }); r.ult = r.ult.slice(0, 10); ls.set('co_reloj_ult_' + S.m.id, r.ult);
    fin({ ok: true, tipo: data.tipo, nombre: data.nombre, texto: `${fHora(data.cuando)} h${data.obra ? ' · ' + data.obra : ''}${data.tipo === 'salida' ? ' · ¡Buen descanso!' : ''}` });
  } catch (e) {
    if (esErrorDeRed(e)) return guardarLocal();
    fin({ ok: false, texto: err(e) });
  }
}

/* ================================================================ panel: asistencia */
const P = () => S.adm;
// Carga perezosa desde la vista, sin repetir el pedido mientras está en curso.
const enCurso = new Set();
const una = (k, f) => { if (enCurso.has(k)) return; enCurso.add(k); setTimeout(() => f().finally(() => enCurso.delete(k)), 0); };
const AS = () => (P().as ||= { vista: 'hoy', obra: '', hoy: null, per: { ...quincena(), datos: null, abierto: null }, rev: null, man: null, anular: null, aj: null, busca: '' });
export function cargarAsistencia() { const s = AS(); ({ hoy: cargarHoy, periodo: cargarPeriodo, revisar: cargarRevisar, ajustes: cargarAjustes })[s.vista](); }
async function cargarHoy() {
  const s = AS(), h = dayKey(new Date());
  const [r, mk] = await Promise.all([sb.rpc('asistencia', { p_empresa: E(), p_desde: h, p_hasta: h }),
    sb.from('marcaciones').select('id', { count: 'exact', head: true }).eq('empresa_id', E()).eq('verificada', false).is('anulada_en', null)]);
  if (r.error) { toast(err(r.error)); s.hoy = { dias: [], ausencias: [], personas: [] }; } else s.hoy = r.data;
  s.nRevisar = mk.count || 0; render();
}
async function cargarPeriodo() {
  const s = AS(), p = s.per; p.datos = null; render();
  const { data, error } = await sb.rpc('asistencia', { p_empresa: E(), p_desde: p.desde, p_hasta: p.hasta });
  if (error) { toast(err(error)); p.datos = { dias: [], ausencias: [], personas: [], feriados: [] }; } else p.datos = data;
  render();
}
async function cargarRevisar() {
  const s = AS(), d = new Date(); d.setDate(d.getDate() - 31);
  const { data, error } = await sb.from('marcaciones').select('*, persona:miembros!marcaciones_miembro_id_fkey(nombre, legajo), obra:obras(nombre)')
    .eq('empresa_id', E()).eq('verificada', false).is('anulada_en', null).gte('cuando', d.toISOString()).order('cuando', { ascending: false }).limit(100);
  if (error) { toast(err(error)); s.rev = []; return render(); }
  s.rev = data; s.nRevisar = data.length;
  const paths = data.map(x => x.foto_path).filter(Boolean);
  s.fotos = {};
  if (paths.length) { const { data: u } = await sb.storage.from('evidencias').createSignedUrls(paths, 3600); (u || []).forEach(x => { if (x.signedUrl) s.fotos[x.path] = x.signedUrl; }); }
  render();
}
async function cargarAjustes() {
  const s = AS(), y = new Date().getFullYear();
  const [aj, fe, qr] = await Promise.all([sb.from('ajustes_asistencia').select('*').eq('empresa_id', E()).maybeSingle(),
    sb.from('feriados').select('*').eq('empresa_id', E()).gte('fecha', `${y}-01-01`).order('fecha'), sb.from('obras_qr').select('obra_id').eq('empresa_id', E())]);
  const def = { hora_entrada: '08:00', tolerancia_min: 10, horas_semana: 9, horas_sabado: 4, sabado_100_desde: '13:00', descanso_min: 0, radio_m: 300, pedir_foto: true };
  const v = aj.data || def;
  s.aj = { v: { ...v, hora_entrada: String(v.hora_entrada).slice(0, 5), sabado_100_desde: v.sabado_100_desde ? String(v.sabado_100_desde).slice(0, 5) : '' }, existe: !!aj.data, feriados: fe.data || [],
    conQr: (qr.data || []).map(x => x.obra_id), nuevoFer: { fecha: '', nombre: '' }, err: '' };
  render();
}

// Resumen por persona para el período (y para el Excel).
export function porPersona(x) {
  const m = new Map();
  for (const p of x.personas) m.set(p.id, { ...p, dias: 0, horas: 0, normales: 0, al50: 0, al100: 0, tarde: 0, ausencias: 0, incompletas: 0, revisar: 0, fechas: [] });
  for (const d of x.dias) { const p = m.get(d.miembro_id); if (!p) continue;
    p.fechas.push(d); if (Number(d.horas) > 0 || d.adentro) p.dias++;
    p.horas += Number(d.horas); p.normales += Number(d.normales); p.al50 += Number(d.al50); p.al100 += Number(d.al100);
    if (d.tarde) p.tarde++; if (d.incompleta) p.incompletas++; if (d.sin_verificar) p.revisar++; }
  for (const a of x.ausencias) { const p = m.get(a.miembro_id); if (p) { p.ausencias++; p.fechas.push({ fecha: a.fecha, ausente: true }); } }
  return [...m.values()].filter(p => p.fechas.length || p.controla).map(p => ({ ...p, fechas: p.fechas.sort((a, b) => a.fecha < b.fecha ? -1 : 1) }));
}

export function vAsistencia() {
  const s = AS(), a = P();
  if (s.cartel) return '';
  const sub = [['hoy', 'Hoy'], ['periodo', 'Horas para sueldos'], ['revisar', `Revisar${s.nRevisar ? ` (${s.nRevisar})` : ''}`], ['ajustes', 'Horarios, obras y relojes']]
    .map(([k, l]) => `<button class="tab ${s.vista === k ? 'on' : ''}" data-act="asVista" data-k="${k}">${l}</button>`).join('');
  const body = { hoy: vHoy, periodo: vPeriodo, revisar: vRevisar, ajustes: vAjustes }[s.vista]();
  return `<nav class="tabs sub no-print">${sub}</nav>${body}`;
}
const selObra = (id, k) => `<select class="inp" id="${id}" data-as="${k}" data-vivo><option value="">Todas las obras</option>${P().d.obras.filter(o => o.activa).map(o => `<option value="${o.id}" ${AS()[k] === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select>`;

function vHoy() {
  const s = AS(), x = s.hoy, a = P();
  if (!x) { una('hoy', cargarHoy); return '<p class="muted">Cargando…</p>'; }
  const nom = id => (x.personas.find(p => p.id === id) || {}).nombre || '—';
  const leg = id => (x.personas.find(p => p.id === id) || {}).legajo || '';
  const ob = id => (a.d.obras.find(o => o.id === id) || {}).nombre || '';
  const enObra = d => !s.obra || (d.obras || []).includes(s.obra);
  const asignado = id => !s.obra || a.d.asig.some(q => q.miembro_id === id && q.obra_id === s.obra);
  const dias = x.dias.filter(enObra);
  const adentro = dias.filter(d => d.adentro), salieron = dias.filter(d => !d.adentro);
  const aus = x.ausencias.filter(q => asignado(q.miembro_id));
  const tarde = dias.filter(d => d.tarde);
  const chips = d => `${d.tarde ? '<span class="chip warn">Llegó tarde</span>' : ''}${d.fuera ? '<span class="chip warn">Fuera de la obra</span>' : ''}${d.sin_verificar ? '<span class="chip warn">Revisar</span>' : ''}${d.incompleta ? '<span class="chip bad">Falta una marca</span>' : ''}`;
  const fila = (d, txt) => `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${esc(nom(d.miembro_id))} <span class="small muted">${esc(leg(d.miembro_id))}</span></div>
      <div class="s">${txt}${(d.obras || []).length ? ' · ' + (d.obras || []).map(o => esc(ob(o))).join(', ') : ''}</div></div><div class="row">${chips(d)}</div></div>`;
  const hora = new Date().getHours() * 60 + new Date().getMinutes(), [he, me] = (x.ajustes.hora_entrada || '08:00').split(':').map(Number);
  const yaEmpezo = hora > he * 60 + me + Number(x.ajustes.tolerancia_min || 0);
  return `<section class="card no-print"><div class="filters"><label>Obra${selObra('as-obra', 'obra')}</label></div></section>
    <div class="kpis"><div class="kpi"><b>${adentro.length}</b><span>Trabajando ahora</span></div><div class="kpi"><b>${salieron.length}</b><span>Ya se fueron</span></div>
      <div class="kpi"><b>${tarde.length}</b><span>Llegaron tarde (después de las ${esc(x.ajustes.hora_entrada)} + ${x.ajustes.tolerancia_min} min)</span></div>
      <div class="kpi"><b>${aus.length}</b><span>${yaEmpezo ? 'No vinieron' : 'Todavía no marcaron'}</span></div></div>
    ${s.nRevisar ? `<div class="warnbox small">Hay ${s.nRevisar} marcación${s.nRevisar === 1 ? '' : 'es'} para revisar (sin señal, fuera de la obra o del reloj sin PIN). <button class="linkbtn" data-act="asVista" data-k="revisar">Revisar</button></div>` : ''}
    <div class="cols"><section class="card"><h2>Trabajando ahora (${adentro.length})</h2>${adentro.length ? `<div>${adentro.map(d => fila(d, `Entró a las <b>${fHora(d.entrada)}</b>${d.ultima && d.ultima !== d.entrada ? ` · volvió a las ${fHora(d.ultima)}` : ''}`)).join('')}</div>` : '<p class="muted">Nadie marcó entrada todavía.</p>'}</section>
      <section class="card"><h2>${yaEmpezo ? 'No vinieron' : 'Todavía no marcaron'} (${aus.length})</h2>${aus.length ? `<div>${aus.map(q => `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${esc(nom(q.miembro_id))} <span class="small muted">${esc(leg(q.miembro_id))}</span></div></div>
          <button class="btn sm ghost" data-act="asManual" data-id="${q.miembro_id}">Cargar a mano</button></div>`).join('')}</div>` : '<p class="muted">Vinieron todos.</p>'}
        ${s.obra ? '<p class="small muted">Con una obra elegida, se muestran los ausentes que tienen esa obra asignada.</p>' : ''}</section></div>
    ${salieron.length ? `<section class="card"><h2>Ya se fueron (${salieron.length})</h2><div>${salieron.map(d => fila(d, `${d.entrada ? fHora(d.entrada) : '—'} a ${d.salida ? fHora(d.salida) : '—'} · <b>${fH(d.horas)}</b>`)).join('')}</div></section>` : ''}
    ${vManual()}`;
}

function vPeriodo() {
  const s = AS(), p = s.per, x = p.datos;
  const atajos = [['q', 'Esta quincena', quincena()], ['qa', 'Quincena anterior', quincena('anterior')], ['m', 'Este mes', mes()], ['ma', 'Mes anterior', mes('anterior')]];
  const filtros = `<section class="card no-print"><div class="filters"><label>Desde<input class="inp" type="date" id="as-des" data-asp="desde" data-vivo value="${p.desde}"></label>
      <label>Hasta<input class="inp" type="date" id="as-has" data-asp="hasta" data-vivo value="${p.hasta}"></label></div>
    <div class="row">${atajos.map(([k, l, r]) => `<button class="btn sm ${p.desde === r.desde && p.hasta === r.hasta ? 'dark' : 'ghost'}" data-act="asAtajo" data-k="${k}">${l}</button>`).join('')}
      <button class="btn sm primary" data-act="asExcel" ${!x || s.excel ? 'disabled' : ''}>${s.excel ? 'Armando el Excel…' : 'Excel para sueldos'}</button><button class="btn sm ghost" data-act="asImprimir">Imprimir / PDF</button></div></section>`;
  if (!x) { una('per', cargarPeriodo); return filtros + '<p class="muted">Calculando…</p>'; }
  const ps = porPersona(x), q = normal(s.busca).trim();
  const tot = ps.reduce((t, r) => ({ horas: t.horas + r.horas, al50: t.al50 + r.al50, al100: t.al100 + r.al100, aus: t.aus + r.ausencias }), { horas: 0, al50: 0, al100: 0, aus: 0 });
  const det = r => `<tr class="det"><td colspan="9"><div class="tabla"><table><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th class="n">Horas</th><th class="n">Normales</th><th class="n">50 %</th><th class="n">100 %</th><th></th></tr></thead><tbody>
      ${r.fechas.map(d => d.ausente ? `<tr><td>${diaSem(d.fecha)} ${ddmm(d.fecha)}</td><td colspan="6"><span class="chip bad">Ausente</span></td><td class="no-print"><button class="btn sm ghost" data-act="asManual" data-id="${r.id}" data-f="${d.fecha}">Cargar a mano</button></td></tr>`
        : `<tr><td>${diaSem(d.fecha)} ${ddmm(d.fecha)}</td><td>${d.entrada ? fHora(d.entrada) : '—'}</td><td>${d.salida ? fHora(d.salida) : d.adentro ? 'trabajando' : '—'}</td><td class="n">${fH(d.horas)}</td><td class="n">${fH(d.normales)}</td><td class="n">${fH(d.al50)}</td><td class="n">${fH(d.al100)}</td>
          <td>${d.tarde ? '<span class="chip warn">Tarde</span>' : ''}${d.incompleta ? '<span class="chip bad">Falta una marca</span>' : ''}${d.sin_verificar ? '<span class="chip warn">Revisar</span>' : ''} <button class="btn sm ghost no-print" data-act="asVerDia" data-id="${r.id}" data-f="${d.fecha}">Marcas</button></td></tr>`).join('')}</tbody></table></div>
      ${s.dia && s.dia.id === r.id ? vMarcasDia() : ''}</td></tr>`;
  const filas = ps.map(r => { const dq = normal(`${r.nombre} ${r.legajo || ''}`), ab = p.abierto === r.id;
    return `<tr data-q="${esc(dq)}" ${q && !dq.includes(q) ? 'hidden' : ''}><td data-l="Persona"><button class="linkbtn" data-act="asAbrir" data-id="${r.id}"><b>${esc(r.nombre)}</b></button> <span class="small muted">${esc(r.legajo || '')} · ${esc(ROL_TXT[r.rol] || r.rol)}</span></td>
      <td class="n" data-l="Días">${r.dias}</td><td class="n" data-l="Horas"><b>${fH(r.horas)}</b></td><td class="n" data-l="Normales">${fH(r.normales)}</td><td class="n" data-l="Al 50 %">${fH(r.al50)}</td><td class="n" data-l="Al 100 %">${fH(r.al100)}</td>
      <td class="n" data-l="Tarde">${r.tarde || '—'}</td><td class="n" data-l="Ausencias">${r.ausencias ? `<b class="txt-bad">${r.ausencias}</b>` : '—'}</td>
      <td data-l="">${r.incompletas ? `<span class="chip bad">${r.incompletas} sin cerrar</span>` : ''}${r.revisar ? `<span class="chip warn">${r.revisar} a revisar</span>` : ''}</td></tr>${ab ? det(r) : ''}`; }).join('');
  return `<section class="solo-print"><p class="eyebrow">Asistencia · ${esc(S.m.empresa.nombre)}</p><h1>Horas del ${ddmm(p.desde)} al ${ddmm(p.hasta)}</h1></section>${filtros}
    <div class="kpis"><div class="kpi"><b>${fH(tot.horas)}</b><span>Horas trabajadas</span></div><div class="kpi"><b>${fH(tot.al50)}</b><span>Extras al 50 %</span></div>
      <div class="kpi"><b>${fH(tot.al100)}</b><span>Extras al 100 %</span></div><div class="kpi"><b>${tot.aus}</b><span>Ausencias</span></div></div>
    <section class="card"><div class="row" style="justify-content:space-between"><h2>Por persona (${ps.length})</h2><input class="inp no-print" id="as-busca" type="search" data-buscar=".as-tabla tr[data-q]" placeholder="Buscar por nombre o legajo" value="${esc(s.busca)}" style="flex:0 1 260px"></div>
      <p class="small muted">Lunes a viernes: ${fHd(x.ajustes.horas_semana)} h normales y el resto al 50 %. Sábado: ${fHd(x.ajustes.horas_sabado)} h normales${x.ajustes.sabado_100_desde ? `, desde las ${x.ajustes.sabado_100_desde} al 100 %` : ''}. Domingos y feriados, al 100 %.${x.ajustes.descanso_min ? ` Se descuentan ${x.ajustes.descanso_min} min de almuerzo a quien no marcó la salida del mediodía.` : ''} <span class="no-print">Se cambia en "Horarios, obras y relojes".</span>${x.feriados.length ? ` Feriados del período: ${x.feriados.map(f => `${ddmm(f.fecha)} (${esc(f.nombre)})`).join(', ')}.` : ''}</p>
      ${ps.length ? `<div class="tabla tabla-cel as-tabla"><table><thead><tr><th>Persona</th><th class="n">Días</th><th class="n">Horas</th><th class="n">Normales</th><th class="n">Al 50 %</th><th class="n">Al 100 %</th><th class="n">Tarde</th><th class="n">Ausencias</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : '<div class="empty">No hay marcaciones en el período.</div>'}
      <p class="muted small" data-sin-resultados hidden>Nadie coincide con la búsqueda.</p></section>${vManual()}`;
}

function vMarcasDia() {
  const s = AS(), d = s.dia;
  if (!d.lista) return '<p class="muted small">Cargando marcas…</p>';
  return `<div class="movs">${d.lista.map(m => `<div class="mov"><span class="small muted">${fHora(m.cuando)} h</span><span>${m.tipo === 'entrada' ? 'Entrada' : 'Salida'} · ${{ reloj: 'reloj del obrador', celular: 'celular', qr: 'QR de la obra', manual: 'cargada a mano' }[m.modo]}${m.obra ? ' · ' + esc(m.obra.nombre) : ''}${m.observacion ? ' · ' + esc(m.observacion) : ''}${m.anulada_en ? ` · <b class="txt-bad">anulada: ${esc(m.motivo_anulacion)}</b>` : ''}</span>
      <span>${!m.anulada_en ? (s.anular && s.anular.id === m.id ? `<span class="row"><input class="inp" id="as-anu" data-asa="motivo" value="${esc(s.anular.motivo)}" placeholder="Motivo" style="width:160px"><button class="btn sm primary" data-act="asAnularOk">Anular</button></span>` : `<button class="btn sm ghost" data-act="asAnular" data-id="${m.id}">Anular</button>`) : ''}</span></div>`).join('') || '<p class="muted small">Sin marcas ese día.</p>'}
    <div class="row"><button class="btn sm ghost" data-act="asManual" data-id="${d.id}" data-f="${d.fecha}">Agregar una marca</button></div></div>`;
}

function vManual() {
  const s = AS(), f = s.man; if (!f) return '';
  const pers = (P().d.miembros || []).filter(m => m.activo && m.rol !== 'reloj');
  return `<section class="card" id="as-man"><h2>Cargar una marcación a mano</h2><p class="small muted">Para cuando alguien se olvidó de marcar o no tenía el celular. Queda en la auditoría con tu nombre y el motivo.</p>
    <div class="form-grid"><label class="f">Persona<select class="inp" id="am-per" data-am="miembro"><option value="">Elegí</option>${pers.map(m => `<option value="${m.id}" ${f.miembro === m.id ? 'selected' : ''}>${esc(m.nombre)}${m.legajo ? ' · ' + esc(m.legajo) : ''}</option>`).join('')}</select></label>
      <label class="f">Tipo<select class="inp" id="am-tipo" data-am="tipo"><option value="entrada" ${f.tipo === 'entrada' ? 'selected' : ''}>Entrada</option><option value="salida" ${f.tipo === 'salida' ? 'selected' : ''}>Salida</option></select></label>
      <label class="f">Día<input class="inp" type="date" id="am-dia" data-am="dia" value="${f.dia}"></label><label class="f">Hora<input class="inp" type="time" id="am-hora" data-am="hora" value="${f.hora}"></label>
      <label class="f">Obra<select class="inp" id="am-obra" data-am="obra"><option value="">Sin obra</option>${P().d.obras.filter(o => o.activa).map(o => `<option value="${o.id}" ${f.obra === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
      <label class="f">Motivo<input class="inp" id="am-mot" data-am="motivo" value="${esc(f.motivo)}" placeholder="Ej.: se olvidó el celular" maxlength="200"></label></div>
    ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="asManualCancelar">Cancelar</button><button class="btn sm primary" data-act="asManualOk" ${f.ocupado ? 'disabled' : ''}>Guardar</button></div></section>`;
}

function vRevisar() {
  const s = AS();
  if (!s.rev) { una('rev', cargarRevisar); return '<p class="muted">Cargando…</p>'; }
  return `<section class="card"><h2>Marcaciones para revisar (${s.rev.length})</h2>
    <p class="small muted">Las que se marcaron sin señal (vale la hora del teléfono), fuera de la obra, o en el reloj sin poder comprobar el PIN. Mirá la foto: si está bien, confirmala; si no, anulala con el motivo. Hasta que la revises, la hora cuenta igual en el período.</p>
    ${s.rev.length ? `<div class="rev-grid">${s.rev.map(m => `<div class="rev">${m.foto_path && s.fotos[m.foto_path] ? `<a href="${s.fotos[m.foto_path]}" target="_blank" rel="noopener"><img src="${s.fotos[m.foto_path]}" alt="Foto de ${esc(m.persona && m.persona.nombre)}" loading="lazy"></a>` : '<div class="rev-sin">Sin foto</div>'}
        <div><b>${esc(m.persona ? m.persona.nombre : '—')}</b> <span class="small muted">${esc(m.persona && m.persona.legajo || '')}</span>
          <div class="small">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'} · ${fFecha(m.cuando)} ${fHora(m.cuando)} h${m.obra ? ' · ' + esc(m.obra.nombre) : ''}</div>
          <div class="small muted">${esc(m.observacion || '')}${m.lat != null ? ` · <a href="https://www.google.com/maps?q=${m.lat},${m.lng}" target="_blank" rel="noopener">ver en el mapa</a>` : ''}</div>
          <div class="row">${s.anular && s.anular.id === m.id ? `<input class="inp" id="as-anu" data-asa="motivo" value="${esc(s.anular.motivo)}" placeholder="Motivo de la anulación" style="flex:1 1 160px"><button class="btn sm" data-act="asAnularCancelar">Cancelar</button><button class="btn sm primary" data-act="asAnularOk">Anular</button>`
            : `<button class="btn sm primary" data-act="asValidar" data-id="${m.id}">Está bien</button><button class="btn sm ghost" data-act="asAnular" data-id="${m.id}">Anular</button>`}</div></div></div>`).join('')}</div>` : '<div class="empty">No hay nada para revisar.</div>'}</section>`;
}

function vAjustes() {
  const s = AS(), a = P(), adm = esAdmin();
  if (!s.aj) { una('aj', cargarAjustes); return '<p class="muted">Cargando…</p>'; }
  const v = s.aj.v, dis = adm ? '' : 'disabled';
  const relojes = a.d.miembros.filter(m => m.rol === 'reloj');
  const y = new Date().getFullYear();
  const obras = a.d.obras.filter(o => o.activa).map(o => `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${esc(o.nombre)}</div>
      <div class="s">${o.lat != null ? `Ubicación cargada · radio ${o.radio_m || v.radio_m} m · <a href="https://www.google.com/maps?q=${o.lat},${o.lng}" target="_blank" rel="noopener">ver</a>` : 'Sin ubicación: no se controla si marcan desde la obra'}</div>
      ${s.ubic && s.ubic.id === o.id ? `<div class="row"><input class="inp num" id="ub-lat" data-ub="lat" value="${esc(s.ubic.lat)}" placeholder="Latitud" style="width:130px"><input class="inp num" id="ub-lng" data-ub="lng" value="${esc(s.ubic.lng)}" placeholder="Longitud" style="width:130px">
        <input class="inp num" id="ub-rad" data-ub="radio" type="number" value="${esc(s.ubic.radio)}" placeholder="Radio (m)" style="width:110px"><button class="btn sm ghost" data-act="asUbicAqui">Estoy en la obra</button><button class="btn sm" data-act="asUbicCancelar">Cancelar</button><button class="btn sm primary" data-act="asUbicOk">Guardar</button></div>` : ''}</div>
      <div class="row"><button class="btn sm ghost" data-act="asUbic" data-id="${o.id}">Ubicación</button><button class="btn sm" data-act="asCartel" data-id="${o.id}">Cartel QR</button>
        ${s.aj.conQr.includes(o.id) ? `<button class="btn sm ghost" data-act="asRenovarQr" data-id="${o.id}">${a.confirm === 'qr' + o.id ? 'Tocá de nuevo: el cartel viejo deja de servir' : 'Renovar QR'}</button>` : ''}</div></div>`).join('');
  return `<div class="cols"><section class="card"><h2>Horario</h2>${adm ? '' : '<p class="small muted">Solo el dueño o administración puede cambiarlo.</p>'}
      <div class="form-grid"><label class="f">Hora de entrada<input class="inp" type="time" id="aj-he" data-aj="hora_entrada" value="${esc(v.hora_entrada)}" ${dis}></label>
        <label class="f">Tolerancia <small>Minutos antes de contar como tarde</small><input class="inp num" type="number" id="aj-tol" data-aj="tolerancia_min" value="${esc(v.tolerancia_min)}" ${dis}></label>
        <label class="f">Horas normales de lunes a viernes<input class="inp num" type="number" step="0.5" id="aj-hs" data-aj="horas_semana" value="${esc(v.horas_semana)}" ${dis}></label>
        <label class="f">Horas normales del sábado<input class="inp num" type="number" step="0.5" id="aj-sab" data-aj="horas_sabado" value="${esc(v.horas_sabado)}" ${dis}></label>
        <label class="f">Sábado al 100 % desde <small>Vacío: no aplica</small><input class="inp" type="time" id="aj-s100" data-aj="sabado_100_desde" value="${esc(v.sabado_100_desde)}" ${dis}></label>
        <label class="f">Descuento de almuerzo <small>Minutos, si no marcó la salida del mediodía</small><input class="inp num" type="number" id="aj-des" data-aj="descanso_min" value="${esc(v.descanso_min)}" ${dis}></label>
        <label class="f">Radio de la obra <small>Metros, si la obra no tiene uno propio</small><input class="inp num" type="number" id="aj-rad" data-aj="radio_m" value="${esc(v.radio_m)}" ${dis}></label></div>
      <label class="check"><input type="checkbox" id="aj-foto" data-aj="pedir_foto" ${v.pedir_foto ? 'checked' : ''} ${dis}><span>Pedir foto al marcar (recomendado: evita que uno marque por otro)</span></label>
      ${s.aj.err ? `<p class="err">${esc(s.aj.err)}</p>` : ''}${adm ? '<div class="row"><button class="btn sm primary" data-act="asAjGuardar">Guardar horario</button></div>' : ''}
      <h2>Feriados</h2><p class="small muted">Se pagan al 100 % y no cuentan como ausencia.</p>
      <div>${s.aj.feriados.map(f => `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${diaSem(f.fecha)} ${f.fecha.split('-').reverse().join('/')}</div><div class="s">${esc(f.nombre)}</div></div>${adm ? `<button class="btn sm ghost" data-act="asFerBorrar" data-f="${f.fecha}">Quitar</button>` : ''}</div>`).join('') || '<p class="muted small">Sin feriados cargados.</p>'}</div>
      ${adm ? `<div class="row"><input class="inp" type="date" id="fer-f" data-fer="fecha" value="${esc(s.aj.nuevoFer.fecha)}" style="width:170px"><input class="inp" id="fer-n" data-fer="nombre" value="${esc(s.aj.nuevoFer.nombre)}" placeholder="Nombre del feriado" style="flex:1 1 160px"><button class="btn sm dark" data-act="asFerAgregar">Agregar</button></div>
        <div class="row"><button class="btn sm ghost" data-act="asFerFijos" data-y="${y}">Feriados fijos de ${y}</button><button class="btn sm ghost" data-act="asFerFijos" data-y="${y + 1}">Feriados fijos de ${y + 1}</button></div>
        <p class="small muted">Carga los nacionales de fecha fija. Carnaval, Semana Santa y los trasladables cambian cada año: agregalos a mano.</p>` : ''}</section>
    <div class="stack"><section class="card"><h2>Obras: ubicación y QR</h2><p class="small muted">Con la ubicación, Operapto avisa si alguien marca desde el celular lejos de la obra. El cartel QR se imprime y se pega en el obrador: quien lo escanea marca en esa obra.</p>
      <div>${obras || '<p class="muted">No hay obras activas.</p>'}</div></section>
      <section class="card"><h2>Relojes del obrador (${relojes.length})</h2><p class="small muted">Un teléfono o tablet que queda fijo en el obrador: cada persona marca con su legajo y su PIN, y el reloj le saca una foto. Sirve para quien no tiene celular.</p>
        ${relojes.map(m => `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${esc(m.nombre)}</div><div class="s">Entra con ${esc(S.m.empresa.slug)} · legajo ${esc(m.legajo || '')}</div></div>${m.activo ? '<span class="chip ok">Activo</span>' : '<span class="chip">Inactivo</span>'}</div>`).join('')}
        <ol class="small"><li>En <button class="linkbtn" data-act="admTab" data-k="personal">Personal y obras</button>, dá de alta a una persona con el rol <b>Reloj del obrador</b> (por ejemplo, legajo RELOJ1).</li><li>En el teléfono del obrador, abrí Operapto y entrá como operario con ese legajo y PIN.</li><li>Elegí la obra y dejalo cargando, a la vista.</li></ol></section></div></div>`;
}

export function vCartel() {
  const c = AS().cartel; if (!c) return '';
  return `<main class="wrap etiquetas-pag"><div class="row no-print" style="justify-content:space-between"><div><h1>Cartel QR · ${esc(c.obra.nombre)}</h1><p class="muted">Imprimilo en A4 y pegalo en el obrador, a la altura de la vista. Si se pierde o lo fotografían para marcar desde otro lado, renovalo: el viejo deja de servir.</p></div>
      <div class="row"><button class="btn" data-act="asCartelCerrar">Volver</button><button class="btn primary" data-act="etqImprimir">Imprimir</button></div></div>
    <div class="cartel"><span class="etq-marca">Operapto · Tarjetero</span><h1>${esc(c.obra.nombre)}</h1><div class="cartel-qr">${qrSvg(urlMarcar(c.token))}</div>
      <p class="cartel-ins">Al llegar y al irte, escaneá este código con la cámara del celular y marcá tu entrada o salida.</p><p class="small">${esc(S.m.empresa.nombre)}</p></div></main>`;
}

const FIJOS = [['01-01', 'Año Nuevo'], ['03-24', 'Día de la Memoria por la Verdad y la Justicia'], ['04-02', 'Día del Veterano y de los Caídos en Malvinas'], ['05-01', 'Día del Trabajador'],
  ['05-25', 'Revolución de Mayo'], ['06-20', 'Paso a la Inmortalidad del Gral. Belgrano'], ['07-09', 'Día de la Independencia'], ['12-08', 'Inmaculada Concepción de María'], ['12-25', 'Navidad']];

async function libroExcel() {
  const s = AS(), p = s.per, x = p.datos;
  const { excelJS, encabezadoExcel, bordeExcel } = await import('./excel.js');
  const ExcelJS = await excelJS(), wb = new ExcelJS.Workbook(); wb.creator = 'Operapto'; wb.created = new Date();
  const per = `Del ${p.desde.split('-').reverse().join('/')} al ${p.hasta.split('-').reverse().join('/')}`, gen = `Generado el ${new Date().toLocaleString('es-AR')} por Operapto`;
  const xl = v => { if (!v) return null; const d = new Date(v); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())); };
  const fechaXl = f => new Date(f + 'T00:00:00Z');
  const hoja = (nombre, tit, cols, filas) => {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.getCell('A1').value = tit; ws.getCell('A1').font = { bold: true, size: 16 }; ws.getCell('A2').value = `${S.m.empresa.nombre} · ${per}`; ws.getCell('A3').value = gen;
    encabezadoExcel(ws, 4, cols);
    filas.forEach((f, i) => { const r = ws.getRow(5 + i); r.values = f; r.eachCell(c => { c.border = bordeExcel; }); });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + Math.max(1, filas.length), column: cols.length } };
    return ws;
  };
  const ps = porPersona(x), H = '#,##0.00';
  const ws = hoja('Resumen para sueldos', 'Horas para sueldos', [{ t: 'Legajo', w: 10 }, { t: 'Nombre', w: 28 }, { t: 'Rol', w: 16 }, { t: 'Días trabajados', w: 11, n: 1 }, { t: 'Horas trabajadas', w: 12, n: 1, f: H },
    { t: 'Horas normales', w: 12, n: 1, f: H }, { t: 'Extras al 50 %', w: 12, n: 1, f: H }, { t: 'Extras al 100 %', w: 12, n: 1, f: H }, { t: 'Llegadas tarde', w: 10, n: 1 }, { t: 'Ausencias', w: 10, n: 1 }, { t: 'Días sin cerrar', w: 10, n: 1 }, { t: 'Marcas a revisar', w: 10, n: 1 }],
    ps.map(r => [r.legajo || '', r.nombre, ROL_TXT[r.rol] || r.rol, r.dias, +r.horas.toFixed(2), +r.normales.toFixed(2), +r.al50.toFixed(2), +r.al100.toFixed(2), r.tarde, r.ausencias, r.incompletas, r.revisar]));
  const tr = ws.getRow(5 + ps.length); tr.values = ['', 'Total', '', null, ...[5, 6, 7, 8].map(c => ({ formula: `SUM(${String.fromCharCode(64 + c)}5:${String.fromCharCode(64 + c)}${4 + ps.length})` }))]; tr.font = { bold: true };
  ws.getCell(`A${7 + ps.length}`).value = `Reglas: lunes a viernes ${x.ajustes.horas_semana} h normales y el resto al 50 %; sábado ${x.ajustes.horas_sabado} h normales${x.ajustes.sabado_100_desde ? `, desde las ${x.ajustes.sabado_100_desde} al 100 %` : ''}; domingos y feriados al 100 %.`;
  const nom = id => x.personas.find(p => p.id === id) || {};
  const ob = id => (P().d.obras.find(o => o.id === id) || {}).nombre || '';
  hoja('Detalle por día', 'Detalle por día', [{ t: 'Fecha', w: 11, f: 'dd/mm/yyyy' }, { t: 'Día', w: 6 }, { t: 'Legajo', w: 10 }, { t: 'Nombre', w: 26 }, { t: 'Entrada', w: 8, f: 'hh:mm' }, { t: 'Salida', w: 8, f: 'hh:mm' },
    { t: 'Horas', w: 9, n: 1, f: H }, { t: 'Normales', w: 9, n: 1, f: H }, { t: 'Al 50 %', w: 9, n: 1, f: H }, { t: 'Al 100 %', w: 9, n: 1, f: H }, { t: 'Observaciones', w: 34 }, { t: 'Obras', w: 28 }],
    x.dias.map(d => [fechaXl(d.fecha), diaSem(d.fecha), nom(d.miembro_id).legajo || '', nom(d.miembro_id).nombre || '', xl(d.entrada), xl(d.salida), +d.horas, +d.normales, +d.al50, +d.al100,
      [d.tarde && 'Llegó tarde', d.incompleta && 'Falta una marca', d.adentro && 'Sigue trabajando', d.sin_verificar && 'Marca a revisar', d.fuera && 'Marcó fuera de la obra'].filter(Boolean).join(' · '), (d.obras || []).map(ob).join(', ')]));
  hoja('Ausencias', 'Ausencias', [{ t: 'Fecha', w: 11, f: 'dd/mm/yyyy' }, { t: 'Día', w: 6 }, { t: 'Legajo', w: 10 }, { t: 'Nombre', w: 28 }],
    x.ausencias.map(a => [fechaXl(a.fecha), diaSem(a.fecha), nom(a.miembro_id).legajo || '', nom(a.miembro_id).nombre || '']));
  const buf = await wb.xlsx.writeBuffer();
  descargar(`operapto-${S.m.empresa.slug}-asistencia-${p.desde}-al-${p.hasta}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* ================================================================ acciones */
export const A = {
  // celular propio
  tjMarcar: b => abrirFlujo(b.dataset.k),
  tjCancelar: () => { const t = T(); if (t.flujo && t.flujo.fotoUrl) URL.revokeObjectURL(t.flujo.fotoUrl); t.flujo = null; render(); },
  tjGps: tomarGps,
  tjConfirmar: () => confirmar().catch(e => { const f = T().flujo; if (f) { f.ocupado = false; f.err = err(e); render(); } else toast(err(e)); }),
  tjDescartar: async b => { await cola.borrar(b.dataset.id); sync(); cargarMio(); },
  // reloj
  rlObra: b => { const r = R(); r.obra = b.dataset.id; r.elegir = false; ls.set('co_reloj_obra_' + S.m.id, r.obra); render(); },
  rlCambiarObra: () => { R().elegir = true; render(); },
  rlListo: () => { R().res = null; render(); setTimeout(() => { const i = $('#rl-leg'); i && i.focus(); }, 50); },
  // panel
  asVista: b => { const s = AS(); s.vista = b.dataset.k; s.man = null; s.anular = null; s.dia = null; if (s.vista === 'revisar') s.rev = null; if (s.vista === 'ajustes') s.aj = null; if (s.vista === 'hoy') s.hoy = null; render(); cargarAsistencia(); },
  asAtajo: b => { const p = AS().per; Object.assign(p, { q: quincena(), qa: quincena('anterior'), m: mes(), ma: mes('anterior') }[b.dataset.k]); p.abierto = null; cargarPeriodo(); },
  asAbrir: b => { const p = AS().per; p.abierto = p.abierto === b.dataset.id ? null : b.dataset.id; AS().dia = null; render(); },
  asVerDia: async b => {
    const s = AS(); if (s.dia && s.dia.id === b.dataset.id && s.dia.fecha === b.dataset.f) { s.dia = null; return render(); }
    s.dia = { id: b.dataset.id, fecha: b.dataset.f, lista: null }; render();
    const d0 = new Date(b.dataset.f + 'T00:00:00-03:00'), d1 = new Date(d0.getTime() + 864e5);
    const { data } = await sb.from('marcaciones').select('*, obra:obras(nombre)').eq('miembro_id', b.dataset.id).gte('cuando', d0.toISOString()).lt('cuando', d1.toISOString()).order('cuando');
    if (s.dia) { s.dia.lista = data || []; render(); }
  },
  asExcel: async () => { const s = AS(); s.excel = true; render(); try { await libroExcel(); } catch (e) { toast('No se pudo armar el Excel: ' + err(e), 6000); } s.excel = false; render(); },
  asImprimir: () => print(),
  asManual: b => {
    const s = AS(), ahora = new Date();
    s.man = { miembro: b.dataset.id || '', tipo: 'entrada', dia: b.dataset.f || dayKey(ahora), hora: b.dataset.f ? (s.hoy && s.hoy.ajustes ? s.hoy.ajustes.hora_entrada : '08:00') : fHora(ahora), obra: '', motivo: '', err: '' };
    render(); setTimeout(() => { const el = $('#as-man'); el && el.scrollIntoView({ block: 'center' }); }, 30);
  },
  asManualCancelar: () => { AS().man = null; render(); },
  asManualOk: async () => {
    const s = AS(), f = s.man; f.err = '';
    if (!f.miembro) f.err = 'Elegí la persona.'; else if (!f.dia || !f.hora) f.err = 'Indicá el día y la hora.'; else if (f.motivo.trim().length < 3) f.err = 'Escribí el motivo.';
    if (f.err) return render();
    f.ocupado = true; render();
    const { error } = await sb.rpc('marcacion_manual', { p_empresa: E(), p_miembro: f.miembro, p_tipo: f.tipo, p_cuando: new Date(`${f.dia}T${f.hora}:00-03:00`).toISOString(), p_obra: f.obra || null, p_motivo: f.motivo.trim() });
    f.ocupado = false;
    if (error) { f.err = err(error); return render(); }
    toast('Marcación cargada.'); s.man = null; s.hoy = null; s.per.datos = null; if (s.dia) s.dia = null; cargarAsistencia();
  },
  asAnular: b => { AS().anular = { id: b.dataset.id, motivo: '' }; render(); setTimeout(() => { const i = $('#as-anu'); i && i.focus(); }, 30); },
  asAnularCancelar: () => { AS().anular = null; render(); },
  asAnularOk: async () => {
    const s = AS(), x = s.anular; if (x.motivo.trim().length < 3) return toast('Escribí el motivo.');
    const { error } = await sb.rpc('anular_marcacion', { p_id: x.id, p_motivo: x.motivo.trim() });
    if (error) return toast(err(error));
    toast('Marcación anulada.'); s.anular = null; s.rev = null; s.per.datos = null; s.dia = null; cargarAsistencia();
  },
  asValidar: async b => {
    const { error } = await sb.rpc('validar_marcacion', { p_id: b.dataset.id });
    if (error) return toast(err(error));
    const s = AS(); s.rev = s.rev.filter(m => m.id !== b.dataset.id); s.nRevisar = s.rev.length; render();
  },
  asAjGuardar: async () => {
    const s = AS(), v = s.aj.v; s.aj.err = '';
    const n = k => v[k] === '' || v[k] == null ? null : +v[k];
    if (!/^\d{2}:\d{2}$/.test(v.hora_entrada)) s.aj.err = 'Indicá la hora de entrada.';
    else if (!(n('horas_semana') >= 0 && n('horas_semana') <= 16) || !(n('horas_sabado') >= 0 && n('horas_sabado') <= 16)) s.aj.err = 'Las horas normales van de 0 a 16.';
    else if (!(n('radio_m') >= 30 && n('radio_m') <= 5000)) s.aj.err = 'El radio va de 30 a 5000 metros.';
    if (s.aj.err) return render();
    const { error } = await sb.from('ajustes_asistencia').upsert({ empresa_id: E(), hora_entrada: v.hora_entrada, tolerancia_min: n('tolerancia_min') || 0, horas_semana: n('horas_semana'), horas_sabado: n('horas_sabado'),
      sabado_100_desde: v.sabado_100_desde || null, descanso_min: n('descanso_min') || 0, radio_m: n('radio_m'), pedir_foto: !!v.pedir_foto, actualizado_en: new Date().toISOString() });
    if (error) { s.aj.err = err(error); return render(); }
    toast('Horario guardado.'); s.per.datos = null; s.hoy = null;
  },
  asFerAgregar: async () => {
    const s = AS(), f = s.aj.nuevoFer; if (!f.fecha || f.nombre.trim().length < 2) return toast('Indicá la fecha y el nombre del feriado.');
    const { error } = await sb.from('feriados').upsert({ empresa_id: E(), fecha: f.fecha, nombre: f.nombre.trim() });
    if (error) return toast(err(error));
    cargarAjustes();
  },
  asFerFijos: async b => {
    const y = b.dataset.y, { error } = await sb.from('feriados').upsert(FIJOS.map(([d, n]) => ({ empresa_id: E(), fecha: `${y}-${d}`, nombre: n })), { onConflict: 'empresa_id,fecha', ignoreDuplicates: true });
    if (error) return toast(err(error));
    toast(`Feriados fijos de ${y} cargados. Sumá a mano carnaval, Semana Santa y los trasladables.`, 6000); cargarAjustes();
  },
  asFerBorrar: async b => { const { error } = await sb.from('feriados').delete().eq('empresa_id', E()).eq('fecha', b.dataset.f); if (error) return toast(err(error)); cargarAjustes(); },
  asUbic: b => { const o = P().d.obras.find(x => x.id === b.dataset.id); AS().ubic = { id: o.id, lat: o.lat ?? '', lng: o.lng ?? '', radio: o.radio_m ?? '' }; render(); },
  asUbicCancelar: () => { AS().ubic = null; render(); },
  asUbicAqui: () => {
    if (!navigator.geolocation) return toast('Este dispositivo no da la ubicación.');
    toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(p => { const u = AS().ubic; if (!u) return; u.lat = p.coords.latitude.toFixed(6); u.lng = p.coords.longitude.toFixed(6); render(); toast(`Ubicación tomada (±${Math.round(p.coords.accuracy)} m).`); },
      () => toast('No se pudo tomar la ubicación.'), { enableHighAccuracy: true, timeout: 20000 });
  },
  asUbicOk: async () => {
    const u = AS().ubic, lat = u.lat === '' ? null : +u.lat, lng = u.lng === '' ? null : +u.lng, radio = u.radio === '' ? null : Math.round(+u.radio);
    if ((lat == null) !== (lng == null) || (lat != null && (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)))) return toast('Revisá la latitud y la longitud.');
    if (radio != null && !(radio > 0)) return toast('El radio tiene que ser mayor a cero.');
    const { error } = await sb.from('obras').update({ lat, lng, radio_m: radio }).eq('id', u.id);
    if (error) return toast(err(error));
    AS().ubic = null; toast('Ubicación de la obra guardada.'); await P().recargar();
  },
  asCartel: async b => {
    const { data, error } = await sb.rpc('qr_de_obra', { p_obra: b.dataset.id, p_renovar: false });
    if (error) return toast(err(error));
    AS().cartel = { obra: P().d.obras.find(o => o.id === b.dataset.id), token: data }; render(); scrollTo(0, 0);
    if (AS().aj && !AS().aj.conQr.includes(b.dataset.id)) AS().aj.conQr.push(b.dataset.id);
  },
  asCartelCerrar: () => { AS().cartel = null; render(); },
  asRenovarQr: async b => {
    const a = P(); if (a.confirm !== 'qr' + b.dataset.id) { a.confirm = 'qr' + b.dataset.id; return render(); }
    a.confirm = null;
    const { data, error } = await sb.rpc('qr_de_obra', { p_obra: b.dataset.id, p_renovar: true });
    if (error) return toast(err(error));
    toast('QR renovado: imprimí el cartel nuevo.'); AS().cartel = { obra: a.d.obras.find(o => o.id === b.dataset.id), token: data }; render();
  },
};

export function alEscribir(el, v) {
  if (el.dataset.tj && S.tj && S.tj.flujo) { S.tj.flujo[el.dataset.tj] = v; return true; }
  if (el.dataset.rl && S.rl) { S.rl[el.dataset.rl] = v; return true; }
  const a = P(); if (!a || !a.as) return false;
  const s = a.as;
  if (el.dataset.as) { s[el.dataset.as] = v; render(); return true; }
  if (el.dataset.asp) { s.per[el.dataset.asp] = v; s.per.abierto = null; if (s.per.desde && s.per.hasta) cargarPeriodo(); return true; }
  if (el.id === 'as-busca') { s.busca = v; filtrar(el.dataset.buscar, v); return true; }
  if (el.dataset.am && s.man) { s.man[el.dataset.am] = v; return true; }
  if (el.dataset.asa && s.anular) { s.anular.motivo = v; return true; }
  if (el.dataset.aj && s.aj) { s.aj.v[el.dataset.aj] = v; return true; }
  if (el.dataset.fer && s.aj) { s.aj.nuevoFer[el.dataset.fer] = v; return true; }
  if (el.dataset.ub && s.ubic) { s.ubic[el.dataset.ub] = v; return true; }
  return false;
}

export async function alArchivo(input) {
  const file = input.files && input.files[0], f = T().flujo; if (!file || !f) return;
  try {
    const now = new Date(), g = f.gps;
    f.foto = await comprimir(file, 900, 0.65, [`Operapto · ${f.tipo === 'entrada' ? 'Entrada' : 'Salida'}`, `${S.m.nombre} · ${fFecha(now)} ${fHora(now)} h`, g ? `GPS ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} ±${Math.round(g.acc)} m` : 'Sin GPS']);
    if (f.fotoUrl) URL.revokeObjectURL(f.fotoUrl); f.fotoUrl = null; f.err = '';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    render();
  } catch { toast('No se pudo leer la foto. Probá de nuevo.'); }
}
