// Órdenes de trabajo: la vista del mecánico en el celular y la pestaña Taller del panel.
import { esc, fFecha, fHora, fNum, unidad, toast, msgError, comprimir } from './util.js';
import { sb } from './datos.js';
import { S, render, esGestor } from './estado.js';

export const ESTADO = { abierta: ['Abierta', 'warn'], en_curso: ['En curso', 'acc'], esperando_repuestos: ['Esperando repuestos', 'warn'], terminada: ['Terminada', 'ok'], cancelada: ['Cancelada', 'plain'] };
export const PRIORIDAD = { alta: ['Alta', 'bad'], media: ['Media', 'warn'], baja: ['Baja', 'plain'] };
export const ABIERTAS = ['abierta', 'en_curso', 'esperando_repuestos'];
const fPeso = v => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const chip = (m, k) => `<span class="chip ${m[k][1]}">${m[k][0]}</span>`;
const E = () => S.m.empresa_id;
const SEL = 'id, numero, titulo, descripcion, prioridad, estado, asignado_a, creada_en, iniciada_en, terminada_en, trabajo_realizado, horas, costo_mano_obra, medidor, foto_path, libero_equipo, equipo_id, equipo:equipos(codigo, nombre, medidor, estado, ultimo_medidor)';

// Estado de la orden abierta en pantalla (compartido entre la vista del mecánico y el panel).
const D = () => (esGestor() && !S.modoOperario ? S.adm.ot : S.tal);

