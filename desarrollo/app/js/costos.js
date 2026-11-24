// Costos por obra: tarifa de cada equipo (por hora o por día), uso por obra, combustible y reparaciones.
import { esc, fNum, unidad, dayKey, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
export const fPeso = v => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });

function rango(clave) {
  const h = new Date(), d = new Date();
  if (clave === 'mes') d.setDate(1);
  else if (clave === 'mes_ant') { d.setDate(1); d.setMonth(d.getMonth() - 1); h.setDate(0); }
  else d.setDate(d.getDate() - 29);
  return { desde: dayKey(d), hasta: dayKey(h) };
}
const filtro = () => (T().cs ||= { periodo: 'mes', ...rango('mes'), datos: null, tarifas: false });

export async function costosPorObra(desde, hasta) {
  const { data, error } = await sb.rpc('costos_por_obra', { p_empresa: E(), p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return data;
}
export async function cargarCostos() {
  const f = filtro(); f.datos = null; f.antes = null; render();
  // Período anterior de la misma cantidad de días, para comparar.
  const d0 = new Date(f.desde + 'T12:00:00'), d1 = new Date(f.hasta + 'T12:00:00'), n = Math.round((d1 - d0) / 864e5) + 1;
  const a1 = new Date(d0); a1.setDate(a1.getDate() - 1); const a0 = new Date(a1); a0.setDate(a0.getDate() - n + 1);
  try { [f.datos, f.antes] = await Promise.all([costosPorObra(f.desde, f.hasta), costosPorObra(dayKey(a0), dayKey(a1)).catch(() => null)]); }
  catch (e) { toast(msgError(e)); f.datos = { filas: [], sin_tarifa: [], reparaciones_sin_uso: 0, combustible_sin_uso: 0, litros_sin_precio: 0 }; }
  render();
}

// Agrupa las filas (obra × equipo) por obra y por equipo.
export function agrupar(filas) {
  const suma = (rs, k) => rs.reduce((s, r) => s + Number(r[k] || 0), 0);
  const tot = rs => ({ costo_equipo: suma(rs, 'costo_equipo'), combustible: suma(rs, 'combustible'), reparaciones: suma(rs, 'reparaciones'), mano_obra: suma(rs, 'mano_obra'), litros: suma(rs, 'litros'), total: suma(rs, 'total') });
  const por = (k) => { const m = new Map(); filas.forEach(r => { const id = r[k] || '-'; if (!m.has(id)) m.set(id, []); m.get(id).push(r); }); return m; };
  const obras = [...por('obra_id')].map(([, rs]) => ({ obra: rs[0].obra, obra_id: rs[0].obra_id, filas: rs, ...tot(rs) })).sort((a, b) => b.total - a.total);
  const equipos = [...por('equipo_id')].map(([, rs]) => ({ codigo: rs[0].codigo, equipo: rs[0].equipo, medidor: rs[0].medidor, dias: suma(rs, 'dias'), uso: suma(rs, 'uso'), obras: rs.length, ...tot(rs) })).sort((a, b) => b.total - a.total);
  return { obras, equipos, total: tot(filas) };
}

const tarifaTxt = r => r.tarifa_hora != null && r.medidor === 'horas' ? `${fPeso(r.tarifa_hora)}/h` : r.tarifa_dia != null ? `${fPeso(r.tarifa_dia)}/día` : '<span class="chip warn">Sin tarifa</span>';
let COLORES = [];
const rubros = conMO => [['costo_equipo', 'Equipos', 'c-eq'], ['combustible', 'Combustible', 'c-cb'], ['reparaciones', 'Reparaciones', 'c-rp'], ...(conMO ? [['mano_obra', 'Mano de obra', 'c-mo']] : [])];
// Presupuesto del período: el mensual de la obra, proporcional a los días elegidos.
export const presupuestoPeriodo = (p, desde, hasta) => p && p.mensual != null ? Number(p.mensual) * ((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 864e5 + 1) / 30.44 : null;
const barraPresu = (gastado, presu) => { if (!presu) return ''; const pct = Math.round(100 * gastado / presu);
  return `<span class="s presu"><span class="nivel"><span class="${pct >= 100 ? 'bajo' : pct >= 80 ? 'medio' : ''}" style="width:${Math.min(100, pct)}%"></span></span>${pct} % del presupuesto del período (${fPeso(presu)})${pct >= 100 ? ' · <b class="txt-bad">pasado</b>' : pct >= 80 ? ' · <b>cerca del límite</b>' : ''}</span>`; };
const horasDe = rs => rs.filter(r => r.medidor === 'horas').reduce((s, r) => s + Number(r.uso || 0), 0);
// Barra con la parte de cada rubro en el total.
const barraRubros = o => { const t = Math.max(1, COLORES.reduce((s, [k]) => s + Number(o[k] || 0), 0));
  return `<div class="rubros" role="img" aria-label="${COLORES.map(([k, l]) => `${l} ${Math.round(100 * (o[k] || 0) / t)} %`).join(', ')}">${COLORES.map(([k, l, c]) => `<span class="${c}" style="width:${100 * (o[k] || 0) / t}%" title="${l}: ${fPeso(o[k])}"></span>`).join('')}</div>`; };
const variacion = (ahora, antes) => { if (antes == null || !(antes > 0)) return ''; const d = (ahora - antes) / antes;
  return `<span class="var ${d > 0.05 ? 'sube' : d < -0.05 ? 'baja' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(Math.round(d * 100))} % vs. período anterior</span>`; };

export function vCostos() {
  const a = T(), f = filtro(), x = f.datos, d = a.d;
  const filtros = `<section class="card no-print"><div class="filters ind-filtros cs-filtros">
    <label>Período<select class="inp" id="cs-per" data-cs="periodo" data-vivo>${[['mes', 'Este mes'], ['mes_ant', 'Mes anterior'], ['30', 'Últimos 30 días'], ['otro', 'Otro']].map(([v, l]) => `<option value="${v}" ${f.periodo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Desde<input class="inp" type="date" id="cs-des" data-cs="desde" data-vivo value="${f.desde}"></label>
    <label>Hasta<input class="inp" type="date" id="cs-has" data-cs="hasta" data-vivo value="${f.hasta}"></label>
    <label>Obra<select class="inp" id="cs-ob" data-csf="obra" data-vivo><option value="">Todas</option>${d.obras.map(o => `<option value="${o.id}" ${f.obra === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label></div>
    <div class="row"><button class="btn sm ${f.tarifas ? '' : 'ghost'}" data-act="csTarifas">${f.tarifas ? 'Ocultar tarifas' : 'Tarifas de los equipos'}</button>
      <button class="btn sm dark" data-act="csExcel" ${a.excelOcupado ? 'disabled' : ''}>${a.excelOcupado ? 'Armando el Excel…' : 'Descargar Excel'}</button></div></section>`;
  if (!x) return filtros + (f.tarifas ? vTarifas() : '') + '<p class="muted">Calculando…</p>';
  const filas = f.obra ? x.filas.filter(r => r.obra_id === f.obra) : x.filas;
  const antes = f.antes ? (f.obra ? f.antes.filas.filter(r => r.obra_id === f.obra) : f.antes.filas) : null;
  COLORES = rubros(x.con_mano_obra);
  const g = agrupar(filas), gAntes = antes ? agrupar(antes) : null;
  const horas = horasDe(filas), est = filas.reduce((s, r) => s + Number(r.combustible_estimado || 0), 0);
  const avisos = [
    x.sin_tarifa.length ? `<b>Sin tarifa:</b> ${x.sin_tarifa.map(esc).join(', ')}. Cargala en "Tarifas de los equipos" para sumar el costo de esos equipos.` : '',
    Number(x.litros_sin_precio) ? `<b>${fNum(x.litros_sin_precio)} L de combustible sin precio</b> no suman al costo. Cargá el precio de referencia o las compras del tanque en la pestaña <button class="linkbtn" data-act="admTab" data-k="combustible">Combustible</button>.` : '',
  ].filter(Boolean);
  const tarjetas = g.obras.map(o => {
    const h = horasDe(o.filas), abierto = a.csAbierta === o.obra;
    return `<div class="obra-card"><button class="obra-cab" data-act="csAbrir" data-k="${esc(o.obra)}" aria-expanded="${abierto}">
        <span class="t">${esc(o.obra)}</span><b class="num">${fPeso(o.total)}</b>
        <span class="s">${o.filas.length} equipo${o.filas.length === 1 ? '' : 's'} · ${fNum(h)} h${h > 0 ? ` · <b>${fPeso(o.total / h)}</b> por hora de máquina` : ''}</span>
        ${barraRubros(o)}
        ${barraPresu(o.total, presupuestoPeriodo((x.presupuestos || {})[o.obra_id], f.desde, f.hasta))}
        <span class="s rub">${COLORES.map(([k, l, c]) => `<i class="${c}"></i>${l} ${fPeso(o[k])}`).join(' · ')}</span>
        <span class="mas">${abierto ? 'Ocultar detalle ▲' : 'Ver detalle por equipo ▼'}</span></button>
      ${abierto ? `<div class="obra-det">${o.filas.map(r => `<div class="det-fila"><div><b>${esc(r.codigo)}</b> <span class="muted">${esc(r.equipo)}</span>
          <div class="small muted">${r.dias} día${r.dias === 1 ? '' : 's'} · ${fNum(r.uso)} ${unidad(r.medidor)} · tarifa ${tarifaTxt(r)}${Number(r.litros) ? ` · ${fNum(r.litros)} L` : ''}${Number(r.combustible_estimado) ? ' (precio estimado)' : ''}</div></div>
          <div class="det-num"><b class="num">${fPeso(r.total)}</b><span class="small muted">equipo ${fPeso(r.costo_equipo)} · comb. ${fPeso(r.combustible)}${Number(r.reparaciones) ? ` · rep. ${fPeso(r.reparaciones)}` : ''}${Number(r.mano_obra) ? ` · m. de obra ${fPeso(r.mano_obra)}` : ''}</span></div></div>`).join('')}</div>` : ''}</div>`;
  }).join('');
  const filasEq = g.equipos.map(r => `<tr><td data-l="Equipo"><b>${esc(r.codigo)}</b> <span class="muted">${esc(r.equipo)}</span></td><td class="n" data-l="Obras">${r.obras}</td><td class="n" data-l="Uso">${r.dias} d · ${fNum(r.uso)} ${unidad(r.medidor)}</td>
      <td class="n" data-l="Equipo">${fPeso(r.costo_equipo)}</td><td class="n" data-l="Combustible">${fPeso(r.combustible)}</td><td class="n" data-l="Reparaciones">${fPeso(r.reparaciones)}</td><td class="n" data-l="Total"><b>${fPeso(r.total)}</b></td>
      <td class="n" data-l="Por hora">${r.medidor === 'horas' && r.uso > 0 ? fPeso(r.total / r.uso) + '/h' : '—'}</td></tr>`).join('');
  const obraNom = f.obra && (d.obras.find(o => o.id === f.obra) || {}).nombre;
  return `<section class="solo-print"><p class="eyebrow">Costos por obra · ${esc(S.m.empresa.nombre)}</p><h1>${obraNom ? esc(obraNom) : 'Todas las obras'}</h1>
      <p class="small">Del ${f.desde.split('-').reverse().join('/')} al ${f.hasta.split('-').reverse().join('/')} · emitido el ${new Date().toLocaleDateString('es-AR')}</p></section>
    ${filtros}${f.tarifas ? vTarifas() : ''}
    <div class="kpis"><div class="kpi"><b>${fPeso(g.total.total)}</b><span>Costo total${f.obra ? ' de la obra' : ''} ${variacion(g.total.total, gAntes && gAntes.total.total)}</span></div>
      <div class="kpi"><b>${horas > 0 ? fPeso(g.total.total / horas) : '—'}</b><span>Por hora de máquina (${fNum(horas)} h)</span></div>
      <div class="kpi"><b>${fPeso(g.total.combustible)}</b><span>Combustible · ${fNum(g.total.litros)} L${est ? ` · ${fPeso(est)} estimado` : ''}</span></div>
      <div class="kpi"><b>${fPeso(g.total.reparaciones)}</b><span>Reparaciones y services</span></div>${x.con_mano_obra ? `<div class="kpi"><b>${fPeso(g.total.mano_obra)}</b><span>Mano de obra (operarios)</span></div>` : ''}</div>
    ${avisos.length ? `<div class="warnbox small">${avisos.join('<br>')}</div>` : ''}
    <section class="card"><h2>${f.obra ? 'La obra' : 'Por obra'}</h2>
      <p class="small muted">El costo del equipo sale de su tarifa y de las horas (o días) de las jornadas cerradas.${x.con_mano_obra ? ' La mano de obra, de las horas de cada jornada por el costo por hora del operario.' : ''} El combustible cargado sin obra y las reparaciones se reparten según las horas de cada equipo en cada obra. <span class="no-print">Tocá una obra para ver el detalle.</span></p>
      ${filas.length ? `<div class="obras">${tarjetas}</div>` : '<div class="empty">No hay jornadas en el período.</div>'}
      ${Number(x.reparaciones_sin_uso) || Number(x.combustible_sin_uso) ? `<p class="small muted">No se cargan a ninguna obra porque esos equipos no trabajaron en el período: ${[Number(x.reparaciones_sin_uso) ? `${fPeso(x.reparaciones_sin_uso)} en reparaciones` : '', Number(x.combustible_sin_uso) ? `${fPeso(x.combustible_sin_uso)} en combustible` : ''].filter(Boolean).join(' y ')}.</p>` : ''}</section>
    ${g.equipos.length ? `<section class="card"><h2>Por equipo</h2><div class="tabla tabla-cel"><table><thead><tr><th>Equipo</th><th class="n">Obras</th><th class="n">Uso</th><th class="n">Equipo</th><th class="n">Combustible</th><th class="n">Reparaciones</th><th class="n">Total</th><th class="n">Por hora</th></tr></thead><tbody>${filasEq}</tbody></table></div></section>` : ''}`;
}

function vTarifas() {
  const a = T(), ed = a.csEd || {};
  const eqs = a.d.equipos.filter(e => e.activo);
  return `<section class="card"><h2>Tarifas de los equipos</h2>
    <p class="small muted">El costo del equipo en cada obra es horas × tarifa por hora; si el equipo no tiene tarifa por hora (o mide en km), días trabajados × tarifa por día. Usá el valor de alquiler o tu costo interno.</p>
    <div class="tabla"><table><thead><tr><th>Equipo</th><th class="n">Por hora ($)</th><th class="n">Por día ($)</th><th></th></tr></thead><tbody>
    ${eqs.map(e => { const v = ed[e.id] || { h: e.tarifa_hora ?? '', d: e.tarifa_dia ?? '' }, cambio = String(v.h) !== String(e.tarifa_hora ?? '') || String(v.d) !== String(e.tarifa_dia ?? '');
      return `<tr><td><b>${esc(e.codigo)}</b> <span class="muted">${esc(e.nombre)}</span></td>
        <td class="n">${e.medidor === 'km' ? '<span class="small muted">mide km</span>' : `<input class="inp num tarifa" id="tf-h-${e.id}" type="number" inputmode="decimal" min="0" data-tf="h" data-id="${e.id}" value="${esc(v.h)}">`}</td>
        <td class="n"><input class="inp num tarifa" id="tf-d-${e.id}" type="number" inputmode="decimal" min="0" data-tf="d" data-id="${e.id}" value="${esc(v.d)}"></td>
        <td><button class="btn sm ${cambio ? 'primary' : 'ghost'}" data-act="csTarifaGuardar" data-id="${e.id}">Guardar</button></td></tr>`; }).join('')}</tbody></table></div></section>`;
}

export const A = {
  csAbrir: b => { const a = T(); a.csAbierta = a.csAbierta === b.dataset.k ? null : b.dataset.k; render(); },
  csTarifas: () => { const f = filtro(); f.tarifas = !f.tarifas; render(); },
  csTarifaGuardar: async b => {
    const a = T(), id = b.dataset.id, e = a.d.equipos.find(x => x.id === id), v = (a.csEd || {})[id] || { h: e.tarifa_hora ?? '', d: e.tarifa_dia ?? '' };
    const num = s => s === '' || s == null ? null : +s;
    if ([num(v.h), num(v.d)].some(n => n != null && !(n >= 0))) return toast('La tarifa tiene que ser un número positivo.');
    const { error } = await sb.from('equipos').update({ tarifa_hora: e.medidor === 'km' ? null : num(v.h), tarifa_dia: num(v.d) }).eq('id', id);
    if (error) return toast(msgError(error));
    if (a.csEd) delete a.csEd[id];
    toast(`Tarifa de ${e.codigo} guardada.`); await a.recargar(); cargarCostos();
  },
};
export function alEscribir(el, v) {
  const a = T(); if (!a) return false;
  if (el.dataset.cs) { const f = filtro(); f[el.dataset.cs] = v; if (el.dataset.cs === 'periodo' && v !== 'otro') Object.assign(f, rango(v)); if (el.dataset.cs !== 'periodo') f.periodo = 'otro'; cargarCostos(); return true; }
  if (el.dataset.csf) { filtro()[el.dataset.csf] = v; T().csAbierta = null; render(); return true; }
  if (el.dataset.tf) { const e = a.d.equipos.find(x => x.id === el.dataset.id); a.csEd ||= {}; a.csEd[e.id] ||= { h: e.tarifa_hora ?? '', d: e.tarifa_dia ?? '' }; a.csEd[e.id][el.dataset.tf] = v; return true; }
  return false;
}
