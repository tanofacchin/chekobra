// Panel de combustible: litros y costo (con precio estimado si falta), tanques propios con stock y faltantes,
// litros por día, consumo real por equipo y lista de cargas con filtros.
import { esc, fFecha, fHora, fNum, unidad, dayKey, uuid, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render, esAdmin } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const ORIGEN = { surtidor_propio: 'Surtidor propio', cisterna: 'Camión cisterna', estacion: 'Estación de servicio', otro: 'Otro' };
export const unidadConsumo = m => m === 'km' ? 'L/100 km' : 'L/h';
const fPeso = v => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const ahoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function rango(clave) {
  const h = new Date(), d = new Date();
  if (clave === 'mes') d.setDate(1); else if (clave === '7') d.setDate(d.getDate() - 6); else d.setDate(d.getDate() - 29);
  return { desde: dayKey(d), hasta: dayKey(h) };
}
const filtro = () => (T().cb ||= { periodo: '30', ...rango('30'), equipo: '', obra: '' });

export async function cargarCombustible() {
  const f = filtro(); f.datos = null; render();
  const hasta = new Date(new Date(f.hasta + 'T00:00:00').getTime() + 864e5).toISOString();
  const [cons, cargas, stock, movs, emp] = await Promise.all([
    sb.rpc('consumo_combustible', { p_empresa: E(), p_desde: f.desde, p_hasta: f.hasta }),
    sb.from('cargas_combustible').select('*, equipo:equipos(codigo, nombre, medidor), quien:miembros(nombre), obra:obras(nombre), tanque:tanques(nombre)').eq('empresa_id', E())
      .gte('cargado_en', new Date(f.desde + 'T00:00:00').toISOString()).lt('cargado_en', hasta).order('cargado_en', { ascending: false }).limit(1000),
    sb.rpc('stock_tanques', { p_empresa: E() }),
    sb.from('movimientos_tanque').select('*, quien:miembros(nombre)').eq('empresa_id', E()).order('fecha', { ascending: false }).limit(300),
    sb.from('empresas').select('precio_gasoil').eq('id', E()).single(),
  ]);
  const err = [cons, cargas, stock, movs, emp].find(r => r.error);
  if (err) { toast(msgError(err.error)); f.datos = { cons: [], cargas: [], tanques: [], movs: [], urls: {}, precioRef: null }; return render(); }
  const fotos = cargas.data.map(c => c.foto_path).filter(Boolean), urls = {};
  if (fotos.length) { const { data } = await sb.storage.from('evidencias').createSignedUrls(fotos, 3600); (data || []).forEach(u => { if (u.signedUrl) urls[u.path] = u.signedUrl; }); }
  f.datos = { cons: cons.data, cargas: cargas.data, tanques: stock.data, movs: movs.data, urls, precioRef: emp.data.precio_gasoil };
  render();
}

// Precio de una carga: el cargado; si no, el del tanque (promedio de las últimas compras); si no, el de referencia.
function precioDe(c, x) {
  if (c.precio_litro != null) return { p: Number(c.precio_litro), est: false };
  const t = c.tanque_id && x.tanques.find(q => q.id === c.tanque_id);
  if (t && t.precio != null) return { p: Number(t.precio), est: true };
  if (x.precioRef != null) return { p: Number(x.precioRef), est: true };
  return { p: null, est: true };
}

export function alertasCombustible(cons) {
  return (cons || []).filter(c => c.alerta).map(c => [c.alerta === 'sin_uso' ? 'bad' : 'warn',
    c.alerta === 'sin_uso' ? `Carga sin uso registrado · ${c.codigo}` : `Consumo alto de combustible · ${c.codigo}`,
    c.alerta === 'sin_uso' ? 'Se llenó el tanque sin que avance el horómetro u odómetro desde la carga anterior'
      : `Último tramo ${fNum(c.ultimo_tramo)} ${unidadConsumo(c.medidor)} contra ${fNum(c.referencia)} habitual (+${Math.round(c.desvio * 100)}%)`,
    `<button class="btn sm" data-act="admTab" data-k="combustible">Ver</button>`]);
}
export function alertasTanques(ts) {
  const out = [];
  (ts || []).filter(t => t.activo).forEach(t => {
    if (t.faltante) out.push(['bad', `Faltante en ${t.nombre}`, `En la medición del ${fFecha(t.ultima_medicion)} había ${fNum(t.medido)} L y tendría que haber ${fNum(t.esperado_en_medicion)} L (${fNum(-t.diferencia)} L menos).`]);
    if (t.pct != null && t.pct < 15) out.push(['warn', `${t.nombre} casi vacío`, `Quedan unos ${fNum(t.stock)} L (${t.pct} %)${t.autonomia_dias != null ? `, alcanza para ${t.autonomia_dias} día${t.autonomia_dias === 1 ? '' : 's'}` : ''}.`]);
    if (t.sin_medicion) out.push(['warn', `${t.nombre} sin medición`, 'Cargá cuánto hay ahora en el tanque: desde ahí se controla el stock.']);
  });
  return out;
}

