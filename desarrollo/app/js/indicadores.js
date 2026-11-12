// Indicadores de cumplimiento e informe del período (imprimible / PDF).
import { esc, fFecha, fDur, fNum, dayKey, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const ST = [['apto', 'Apto', 'st-ok'], ['observaciones', 'Con observaciones', 'st-warn'], ['no_apto', 'No apto', 'st-bad']];

function rango(clave) {
  const h = new Date(), d = new Date();
  if (clave === 'mes') d.setDate(1);
  else if (clave === 'mes_ant') { d.setMonth(d.getMonth() - 1, 1); h.setDate(0); }
  else if (clave === '7') d.setDate(d.getDate() - 6);
  else d.setDate(d.getDate() - 29);
  return { desde: dayKey(d), hasta: dayKey(h) };
}
export async function cargarIndicadores() {
  const a = T(); a.ind ||= { periodo: 'mes', obra: '', ...rango('mes') };
  const f = a.ind; f.datos = null; render();
  const { data, error } = await sb.rpc('indicadores', { p_empresa: E(), p_desde: f.desde, p_hasta: f.hasta, p_obra: f.obra || null });
  if (error) { toast(msgError(error)); return; }
  f.datos = data; render();
}

const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
const fPct = v => v == null ? '—' : fNum(v) + '%';

/* ------------------------------------------------------------ gráfico: checklists por día, apilado por resultado */
function grafico(dias) {
  if (!dias.length) return '';
  const W = 760, H = 220, L = 34, R = 8, Tp = 10, B = 26;
  const max = Math.max(1, ...dias.map(d => d.apto + d.observaciones + d.no_apto));
  const paso = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / paso) * paso;
  const y = v => Tp + (H - Tp - B) * (1 - v / top);
  const bw = (W - L - R) / dias.length, ancho = Math.max(4, Math.min(28, bw * 0.62));
  const ticks = []; for (let v = 0; v <= top; v += paso) ticks.push(v);
  const cadaEtiq = Math.ceil(dias.length / 10);
  const barras = dias.map((d, i) => {
    const x = L + bw * i + (bw - ancho) / 2; let base = 0;
    const segs = ST.map(([k, , cl]) => ({ k, cl, v: d[k] })).filter(s => s.v > 0);
    const rects = segs.map((s, j) => {
      const y0 = y(base), y1 = y(base + s.v); base += s.v;
      const ultimo = j === segs.length - 1;
      const yt = y1 + (ultimo ? 0 : 2), alto = Math.max(0, y0 - yt);      // 2px de separación entre segmentos
      if (!ultimo || alto < 2) return `<rect class="${s.cl}" x="${x}" y="${yt}" width="${ancho}" height="${alto}"/>`;
      const r = Math.min(4, alto / 2, ancho / 2);                            // solo el extremo de arriba va redondeado
      return `<path class="${s.cl}" d="M${x},${y0}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + ancho - r}Q${x + ancho},${yt} ${x + ancho},${yt + r}V${y0}Z"/>`;
    }).join('');
    const etq = i % cadaEtiq === 0 ? `<text class="ax" x="${x + ancho / 2}" y="${H - 8}" text-anchor="middle">${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}</text>` : '';
    return `<g>${rects}${etq}<rect class="hit" x="${L + bw * i}" y="${Tp}" width="${bw}" height="${H - Tp - B}" data-tip="${esc(JSON.stringify(d))}"/></g>`;
  }).join('');
  const grid = ticks.map(v => `<line class="${v ? 'grid' : 'base'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  return `<div class="chart" id="graf-dias"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Checklists por día según resultado">${grid}${barras}</svg><div class="tip" id="graf-tip" hidden></div></div>
    <div class="leyenda">${ST.map(([, l, cl]) => `<span><i class="${cl}"></i>${l}</span>`).join('')}</div>`;
}
// Tooltip del gráfico (se engancha después de dibujar).
export function despues() {
  const g = document.getElementById('graf-dias'); if (!g || g.dataset.ok) return; g.dataset.ok = '1';
  const tip = document.getElementById('graf-tip');
  g.addEventListener('pointermove', ev => {
    const h = ev.target.closest('.hit'); if (!h) { tip.hidden = true; return; }
    const d = JSON.parse(h.dataset.tip), tot = d.apto + d.observaciones + d.no_apto;
    tip.innerHTML = `<b>${fFecha(d.dia + 'T12:00:00')}</b><br>${tot} checklist${tot === 1 ? '' : 's'}${ST.map(([k, l, cl]) => d[k] ? `<br><i class="${cl}"></i>${l}: ${d[k]}` : '').join('')}`;
    const r = g.getBoundingClientRect(); tip.hidden = false;
    tip.style.left = Math.min(r.width - 170, Math.max(0, ev.clientX - r.left + 12)) + 'px'; tip.style.top = Math.max(0, ev.clientY - r.top - 20) + 'px';
  });
  g.addEventListener('pointerleave', () => { tip.hidden = true; });
}

const barraFila = (v, max) => `<span class="minibar"><i style="width:${max ? (100 * v / max).toFixed(0) : 0}%"></i></span>`;

export function vIndicadores() {
  const a = T(), f = a.ind || { periodo: 'mes', obra: '', ...rango('mes') }, x = f.datos;
  const obras = a.d.obras;
  const filtros = `<section class="card no-print"><div class="filters ind-filtros">
      <label>Período<select class="inp" id="in-per" data-in="periodo" data-vivo>${[['mes', 'Este mes'], ['mes_ant', 'Mes anterior'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['otro', 'Otro']].map(([v, l]) => `<option value="${v}" ${f.periodo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Desde<input class="inp" type="date" id="in-des" data-in="desde" data-vivo value="${f.desde}"></label>
      <label>Hasta<input class="inp" type="date" id="in-has" data-in="hasta" data-vivo value="${f.hasta}"></label>
      <label>Obra<select class="inp" id="in-obra" data-in="obra" data-vivo><option value="">Todas</option>${obras.map(o => `<option value="${o.id}" ${f.obra === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
      <label>&nbsp;<button class="btn sm dark" data-act="inImprimir" ${x ? '' : 'disabled'}>Imprimir / PDF</button></label></div></section>`;
  if (!x) return filtros + '<p class="muted">Calculando…</p>';
  const pr = x.por_resultado || {}, tot = x.total;
  const obraNom = f.obra ? (obras.find(o => o.id === f.obra) || {}).nombre : 'Todas las obras';
  const maxF = Math.max(0, ...x.fallas_frecuentes.map(z => z.veces));
  return `${filtros}<div class="informe">
    <section class="solo-print"><p class="eyebrow">Informe de cumplimiento · CheckObra</p><h1>${esc(S.m.empresa.nombre)}</h1>
      <p>${fFecha(f.desde + 'T12:00:00')} al ${fFecha(f.hasta + 'T12:00:00')} · ${esc(obraNom)} · emitido el ${fFecha(new Date())}</p></section>
    <div class="kpis">
      <div class="kpi"><b>${tot}</b><span>Checklists</span></div>
      <div class="kpi"><b>${fPct(x.cobertura)}</b><span>Cobertura: días hábiles con checklist por equipo (${x.dias_habiles} días)</span></div>
      <div class="kpi"><b>${fNum(x.horas)}</b><span>Horas trabajadas${x.km ? ` · ${fNum(x.km)} km` : ''}</span></div>
      <div class="kpi ${x.bloqueos ? 'bad' : ''}"><b>${x.bloqueos}</b><span>Equipos bloqueados por fallas críticas</span></div>
      <div class="kpi ${x.fallas ? 'warn' : ''}"><b>${x.fallas}</b><span>Fallas reportadas (${x.fallas_criticas} críticas)</span></div>
      <div class="kpi"><b>${fPct(pct(pr.apto || 0, tot))}</b><span>Checklists aptos</span></div>
      <div class="kpi ${x.rapidos ? 'warn' : ''}"><b>${fPct(pct(x.rapidos, tot))}</b><span>Hechos en menos de 2 minutos</span></div>
      <div class="kpi"><b>${x.dur_promedio_s != null ? fDur(x.dur_promedio_s) : '—'}</b><span>Duración promedio del checklist</span></div></div>
    <section class="card"><h2>Checklists por día</h2>${tot ? grafico(x.por_dia) : '<div class="empty">No hay checklists en el período.</div>'}</section>
    <div class="cols">
      <section class="card"><h2>Por equipo</h2><div class="tabla"><table><thead><tr><th>Equipo</th><th class="n">Checklists</th><th>Cobertura</th><th class="n">Uso</th><th class="n">Fallas</th><th class="n">Bloqueos</th></tr></thead><tbody>
        ${x.por_equipo.map(e => { const c = pct(e.dias_con_checklist, e.dias_habiles); return `<tr><td><b>${esc(e.codigo)}</b> <span class="muted">${esc(e.nombre)}</span></td><td class="n">${e.jornadas}</td><td>${barraFila(c || 0, 100)} ${fPct(c)}</td><td class="n">${fNum(e.uso)} ${e.medidor === 'km' ? 'km' : 'h'}</td><td class="n">${e.fallas}</td><td class="n">${e.bloqueos}</td></tr>`; }).join('')}
      </tbody></table></div></section>
      <section class="card"><h2>Fallas más repetidas</h2>${x.fallas_frecuentes.length ? `<div class="tabla"><table><tbody>${x.fallas_frecuentes.map(z => `<tr><td>${z.critica ? '<span class="crit">C</span>' : ''}${esc(z.texto)}</td><td>${barraFila(z.veces, maxF)}</td><td class="n">${z.veces}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin fallas en el período.</p>'}</section>
    </div>
    <div class="cols">
      <section class="card"><h2>Por operario</h2><div class="tabla"><table><thead><tr><th>Operario</th><th class="n">Checklists</th><th class="n">Duración prom.</th><th class="n">Rápidos</th><th class="n">Fallas reportadas</th></tr></thead><tbody>
        ${x.por_operario.map(o => `<tr><td>${esc(o.nombre)}${o.legajo ? ` <span class="muted">· ${esc(o.legajo)}</span>` : ''}</td><td class="n">${o.jornadas}</td><td class="n">${o.dur_promedio_s != null ? fDur(o.dur_promedio_s) : '—'}</td><td class="n">${o.rapidos ? `<b style="color:var(--warn)">${o.rapidos}</b>` : 0}</td><td class="n">${o.fallas}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin datos</td></tr>'}
      </tbody></table></div></section>
      <section class="card"><h2>Por obra</h2><div class="tabla"><table><thead><tr><th>Obra</th><th class="n">Checklists</th><th class="n">Horas</th></tr></thead><tbody>
        ${x.por_obra.map(o => `<tr><td>${esc(o.obra)}</td><td class="n">${o.jornadas}</td><td class="n">${fNum(o.horas)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin datos</td></tr>'}
      </tbody></table></div></section>
    </div>
    <p class="small muted">Cobertura: de los días hábiles (lunes a sábado) del período, en cuántos cada equipo activo tuvo al menos un checklist. Un equipo que no trabajó ese día baja la cobertura aunque no haya incumplimiento.</p>
  </div>`;
}

export const A = {
  inImprimir: () => window.print(),
};
export function alEscribir(el, v) {
  const a = T(); if (!el.dataset.in || !a) return false;
  const f = a.ind ||= { periodo: 'mes', obra: '', ...rango('mes') };
  f[el.dataset.in] = v;
  if (el.dataset.in === 'periodo' && v !== 'otro') Object.assign(f, rango(v));
  if (el.dataset.in === 'desde' || el.dataset.in === 'hasta') f.periodo = 'otro';
  cargarIndicadores(); return true;
}
