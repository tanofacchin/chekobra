// Vista del operario: inicio de jornada (equipo, ubicación, foto, checklist, firma) y cierre.
import { $, esc, fFecha, fHora, fDur, fNum, unidad, fechaLarga, mapsUrl, uuid, RES, MIN_CHECK_S, toast, msgError, comprimir } from './util.js';
import { sb, cargarOperario, itemsDe } from './datos.js';
import { cola } from './cola.js';
import { estadoDoc, nombreDoc } from './mantenimiento.js';
import { S, render } from './estado.js';
import { sync } from './main.js';

const STEPS = ['Equipo y obra', 'Ubicación', 'Foto con el equipo', 'Checklist', 'Firma y envío'];
const O = () => S.op;

export function reiniciar() {
  S.op = { d: null, cargando: false, err: '', flow: null, resultado: null, cierre: null, detalle: null, confirm: null, cola: [] };
}
export const clave = () => { const o = O(); return o ? [o.flow && o.flow.step, !!o.resultado, !!o.cierre, o.detalle].join(',') : ''; };

export async function cargar() {
  const o = O(); if (!o || o.cargando) return;
  o.cargando = true;
  try { o.d = await cargarOperario(S.m.empresa_id, S.m.id); o.err = ''; }
  catch (e) { o.err = msgError(e); }
  o.cola = await cola.listar().catch(() => []);
  const b = o.cola.find(e => S.user && e.id === idBorrador());
  o.borrador = b ? b.flow : null;
  o.cargando = false;
  if (o.qr && o.d) { const id = o.qr; o.qr = null; elegirPorQr(id); }
  render();
}

// Cuando un checklist hecho sin señal llega al servidor.
export function alEnviar(ev) {
  const o = O(); if (!o) return;
  if (o.resultado && o.resultado.client_id === ev.envio.id) { o.resultado.enviado = true; render(); }
}

/* ------------------------------------------------------------ QR del equipo */
// Desde el enlace del QR (main.js) o desde el escáner de la app.
export function abrirDesdeQr(id) {
  const o = O(); if (!o) return;
  if (o.d) elegirPorQr(id); else o.qr = id;
}
function elegirPorQr(id) {
  const o = O(), e = eqById(id);
  if (!e) return toast('Ese equipo no está cargado en tu empresa.', 5000);
  if (jornadaAbierta() && !(o.flow && o.flow.step === 0)) return toast('Tenés una jornada abierta: cerrala antes de iniciar otra.', 5000);
  if (e.estado === 'bloqueado') return toast(`${e.codigo} está bloqueado: ${e.motivo_bloqueo || 'falla crítica'}. Avisá al supervisor.`, 7000);
  if (e.estado === 'fuera_servicio') return toast(`${e.codigo} está fuera de servicio.`, 5000);
  const uso = o.d.enUso.find(u => u.equipo_id === e.id);
  if (uso) return toast(`${e.codigo} lo está usando ${uso.operario}.`, 5000);
  if (!plDe(e)) return toast(`${e.codigo} no tiene checklist asignado.`, 5000);
  const dv = docBloqueante(e.id);
  if (dv) return toast(dv.equipo_id ? `${e.codigo} tiene ${nombreDoc(dv)} vencido. Avisá al supervisor.` : `Tu ${nombreDoc(dv)} está vencida. No podés iniciar jornada.`, 7000);
  if (!o.flow) o.flow = nuevoFlujo();
  if (o.flow.equipoId !== e.id) { o.flow.equipoId = e.id; o.flow.resp = {}; o.flow.medIni = ''; }
  o.flow.step = 0; o.flow.err = ''; o.resultado = null; o.cierre = null; o.detalle = null;
  guardarBorrador(); render();
  toast(`${e.codigo} · ${e.nombre} seleccionado.`);
}
export const puedeEscanear = () => 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
let scan = null;
async function abrirEscaner() {
  // El escáner vive fuera de #app: así no se corta si la pantalla se redibuja.
  const caja = document.createElement('div'); caja.id = 'escaner'; caja.innerHTML = vEscaner(); document.body.append(caja);
  O().scan = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('#scan-video'); if (!v || !O() || !O().scan) { stream.getTracks().forEach(t => t.stop()); return; }
    v.srcObject = stream; await v.play();
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    scan = { stream, timer: setInterval(async () => {
      try {
        const r = await det.detect(v); if (!r.length) return;
        const u = new URL(r[0].rawValue, location.href), id = u.searchParams.get('equipo');
        if (!id) return toast('Ese código no es de un equipo de CheckObra.');
        cerrarEscaner(); elegirPorQr(id);
      } catch { /* sigue intentando */ }
    }, 300) };
  } catch {
    cerrarEscaner(); toast('No se pudo abrir la cámara. Revisá el permiso o elegí el equipo de la lista.', 6000);
  }
}
function cerrarEscaner() {
  if (scan) { clearInterval(scan.timer); scan.stream.getTracks().forEach(t => t.stop()); scan = null; }
  if (O()) O().scan = false;
  const caja = $('#escaner'); if (caja) caja.remove();
}
const vEscaner = () => `<div class="modal" role="dialog" aria-modal="true" aria-label="Escanear QR"><div class="card scan">
  <h2>Escaneá el QR del equipo</h2><video id="scan-video" playsinline muted></video>
  <p class="small muted">Apuntá la cámara a la etiqueta pegada en la máquina.</p>
  <button class="btn" data-act="opCerrarEscaner">Cancelar</button></div></div>`;

