// Resumen del día (imprimible): lo mismo que llega por correo a las 19 h.
import { esc, fFecha, fHora, fNum, dayKey, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;

export async function abrirResumen(fecha) {
  const a = T(); a.rd = { fecha: fecha || dayKey(new Date()), datos: null }; render(); scrollTo(0, 0);
  const { data, error } = await sb.rpc('resumen_diario', { p_empresa: S.m.empresa_id, p_fecha: a.rd.fecha });
  if (error) { toast(msgError(error)); a.rd = null; return render(); }
  a.rd.datos = data; render();
}

export function vResumenDia() {
  const r = T().rd, x = r.datos;
  const barra = `<div class="row no-print" style="justify-content:space-between"><button class="btn ghost sm" data-act="rdCerrar">← Volver</button>
    <div class="row"><input class="inp" type="date" id="rd-fecha" data-rd="fecha" data-vivo value="${r.fecha}" max="${dayKey(new Date())}" aria-label="Día" style="width:auto"><button class="btn sm dark" data-act="rdImprimir" ${x ? '' : 'disabled'}>Imprimir / PDF</button></div></div>`;
  if (!x) return `<main class="wrap wide">${barra}<p class="muted">Armando el resumen…</p></main>`;
  const dia = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lista = (tit, items, vacio) => `<section class="card flat"><h3>${tit}${items.length ? ` (${items.length})` : ''}</h3>${items.length ? `<div>${items.join('')}</div>` : `<p class="muted">${vacio}</p>`}</section>`;
  const att = (sev, t, s) => `<div class="att" style="grid-template-columns:auto 1fr"><span class="sev ${sev}"></span><div><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div></div>`;
  return `<main class="wrap wide ficha">${barra}
    <section><p class="eyebrow">Resumen del día · ${esc(S.m.empresa.nombre)}</p><h1>${esc(dia[0].toUpperCase() + dia.slice(1))}</h1></section>
    <div class="kpis"><div class="kpi"><b>${x.checklists}</b><span>Checklists · ${x.operarios} operario${x.operarios === 1 ? '' : 's'}</span></div>
      <div class="kpi"><b>${x.equipos_trabajaron}</b><span>Equipos que trabajaron</span></div>
      <div class="kpi"><b>${fNum(x.horas)} h</b><span>Horas de máquina${Number(x.km) ? ` · ${fNum(x.km)} km` : ''}</span></div>
      <div class="kpi ${x.bloqueados.length ? 'bad' : ''}"><b>${x.bloqueados.length}</b><span>Equipos bloqueados</span></div></div>
    <p class="muted">${x.aptos} apto${x.aptos === 1 ? '' : 's'} · ${x.observaciones} con observaciones · ${x.no_aptos} no apto${x.no_aptos === 1 ? '' : 's'}${x.rapidos ? ` · ${x.rapidos} checklist${x.rapidos > 1 ? 's' : ''} hecho${x.rapidos > 1 ? 's' : ''} en menos de 2 minutos` : ''}${Number(x.litros) ? ` · ${fNum(x.litros)} L de combustible` : ''} · ${x.ordenes_abiertas} ${x.ordenes_abiertas === 1 ? 'orden' : 'órdenes'} de trabajo abierta${x.ordenes_abiertas === 1 ? '' : 's'}</p>
    <div class="rd-cols">
      ${lista('Equipos bloqueados', x.bloqueados.map(b => att('bad', `${esc(b.codigo)} · ${esc(b.equipo)}`, `${esc(b.motivo || 'Falla crítica')}${b.desde ? ' · desde ' + fFecha(b.desde) : ''}${b.orden ? ' · ' + esc(b.orden) + ' en el taller' : ' · <b>sin orden de trabajo</b>'}`)), 'Ninguno.')}
      ${lista('Fallas del día', x.fallas_nuevas.map(f => att(f.critica || f.grave ? 'bad' : 'warn', `${esc(f.codigo)} · ${f.critica ? 'CRÍTICA · ' : f.grave ? 'ADVERTENCIA · ' : ''}${esc(f.texto)}`, `${esc(f.nota)} · ${esc(f.operario)}${f.estado === 'reparada' ? ' · ya reparada' : ''}`)), 'Sin fallas nuevas.')}
      ${lista('Por obra', x.por_obra.map(o => att('', esc(o.obra), `${o.equipos} equipo${o.equipos === 1 ? '' : 's'} · ${fNum(o.horas)} h`)), 'Sin actividad.')}
      ${lista('Trabajos del taller terminados', x.ordenes_terminadas.map(o => att('ok', `OT ${o.numero} · ${esc(o.codigo)} · ${esc(o.titulo)}`, o.libero ? 'Liberó el equipo' : '')), 'Ninguno.')}
      ${lista('Fallas repetidas (30 días)', x.repetidas.map(f => att('warn', `${esc(f.codigo)} · ${esc(f.texto)}`, f.motivo === 'reaparecio' ? `Volvió a aparecer después de repararse (${f.veces} veces)` : `${f.veces} veces en 30 días`)), 'Ninguna.')}
      ${lista('Jornadas sin cerrar', x.sin_cerrar.map(j => att('warn', `${esc(j.codigo)} · ${esc(j.operario)}`, `Abierta desde ${fFecha(j.desde)} ${fHora(j.desde)} h`)), 'Todas cerradas.')}
    </div>
    <section class="card flat"><h3>Operativos sin checklist ese día (${x.sin_checklist.length})</h3><p class="small">${x.sin_checklist.length ? x.sin_checklist.map(c => `<span class="eqcode">${esc(c)}</span>`).join(' ') : 'Todos los equipos operativos tuvieron checklist.'}</p></section>
    <p class="small muted">Este resumen también llega por correo todos los días a las 19 h a quienes reciben avisos (Personal y obras).</p></main>`;
}

export const A = {
  rdAbrir: () => abrirResumen(),
  rdCerrar: () => { T().rd = null; render(); },
  rdImprimir: () => window.print(),
};
export function alEscribir(el, v) {
  const a = T(); if (!a || !a.rd || !el.dataset.rd) return false;
  if (v) abrirResumen(v); return true;
}