/* ------------------------------------------------------------ vista */
export function vCombustible() {
  const a = T(), f = filtro(), x = f.datos, d = a.d;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const filtros = `<section class="card"><div class="filters cb-filtros">
    <label>Período<select class="inp" id="cb-per" data-cb="periodo" data-vivo>${[['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['mes', 'Este mes'], ['otro', 'Otro']].map(([v, l]) => opt(v, l, f.periodo)).join('')}</select></label>
    <label>Desde<input class="inp" type="date" id="cb-des" data-cb="desde" data-vivo value="${f.desde}"></label>
    <label>Hasta<input class="inp" type="date" id="cb-has" data-cb="hasta" data-vivo value="${f.hasta}"></label>
    <label>Equipo<select class="inp" id="cb-eq" data-cbf="equipo" data-vivo>${opt('', 'Todos', f.equipo)}${d.equipos.map(e => opt(e.id, e.codigo, f.equipo)).join('')}</select></label>
    <label>Obra<select class="inp" id="cb-ob" data-cbf="obra" data-vivo>${opt('', 'Todas', f.obra)}${opt('-', 'Sin obra', f.obra)}${d.obras.map(o => opt(o.id, o.nombre, f.obra)).join('')}</select></label></div>
    <div class="row"><button class="btn sm dark" data-act="cbNueva">Registrar carga</button><button class="btn sm" data-act="cbMov" data-k="ingreso">Registrar compra al tanque</button><button class="btn sm ghost" data-act="cbMov" data-k="medicion">Medir un tanque</button></div></section>`;
  if (!x) return filtros + '<p class="muted">Calculando…</p>';
  const cargas = x.cargas.filter(c => (!f.equipo || c.equipo_id === f.equipo) && (!f.obra || (f.obra === '-' ? !c.obra_id : c.obra_id === f.obra)));
  const litros = cargas.reduce((s, c) => s + Number(c.litros), 0);
  let costo = 0, estimado = 0, sinPrecio = 0;
  cargas.forEach(c => { const { p, est } = precioDe(c, x); if (p == null) sinPrecio++; else { costo += c.litros * p; if (est) estimado += c.litros * p; } });
  const alertas = [...alertasTanques(x.tanques), ...alertasCombustible(x.cons)];
  return `${filtros}${vForms()}
    <div class="kpis"><div class="kpi"><b>${fNum(litros)} L</b><span>Cargados en el período${f.equipo || f.obra ? ' (filtrado)' : ''}</span></div>
      <div class="kpi"><b>${fPeso(costo)}</b><span>${estimado ? `Costo · incluye ${fPeso(estimado)} estimado` : 'Costo'}${sinPrecio ? ` · ${sinPrecio} sin precio` : ''}</span></div>
      <div class="kpi"><b>${litros ? fPeso(costo / Math.max(1, litros - cargas.filter(c => precioDe(c, x).p == null).reduce((s, c) => s + Number(c.litros), 0))) : '—'}</b><span>Precio promedio por litro</span></div>
      <div class="kpi ${alertas.length ? 'warn' : ''}"><b>${alertas.length}</b><span>Alertas</span></div></div>
    ${alertas.length ? `<section class="card"><h2>Requiere atención</h2><div>${alertas.map(([s, t, dd]) => `<div class="att" style="grid-template-columns:auto 1fr"><span class="sev ${s}"></span><div><div class="t">${esc(t)}</div><div class="s">${esc(dd)}</div></div></div>`).join('')}</div></section>` : ''}
    ${vTanques(x)}
    ${vPrecioRef(x)}
    ${vPorDia(cargas, f)}
    ${vConsumo(x)}
    ${vCargas(cargas, x)}`;
}