/* ================================================================ datos */
async function cargarLista(filtro) {
  let q = sb.from('ordenes_trabajo').select(SEL + ', fallas(id), repuestos:repuestos_orden(cantidad, costo_unitario)').eq('empresa_id', E())
    .order('creada_en', { ascending: false }).limit(300);
  if (filtro === 'abiertas') q = q.in('estado', ABIERTAS); else if (filtro === 'cerradas') q = q.in('estado', ['terminada', 'cancelada']);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
async function cargarOrden(id) {
  const [o, f, r] = await Promise.all([
    sb.from('ordenes_trabajo').select(SEL).eq('id', id).single(),
    sb.from('fallas').select('id, texto, nota, critica, grave, foto_path, estado, creada_en, seccion').eq('orden_id', id).order('critica', { ascending: false }),
    sb.from('repuestos_orden').select('*').eq('orden_id', id).order('creado_en'),
  ]);
  for (const x of [o, f, r]) if (x.error) throw x.error;
  const paths = [...f.data.map(x => x.foto_path), o.data.foto_path].filter(Boolean), urls = {};
  if (paths.length) { const { data } = await sb.storage.from('evidencias').createSignedUrls(paths, 3600); (data || []).forEach(u => { if (u.signedUrl) urls[u.path] = u.signedUrl; }); }
  return { o: o.data, fallas: f.data, rep: r.data, urls };
}
const costoRep = rs => (rs || []).reduce((s, r) => s + Number(r.cantidad) * Number(r.costo_unitario || 0), 0);
const nombreMiembro = id => { const ms = S.adm && S.adm.d ? S.adm.d.miembros : []; const m = ms.find(x => x.id === id); return m ? m.nombre : (id && S.m && id === S.m.id ? S.m.nombre : null); };

/* ================================================================ mecánico */
export function reiniciar() { S.tal = { lista: null, filtro: 'abiertas', err: '', cargando: false, det: null, rep: null, fin: null, ocupado: false }; }
export const clave = () => { const t = S.tal; const a = S.adm && S.adm.ot; return [t && t.det && t.det.o.id, a && a.det && a.det.o.id, a && !!a.nueva].join(','); };

export async function cargar() {
  const t = S.tal; if (!t || t.cargando) return;
  t.cargando = true;
  try { t.lista = await cargarLista(t.filtro); t.err = ''; } catch (e) { t.err = msgError(e); }
  t.cargando = false;
  if (t.det) await abrir(t.det.o.id, true);
  render();
}

export function vistaMecanico() {
  const t = S.tal;
  if (t.det) return `<main class="wrap">${vOrden(t)}</main>`;
  if (!t.lista) return `<main class="wrap">${t.err ? `<div class="badbox">${esc(t.err)}</div><button class="btn" data-act="otRecargar">Reintentar</button>` : '<p class="muted">Cargando órdenes…</p>'}</main>`;
  const abiertas = t.lista.filter(o => ABIERTAS.includes(o.estado));
  return `<main class="wrap"><section><p class="eyebrow">Taller</p><h1>Mis órdenes de trabajo</h1></section>
    <div class="seg-tabs" role="tablist">${[['abiertas', `Pendientes${t.filtro === 'abiertas' ? ` (${abiertas.length})` : ''}`], ['cerradas', 'Terminadas']].map(([k, l]) =>
      `<button role="tab" aria-selected="${t.filtro === k}" class="${t.filtro === k ? 'on' : ''}" data-act="otFiltro" data-k="${k}">${l}</button>`).join('')}</div>
    ${t.err ? `<div class="badbox">${esc(t.err)}</div>` : ''}
    ${t.lista.length ? `<div class="list">${t.lista.map(filaOrden).join('')}</div>` : `<div class="empty">${t.filtro === 'abiertas' ? 'No tenés órdenes pendientes.' : 'Todavía no terminaste órdenes.'}</div>`}
    <button class="btn ghost" data-act="otRecargar">${t.cargando ? 'Actualizando…' : 'Actualizar'}</button></main>`;
}

function filaOrden(o) {
  const rep = costoRep(o.repuestos);
  return `<button class="li" data-act="otAbrir" data-id="${o.id}"><span class="t">OT ${o.numero} · ${esc(o.equipo.codigo)} · ${esc(o.titulo)}</span>
    <span class="row" style="gap:4px">${o.estado === 'terminada' || o.estado === 'cancelada' ? '' : chip(PRIORIDAD, o.prioridad)}${chip(ESTADO, o.estado)}</span>
    <span class="s">${o.equipo.estado === 'bloqueado' ? '<b style="color:var(--bad)">Equipo bloqueado</b> · ' : ''}${o.fallas.length ? `${o.fallas.length} falla${o.fallas.length > 1 ? 's' : ''} · ` : ''}${esc(nombreMiembro(o.asignado_a) || (o.asignado_a ? '' : 'Sin asignar'))}${o.asignado_a && nombreMiembro(o.asignado_a) ? ' · ' : ''}${o.terminada_en ? 'terminada ' + fFecha(o.terminada_en) : 'creada ' + fFecha(o.creada_en)}${rep ? ' · repuestos ' + fPeso(rep) : ''}</span></button>`;
}

/* ================================================================ detalle (mecánico y panel) */
export function vOrden(t) {
  const { o, fallas, rep, urls } = t.det, gestor = esGestor() && !S.modoOperario, abierta = ABIERTAS.includes(o.estado);
  const puedo = gestor || o.asignado_a === S.m.id, u = unidad(o.equipo.medidor);
  const totRep = costoRep(rep);
  const fl = fallas.map(f => `<div class="fl">${f.critica ? '<span class="crit">CRÍTICO</span>' : f.grave ? '<span class="crit alerta">ADVERTENCIA</span>' : ''}<b>${esc(f.texto)}</b>
      <span>${esc(f.nota)}</span><span class="small muted">${fFecha(f.creada_en)}</span>
      ${urls[f.foto_path] ? `<a href="${urls[f.foto_path]}" target="_blank" rel="noopener"><img src="${urls[f.foto_path]}" alt="Foto de la falla" style="max-width:260px;border-radius:8px"></a>` : ''}
      ${f.estado === 'reparada' ? '<span class="chip ok">Reparada</span>' : ''}</div>`).join('');
  const reps = rep.map(r => `<div class="att" style="grid-template-columns:1fr auto auto"><div><div class="t">${esc(r.descripcion)}</div><div class="s">${fNum(r.cantidad)} × ${fPeso(r.costo_unitario)}</div></div>
      <b class="num">${r.costo_unitario != null ? fPeso(r.cantidad * r.costo_unitario) : '—'}</b>${abierta && puedo ? `<button class="btn sm ghost" data-act="otRepQuitar" data-id="${r.id}" aria-label="Quitar">✕</button>` : '<span></span>'}</div>`).join('');
  const nr = t.rep, fin = t.fin;
  const estados = abierta && puedo && !fin ? `<div class="row">${o.estado !== 'en_curso' ? '<button class="btn sm dark" data-act="otEstado" data-k="en_curso">Empezar / en curso</button>' : ''}
      ${o.estado !== 'esperando_repuestos' ? '<button class="btn sm" data-act="otEstado" data-k="esperando_repuestos">Esperando repuestos</button>' : ''}
      <button class="btn sm primary" data-act="otTerminar">Terminar orden</button>
      ${gestor ? `<button class="btn sm ghost" data-act="otEstado" data-k="cancelada">${t.confirm === 'cancelar' ? 'Tocá de nuevo para cancelar' : 'Cancelar orden'}</button>` : ''}</div>` : '';
  return `<button class="btn ghost sm" data-act="otVolver" style="align-self:flex-start">← Volver</button>
    <section class="card"><div class="row" style="justify-content:space-between"><div><p class="eyebrow">OT ${o.numero} · creada ${fFecha(o.creada_en)}</p><h1>${esc(o.equipo.codigo)} · ${esc(o.titulo)}</h1></div>
      <div class="row">${chip(PRIORIDAD, o.prioridad)}${chip(ESTADO, o.estado)}</div></div>
      <dl class="kv"><dt>Equipo</dt><dd>${esc(o.equipo.nombre)}${o.equipo.estado === 'bloqueado' ? ' <span class="chip bad">Bloqueado</span>' : ''} · <span class="num">${fNum(o.equipo.ultimo_medidor)} ${u}</span></dd>
        <dt>Asignada a</dt><dd>${gestor && abierta ? selMecanico(o.asignado_a, 'otAsignar') : esc(nombreMiembro(o.asignado_a) || 'Sin asignar')}</dd>
        ${gestor && abierta ? `<dt>Prioridad</dt><dd><select class="inp" id="ot-prio" data-otp="prioridad" data-vivo>${Object.entries(PRIORIDAD).map(([k, [l]]) => `<option value="${k}" ${o.prioridad === k ? 'selected' : ''}>${l}</option>`).join('')}</select></dd>` : ''}
        ${o.iniciada_en ? `<dt>Empezada</dt><dd>${fFecha(o.iniciada_en)} ${fHora(o.iniciada_en)} h</dd>` : ''}
        ${o.terminada_en ? `<dt>Terminada</dt><dd>${fFecha(o.terminada_en)} ${fHora(o.terminada_en)} h${o.libero_equipo ? ' · <b>liberó el equipo</b>' : ''}</dd>` : ''}</dl>
      ${o.descripcion ? `<p>${esc(o.descripcion)}</p>` : ''}${estados}</section>
    ${fallas.length ? `<section class="card flat"><h3>Fallas a reparar (${fallas.length})</h3>${fl}</section>` : ''}
    ${fin ? vTerminar(t) : ''}
    <section class="card flat"><div class="row" style="justify-content:space-between"><h3>Repuestos</h3><b class="num">${fPeso(totRep)}</b></div>
      ${reps || '<p class="muted small">Sin repuestos cargados.</p>'}
      ${abierta && puedo ? (nr ? `<div class="form-grid"><label class="f">Repuesto<input class="inp" id="ot-rd" data-otr="descripcion" value="${esc(nr.descripcion)}" placeholder="Ej.: filtro de aceite"></label>
          <label class="f">Cantidad<input class="inp num" id="ot-rc" type="number" inputmode="decimal" data-otr="cantidad" value="${esc(nr.cantidad)}"></label>
          <label class="f">Precio unitario <small>Opcional</small><input class="inp num" id="ot-rp" type="number" inputmode="decimal" data-otr="costo" value="${esc(nr.costo)}"></label></div>
          <div class="row"><button class="btn sm" data-act="otRepCancelar">Cancelar</button><button class="btn sm primary" data-act="otRepGuardar" ${t.ocupado ? 'disabled' : ''}>Agregar</button></div>`
        : '<button class="btn sm" data-act="otRepNuevo" style="align-self:flex-start">Agregar repuesto</button>') : ''}</section>
    ${o.estado === 'terminada' ? `<section class="card flat"><h3>Trabajo realizado</h3><p>${esc(o.trabajo_realizado)}</p>
      <dl class="kv">${o.horas != null ? `<dt>Horas de taller</dt><dd class="num">${fNum(o.horas)} h</dd>` : ''}${o.costo_mano_obra != null ? `<dt>Mano de obra</dt><dd class="num">${fPeso(o.costo_mano_obra)}</dd>` : ''}
        <dt>Costo total</dt><dd class="num"><b>${fPeso(totRep + Number(o.costo_mano_obra || 0))}</b></dd>${o.medidor != null ? `<dt>Medidor</dt><dd class="num">${fNum(o.medidor)} ${u}</dd>` : ''}</dl>
      ${urls[o.foto_path] ? `<img src="${urls[o.foto_path]}" alt="Foto del trabajo terminado" style="max-width:320px;border-radius:8px">` : ''}</section>` : ''}`;
}

function vTerminar(t) {
  const f = t.fin, o = t.det.o, crit = t.det.fallas.some(x => x.critica && x.estado === 'abierta');
  return `<section class="card"><h2>Terminar la orden</h2>
    <label class="f">¿Qué trabajo se hizo?<textarea class="inp" id="ot-tr" data-otf="trabajo" placeholder="Ej.: se cambió el cinturón de seguridad y la junta del cárter">${esc(f.trabajo)}</textarea></label>
    <div class="form-grid"><label class="f">Horas de taller<input class="inp num" id="ot-h" type="number" inputmode="decimal" data-otf="horas" value="${esc(f.horas)}"></label>
      <label class="f">Mano de obra ($) <small>Opcional</small><input class="inp num" id="ot-mo" type="number" inputmode="decimal" data-otf="mano" value="${esc(f.mano)}"></label>
      <label class="f">${o.equipo.medidor === 'km' ? 'Odómetro (km)' : 'Horómetro (h)'}<input class="inp num" id="ot-med" type="number" inputmode="decimal" data-otf="medidor" value="${esc(f.medidor)}"></label></div>
    <label class="btn ${f.foto ? '' : 'dark'}" style="align-self:flex-start">${f.foto ? 'Cambiar la foto' : 'Sacar foto del trabajo terminado'}
      <input class="vh" type="file" id="ot-foto" accept="image/*" capture="environment" data-file="ot"></label>
    ${f.foto ? `<img src="${f.fotoUrl ||= URL.createObjectURL(f.foto)}" alt="Foto del trabajo" style="max-width:240px;border-radius:8px">` : ''}
    ${o.equipo.estado === 'bloqueado' ? `<div class="${crit ? 'okbox' : 'warnbox'} small">${crit ? 'Al terminar, las fallas críticas quedan reparadas y el equipo se libera si no tiene otras.' : 'El equipo está bloqueado por otras fallas: seguirá bloqueado.'}</div>` : ''}
    <p class="small muted">Necesita señal para enviarse.</p>
    ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}
    <div class="row"><button class="btn sm" data-act="otTerminarCancelar">Cancelar</button><button class="btn sm primary" data-act="otTerminarOk" ${t.ocupado ? 'disabled' : ''}>${t.ocupado ? 'Enviando…' : 'Terminar orden'}</button></div></section>`;
}

function selMecanico(actual, act) {
  const ms = (S.adm && S.adm.d ? S.adm.d.miembros : []).filter(m => m.activo && ['mecanico', 'supervisor', 'admin', 'dueno'].includes(m.rol))
    .sort((a, b) => (a.rol === 'mecanico' ? 0 : 1) - (b.rol === 'mecanico' ? 0 : 1) || a.nombre.localeCompare(b.nombre));
  return `<select class="inp" id="sel-${act}" data-ota="${act}" data-vivo><option value="">Sin asignar</option>${ms.map(m => `<option value="${m.id}" ${m.id === actual ? 'selected' : ''}>${esc(m.nombre)}${m.rol === 'mecanico' ? '' : ' (' + m.rol + ')'}</option>`).join('')}</select>`;
}

async function abrir(id, silencioso) {
  const t = D();
  try { t.det = await cargarOrden(id); }
  catch (e) { if (!silencioso) toast(msgError(e)); t.det = null; }
  render();
}
async function recargar() {
  const t = D();
  if (t.det) await abrir(t.det.o.id, true);
  if (t === S.tal) cargar(); else { cargarTaller(); S.adm.recargar(); }
}
async function llamar(nombre, args, ok) {
  const t = D(); t.ocupado = true; render();
  const { data, error } = await sb.rpc(nombre, args);
  t.ocupado = false;
  if (error) { toast(msgError(error), 6000); render(); return null; }
  if (ok) toast(ok);
  await recargar();
  return data ?? true;
}

/* ================================================================ panel: pestaña Taller */
export async function cargarTaller() {
  const a = S.adm; a.ot ||= { filtro: 'abiertas', lista: null, det: null, nueva: null };
  try { a.ot.lista = await cargarLista(a.ot.filtro); } catch (e) { toast(msgError(e)); }
  render();
}

export function vTaller() {
  const a = S.adm, t = a.ot || { filtro: 'abiertas', lista: null };
  if (t.det) return vOrden(t);
  const filtros = `<section class="card"><div class="row" style="justify-content:space-between"><div class="seg-tabs" role="tablist">${[['abiertas', 'Abiertas'], ['cerradas', 'Cerradas'], ['todas', 'Todas']].map(([k, l]) =>
      `<button role="tab" aria-selected="${t.filtro === k}" class="${t.filtro === k ? 'on' : ''}" data-act="otFiltro" data-k="${k}">${l}</button>`).join('')}</div>
    ${t.nueva ? '' : '<button class="btn sm dark" data-act="otNueva">Nueva orden</button>'}</div>
    ${a.d.miembros.some(m => m.rol === 'mecanico') ? '' : '<p class="small muted">Todavía no hay mecánicos. Dalos de alta en Personal y obras con el rol Mecánico: entran con legajo y PIN y ven sus órdenes en el celular.</p>'}</section>`;
  const lista = !t.lista ? '<p class="muted">Cargando…</p>' : t.lista.length ? `<div class="list">${t.lista.map(filaOrden).join('')}</div>` : '<div class="empty">No hay órdenes con este filtro.</div>';
  return filtros + (t.nueva ? vNueva(t.nueva) : '') + lista;
}

function vNueva(n) {
  const d = S.adm.d, eqs = d.equipos.filter(e => e.activo), e = eqs.find(x => x.id === n.equipo_id);
  const enOrden = new Set(d.ordenes.flatMap(o => o.fallas.map(f => f.id)));
  const fs = e ? d.fallas.filter(f => f.equipo_id === e.id && !enOrden.has(f.id)) : [];
  return `<section class="card"><h2>Nueva orden de trabajo</h2><div class="form-grid">
    <label class="f">Equipo<select class="inp" id="on-eq" data-otn="equipo_id" data-vivo><option value="">Elegí el equipo</option>${eqs.map(x => `<option value="${x.id}" ${n.equipo_id === x.id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nombre)}${x.estado === 'bloqueado' ? ' (bloqueado)' : ''}</option>`).join('')}</select></label>
    <label class="f">Título<input class="inp" id="on-tit" data-otn="titulo" value="${esc(n.titulo)}" placeholder="Ej.: Cambio de manguera de pluma" maxlength="120"></label>
    <label class="f">Prioridad<select class="inp" id="on-pr" data-otn="prioridad">${Object.entries(PRIORIDAD).map(([k, [l]]) => `<option value="${k}" ${n.prioridad === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Asignar a${selMecanico(n.asignado_a, 'nueva')}</label></div>
    ${fs.length ? `<fieldset class="f"><legend class="small"><b>Fallas que resuelve</b></legend>${fs.map(f => `<label class="check"><input type="checkbox" data-otnf="${f.id}" ${n.falla_ids.includes(f.id) ? 'checked' : ''}>
      <span>${f.critica ? '<span class="crit">CRÍTICO</span>' : f.grave ? '<span class="crit alerta">ADVERTENCIA</span>' : ''}${esc(f.texto)} <span class="small muted">· ${esc(f.nota)} · ${fFecha(f.creada_en)}</span></span></label>`).join('')}</fieldset>`
      : e ? '<p class="small muted">Este equipo no tiene fallas abiertas sin orden. Podés crear igual una orden (por ejemplo, un trabajo preventivo).</p>' : ''}
    <label class="f">Indicaciones para el taller <small>Opcional</small><textarea class="inp" id="on-desc" data-otn="descripcion">${esc(n.descripcion)}</textarea></label>
    ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}
    <div class="row"><button class="btn sm" data-act="otNuevaCancelar">Cancelar</button><button class="btn sm primary" data-act="otNuevaGuardar" ${n.ocupado ? 'disabled' : ''}>Crear orden</button></div></section>`;
}

// Alertas del resumen: órdenes de prioridad alta abiertas y las que esperan repuestos hace más de 3 días.
export function alertasTaller(ordenes) {
  const out = [];
  (ordenes || []).forEach(o => {
    if (o.prioridad === 'alta') out.push(['bad', `OT ${o.numero} prioridad alta · ${o.equipo.codigo}`, `${o.titulo} · ${ESTADO[o.estado][0].toLowerCase()}${o.asignado_a ? '' : ' · sin asignar'}`, `<button class="btn sm" data-act="otAbrirPanel" data-id="${o.id}">Ver</button>`]);
    else if (o.estado === 'esperando_repuestos' && Date.now() - new Date(o.creada_en) > 3 * 864e5) out.push(['warn', `OT ${o.numero} esperando repuestos · ${o.equipo.codigo}`, `${o.titulo} · desde ${fFecha(o.creada_en)}`, `<button class="btn sm" data-act="otAbrirPanel" data-id="${o.id}">Ver</button>`]);
  });
  return out;
}

/* ================================================================ acciones */
export const A = {
  otRecargar: () => cargar(),
  otFiltro: b => { const t = esGestor() && !S.modoOperario ? S.adm.ot : S.tal; t.filtro = b.dataset.k; t.lista = null; render(); t === S.tal ? cargar() : cargarTaller(); },
  otAbrir: b => abrir(b.dataset.id),
  otAbrirPanel: b => { const a = S.adm; a.tab = 'taller'; a.ot ||= { filtro: 'abiertas', lista: null, det: null, nueva: null }; cargarTaller(); abrir(b.dataset.id); },
  otVolver: () => { const t = D(); t.det = null; t.rep = null; t.fin = null; t.confirm = null; render(); },
  otEstado: async b => {
    const t = D(), k = b.dataset.k;
    if (k === 'cancelada' && t.confirm !== 'cancelar') { t.confirm = 'cancelar'; return render(); }
    t.confirm = null;
    await llamar('cambiar_estado_orden', { p_orden: t.det.o.id, p_estado: k }, { en_curso: 'Orden en curso.', esperando_repuestos: 'Orden esperando repuestos.', cancelada: 'Orden cancelada.' }[k]);
  },
  otRepNuevo: () => { D().rep = { descripcion: '', cantidad: '1', costo: '' }; render(); },
  otRepCancelar: () => { D().rep = null; render(); },
  otRepGuardar: async () => {
    const t = D(), r = t.rep;
    if (r.descripcion.trim().length < 2) return toast('Escribí qué repuesto es.');
    if (!(+r.cantidad > 0)) return toast('Indicá la cantidad.');
    if (await llamar('agregar_repuesto', { p_orden: t.det.o.id, p_descripcion: r.descripcion.trim(), p_cantidad: +r.cantidad, p_costo: r.costo === '' ? null : +r.costo })) { t.rep = null; render(); }
  },
  otRepQuitar: b => llamar('quitar_repuesto', { p_repuesto: b.dataset.id }),
  otTerminar: () => { const t = D(); t.fin = { trabajo: '', horas: '', mano: '', medidor: t.det.o.equipo.ultimo_medidor ?? '', foto: null, fotoUrl: null, err: '' }; render(); },
  otTerminarCancelar: () => { const t = D(); if (t.fin && t.fin.fotoUrl) URL.revokeObjectURL(t.fin.fotoUrl); t.fin = null; render(); },
  otTerminarOk: async () => {
    const t = D(), f = t.fin, o = t.det.o; f.err = '';
    if (f.trabajo.trim().length < 5) { f.err = 'Contá qué trabajo se hizo.'; return render(); }
    if (!S.online) { f.err = 'Sin señal. Probá de nuevo cuando haya conexión.'; return render(); }
    t.ocupado = true; render();
    let foto = null;
    if (f.foto) {
      foto = `${E()}/${S.user.id}/ot-${o.numero}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('evidencias').upload(foto, f.foto, { contentType: 'image/jpeg', upsert: false });
      if (error) { t.ocupado = false; f.err = 'No se pudo subir la foto: ' + msgError(error); return render(); }
    }
    const { data, error } = await sb.rpc('terminar_orden', { p_orden: o.id, p: { trabajo_realizado: f.trabajo.trim(), horas: f.horas === '' ? null : +f.horas,
      costo_mano_obra: f.mano === '' ? null : +f.mano, medidor: f.medidor === '' ? null : +f.medidor, foto_path: foto } });
    t.ocupado = false;
    if (error) { f.err = msgError(error); return render(); }
    if (f.fotoUrl) URL.revokeObjectURL(f.fotoUrl);
    t.fin = null;
    toast(data.libero_equipo ? `OT ${o.numero} terminada. ${o.equipo.codigo} quedó liberado.` : `OT ${o.numero} terminada.`, 5000);
    await recargar();
  },
  otNueva: () => { S.adm.ot.nueva = { equipo_id: '', titulo: '', prioridad: 'media', asignado_a: '', descripcion: '', falla_ids: [], err: '' }; render(); },
  // Desde la pestaña Fallas: orden para esa falla (y se pueden sumar otras del mismo equipo).
  otDesdeFalla: b => {
    const a = S.adm, f = a.d.fallas.find(x => x.id === b.dataset.id);
    a.tab = 'taller'; a.ot ||= { filtro: 'abiertas', lista: null, det: null, nueva: null }; a.ot.det = null;
    a.ot.nueva = { equipo_id: f.equipo_id, titulo: f.texto.slice(0, 120), prioridad: f.critica ? 'alta' : f.grave ? 'media' : 'baja', asignado_a: '', descripcion: f.nota || '', falla_ids: [f.id], err: '' };
    cargarTaller();
  },
  otNuevaCancelar: () => { S.adm.ot.nueva = null; render(); },
  otNuevaGuardar: async () => {
    const n = S.adm.ot.nueva; n.err = '';
    if (!n.equipo_id) n.err = 'Elegí el equipo.'; else if (n.titulo.trim().length < 3) n.err = 'Escribí un título.';
    if (n.err) return render();
    n.ocupado = true; render();
    const { data, error } = await sb.rpc('crear_orden', { p: { equipo_id: n.equipo_id, falla_ids: n.falla_ids, titulo: n.titulo.trim(), descripcion: n.descripcion, prioridad: n.prioridad, asignado_a: n.asignado_a || null } });
    n.ocupado = false;
    if (error) { n.err = msgError(error); return render(); }
    S.adm.ot.nueva = null; toast(`OT ${data.numero} creada.`);
    await cargarTaller(); S.adm.recargar();
  },
};

