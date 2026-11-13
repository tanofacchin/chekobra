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
  const f = filtro(); f.datos = null; render();
  try { f.datos = await costosPorObra(f.desde, f.hasta); } catch (e) { toast(msgError(e)); }
  render();
}

// Agrupa las filas (obra × equipo) por obra y por equipo.
export function agrupar(filas) {
  const suma = (rs, k) => rs.reduce((s, r) => s + Number(r[k] || 0), 0);
  const tot = rs => ({ costo_equipo: suma(rs, 'costo_equipo'), combustible: suma(rs, 'combustible'), reparaciones: suma(rs, 'reparaciones'), litros: suma(rs, 'litros'), total: suma(rs, 'total') });
  const por = (k) => { const m = new Map(); filas.forEach(r => { const id = r[k] || '-'; if (!m.has(id)) m.set(id, []); m.get(id).push(r); }); return m; };
  const obras = [...por('obra_id')].map(([, rs]) => ({ obra: rs[0].obra, filas: rs, ...tot(rs) })).sort((a, b) => b.total - a.total);
  const equipos = [...por('equipo_id')].map(([, rs]) => ({ codigo: rs[0].codigo, equipo: rs[0].equipo, medidor: rs[0].medidor, dias: suma(rs, 'dias'), uso: suma(rs, 'uso'), obras: rs.length, ...tot(rs) })).sort((a, b) => b.total - a.total);
  return { obras, equipos, total: tot(filas) };
}

const tarifaTxt = r => r.tarifa_hora != null && r.medidor === 'horas' ? `${fPeso(r.tarifa_hora)}/h` : r.tarifa_dia != null ? `${fPeso(r.tarifa_dia)}/día` : '<span class="chip warn">Sin tarifa</span>';

export function vCostos() {
  const a = T(), f = filtro(), x = f.datos;
  const filtros = `<section class="card"><div class="filters ind-filtros">
    <label>Período<select class="inp" id="cs-per" data-cs="periodo" data-vivo>${[['mes', 'Este mes'], ['mes_ant', 'Mes anterior'], ['30', 'Últimos 30 días'], ['otro', 'Otro']].map(([v, l]) => `<option value="${v}" ${f.periodo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Desde<input class="inp" type="date" id="cs-des" data-cs="desde" data-vivo value="${f.desde}"></label>
    <label>Hasta<input class="inp" type="date" id="cs-has" data-cs="hasta" data-vivo value="${f.hasta}"></label>
    <label>&nbsp;<button class="btn sm ${f.tarifas ? '' : 'ghost'}" data-act="csTarifas">${f.tarifas ? 'Ocultar tarifas' : 'Tarifas de los equipos'}</button></label>
    <label>&nbsp;<button class="btn sm dark" data-act="csExcel" ${a.excelOcupado ? 'disabled' : ''}>${a.excelOcupado ? 'Armando el Excel…' : 'Descargar Excel'}</button></label></div></section>`;
  if (!x) return filtros + (f.tarifas ? vTarifas() : '') + '<p class="muted">Calculando…</p>';
  const g = agrupar(x.filas);
  const sinTar = x.sin_tarifa.length ? `<div class="warnbox small">Sin tarifa: ${x.sin_tarifa.map(esc).join(', ')}. Cargala en "Tarifas de los equipos" para sumar el costo de esos equipos.</div>` : '';
  const filasObra = g.obras.map(o => `<tr class="sub"><td colspan="3">${esc(o.obra)}</td><td class="n">${fPeso(o.costo_equipo)}</td><td class="n">${fNum(o.litros)} L · ${fPeso(o.combustible)}</td><td class="n">${fPeso(o.reparaciones)}</td><td class="n">${fPeso(o.total)}</td></tr>
    ${o.filas.map(r => `<tr><td>&nbsp;&nbsp;<b>${esc(r.codigo)}</b> <span class="muted">${esc(r.equipo)}</span></td><td class="n">${r.dias} d · ${fNum(r.uso)} ${unidad(r.medidor)}</td><td class="n">${tarifaTxt(r)}</td>
      <td class="n">${fPeso(r.costo_equipo)}</td><td class="n">${fNum(r.litros)} L · ${fPeso(r.combustible)}</td><td class="n">${fPeso(r.reparaciones)}</td><td class="n">${fPeso(r.total)}</td></tr>`).join('')}`).join('');
  const filasEq = g.equipos.map(r => `<tr><td><b>${esc(r.codigo)}</b> <span class="muted">${esc(r.equipo)}</span></td><td class="n">${r.obras}</td><td class="n">${r.dias} d · ${fNum(r.uso)} ${unidad(r.medidor)}</td>
      <td class="n">${fPeso(r.costo_equipo)}</td><td class="n">${fPeso(r.combustible)}</td><td class="n">${fPeso(r.reparaciones)}</td><td class="n">${fPeso(r.total)}</td></tr>`).join('');
  return `${filtros}${f.tarifas ? vTarifas() : ''}
    <div class="kpis"><div class="kpi"><b>${fPeso(g.total.total)}</b><span>Costo total del período</span></div>
      <div class="kpi"><b>${fPeso(g.total.costo_equipo)}</b><span>Equipos (según tarifa)</span></div>
      <div class="kpi"><b>${fPeso(g.total.combustible)}</b><span>Combustible</span></div>
      <div class="kpi"><b>${fPeso(g.total.reparaciones)}</b><span>Reparaciones y services</span></div></div>
    ${sinTar}
    <section class="card"><h2>Por obra</h2>
      <p class="small muted">Días y horas salen de las jornadas cerradas. El combustible cargado sin obra y las reparaciones se reparten entre las obras según las horas que trabajó cada equipo en cada una.</p>
      ${x.filas.length ? `<div class="tabla"><table><thead><tr><th>Obra / equipo</th><th class="n">Uso</th><th class="n">Tarifa</th><th class="n">Equipo</th><th class="n">Combustible</th><th class="n">Reparaciones</th><th class="n">Total</th></tr></thead>
        <tbody>${filasObra}<tr class="tot"><td colspan="3">Total</td><td class="n">${fPeso(g.total.costo_equipo)}</td><td class="n">${fNum(g.total.litros)} L · ${fPeso(g.total.combustible)}</td><td class="n">${fPeso(g.total.reparaciones)}</td><td class="n">${fPeso(g.total.total)}</td></tr></tbody></table></div>`
        : '<div class="empty">No hay jornadas en el período.</div>'}
      ${Number(x.reparaciones_sin_uso) ? `<p class="small muted">Hay ${fPeso(x.reparaciones_sin_uso)} en reparaciones de equipos que no trabajaron en el período (no se cargan a ninguna obra).</p>` : ''}</section>
    ${g.equipos.length ? `<section class="card"><h2>Por equipo</h2><div class="tabla"><table><thead><tr><th>Equipo</th><th class="n">Obras</th><th class="n">Uso</th><th class="n">Equipo</th><th class="n">Combustible</th><th class="n">Reparaciones</th><th class="n">Total</th></tr></thead><tbody>${filasEq}</tbody></table></div></section>` : ''}`;
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
  if (el.dataset.tf) { const e = a.d.equipos.find(x => x.id === el.dataset.id); a.csEd ||= {}; a.csEd[e.id] ||= { h: e.tarifa_hora ?? '', d: e.tarifa_dia ?? '' }; a.csEd[e.id][el.dataset.tf] = v; return true; }
  return false;
}