/* ------------------------------------------------------------ helpers */
// Documento vencido que impide iniciar jornada (del equipo o del propio operario).
const docsDe = (filtro) => ((O().d && O().d.docs) || []).filter(filtro);
const docBloqueante = equipoId => docsDe(x => x.bloquea && (x.equipo_id === equipoId || x.miembro_id === S.m.id)).find(x => estadoDoc(x).clave === 'vencido');
const eqById = id => O().d && O().d.equipos.find(e => e.id === id);
const plDe = eq => eq && O().d.plantillas[eq.plantilla_clave];
const misEnvios = () => O().cola.filter(e => e.uid === S.user.id && e.empresa_id === S.m.empresa_id);

// Jornada abierta: la del servidor o una iniciada sin señal que todavía no se envió.
function jornadaAbierta() {
  const env = misEnvios();
  const cerrando = new Set(env.filter(e => e.tipo === 'cierre').map(e => e.payload.jornada_id || e.payload.checklist_client_id));
  const srv = O().d && O().d.jornadas.find(j => j.estado === 'abierta' && !cerrando.has(j.id) && !cerrando.has(j.client_id));
  if (srv) return { ...srv, local: false };
  const loc = env.find(e => e.tipo === 'checklist' && e.estado === 'pendiente' && e.local.resultado !== 'no_apto' && !cerrando.has(e.id));
  if (loc) return { id: null, client_id: loc.id, estado: 'abierta', resultado: loc.local.resultado, inicio: loc.payload.inicio, med_ini: loc.payload.med_ini, equipo_id: loc.payload.equipo_id, obra_id: loc.payload.obra_id, local: true };
  return null;
}
function chipRes(r) { const [t, c] = RES[r] || ['—', '']; return `<span class="chip ${c}">${t}</span>`; }

/* ------------------------------------------------------------ vistas */
export function vista() {
  const o = O();
  if (!o.d) return `<main class="wrap">${o.err ? `<div class="badbox">${esc(o.err)}</div><button class="btn" data-act="opRecargar">Reintentar</button>` : '<p class="muted">Cargando equipos…</p>'}</main>`;
  if (o.flow) return vFlow();
  if (o.resultado) return vResultado();
  if (o.cierre) return vCierre();
  if (o.detalle) return vDetalle();
  return vInicio();
}

function vInicio() {
  const o = O(), d = o.d, ab = jornadaAbierta();
  const rech = misEnvios().filter(e => e.estado === 'rechazado');
  const borr = o.borrador;
  let main;
  if (ab) {
    const e = eqById(ab.equipo_id), ob = d.obras.find(x => x.id === ab.obra_id);
    main = `<section class="card on-card"><p class="eyebrow">Jornada en curso${ab.local ? ' · esperando señal para enviarse' : ''}</p>
      <h2>${esc(e ? e.codigo + ' · ' + e.nombre : 'Equipo')}</h2>
      <dl class="kv"><dt>Obra</dt><dd>${esc(ob ? ob.nombre : '—')}</dd><dt>Desde</dt><dd class="num">${fHora(ab.inicio)} h</dd>
      <dt>${e && e.medidor === 'km' ? 'Odómetro' : 'Horómetro'} inicial</dt><dd class="num">${fNum(ab.med_ini)} ${unidad(e && e.medidor)}</dd>
      <dt>Checklist</dt><dd>${chipRes(ab.resultado)}</dd></dl>
      <button class="btn dark block" data-act="opAbrirCierre">Cerrar jornada</button></section>`;
  } else if (borr) {
    const e = eqById(borr.equipoId);
    main = `<section class="card"><p class="eyebrow">Checklist sin terminar</p><h2>${esc(e ? e.codigo + ' · ' + e.nombre : 'Equipo')}</h2>
      <p class="muted">Quedó guardado en este teléfono. Podés seguir desde donde lo dejaste.</p>
      <div class="row"><button class="btn primary" data-act="opSeguir">Continuar</button><button class="btn ghost" data-act="opDescartar">${o.confirm === 'borrador' ? 'Tocá de nuevo para descartar' : 'Descartar'}</button></div></section>`;
  } else {
    main = `<button class="start" data-act="opNueva"><span class="eyebrow" style="color:inherit;opacity:.75">Antes de operar</span><b>Iniciar jornada</b><span>Elegí el equipo, registrá ubicación y foto, y completá el checklist.</span></button>`;
  }
  const rechHtml = rech.map(e => `<div class="badbox"><b>Un registro no se pudo guardar.</b> ${esc(e.error)}<div class="row" style="margin-top:8px"><button class="btn sm" data-act="opDescartarEnvio" data-id="${e.id}">${o.confirm === e.id ? 'Tocá de nuevo para descartar' : 'Descartar'}</button></div></div>`).join('');
  const js = d.jornadas.slice(0, 10);
  const lista = js.length ? `<div class="list">${js.map(j => { const e = eqById(j.equipo_id), ob = d.obras.find(x => x.id === j.obra_id); return `<button class="li" data-act="opVer" data-id="${j.id}">
      <span class="t">${esc(e ? e.codigo + ' · ' + e.nombre : 'Equipo')}</span>${chipRes(j.resultado)}
      <span class="s">${fFecha(j.inicio)} ${fHora(j.inicio)}${ob ? ' · ' + esc(ob.nombre) : ''}${j.estado === 'abierta' ? ' · en curso' : ''}</span></button>`; }).join('')}</div>`
    : '<div class="empty">Todavía no registraste jornadas. Tu historial va a aparecer acá.</div>';
  const mios = docsDe(x => x.miembro_id === S.m.id).map(x => ({ x, st: estadoDoc(x) })).filter(({ st }) => st.clave !== 'vigente');
  const docsHtml = mios.map(({ x, st }) => `<div class="${st.clave === 'vencido' ? 'badbox' : 'warnbox'}"><b>${esc(nombreDoc(x))}:</b> ${esc(st.texto.toLowerCase())}.${st.clave === 'vencido' && x.bloquea ? ' No podés iniciar jornada hasta renovarla; avisale al supervisor.' : ' Avisale al supervisor para renovarla.'}</div>`).join('');
  return `<main class="wrap"><section><p class="eyebrow">${esc(fechaLarga())}</p><h1>Hola, ${esc(S.m.nombre.split(' ')[0])}</h1></section>${docsHtml}
    ${d.offline ? `<div class="warnbox">Sin conexión: estás viendo los datos guardados el ${fFecha(d.actualizado)} a las ${fHora(d.actualizado)}.</div>` : ''}
    ${rechHtml}${main}<h2>Tus últimas jornadas</h2>${lista}</main>`;
}

