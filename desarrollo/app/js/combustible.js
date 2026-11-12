// Panel de combustible: litros, costo, consumo real por equipo, alertas y lista de cargas.
import { esc, fFecha, fHora, fNum, unidad, dayKey, uuid, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const ORIGEN = { surtidor_propio: 'Surtidor propio', cisterna: 'Camión cisterna', estacion: 'Estación de servicio', otro: 'Otro' };
export const unidadConsumo = m => m === 'km' ? 'L/100 km' : 'L/h';
const fPeso = v => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });

function rango(clave) {
  const h = new Date(), d = new Date();
  if (clave === 'mes') d.setDate(1); else if (clave === '7') d.setDate(d.getDate() - 6); else d.setDate(d.getDate() - 29);
  return { desde: dayKey(d), hasta: dayKey(h) };
}
export async function cargarCombustible() {
  const a = T(); a.cb ||= { periodo: '30', ...rango('30') };
  const f = a.cb; f.datos = null; render();
  const [cons, cargas] = await Promise.all([
    sb.rpc('consumo_combustible', { p_empresa: E(), p_desde: f.desde, p_hasta: f.hasta }),
    sb.from('cargas_combustible').select('*, equipo:equipos(codigo, nombre, medidor), quien:miembros(nombre), obra:obras(nombre)').eq('empresa_id', E())
      .gte('cargado_en', new Date(f.desde + 'T00:00:00').toISOString()).lt('cargado_en', new Date(new Date(f.hasta + 'T00:00:00').getTime() + 864e5).toISOString())
      .order('cargado_en', { ascending: false }).limit(500),
  ]);
  if (cons.error || cargas.error) return toast(msgError(cons.error || cargas.error));
  const fotos = cargas.data.map(c => c.foto_path).filter(Boolean), urls = {};
  if (fotos.length) { const { data } = await sb.storage.from('evidencias').createSignedUrls(fotos, 3600); (data || []).forEach(u => { if (u.signedUrl) urls[u.path] = u.signedUrl; }); }
  f.datos = { cons: cons.data, cargas: cargas.data, urls }; render();
}

export function alertasCombustible(cons) {
  return (cons || []).filter(c => c.alerta).map(c => [c.alerta === 'sin_uso' ? 'bad' : 'warn',
    c.alerta === 'sin_uso' ? `Carga sin uso registrado · ${c.codigo}` : `Consumo alto de combustible · ${c.codigo}`,
    c.alerta === 'sin_uso' ? 'Se llenó el tanque sin que avance el horómetro u odómetro desde la carga anterior'
      : `Último tramo ${fNum(c.ultimo_tramo)} ${unidadConsumo(c.medidor)} contra ${fNum(c.referencia)} habitual (+${Math.round(c.desvio * 100)}%)`,
    `<button class="btn sm" data-act="admTab" data-k="combustible">Ver</button>`]);
}