export function alEscribir(el, v) {
  const t = D();
  if (el.dataset.otr && t && t.rep) { t.rep[el.dataset.otr] = v; return true; }
  if (el.dataset.otf && t && t.fin) { t.fin[el.dataset.otf] = v; return true; }
  if (!S.adm || !S.adm.ot) return false;
  const ot = S.adm.ot;
  if (el.dataset.otn && ot.nueva) { ot.nueva[el.dataset.otn] = v; if (el.dataset.otn === 'equipo_id') { ot.nueva.falla_ids = []; render(); } return true; }
  if (el.dataset.otnf && ot.nueva) { const ids = ot.nueva.falla_ids, id = el.dataset.otnf; ot.nueva.falla_ids = v ? [...ids, id] : ids.filter(x => x !== id); return true; }
  if (el.dataset.ota === 'nueva' && ot.nueva) { ot.nueva.asignado_a = v; return true; }
  if (el.dataset.ota === 'otAsignar' && ot.det) { llamar('editar_orden', { p_orden: ot.det.o.id, p: { asignado_a: v || null } }, 'Asignación guardada.'); return true; }
  if (el.dataset.otp && ot.det) { llamar('editar_orden', { p_orden: ot.det.o.id, p: { [el.dataset.otp]: v } }, 'Prioridad guardada.'); return true; }
  return false;
}

export async function alArchivo(input) {
  const t = D(), file = input.files && input.files[0]; if (!file || !t || !t.fin) return;
  try {
    const now = new Date(), o = t.det.o;
    t.fin.foto = await comprimir(file, 1080, 0.7, [`OT ${o.numero} · ${o.equipo.codigo} · trabajo terminado`, `${S.m.nombre} · ${fFecha(now)} ${fHora(now)} h`]);
    if (t.fin.fotoUrl) URL.revokeObjectURL(t.fin.fotoUrl); t.fin.fotoUrl = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    render();
  } catch { toast('No se pudo leer la foto. Probá de nuevo.'); }
}
