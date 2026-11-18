// Ficha de equipo para auditoría (imprimible / PDF): datos, documentación, services, historial y bloqueos.
import { esc, fFecha, fHora, fNum, unidad, RES, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';
import { estadoDoc, nombreDoc } from './mantenimiento.js';

const T = () => S.adm;

export async function abrirFicha(equipoId) {
  const a = T(); a.ficha = { id: equipoId, datos: null }; render(); scrollTo(0, 0);
  const desde = new Date(); desde.setDate(desde.getDate() - 90);
  const [hi, eq, js, mt, docs, ev, srv] = await Promise.all([
    sb.rpc('historial_equipo', { p_equipo: equipoId, p_dias: 90, p_limite: 400 }),
    sb.from('equipos').select('*').eq('id', equipoId).single(),
    sb.from('jornadas').select('id, inicio, fin, estado, resultado, med_ini, med_fin, uso, n_fallas, operario:miembros(nombre), obra:obras(nombre), fallas(texto, nota, critica, estado, reparacion, reparada_en)')
      .eq('equipo_id', equipoId).gte('inicio', desde.toISOString()).order('inicio', { ascending: false }).limit(300),
    sb.from('mantenimientos').select('*, plan:planes_mantenimiento(nombre), quien:miembros(nombre)').eq('equipo_id', equipoId).order('realizado_en', { ascending: false }).limit(100),
    sb.from('documentos').select('*').eq('equipo_id', equipoId).order('vence'),
    sb.from('eventos_equipo').select('tipo, detalle, creado_en, quien:miembros(nombre)').eq('equipo_id', equipoId).order('creado_en', { ascending: false }).limit(50),
    sb.rpc('estado_mantenimiento', { p_empresa: S.m.empresa_id }),
  ]);
  const err = [eq, js, mt, docs, ev, srv, hi].find(r => r.error);
  if (err) { toast(msgError(err.error)); a.ficha = null; return render(); }
  a.ficha.datos = { e: eq.data, js: js.data, mt: mt.data, docs: docs.data, ev: ev.data, hi: hi.data, srv: srv.data.filter(s => s.equipo_id === equipoId) };
  render();
}

export function vFicha() {
  const f = T().ficha, x = f.datos;
  const barra = `<div class="row no-print" style="justify-content:space-between"><button class="btn ghost sm" data-act="fichaCerrar">← Volver</button><button class="btn sm dark" data-act="fichaImprimir" ${x ? '' : 'disabled'}>Imprimir / PDF</button></div>`;
  if (!x) return `<main class="wrap wide">${barra}<p class="muted">Armando la ficha…</p></main>`;
  const e = x.e, u = unidad(e.medidor);
  const EV = { bloqueo: 'Bloqueado', liberacion: 'Liberado', fuera_servicio: 'Fuera de servicio', en_servicio: 'Vuelve a servicio' };
  const TIP = { service: 'Service', reparacion: 'Reparación', otro: 'Otro' };
  const fallas = x.js.flatMap(j => j.fallas.map(fl => ({ ...fl, j })));
  return `<main class="wrap wide ficha">${barra}
    <section><p class="eyebrow">Ficha de equipo · ${esc(S.m.empresa.nombre)} · emitida el ${fFecha(new Date())} ${fHora(new Date())} h</p>
      <h1>${esc(e.codigo)} · ${esc(e.nombre)}</h1>
      <dl class="kv"><dt>Estado</dt><dd>${{ operativo: 'Operativo', bloqueado: 'Bloqueado' + (e.motivo_bloqueo ? ': ' + esc(e.motivo_bloqueo) : ''), fuera_servicio: 'Fuera de servicio' }[e.estado]}</dd>
        <dt>${e.medidor === 'km' ? 'Odómetro' : 'Horómetro'}</dt><dd class="num">${fNum(e.ultimo_medidor)} ${u}</dd>
        ${e.serie ? `<dt>N.º de serie</dt><dd class="mono">${esc(e.serie)}</dd>` : ''}${e.patente ? `<dt>Patente</dt><dd class="mono">${esc(e.patente)}</dd>` : ''}
        <dt>Período del historial</dt><dd>últimos 90 días · ${x.js.length} checklists</dd></dl></section>
    ${vLinea(x.hi)}
    <section class="card flat"><h2>Documentación</h2>${x.docs.length ? `<div class="tabla"><table><thead><tr><th>Documento</th><th>Vence</th><th>Estado</th></tr></thead><tbody>${x.docs.map(d => { const s = estadoDoc(d); return `<tr><td>${esc(nombreDoc(d))}${d.bloquea ? ' <span class="muted">(bloquea)</span>' : ''}</td><td>${fFecha(d.vence + 'T12:00:00')}</td><td><span class="chip ${s.chip}">${s.texto}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Sin documentación cargada.</p>'}</section>
    <section class="card flat"><h2>Mantenimiento</h2>
      ${x.srv.length ? `<div class="tabla"><table><thead><tr><th>Plan</th><th class="n">Cada</th><th class="n">Último</th><th class="n">Próximo</th><th>Estado</th></tr></thead><tbody>${x.srv.map(s => `<tr><td>${esc(s.plan)}</td><td class="n">${fNum(s.cada)} ${u}</td><td class="n">${fNum(s.ultimo_medidor)} ${u}</td><td class="n">${fNum(s.proximo)} ${u}</td><td><span class="chip ${{ vencido: 'bad', proximo: 'warn', al_dia: 'ok' }[s.estado]}">${{ vencido: 'Vencido', proximo: 'Próximo', al_dia: 'Al día' }[s.estado]}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin planes de service.</p>'}
      <h3>Trabajos realizados</h3>${x.mt.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="n">Medidor</th><th>Taller</th></tr></thead><tbody>${x.mt.map(m => `<tr><td>${fFecha(m.realizado_en + 'T12:00:00')}</td><td>${TIP[m.tipo]}${m.plan ? ' · ' + esc(m.plan.nombre) : ''}</td><td>${esc(m.descripcion)}</td><td class="n">${m.medidor != null ? fNum(m.medidor) + ' ' + u : '—'}</td><td>${esc(m.responsable || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin trabajos registrados.</p>'}</section>
    <section class="card flat"><h2>Fallas y reparaciones</h2>${fallas.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Falla</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${fallas.map(fl => `<tr><td>${fFecha(fl.j.inicio)}</td><td>${fl.critica ? '<span class="crit">C</span>' : ''}${esc(fl.texto)}</td><td>${esc(fl.nota)}</td><td>${fl.estado === 'reparada' ? `Reparada ${fl.reparada_en ? fFecha(fl.reparada_en) : ''}${fl.reparacion ? ': ' + esc(fl.reparacion) : ''}` : '<b>Abierta</b>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin fallas en el período.</p>'}</section>
    <section class="card flat"><h2>Bloqueos y liberaciones</h2>${x.ev.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th><th>Quién</th></tr></thead><tbody>${x.ev.map(v => `<tr><td>${fFecha(v.creado_en)} ${fHora(v.creado_en)}</td><td>${EV[v.tipo]}</td><td>${esc(v.detalle || '—')}</td><td>${esc(v.quien ? v.quien.nombre : '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin eventos.</p>'}</section>
    <section class="card flat"><h2>Checklists</h2>${x.js.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Operario</th><th>Obra</th><th class="n">Medidor</th><th class="n">Fallas</th><th>Resultado</th></tr></thead><tbody>${x.js.map(j => `<tr><td>${fFecha(j.inicio)} ${fHora(j.inicio)}</td><td>${esc(j.operario.nombre)}</td><td>${esc(j.obra ? j.obra.nombre : '—')}</td><td class="n">${fNum(j.med_ini)}${j.med_fin != null ? '→' + fNum(j.med_fin) : ''}</td><td class="n">${j.n_fallas}</td><td>${RES[j.resultado][0]}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin checklists en el período.</p>'}</section>
    <p class="small muted solo-print">Documento generado por Operapto. Los checklists tienen foto, ubicación y firma del operario, disponibles en el sistema.</p>
  </main>`;
}

// Todo lo que le pasó al equipo, en orden: checklists, fallas, órdenes, services, cargas y bloqueos.
const TIPOS = [['', 'Todo'], ['checklist', 'Checklists'], ['falla', 'Fallas'], ['orden', 'Taller'], ['mantenimiento', 'Mantenimiento'], ['combustible', 'Combustible'], ['evento', 'Bloqueos']];
const grupo = t => t === 'falla_reparada' ? 'falla' : t === 'orden_terminada' ? 'orden' : t;
function vLinea(hi) {
  const f = T().ficha.filtro || '', items = hi.filter(h => !f || grupo(h.tipo) === f);
  let dia = '';
  const filas = items.map(h => {
    const d = fFecha(h.cuando), cab = d !== dia ? `<div class="tl-dia">${new Date(h.cuando).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>` : ''; dia = d;
    const cuerpo = `<span class="h">${h.tipo === 'mantenimiento' ? '' : fHora(h.cuando)}</span><span class="p ${h.nivel}"></span><span><span class="t">${esc(h.titulo)}</span>
      ${h.detalle || h.quien ? `<span class="s" style="display:block">${esc([h.detalle, h.quien].filter(Boolean).join(' · '))}</span>` : ''}</span>`;
    return cab + (h.orden_id && grupo(h.tipo) === 'orden' ? `<button class="tl-it" data-act="otAbrirPanel" data-id="${h.orden_id}">${cuerpo}</button>`
      : h.jornada_id ? `<button class="tl-it" data-act="fichaJornada" data-id="${h.jornada_id}">${cuerpo}</button>` : `<div class="tl-it">${cuerpo}</div>`);
  }).join('');
  return `<section class="card flat"><h2>Historial</h2><p class="small muted no-print">Últimos 90 días, lo más nuevo arriba. Tocá un checklist o una orden para abrirlos.</p>
    <nav class="tabs no-print">${TIPOS.map(([k, l]) => `<button class="tab ${f === k ? 'on' : ''}" data-act="fichaFiltro" data-k="${k}">${l}</button>`).join('')}</nav>
    ${filas ? `<div class="tl">${filas}</div>` : '<p class="muted">Sin movimientos en el período.</p>'}</section>`;
}

export const A = {
  fichaFiltro: b => { T().ficha.filtro = b.dataset.k; render(); },
  fichaJornada: b => { const a = T(); a.ficha = null; a.detalle = b.dataset.id; a.recargarDetalle(b.dataset.id); },
  fichaCerrar: () => { T().ficha = null; render(); },
  fichaImprimir: () => window.print(),
  equipoFicha: b => abrirFicha(b.dataset.id),
  jornadaImprimir: () => window.print(),
};