export function vCombustible() {
  const a = T(), f = a.cb || { periodo: '30', ...rango('30') }, x = f.datos;
  const filtros = `<section class="card"><div class="filters ind-filtros">
    <label>Período<select class="inp" id="cb-per" data-cb="periodo" data-vivo>${[['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['mes', 'Este mes'], ['otro', 'Otro']].map(([v, l]) => `<option value="${v}" ${f.periodo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Desde<input class="inp" type="date" id="cb-des" data-cb="desde" data-vivo value="${f.desde}"></label>
    <label>Hasta<input class="inp" type="date" id="cb-has" data-cb="hasta" data-vivo value="${f.hasta}"></label>
    <label>&nbsp;<button class="btn sm dark" data-act="cbNueva">Registrar carga</button></label></div></section>`;
  if (!x) return filtros + '<p class="muted">Calculando…</p>';
  const tot = x.cargas.reduce((s, c) => s + Number(c.litros), 0), costo = x.cargas.reduce((s, c) => s + (c.precio_litro != null ? c.litros * c.precio_litro : 0), 0);
  const sinPrecio = x.cargas.filter(c => c.precio_litro == null).length;
  const alertas = alertasCombustible(x.cons);
  const ed = a.cbEd;
  const filas = x.cons.map(c => {
    const u = unidadConsumo(c.medidor), chip = c.alerta === 'consumo_alto' ? '<span class="chip warn">Consumo alto</span>' : c.alerta === 'sin_uso' ? '<span class="chip bad">Carga sin uso</span>' : c.ultimo_tramo != null ? '<span class="chip ok">Normal</span>' : '<span class="chip plain">Faltan datos</span>';
    const editando = ed && ed.id === c.equipo_id;
    return `<tr><td><b>${esc(c.codigo)}</b> <span class="muted">${esc(c.nombre)}</span></td><td class="n">${fNum(c.litros)} L</td><td class="n">${c.cargas}</td>
      <td class="n">${c.consumo_periodo != null ? fNum(c.consumo_periodo) + ' ' + u : '—'}</td><td class="n">${c.ultimo_tramo != null ? fNum(c.ultimo_tramo) + ' ' + u : '—'}</td>
      <td class="n">${editando ? `<input class="inp num cb-ref" id="cb-ref" data-cbe="ref" value="${esc(ed.ref)}" placeholder="${u}">` : c.referencia != null ? `${fNum(c.referencia)} ${u}<br><span class="small muted">${c.origen_referencia === 'cargada' ? 'cargada' : 'según historial'}</span>` : '—'}</td>
      <td>${chip}${c.desvio != null && !c.alerta ? ` <span class="small muted">${c.desvio > 0 ? '+' : ''}${Math.round(c.desvio * 100)}%</span>` : ''}</td>
      <td>${editando ? `<label class="small">Tanque (L) <input class="inp num cb-ref" id="cb-cap" data-cbe="cap" value="${esc(ed.cap)}"></label><div class="row"><button class="btn sm" data-act="cbEdCancelar">Cancelar</button><button class="btn sm primary" data-act="cbEdGuardar">Guardar</button></div>`
        : `<button class="btn sm ghost" data-act="cbEd" data-id="${c.equipo_id}">Referencia</button>`}</td></tr>`;
  }).join('');
  return `${filtros}${vNueva()}
    <div class="kpis"><div class="kpi"><b>${fNum(tot)} L</b><span>Litros cargados</span></div>
      <div class="kpi"><b>${fPeso(costo)}</b><span>Costo${sinPrecio ? ` (${sinPrecio} carga${sinPrecio > 1 ? 's' : ''} sin precio)` : ''}</span></div>
      <div class="kpi"><b>${x.cargas.length}</b><span>Cargas registradas</span></div>
      <div class="kpi ${alertas.length ? 'warn' : ''}"><b>${alertas.length}</b><span>Equipos con consumo fuera de lo normal</span></div></div>
    ${alertas.length ? `<section class="card"><h2>Requiere atención</h2><div>${alertas.map(([s, t, d]) => `<div class="att" style="grid-template-columns:auto 1fr"><span class="sev ${s}"></span><div><div class="t">${esc(t)}</div><div class="s">${esc(d)}</div></div></div>`).join('')}</div></section>` : ''}
    <section class="card"><h2>Consumo por equipo</h2>
      <p class="small muted">El consumo se calcula entre dos cargas con tanque lleno: litros cargados dividido horas (o km) trabajadas. "Referencia" es el consumo normal de la máquina: cargalo del manual o se toma del historial.</p>
      ${filas ? `<div class="tabla"><table><thead><tr><th>Equipo</th><th class="n">Litros</th><th class="n">Cargas</th><th class="n">Consumo período</th><th class="n">Último tramo</th><th class="n">Referencia</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
        : '<div class="empty">Todavía no hay cargas. Los operarios las registran desde su inicio con "Registrar carga de combustible".</div>'}</section>
    <section class="card"><h2>Cargas (${x.cargas.length})</h2>${x.cargas.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Equipo</th><th>Cargó</th><th class="n">Litros</th><th class="n">Medidor</th><th>Tanque</th><th>Origen</th><th class="n">$/L</th><th>Foto</th></tr></thead><tbody>
      ${x.cargas.map(c => `<tr><td>${fFecha(c.cargado_en)} ${fHora(c.cargado_en)}</td><td>${esc(c.equipo.codigo)}</td><td>${esc(c.quien ? c.quien.nombre : '—')}</td><td class="n">${fNum(c.litros)}</td>
        <td class="n">${c.medidor != null ? fNum(c.medidor) + ' ' + unidad(c.equipo.medidor) : '—'}</td><td>${c.tanque_lleno ? 'Lleno' : 'Parcial'}</td><td>${esc(ORIGEN[c.origen])}${c.proveedor ? ' · ' + esc(c.proveedor) : ''}</td>
        <td class="n">${c.precio_litro != null ? fNum(c.precio_litro) : '—'}</td><td>${x.urls[c.foto_path] ? `<a href="${x.urls[c.foto_path]}" target="_blank" rel="noopener">Ver</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin cargas en el período.</p>'}</section>`;
}

function vNueva() {
  const n = T().cbNueva; if (!n) return '';
  const eqs = T().d.equipos.filter(e => e.activo), e = eqs.find(x => x.id === n.equipo_id);
  return `<section class="card"><h2>Registrar carga</h2><div class="form-grid">
    <label class="f">Equipo<select class="inp" id="cn-eq" data-cn="equipo_id" data-vivo><option value="">Elegí el equipo</option>${eqs.map(x => `<option value="${x.id}" ${n.equipo_id === x.id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join('')}</select></label>
    <label class="f">Fecha y hora<input class="inp" type="datetime-local" id="cn-fec" data-cn="cuando" value="${esc(n.cuando)}"></label>
    <label class="f">Litros<input class="inp num" id="cn-l" type="number" inputmode="decimal" data-cn="litros" value="${esc(n.litros)}"></label>
    <label class="f">${e && e.medidor === 'km' ? 'Odómetro (km)' : 'Horómetro (h)'}<input class="inp num" id="cn-m" type="number" inputmode="decimal" data-cn="medidor" value="${esc(n.medidor)}"></label>
    <label class="f">Origen<select class="inp" id="cn-o" data-cn="origen">${Object.entries(ORIGEN).map(([v, l]) => `<option value="${v}" ${n.origen === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Precio por litro <small>Opcional</small><input class="inp num" id="cn-pr" type="number" inputmode="decimal" data-cn="precio" value="${esc(n.precio)}"></label></div>
    <label class="check"><input type="checkbox" id="cn-ll" data-cn="lleno" ${n.lleno ? 'checked' : ''}><span>Tanque lleno</span></label>
    ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="cbNuevaCancelar">Cancelar</button><button class="btn sm primary" data-act="cbNuevaGuardar">Guardar</button></div></section>`;
}

export const A = {
  cbNueva: () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); T().cbNueva = { equipo_id: '', cuando: d.toISOString().slice(0, 16), litros: '', medidor: '', origen: 'surtidor_propio', precio: '', lleno: true, err: '' }; render(); },
  cbNuevaCancelar: () => { T().cbNueva = null; render(); },
  cbNuevaGuardar: async () => {
    const n = T().cbNueva; n.err = '';
    if (!n.equipo_id) n.err = 'Elegí el equipo.'; else if (!(+n.litros > 0)) n.err = 'Indicá los litros.';
    if (n.err) return render();
    const { error } = await sb.rpc('registrar_carga', { p: { client_id: uuid(), equipo_id: n.equipo_id, cargado_en: new Date(n.cuando).toISOString(), litros: +n.litros,
      medidor: n.medidor === '' ? null : +n.medidor, tanque_lleno: !!n.lleno, origen: n.origen, precio_litro: n.precio === '' ? null : +n.precio } });
    if (error) { n.err = msgError(error); return render(); }
    T().cbNueva = null; toast('Carga registrada.'); cargarCombustible(); S.adm.recargar();
  },
  cbEd: b => { const e = T().d.equipos.find(x => x.id === b.dataset.id); T().cbEd = { id: e.id, ref: e.consumo_referencia ?? '', cap: e.capacidad_tanque ?? '' }; render(); },
  cbEdCancelar: () => { T().cbEd = null; render(); },
  cbEdGuardar: async () => {
    const ed = T().cbEd;
    const { error } = await sb.from('equipos').update({ consumo_referencia: ed.ref === '' ? null : +ed.ref, capacidad_tanque: ed.cap === '' ? null : +ed.cap }).eq('id', ed.id);
    if (error) return toast(msgError(error));
    T().cbEd = null; toast('Referencia guardada.'); await S.adm.recargar(); cargarCombustible();
  },
};
export function alEscribir(el, v) {
  const a = T(); if (!a) return false;
  if (el.dataset.cb) { const f = a.cb ||= { periodo: '30', ...rango('30') }; f[el.dataset.cb] = v; if (el.dataset.cb === 'periodo' && v !== 'otro') Object.assign(f, rango(v)); if (el.dataset.cb !== 'periodo') f.periodo = 'otro'; cargarCombustible(); return true; }
  if (el.dataset.cn && a.cbNueva) { a.cbNueva[el.dataset.cn] = v; if (el.dataset.cn === 'equipo_id') { const e = a.d.equipos.find(x => x.id === v); a.cbNueva.medidor = e && e.ultimo_medidor != null ? e.ultimo_medidor : ''; render(); } return true; }
  if (el.dataset.cbe && a.cbEd) { a.cbEd[el.dataset.cbe] = v; return true; }
  return false;
}