function vTanques(x) {
  const a = T(), ts = x.tanques.filter(t => t.activo);
  const barra = t => t.pct == null ? '' : `<div class="nivel" role="img" aria-label="${t.pct} % del tanque"><span style="width:${Math.max(0, Math.min(100, t.pct))}%" class="${t.pct < 15 ? 'bajo' : t.pct < 35 ? 'medio' : ''}"></span></div>`;
  const card = t => {
    const movs = x.movs.filter(m => m.tanque_id === t.id), abierto = a.cbTanque === t.id;
    const desp = x.cargas.filter(c => c.tanque_id === t.id).slice(0, 10);
    return `<div class="tanque ${t.faltante ? 'mal' : ''}"><div class="row" style="justify-content:space-between"><div><b>${esc(t.nombre)}</b>${t.obra ? `<div class="small muted">${esc(t.obra)}</div>` : ''}</div>
        ${t.precio != null ? `<span class="chip plain">${fPeso(t.precio)}/L</span>` : ''}</div>
      <div class="tanque-stock"><b class="num">${fNum(Math.max(0, t.stock))} L</b><span class="muted small">${t.capacidad ? `de ${fNum(t.capacidad)} L` : 'en el tanque'}${t.sin_medicion ? ' · estimado sin medición' : ''}</span></div>
      ${barra(t)}
      <div class="small muted">${t.autonomia_dias != null ? `Alcanza para unos <b>${t.autonomia_dias} día${t.autonomia_dias === 1 ? '' : 's'}</b> · ` : ''}salieron ${fNum(t.despachado_30d)} L en 30 días · entraron ${fNum(t.ingresado_30d)} L</div>
      ${t.ultima_medicion ? `<div class="small ${t.faltante ? 'txt-bad' : 'muted'}">Última medición ${fFecha(t.ultima_medicion)}: ${fNum(t.medido)} L${t.diferencia != null ? ` · ${t.diferencia < 0 ? `faltaron ${fNum(-t.diferencia)} L` : t.diferencia > 0 ? `sobraron ${fNum(t.diferencia)} L` : 'sin diferencias'} contra lo esperado` : ''}</div>` : ''}
      <div class="row"><button class="btn sm" data-act="cbMov" data-k="ingreso" data-id="${t.id}">Compra</button><button class="btn sm" data-act="cbMov" data-k="medicion" data-id="${t.id}">Medición</button>
        <button class="btn sm ghost" data-act="cbTanqueVer" data-id="${t.id}" aria-expanded="${abierto}">${abierto ? 'Ocultar movimientos' : 'Movimientos'}</button></div>
      ${abierto ? `<div class="movs">${[...movs.map(m => ({ f: m.fecha, h: `<b>${m.tipo === 'ingreso' ? 'Compra' : 'Medición'}</b> ${fNum(m.litros)} L${m.precio_litro != null ? ` a ${fPeso(m.precio_litro)}/L` : ''}${m.proveedor ? ' · ' + esc(m.proveedor) : ''}${m.remito ? ' · remito ' + esc(m.remito) : ''}${m.quien ? ` · ${esc(m.quien.nombre)}` : ''}`, id: m.id })),
          ...desp.map(c => ({ f: c.cargado_en, h: `Despacho ${fNum(c.litros)} L a <b>${esc(c.equipo.codigo)}</b>${c.quien ? ` · ${esc(c.quien.nombre)}` : ''}` }))]
          .sort((p, q) => new Date(q.f) - new Date(p.f)).slice(0, 20).map(r => `<div class="mov"><span class="small muted">${fFecha(r.f)} ${fHora(r.f)}</span><span>${r.h}</span>${r.id && esAdmin() ? `<button class="btn sm ghost" data-act="cbMovBorrar" data-id="${r.id}" aria-label="Borrar">${a.confirm === 'mov' + r.id ? 'Tocá de nuevo' : '✕'}</button>` : '<span></span>'}</div>`).join('') || '<p class="muted small">Sin movimientos.</p>'}</div>` : ''}</div>`;
  };
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Tanques propios</h2>
      <p class="small muted">Stock = última medición + compras − lo que se cargó a los equipos. Medí el tanque cada tanto (varilla o medidor) para detectar faltantes.</p></div>
      ${a.cbTq ? '' : '<button class="btn sm dark" data-act="cbTqNuevo">Agregar tanque</button>'}</div>
    ${a.cbTq ? vTanqueNuevo() : ''}
    ${ts.length ? `<div class="tanques">${ts.map(card).join('')}</div>` : a.cbTq ? '' : '<div class="empty">Si tenés surtidor propio o cisterna, agregalo para controlar el stock y saber a qué precio sale el litro.</div>'}</section>`;
}

function vTanqueNuevo() {
  const n = T().cbTq, d = T().d;
  return `<div class="stack card flat"><div class="form-grid">
      <label class="f">Nombre<input class="inp" id="tq-nom" data-cbt="nombre" value="${esc(n.nombre)}" placeholder="Ej.: Tanque obrador Ruta 5" maxlength="60"></label>
      <label class="f">Capacidad (L) <small>Opcional</small><input class="inp num" id="tq-cap" type="number" inputmode="decimal" data-cbt="capacidad" value="${esc(n.capacidad)}"></label>
      <label class="f">Obra donde está <small>Opcional</small><select class="inp" id="tq-ob" data-cbt="obra_id"><option value="">—</option>${d.obras.filter(o => o.activa).map(o => `<option value="${o.id}" ${n.obra_id === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
      <label class="f">Litros que tiene ahora<input class="inp num" id="tq-ini" type="number" inputmode="decimal" data-cbt="inicial" value="${esc(n.inicial)}"></label></div>
    ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}
    <div class="row"><button class="btn sm" data-act="cbTqCancelar">Cancelar</button><button class="btn sm primary" data-act="cbTqGuardar">Guardar tanque</button></div></div>`;
}

function vPrecioRef(x) {
  const a = T(), ed = a.cbPrecio;
  return `<section class="card flat"><div class="row" style="justify-content:space-between;align-items:center"><div><h3>Precio de referencia del gasoil</h3>
      <p class="small muted">Se usa para las cargas sin precio que no salen de un tanque con compras cargadas (por ejemplo, estaciones sin ticket). Esos montos se muestran como estimados.</p></div>
      ${ed ? `<div class="row"><input class="inp num" id="cb-pref" type="number" inputmode="decimal" data-cbp="valor" value="${esc(ed.valor)}" style="width:140px" aria-label="Precio por litro"><button class="btn sm" data-act="cbPrecioCancelar">Cancelar</button><button class="btn sm primary" data-act="cbPrecioGuardar">Guardar</button></div>`
        : `<div class="row"><b class="num">${x.precioRef != null ? fPeso(x.precioRef) + '/L' : 'Sin cargar'}</b>${esAdmin() ? '<button class="btn sm ghost" data-act="cbPrecio">Cambiar</button>' : ''}</div>`}</div></section>`;
}

// Litros por día (barras): para ver de un vistazo cuándo se cargó más.
function vPorDia(cargas, f) {
  const dias = [], ini = new Date(f.desde + 'T12:00:00'), fin = new Date(f.hasta + 'T12:00:00');
  for (let d = new Date(ini); d <= fin && dias.length < 93; d.setDate(d.getDate() + 1)) dias.push(dayKey(d));
  const porDia = Object.fromEntries(dias.map(k => [k, 0]));
  cargas.forEach(c => { const k = dayKey(c.cargado_en); if (k in porDia) porDia[k] += Number(c.litros); });
  const max = Math.max(1, ...Object.values(porDia));
  if (!cargas.length) return '';
  const W = 100 / dias.length;
  return `<section class="card"><h2>Litros por día</h2>
    <div class="barras" role="img" aria-label="Litros cargados por día">${dias.map(k => `<div class="barra" style="width:${W}%" title="${fFecha(k + 'T12:00:00')}: ${fNum(porDia[k])} L"><span style="height:${(porDia[k] / max) * 100}%"></span></div>`).join('')}</div>
    <div class="row small muted" style="justify-content:space-between"><span>${fFecha(f.desde + 'T12:00:00')}</span><span>Máximo: ${fNum(max)} L en un día</span><span>${fFecha(f.hasta + 'T12:00:00')}</span></div></section>`;
}

function vConsumo(x) {
  const ed = T().cbEd;
  const filas = x.cons.map(c => {
    const u = unidadConsumo(c.medidor), chip = c.alerta === 'consumo_alto' ? '<span class="chip warn">Consumo alto</span>' : c.alerta === 'sin_uso' ? '<span class="chip bad">Carga sin uso</span>' : c.ultimo_tramo != null ? '<span class="chip ok">Normal</span>' : '<span class="chip plain">Faltan datos</span>';
    const editando = ed && ed.id === c.equipo_id;
    return `<tr><td data-l="Equipo"><b>${esc(c.codigo)}</b> <span class="muted">${esc(c.nombre)}</span></td><td class="n" data-l="Litros">${fNum(c.litros)} L</td><td class="n" data-l="Cargas">${c.cargas}</td>
      <td class="n" data-l="Consumo período">${c.consumo_periodo != null ? fNum(c.consumo_periodo) + ' ' + u : '—'}</td><td class="n" data-l="Último tramo">${c.ultimo_tramo != null ? fNum(c.ultimo_tramo) + ' ' + u : '—'}</td>
      <td class="n" data-l="Referencia">${editando ? `<input class="inp num cb-ref" id="cb-ref" data-cbe="ref" value="${esc(ed.ref)}" placeholder="${u}">` : c.referencia != null ? `${fNum(c.referencia)} ${u} <span class="small muted">${c.origen_referencia === 'cargada' ? '(cargada)' : '(historial)'}</span>` : '—'}</td>
      <td data-l="Estado">${chip}${c.desvio != null && !c.alerta ? ` <span class="small muted">${c.desvio > 0 ? '+' : ''}${Math.round(c.desvio * 100)}%</span>` : ''}</td>
      <td>${editando ? `<label class="small">Tanque (L) <input class="inp num cb-ref" id="cb-cap" data-cbe="cap" value="${esc(ed.cap)}"></label><div class="row"><button class="btn sm" data-act="cbEdCancelar">Cancelar</button><button class="btn sm primary" data-act="cbEdGuardar">Guardar</button></div>`
        : `<button class="btn sm ghost" data-act="cbEd" data-id="${c.equipo_id}">Referencia</button>`}</td></tr>`;
  }).join('');
  return `<section class="card"><h2>Consumo por equipo</h2>
      <p class="small muted">Entre dos cargas con tanque lleno: litros cargados dividido horas (o km) trabajadas. "Referencia" es el consumo normal de la máquina: cargalo del manual o se toma del historial.</p>
      ${filas ? `<div class="tabla tabla-cel"><table><thead><tr><th>Equipo</th><th class="n">Litros</th><th class="n">Cargas</th><th class="n">Consumo período</th><th class="n">Último tramo</th><th class="n">Referencia</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
        : '<div class="empty">Todavía no hay cargas. Los operarios las registran desde su inicio con "Registrar carga de combustible".</div>'}</section>`;
}

function vCargas(cargas, x) {
  const a = T(), max = a.cbMas ? cargas.length : 50;
  return `<section class="card"><h2>Cargas (${cargas.length})</h2>${cargas.length ? `<div class="tabla tabla-cel"><table><thead><tr><th>Fecha</th><th>Equipo</th><th>Obra</th><th>Cargó</th><th class="n">Litros</th><th class="n">Medidor</th><th>De dónde</th><th class="n">$/L</th><th>Foto</th></tr></thead><tbody>
      ${cargas.slice(0, max).map(c => { const { p, est } = precioDe(c, x); return `<tr><td data-l="Fecha">${fFecha(c.cargado_en)} ${fHora(c.cargado_en)}</td><td data-l="Equipo"><b>${esc(c.equipo.codigo)}</b></td><td data-l="Obra">${esc(c.obra ? c.obra.nombre : '—')}</td><td data-l="Cargó">${esc(c.quien ? c.quien.nombre : '—')}</td>
        <td class="n" data-l="Litros">${fNum(c.litros)}${c.tanque_lleno ? '' : ' <span class="small muted">(parcial)</span>'}</td><td class="n" data-l="Medidor">${c.medidor != null ? fNum(c.medidor) + ' ' + unidad(c.equipo.medidor) : '—'}</td>
        <td data-l="De dónde">${esc(c.tanque ? c.tanque.nombre : ORIGEN[c.origen])}${c.proveedor ? ' · ' + esc(c.proveedor) : ''}</td>
        <td class="n" data-l="$/L">${p == null ? '<span class="muted">sin precio</span>' : est ? `<span class="muted" title="Precio estimado">~${fNum(p)}</span>` : fNum(p)}</td><td data-l="Foto">${x.urls[c.foto_path] ? `<a href="${x.urls[c.foto_path]}" target="_blank" rel="noopener">Ver</a>` : '—'}</td></tr>`; }).join('')}</tbody></table></div>
      ${cargas.length > max ? `<button class="btn sm ghost" data-act="cbMas">Ver las ${cargas.length - max} restantes</button>` : ''}
      <p class="small muted">"~" = precio estimado (del tanque o de referencia).</p>` : '<p class="muted">Sin cargas con estos filtros.</p>'}</section>`;
}

function vForms() {
  const a = T(), n = a.cbNueva, m = a.cbMovForm, x = filtro().datos;
  if (n) {
    const eqs = a.d.equipos.filter(e => e.activo), e = eqs.find(q => q.id === n.equipo_id), tqs = (x && x.tanques || []).filter(t => t.activo);
    return `<section class="card"><h2>Registrar carga</h2><div class="form-grid">
      <label class="f">Equipo<select class="inp" id="cn-eq" data-cn="equipo_id" data-vivo><option value="">Elegí el equipo</option>${eqs.map(q => `<option value="${q.id}" ${n.equipo_id === q.id ? 'selected' : ''}>${esc(q.codigo)} · ${esc(q.nombre)}</option>`).join('')}</select></label>
      <label class="f">Fecha y hora<input class="inp" type="datetime-local" id="cn-fec" data-cn="cuando" value="${esc(n.cuando)}"></label>
      <label class="f">Litros<input class="inp num" id="cn-l" type="number" inputmode="decimal" data-cn="litros" value="${esc(n.litros)}"></label>
      <label class="f">${e && e.medidor === 'km' ? 'Odómetro (km)' : 'Horómetro (h)'}<input class="inp num" id="cn-m" type="number" inputmode="decimal" data-cn="medidor" value="${esc(n.medidor)}"></label>
      <label class="f">De dónde salió<select class="inp" id="cn-o" data-cn="origen" data-vivo>${Object.entries(ORIGEN).map(([v, l]) => `<option value="${v}" ${n.origen === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${['surtidor_propio', 'cisterna'].includes(n.origen) && tqs.length ? `<label class="f">Tanque<select class="inp" id="cn-tq" data-cn="tanque">${tqs.length > 1 ? '<option value="">Elegí el tanque</option>' : ''}${tqs.map(t => `<option value="${t.id}" ${n.tanque === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}
      <label class="f">Obra <small>Opcional</small><select class="inp" id="cn-ob" data-cn="obra"><option value="">—</option>${a.d.obras.filter(o => o.activa).map(o => `<option value="${o.id}" ${n.obra === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
      <label class="f">Precio por litro <small>Opcional</small><input class="inp num" id="cn-pr" type="number" inputmode="decimal" data-cn="precio" value="${esc(n.precio)}"></label></div>
      <label class="check"><input type="checkbox" id="cn-ll" data-cn="lleno" ${n.lleno ? 'checked' : ''}><span>Tanque lleno</span></label>
      ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="cbNuevaCancelar">Cancelar</button><button class="btn sm primary" data-act="cbNuevaGuardar">Guardar</button></div></section>`;
  }
  if (m) {
    const tqs = (x && x.tanques || []).filter(t => t.activo), ing = m.tipo === 'ingreso';
    if (!tqs.length) return `<section class="card"><div class="warnbox">Primero agregá un tanque (más abajo, en "Tanques propios").</div><button class="btn sm" data-act="cbMovCancelar">Cerrar</button></section>`;
    return `<section class="card"><h2>${ing ? 'Compra de combustible al tanque' : 'Medición del tanque'}</h2>
      <p class="small muted">${ing ? 'Lo que entró al tanque, con el precio de la factura o remito: así se calcula a cuánto sale cada litro que se carga.' : 'Cuántos litros hay ahora en el tanque (varilla o medidor). Se compara con lo que debería haber.'}</p>
      <div class="form-grid"><label class="f">Tanque<select class="inp" id="mv-tq" data-cbm="tanque_id">${tqs.map(t => `<option value="${t.id}" ${m.tanque_id === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>
        <label class="f">Fecha y hora<input class="inp" type="datetime-local" id="mv-fec" data-cbm="fecha" value="${esc(m.fecha)}"></label>
        <label class="f">${ing ? 'Litros que entraron' : 'Litros que hay'}<input class="inp num" id="mv-l" type="number" inputmode="decimal" data-cbm="litros" value="${esc(m.litros)}"></label>
        ${ing ? `<label class="f">Precio por litro<input class="inp num" id="mv-pr" type="number" inputmode="decimal" data-cbm="precio" value="${esc(m.precio)}"></label>
        <label class="f">Proveedor <small>Opcional</small><input class="inp" id="mv-pv" data-cbm="proveedor" value="${esc(m.proveedor)}"></label>
        <label class="f">N.º de remito o factura <small>Opcional</small><input class="inp" id="mv-rm" data-cbm="remito" value="${esc(m.remito)}"></label>` : ''}</div>
      ${m.err ? `<p class="err">${esc(m.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="cbMovCancelar">Cancelar</button><button class="btn sm primary" data-act="cbMovGuardar">Guardar</button></div></section>`;
  }
  return '';
}

/* ------------------------------------------------------------ acciones */
async function insertarMov(m) {
  const { error } = await sb.from('movimientos_tanque').insert({ empresa_id: E(), tanque_id: m.tanque_id, tipo: m.tipo, fecha: new Date(m.fecha).toISOString(), litros: +m.litros,
    precio_litro: m.precio === '' || m.precio == null ? null : +m.precio, proveedor: (m.proveedor || '').trim() || null, remito: (m.remito || '').trim() || null, miembro_id: S.m.id });
  return error;
}
export const A = {
  cbNueva: () => { const tqs = (filtro().datos && filtro().datos.tanques || []).filter(t => t.activo); T().cbMovForm = null;
    T().cbNueva = { equipo_id: '', cuando: ahoraLocal(), litros: '', medidor: '', origen: 'surtidor_propio', tanque: tqs.length === 1 ? tqs[0].id : '', obra: '', precio: '', lleno: true, err: '' }; render(); scrollTo(0, 0); },
  cbNuevaCancelar: () => { T().cbNueva = null; render(); },
  cbNuevaGuardar: async () => {
    const n = T().cbNueva; n.err = '';
    if (!n.equipo_id) n.err = 'Elegí el equipo.'; else if (!(+n.litros > 0)) n.err = 'Indicá los litros.';
    if (n.err) return render();
    const { error } = await sb.rpc('registrar_carga', { p: { client_id: uuid(), equipo_id: n.equipo_id, cargado_en: new Date(n.cuando).toISOString(), litros: +n.litros,
      medidor: n.medidor === '' ? null : +n.medidor, tanque_lleno: !!n.lleno, origen: n.origen, precio_litro: n.precio === '' ? null : +n.precio,
      obra_id: n.obra || null, tanque_id: ['surtidor_propio', 'cisterna'].includes(n.origen) && n.tanque ? n.tanque : null } });
    if (error) { n.err = msgError(error); return render(); }
    T().cbNueva = null; toast('Carga registrada.'); cargarCombustible(); S.adm.recargar();
  },
  cbMov: b => { const tqs = (filtro().datos && filtro().datos.tanques || []).filter(t => t.activo); T().cbNueva = null;
    T().cbMovForm = { tipo: b.dataset.k, tanque_id: b.dataset.id || (tqs[0] || {}).id || '', fecha: ahoraLocal(), litros: '', precio: '', proveedor: '', remito: '', err: '' }; render(); scrollTo(0, 0); },
  cbMovCancelar: () => { T().cbMovForm = null; render(); },
  cbMovGuardar: async () => {
    const m = T().cbMovForm; m.err = '';
    if (!m.tanque_id) m.err = 'Elegí el tanque.';
    else if (m.litros === '' || +m.litros < 0 || (m.tipo === 'ingreso' && !(+m.litros > 0))) m.err = 'Indicá los litros.';
    else if (m.tipo === 'ingreso' && m.precio === '') m.err = 'Cargá el precio por litro de la factura o remito: con eso se calcula el costo.';
    if (m.err) return render();
    const error = await insertarMov(m);
    if (error) { m.err = msgError(error); return render(); }
    T().cbMovForm = null; toast(m.tipo === 'ingreso' ? 'Compra registrada.' : 'Medición registrada.'); cargarCombustible();
  },
  cbMovBorrar: async b => {
    const a = T(), k = 'mov' + b.dataset.id; if (a.confirm !== k) { a.confirm = k; return render(); } a.confirm = null;
    const { error } = await sb.from('movimientos_tanque').delete().eq('id', b.dataset.id);
    if (error) return toast(msgError(error)); toast('Movimiento borrado.'); cargarCombustible();
  },
  cbTanqueVer: b => { const a = T(); a.cbTanque = a.cbTanque === b.dataset.id ? null : b.dataset.id; render(); },
  cbTqNuevo: () => { T().cbTq = { nombre: '', capacidad: '', obra_id: '', inicial: '', err: '' }; render(); },
  cbTqCancelar: () => { T().cbTq = null; render(); },
  cbTqGuardar: async () => {
    const n = T().cbTq; n.err = '';
    if (n.nombre.trim().length < 2) n.err = 'Escribí el nombre del tanque.'; else if (n.inicial === '' || +n.inicial < 0) n.err = 'Indicá cuántos litros tiene ahora (0 si está vacío).';
    else if (n.capacidad !== '' && +n.inicial > +n.capacidad * 1.05) n.err = 'Los litros que tiene superan la capacidad.';
    if (n.err) return render();
    const { data, error } = await sb.from('tanques').insert({ empresa_id: E(), nombre: n.nombre.trim(), capacidad: n.capacidad === '' ? null : +n.capacidad, obra_id: n.obra_id || null }).select('id').single();
    if (error) { n.err = /duplicate|unique/.test(error.message) ? 'Ya hay un tanque con ese nombre.' : msgError(error); return render(); }
    const e2 = await insertarMov({ tipo: 'medicion', tanque_id: data.id, fecha: ahoraLocal(), litros: n.inicial });
    if (e2) toast('Tanque guardado, pero no la medición inicial: ' + msgError(e2), 7000);
    T().cbTq = null; toast('Tanque agregado.'); cargarCombustible();
  },
  cbPrecio: () => { T().cbPrecio = { valor: filtro().datos.precioRef ?? '' }; render(); },
  cbPrecioCancelar: () => { T().cbPrecio = null; render(); },
  cbPrecioGuardar: async () => {
    const v = T().cbPrecio.valor;
    if (v !== '' && !(+v >= 0)) return toast('El precio tiene que ser un número.');
    const { error } = await sb.from('empresas').update({ precio_gasoil: v === '' ? null : +v }).eq('id', E());
    if (error) return toast(msgError(error));
    T().cbPrecio = null; toast('Precio de referencia guardado.'); cargarCombustible();
  },
  cbMas: () => { T().cbMas = true; render(); },
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
  if (el.dataset.cb) { const f = filtro(); f[el.dataset.cb] = v; if (el.dataset.cb === 'periodo' && v !== 'otro') Object.assign(f, rango(v)); if (el.dataset.cb !== 'periodo') f.periodo = 'otro'; cargarCombustible(); return true; }
  if (el.dataset.cbf) { filtro()[el.dataset.cbf] = v; a.cbMas = false; render(); return true; }
  if (el.dataset.cn && a.cbNueva) { a.cbNueva[el.dataset.cn] = v; if (el.dataset.cn === 'equipo_id') { const e = a.d.equipos.find(x => x.id === v); a.cbNueva.medidor = e && e.ultimo_medidor != null ? e.ultimo_medidor : ''; render(); } if (el.dataset.cn === 'origen') render(); return true; }
  if (el.dataset.cbm && a.cbMovForm) { a.cbMovForm[el.dataset.cbm] = v; return true; }
  if (el.dataset.cbt && a.cbTq) { a.cbTq[el.dataset.cbt] = v; return true; }
  if (el.dataset.cbp && a.cbPrecio) { a.cbPrecio.valor = v; return true; }
  if (el.dataset.cbe && a.cbEd) { a.cbEd[el.dataset.cbe] = v; return true; }
  return false;
}