/* ------------------------------------------------------------ flujo */
function nuevoFlujo() { return { step: 0, client_id: uuid(), equipoId: '', obraId: '', medIni: '', gps: null, gpsErr: '', gpsBusy: false, ubicRef: '', selfie: null, resp: {}, t0: null, tAcum: 0, firma: null, decl: false, motivoRapido: '', err: '' }; }

function vFlow() {
  const f = O().flow;
  const steps = STEPS.map((_, i) => `<span class="${i < f.step ? 'done' : i === f.step ? 'cur' : ''}"></span>`).join('');
  const body = [stEquipo, stGps, stFoto, stChecklist, stFirma][f.step]();
  return `<main class="wrap"><div class="step-head"><div class="steps">${steps}</div><p class="eyebrow">Paso ${f.step + 1} de 5 · ${STEPS[f.step]}</p></div>
    ${body}${f.err ? `<p class="err" role="alert">${esc(f.err)}</p>` : ''}</main>
    <nav class="flow-nav"><div class="in"><button class="btn" data-act="opAtras">${f.step ? 'Atrás' : 'Cancelar'}</button>
    <button class="btn primary" data-act="opSiguiente" id="nextBtn">${f.step === 4 ? 'Enviar checklist' : 'Siguiente'}</button></div></nav>`;
}
function chipEquipo(e, uso) {
  if (e.estado === 'bloqueado') return '<span class="chip bad">Bloqueado</span>';
  if (e.estado === 'fuera_servicio') return '<span class="chip">Fuera de servicio</span>';
  if (uso) return '<span class="chip acc">En uso</span>';
  return '<span class="chip ok">Operativo</span>';
}
function stEquipo() {
  const f = O().flow, d = O().d;
  const grid = d.equipos.length ? `<div class="eq-grid">${d.equipos.map(e => {
    const uso = d.enUso.find(u => u.equipo_id === e.id);
    const pl = plDe(e);
    const docEq = docsDe(x => x.bloquea && x.equipo_id === e.id).find(x => estadoDoc(x).clave === 'vencido');
    const dis = e.estado !== 'operativo' || !!uso || !pl || !!docEq;
    return `<button class="eq ${f.equipoId === e.id ? 'sel' : ''}" data-act="opEquipo" data-id="${e.id}" ${dis ? 'disabled' : ''} aria-pressed="${f.equipoId === e.id}">
      <span class="code">${esc(e.codigo)}</span><span class="nm">${esc(e.nombre)}</span><span class="meta">${esc(pl ? pl.nombre : 'Sin plantilla')}</span>
      ${chipEquipo(e, uso)}${uso ? `<span class="meta">Lo usa ${esc(uso.operario)}</span>` : ''}${e.estado === 'bloqueado' ? '<span class="meta">Avisá al supervisor</span>' : ''}${docEq && e.estado === 'operativo' ? `<span class="chip bad">${esc(nombreDoc(docEq))} vencido</span>` : ''}</button>`;
  }).join('')}</div>` : '<div class="empty">No hay equipos cargados. Pedile al supervisor que los dé de alta.</div>';
  const e = eqById(f.equipoId);
  return `<h1>¿Con qué equipo trabajás hoy?</h1>
    ${puedeEscanear() ? '<button class="btn dark block" data-act="opEscanear">Escanear QR del equipo</button>' : ''}${grid}
    <label class="f">Obra o frente de trabajo<select class="inp" id="f-obra" data-fl="obraId"><option value="">Elegí la obra</option>
      ${d.obras.map(ob => `<option value="${ob.id}" ${ob.id === f.obraId ? 'selected' : ''}>${esc(ob.nombre)}</option>`).join('')}</select></label>
    ${e ? `<label class="f">${e.medidor === 'km' ? 'Odómetro inicial (km)' : 'Horómetro inicial (horas)'}
      <input class="inp num" id="f-med" type="number" inputmode="decimal" step="0.1" data-fl="medIni" value="${esc(f.medIni)}">
      <small>Último registrado: <span class="num">${fNum(e.ultimo_medidor)} ${unidad(e.medidor)}</span></small></label>` : ''}`;
}
function stGps() {
  const f = O().flow, g = f.gps;
  const box = g ? `<div class="gps-box"><b>Ubicación registrada</b><span class="num">${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}</span>
      <span>Precisión ±${Math.round(g.acc)} m · ${fHora(g.ts)} h</span><a href="${mapsUrl(g.lat, g.lng)}" target="_blank" rel="noopener" style="color:inherit;font-weight:600">Ver en el mapa ↗</a></div>
      <button class="btn" data-act="opGps">Volver a tomar</button>`
    : `<button class="btn primary block" data-act="opGps" ${f.gpsBusy ? 'disabled' : ''}>${f.gpsBusy ? 'Buscando señal GPS…' : 'Tomar ubicación GPS'}</button>`;
  return `<h1>¿Dónde estás?</h1><p class="muted">Se guarda el punto donde se hizo el control del equipo.</p>${box}
    ${f.gpsErr ? `<div class="warnbox">${esc(f.gpsErr)}</div>
      <label class="f">Referencia del lugar <small>Obligatoria si no hay GPS. Ej.: "Obrador km 12, playa de equipos".</small>
      <input class="inp" id="f-ref" data-fl="ubicRef" value="${esc(f.ubicRef)}" maxlength="120"></label>` : ''}`;
}
let selfieUrl = null;
function stFoto() {
  const f = O().flow;
  if (f.selfie && !selfieUrl) selfieUrl = URL.createObjectURL(f.selfie);
  return `<h1>Foto con el equipo</h1><p class="muted">Sacate una foto en la que se vea el equipo. Se le agrega fecha, hora, equipo y ubicación.</p>
    <label class="photo" for="f-selfie">${f.selfie ? `<img src="${selfieUrl}" alt="Foto del operario con el equipo">` : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="4"/></svg><b>Abrir cámara</b>`}
      <input class="vh" type="file" id="f-selfie" accept="image/*" capture="user" data-file="selfie"></label>
    ${f.selfie ? '<label class="btn" for="f-selfie">Sacar otra</label>' : ''}`;
}
const fotoUrls = {};
function itemHtml(it, r) {
  const v = r && r.v, dom = it.id.replace(/\./g, '-');
  if (r && r.foto && !fotoUrls[it.id]) fotoUrls[it.id] = URL.createObjectURL(r.foto);
  return `<div class="item" id="it-${dom}" data-v="${v || ''}">
    <div class="it-t">${it.critico ? '<span class="crit">CRÍTICO</span>' : ''}${esc(it.texto)}</div>
    <div class="seg" role="group" aria-label="${esc(it.texto)}">
      <button class="${v === 'ok' ? 'on ok' : ''}" data-act="opResp" data-id="${it.id}" data-v="ok" aria-pressed="${v === 'ok'}">Bien</button>
      <button class="${v === 'falla' ? 'on falla' : ''}" data-act="opResp" data-id="${it.id}" data-v="falla" aria-pressed="${v === 'falla'}">Falla</button>
      <button class="${v === 'na' ? 'on na' : ''}" data-act="opResp" data-id="${it.id}" data-v="na" ${it.critico ? 'disabled title="Un punto crítico no puede quedar como No aplica"' : ''} aria-pressed="${v === 'na'}">N/A</button>
    </div>
    ${v === 'falla' ? `<div class="falla-box">
      <textarea class="inp" id="n-${dom}" data-nota="${it.id}" placeholder="¿Qué encontraste? (obligatorio)" maxlength="300">${esc(r.nota || '')}</textarea>
      ${r.foto ? `<img class="thumb" src="${fotoUrls[it.id]}" alt="Foto de la falla">` : ''}
      <label class="btn sm" for="ff-${dom}">${r.foto ? 'Cambiar foto' : 'Agregar foto de la falla'}</label>
      <input class="vh" type="file" id="ff-${dom}" accept="image/*" capture="environment" data-file="falla" data-id="${it.id}"></div>` : ''}
  </div>`;
}
function stats() {
  const f = O().flow, items = itemsDe(plDe(eqById(f.equipoId))), r = f.resp;
  const fallas = items.filter(i => r[i.id] && r[i.id].v === 'falla');
  return { items, done: items.filter(i => r[i.id] && r[i.id].v).length, total: items.length, fallas, crit: fallas.filter(i => i.critico) };
}
function clHead() {
  const s = stats();
  return `<div class="cl-head" id="clhead"><div class="row" style="justify-content:space-between"><b class="num">${s.done} / ${s.total} revisados</b>
    <span>${s.fallas.length ? `<span class="chip ${s.crit.length ? 'bad' : 'warn'}">${s.fallas.length} falla${s.fallas.length > 1 ? 's' : ''}${s.crit.length ? ` · ${s.crit.length} crítica${s.crit.length > 1 ? 's' : ''}` : ''}</span>` : '<span class="chip ok">Sin fallas</span>'}</span></div>
    <div class="bar"><i style="width:${(s.done / s.total * 100).toFixed(1)}%"></i></div></div>`;
}
function stChecklist() {
  const f = O().flow, e = eqById(f.equipoId), pl = plDe(e);
  if (!f.t0) f.t0 = Date.now();
  const secs = pl.secciones.map(s => `<section class="sec"><h3>${esc(s.titulo)} <span class="num">${s.items.length} puntos</span></h3>
    ${s.items.map(i => itemHtml(i, f.resp[i.id])).join('')}</section>`).join('');
  return `<div><h1>${esc(pl.nombre)}</h1><p class="muted">${esc(e.codigo)} · ${esc(e.nombre)}. Revisá cada punto con el equipo apagado, salvo la prueba de funcionamiento.</p></div>${clHead()}${secs}`;
}
const resultadoDe = s => s.crit.length ? 'no_apto' : s.fallas.length ? 'observaciones' : 'apto';
const segundos = f => Math.round((f.tAcum + (f.t0 ? Date.now() - f.t0 : 0)) / 1000);
function stFirma() {
  const f = O().flow, s = stats(), r = resultadoDe(s), dur = f.durS ?? segundos(f), rapido = dur < MIN_CHECK_S;
  return `<h1>Revisá y firmá</h1>
    <div class="sum"><div><b>${s.total - s.fallas.length}</b><span>Bien / N/A</span></div><div><b style="color:var(--warn)">${s.fallas.length - s.crit.length}</b><span>Fallas</span></div><div><b style="color:var(--bad)">${s.crit.length}</b><span>Críticas</span></div></div>
    ${r === 'no_apto' ? `<div class="badbox"><b>El equipo no puede operar.</b> Hay fallas en puntos críticos. Al enviar, el equipo queda bloqueado hasta que el supervisor lo libere.<ul style="margin:8px 0 0;padding-left:18px">${s.crit.map(i => `<li>${esc(i.texto)}</li>`).join('')}</ul></div>`
      : r === 'observaciones' ? `<div class="warnbox">El equipo puede operar, con ${s.fallas.length} observación${s.fallas.length > 1 ? 'es' : ''} que le llegan al supervisor.</div>` : ''}
    ${rapido ? `<div class="warnbox"><b>Completaste el checklist en ${fDur(dur)}.</b> Una revisión real lleva al menos ${MIN_CHECK_S / 60} minutos. Queda registrado para el supervisor.
      <label class="f" style="margin-top:10px;color:var(--ink)">¿Por qué fue tan rápido? <small>Opcional</small><input class="inp" id="f-rap" data-fl="motivoRapido" value="${esc(f.motivoRapido)}" maxlength="140"></label></div>` : ''}
    <label class="check"><input type="checkbox" id="f-decl" data-fl="decl" ${f.decl ? 'checked' : ''}><span>Declaro que revisé personalmente cada punto de este checklist y que la información es verdadera.</span></label>
    <div><p class="eyebrow" style="margin-bottom:6px">Firma</p><div class="sig-wrap"><canvas id="sig" aria-label="Firmá con el dedo"></canvas><span class="x">✕</span><span class="base"></span></div>
    <div class="row" style="justify-content:space-between;margin-top:6px"><span class="small muted">Firmá con el dedo</span><button class="btn ghost sm" data-act="opBorrarFirma">Borrar firma</button></div></div>`;
}

// Después de cada render: preparar el lienzo de la firma si está en pantalla.
export function despues() { if ($('#sig')) iniciarFirma(); }
function iniciarFirma() {
  const f = O().flow, c = $('#sig'), ctx = c.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
  if (f.firma) { const u = URL.createObjectURL(f.firma); const im = new Image(); im.onload = () => { ctx.drawImage(im, 0, 0, w, h); URL.revokeObjectURL(u); }; im.src = u; }
  let dib = false, last = null;
  const pt = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { dib = true; last = pt(e); c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last[0], last[1], 1.2, 0, 7); ctx.fillStyle = '#111827'; ctx.fill(); };
  c.onpointermove = e => { if (!dib) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p; };
  c.onpointerup = c.onpointercancel = () => { if (!dib) return; dib = false; c.toBlob(b => { f.firma = b; guardarBorrador(); }, 'image/png'); };
}

/* ------------------------------------------------------------ borrador (sobrevive a cerrar la app) */
const idBorrador = () => `borrador-${S.user.id}-${S.m.empresa_id}`;
let tBorr;
function guardarBorrador() {
  clearTimeout(tBorr);
  tBorr = setTimeout(() => {
    const f = O() && O().flow; if (!f) return;
    const { gpsBusy, err, ...d } = f;
    if (d.t0) { d.tAcum += Date.now() - d.t0; d.t0 = null; }
    cola.guardar({ id: idBorrador(), tipo: 'borrador', estado: 'borrador', uid: S.user.id, empresa_id: S.m.empresa_id, flow: d, creado: Date.now() }).catch(() => {});
  }, 500);
}
async function leerBorrador() {
  const l = await cola.listar().catch(() => []);
  return l.find(e => e.id === idBorrador());
}

/* ------------------------------------------------------------ resultado y cierre */
function vResultado() {
  const r = O().resultado, res = r.resultado;
  const txt = res === 'apto' ? 'Podés operar el equipo. Al terminar el día, cerrá la jornada desde la pantalla de inicio.'
    : res === 'observaciones' ? 'Podés operar con precaución. El supervisor recibe las fallas que marcaste.'
    : 'No operes este equipo. Queda bloqueado y el supervisor lo ve en su panel. Avisale por radio o teléfono.';
  return `<main class="wrap"><section class="verdict ${res}"><p class="eyebrow" style="color:inherit;opacity:.8">${esc(r.codigo)} · ${fHora(r.inicio)} h</p>
    <h1>${RES[res][0]}</h1><p>${txt}</p></section>
    <div class="${r.enviado ? 'card flat' : 'warnbox'}">${r.enviado ? 'Registro enviado al servidor.' : 'Guardado en el teléfono. Se envía solo apenas haya señal; no hace falta que hagas nada.'}</div>
    ${r.fallas.length ? `<section class="card flat"><h3>Fallas registradas</h3>${r.fallas.map(i => `<div class="fl">${i.critico ? '<span class="crit">CRÍTICO</span>' : ''}<b>${esc(i.texto)}</b><span class="muted">${esc(i.nota)}</span></div>`).join('')}</section>` : ''}
    <button class="btn dark block" data-act="opInicio">Volver al inicio</button></main>`;
}
function vCierre() {
  const c = O().cierre, ab = jornadaAbierta(); if (!ab) return '<main class="wrap"><div class="empty">No hay jornada abierta.</div></main>';
  const e = eqById(ab.equipo_id), u = unidad(e && e.medidor);
  return `<main class="wrap"><section><p class="eyebrow">Cierre de jornada</p><h1>${esc(e ? e.codigo + ' · ' + e.nombre : '')}</h1>
    <p class="muted">Desde las ${fHora(ab.inicio)} h. ${e && e.medidor === 'km' ? 'Odómetro' : 'Horómetro'} inicial: <span class="num">${fNum(ab.med_ini)} ${u}</span></p></section>
    <label class="f">${e && e.medidor === 'km' ? 'Odómetro final (km)' : 'Horómetro final (horas)'}<input class="inp num" id="c-med" type="number" inputmode="decimal" step="0.1" data-ci="medFin" value="${esc(c.medFin)}"></label>
    <label class="f">Combustible cargado hoy (litros) <small>Opcional</small><input class="inp num" id="c-comb" type="number" inputmode="decimal" data-ci="litros" value="${esc(c.litros)}"></label>
    <section class="card flat"><h3>Al dejar el equipo</h3>
      <label class="check"><input type="checkbox" id="c-1" data-ci="k1" ${c.k1 ? 'checked' : ''}><span>Estacionado en terreno firme y nivelado, fuera de la circulación</span></label>
      <label class="check"><input type="checkbox" id="c-2" data-ci="k2" ${c.k2 ? 'checked' : ''}><span>Implemento apoyado en el piso y freno de estacionamiento puesto</span></label>
      <label class="check"><input type="checkbox" id="c-3" data-ci="k3" ${c.k3 ? 'checked' : ''}><span>Motor apagado, llave retirada y cabina cerrada</span></label></section>
    <label class="check"><input type="checkbox" id="c-falla" data-ci="falla" data-vivo ${c.falla ? 'checked' : ''}><span><b>Apareció una falla durante el trabajo</b></span></label>
    <label class="f">Novedades del día <small>${c.falla ? 'Describí la falla (obligatorio)' : 'Opcional'}</small><textarea class="inp" id="c-nov" data-ci="novedades" maxlength="500">${esc(c.novedades)}</textarea></label>
    ${c.err ? `<p class="err" role="alert">${esc(c.err)}</p>` : ''}
    <div class="row"><button class="btn" data-act="opCancelarCierre">Cancelar</button><button class="btn dark" data-act="opCerrar">Cerrar jornada</button></div></main>`;
}
function vDetalle() {
  const j = O().d.jornadas.find(x => x.id === O().detalle); if (!j) return '<main class="wrap"><div class="empty">No encontrada.</div></main>';
  const e = eqById(j.equipo_id), ob = O().d.obras.find(x => x.id === j.obra_id), u = unidad(e && e.medidor);
  return `<main class="wrap"><button class="btn ghost sm" data-act="opInicio" style="align-self:flex-start">← Volver</button>
    <section class="card"><p class="eyebrow">${fFecha(j.inicio)} · ${fHora(j.inicio)} h</p><h1>${esc(e ? e.codigo + ' · ' + e.nombre : '')}</h1>${chipRes(j.resultado)}
    <dl class="kv"><dt>Obra</dt><dd>${esc(ob ? ob.nombre : '—')}</dd><dt>Checklist</dt><dd>${fDur(j.dur_checklist_s)}</dd>
    <dt>Fallas</dt><dd>${j.n_fallas}${j.n_criticas ? ` (${j.n_criticas} críticas)` : ''}</dd>
    <dt>Medidor</dt><dd class="num">${fNum(j.med_ini)} → ${j.med_fin != null ? fNum(j.med_fin) : '…'} ${u}</dd>
    <dt>Estado</dt><dd>${j.estado === 'abierta' ? 'En curso' : j.estado === 'cerrada' ? `Cerrada ${fHora(j.fin)} h` : 'Rechazada: equipo bloqueado'}</dd></dl></section></main>`;
}

/* ------------------------------------------------------------ envío */
async function enviar() {
  const o = O(), f = o.flow;
  if (!f.decl) { f.err = 'Marcá la declaración para enviar.'; return render(); }
  if (!f.firma) { f.err = 'Falta tu firma.'; return render(); }
  const e = eqById(f.equipoId), s = stats(), res = resultadoDe(s);
  const base = `${S.m.empresa_id}/${S.user.id}/${f.client_id}/`;
  const archivos = [{ path: base + 'selfie.jpg', blob: f.selfie, tipo: 'image/jpeg' }, { path: base + 'firma.png', blob: f.firma, tipo: 'image/png' }];
  const respuestas = {};
  for (const i of s.items) {
    const r = f.resp[i.id];
    respuestas[i.id] = { v: r.v };
    if (r.v === 'falla') {
      respuestas[i.id].nota = r.nota.trim();
      if (r.foto) { const p = `${base}falla-${i.id.replace(/\./g, '-')}.jpg`; archivos.push({ path: p, blob: r.foto, tipo: 'image/jpeg' }); respuestas[i.id].foto = p; }
    }
  }
  const inicio = new Date().toISOString();
  const payload = {
    client_id: f.client_id, equipo_id: e.id, obra_id: f.obraId, inicio, med_ini: +f.medIni,
    lat: f.gps ? f.gps.lat : null, lng: f.gps ? f.gps.lng : null, precision_m: f.gps ? f.gps.acc : null, ubic_ref: f.gps ? null : f.ubicRef.trim(),
    selfie_path: archivos[0].path, firma_path: archivos[1].path, dur_checklist_s: f.durS, motivo_rapido: f.motivoRapido || null,
    declaracion: true, respuestas,
  };
  try {
    await cola.agregar({ id: f.client_id, tipo: 'checklist', uid: S.user.id, empresa_id: S.m.empresa_id, payload, archivos, local: { resultado: res } });
    await cola.borrar(idBorrador());
  } catch (err) { f.err = 'No se pudo guardar en el teléfono: ' + msgError(err); return render(); }
  o.resultado = { client_id: f.client_id, resultado: res, codigo: e.codigo, inicio, fallas: s.fallas.map(i => ({ texto: i.texto, critico: i.critico, nota: f.resp[i.id].nota })), enviado: false };
  o.flow = null; o.borrador = null; selfieUrl = null; for (const k in fotoUrls) delete fotoUrls[k];
  o.cola = await cola.listar().catch(() => o.cola);
  render(); sync();
}

/* ------------------------------------------------------------ acciones */
function setResp(id, v) {
  const f = O().flow, cur = f.resp[id] || {};
  f.resp[id] = v === 'falla' ? { ...cur, v } : { v };
  const it = itemsDe(plDe(eqById(f.equipoId))).find(i => i.id === id);
  $('#it-' + id.replace(/\./g, '-')).outerHTML = itemHtml(it, f.resp[id]);
  $('#clhead').outerHTML = clHead();
  if (v === 'falla') setTimeout(() => { const n = $('#n-' + id.replace(/\./g, '-')); n && n.focus(); }, 30);
  guardarBorrador();
}
function tomarGps() {
  const f = O().flow; f.gpsErr = '';
  if (!navigator.geolocation) { f.gpsErr = 'Este teléfono no ofrece GPS al navegador. Escribí una referencia del lugar.'; return render(); }
  f.gpsBusy = true; render();
  navigator.geolocation.getCurrentPosition(p => {
    f.gpsBusy = false; f.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }; guardarBorrador(); render();
  }, err => {
    f.gpsBusy = false;
    f.gpsErr = err.code === 1 ? 'No diste permiso de ubicación. Activalo en la configuración del navegador o escribí una referencia del lugar.'
      : err.code === 3 ? 'No se encontró señal GPS a tiempo. Probá al aire libre o escribí una referencia del lugar.'
      : 'No se pudo obtener la ubicación. Escribí una referencia del lugar.';
    render();
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
function siguiente() {
  const f = O().flow; f.err = '';
  if (f.step === 0) {
    const e = eqById(f.equipoId);
    if (!e) f.err = 'Elegí el equipo.';
    else if (!f.obraId) f.err = 'Elegí la obra.';
    else if (f.medIni === '' || isNaN(+f.medIni) || +f.medIni < 0) f.err = `Cargá el ${e.medidor === 'km' ? 'odómetro' : 'horómetro'} inicial.`;
    else if (e.ultimo_medidor != null && +f.medIni < +e.ultimo_medidor) f.err = `El valor es menor al último registrado (${fNum(e.ultimo_medidor)}). Revisá el número.`;
  } else if (f.step === 1) { if (!f.gps && (f.ubicRef || '').trim().length < 3) f.err = f.gpsErr ? 'Escribí una referencia del lugar.' : 'Tomá la ubicación GPS.'; }
  else if (f.step === 2) { if (!f.selfie) f.err = 'Falta la foto con el equipo.'; }
  else if (f.step === 3) {
    const s = stats();
    const miss = s.items.find(i => !(f.resp[i.id] && f.resp[i.id].v)) || s.fallas.find(i => !(f.resp[i.id].nota || '').trim());
    if (miss) {
      const sinNota = f.resp[miss.id] && f.resp[miss.id].v === 'falla';
      f.err = sinNota ? 'Describí la falla marcada.' : `Faltan ${s.total - s.done} punto${s.total - s.done > 1 ? 's' : ''} por revisar.`;
      toast(f.err);
      const el = $('#it-' + miss.id.replace(/\./g, '-')); el.classList.add('miss'); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    f.durS = segundos(f); f.tAcum = f.durS * 1000; f.t0 = null;
  } else if (f.step === 4) return enviar();
  if (!f.err) { f.step++; guardarBorrador(); }
  render();
}
async function cerrar() {
  const o = O(), c = o.cierre, ab = jornadaAbierta(), e = eqById(ab.equipo_id); c.err = '';
  if (c.medFin === '' || isNaN(+c.medFin)) c.err = 'Cargá el valor final.';
  else if (+c.medFin < +ab.med_ini) c.err = `El valor final no puede ser menor al inicial (${fNum(ab.med_ini)}).`;
  else if (+c.medFin - +ab.med_ini > (e && e.medidor === 'km' ? 1500 : 24)) c.err = 'La diferencia es demasiado grande para una jornada. Revisá el número.';
  else if (!(c.k1 && c.k2 && c.k3)) c.err = 'Confirmá los tres puntos de cómo dejaste el equipo.';
  else if (c.falla && !(c.novedades || '').trim()) c.err = 'Describí la falla que apareció.';
  if (c.err) return render();
  await cola.agregar({ id: uuid(), tipo: 'cierre', uid: S.user.id, empresa_id: S.m.empresa_id, archivos: [],
    payload: { jornada_id: ab.id, checklist_client_id: ab.client_id, med_fin: +c.medFin, litros: c.litros === '' ? null : +c.litros, novedades: (c.novedades || '').trim(), falla: !!c.falla } });
  o.cierre = null; o.cola = await cola.listar().catch(() => o.cola);
  toast('Jornada cerrada. ¡Buen descanso!'); render(); sync();
}

export const A = {
  opRecargar: () => cargar(),
  opEscanear: () => abrirEscaner(),
  opCerrarEscaner: () => cerrarEscaner(),
  opNueva: () => { O().flow = nuevoFlujo(); render(); },
  opSeguir: () => { const b = O().borrador; if (!b) return; O().flow = { ...nuevoFlujo(), ...b, t0: b.step === 3 ? Date.now() : null }; render(); },
  opDescartar: async () => { const o = O(); if (o.confirm !== 'borrador') { o.confirm = 'borrador'; return render(); } o.confirm = null; await cola.borrar(idBorrador()); o.borrador = null; render(); },
  opDescartarEnvio: async b => { const o = O(); if (o.confirm !== b.dataset.id) { o.confirm = b.dataset.id; return render(); } o.confirm = null; await cola.borrar(b.dataset.id); o.cola = await cola.listar(); render(); sync(); },
  opEquipo: b => { const f = O().flow; if (f.equipoId !== b.dataset.id) { f.equipoId = b.dataset.id; f.resp = {}; f.medIni = ''; } f.err = ''; guardarBorrador(); render(); },
  opGps: tomarGps,
  opResp: b => setResp(b.dataset.id, b.dataset.v),
  opSiguiente: siguiente,
  opAtras: () => {
    const o = O(), f = o.flow;
    if (f.step === 0) { o.flow = null; leerBorrador().then(b => { o.borrador = b && b.flow; render(); }); return; }
    if (f.step === 3 && f.t0) { f.tAcum += Date.now() - f.t0; f.t0 = null; }
    if (f.step === 4) { delete f.durS; f.t0 = Date.now(); }
    f.step--; f.err = ''; guardarBorrador(); render();
  },
  opBorrarFirma: () => { O().flow.firma = null; guardarBorrador(); iniciarFirma(); },
  opInicio: () => { const o = O(); o.resultado = null; o.detalle = null; render(); cargar(); },
  opAbrirCierre: () => { O().cierre = { medFin: '', litros: '', novedades: '', k1: false, k2: false, k3: false, falla: false, err: '' }; render(); },
  opCancelarCierre: () => { O().cierre = null; render(); },
  opCerrar: cerrar,
  opVer: b => { O().detalle = b.dataset.id; render(); },
};

export function alEscribir(el, v) {
  const o = O(); if (!o) return false;
  if (el.dataset.fl && o.flow) { o.flow[el.dataset.fl] = v; guardarBorrador(); return true; }
  if (el.dataset.nota && o.flow) { o.flow.resp[el.dataset.nota].nota = v; guardarBorrador(); return true; }
  if (el.dataset.ci && o.cierre) { o.cierre[el.dataset.ci] = v; if (el.dataset.ci === 'falla') render(); return true; }
  return false;
}

export async function alArchivo(input) {
  const file = input.files && input.files[0], o = O(); if (!file || !o.flow) return;
  const f = o.flow, e = eqById(f.equipoId), now = new Date();
  try {
    if (input.dataset.file === 'selfie') {
      const g = f.gps, ob = o.d.obras.find(x => x.id === f.obraId);
      f.selfie = await comprimir(file, 1080, 0.7, [`CheckObra · ${e.codigo} ${e.nombre}`, `${S.m.nombre} · ${fFecha(now)} ${fHora(now)} h`,
        g ? `GPS ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} ±${Math.round(g.acc)} m` : `Sin GPS · ${f.ubicRef}`, ob ? ob.nombre : '']);
      if (selfieUrl) URL.revokeObjectURL(selfieUrl); selfieUrl = null; f.err = '';
      render();
    } else {
      const id = input.dataset.id;
      f.resp[id].foto = await comprimir(file, 1080, 0.65, [`${e.codigo} · ${fFecha(now)} ${fHora(now)} h`]);
      if (fotoUrls[id]) URL.revokeObjectURL(fotoUrls[id]); delete fotoUrls[id];
      const it = itemsDe(plDe(e)).find(i => i.id === id);
      $('#it-' + id.replace(/\./g, '-')).outerHTML = itemHtml(it, f.resp[id]);
    }
    guardarBorrador();
  } catch { toast('No se pudo leer la foto. Probá sacarla de nuevo.'); }
}
