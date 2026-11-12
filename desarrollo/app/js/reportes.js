// Ficha de equipo para auditoría (imprimible / PDF): datos, documentación, services, historial y bloqueos.
import { esc, fFecha, fHora, fNum, unidad, RES, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';
import { estadoDoc, nombreDoc } from './mantenimiento.js';

const T = () => S.adm;

export async function abrirFicha(equipoId) {
  const a = T(); a.ficha = { id: equipoId, datos: null }; render(); scrollTo(0, 0);
  const desde = new Date(); desde.setDate(desde.getDate() - 90);
  const [eq, js, mt, docs, ev, srv] = await Promise.all([
    sb.from('equipos').select('*').eq('id', equipoId).single(),
    sb.from('jornadas').select('id, inicio, fin, estado, resultado, med_ini, med_fin, uso, n_fallas, operario:miembros(nombre), obra:obras(nombre), fallas(texto, nota, critica, estado, reparacion, reparada_en)')
      .eq('equipo_id', equipoId).gte('inicio', desde.toISOString()).order('inicio', { ascending: false }).limit(300),
    sb.from('mantenimientos').select('*, plan:planes_mantenimiento(nombre), quien:miembros(nombre)').eq('equipo_id', equipoId).order('realizado_en', { ascending: false }).limit(100),
    sb.from('documentos').select('*').eq('equipo_id', equipoId).order('vence'),
    sb.from('eventos_equipo').select('tipo, detalle, creado_en, quien:miembros(nombre)').eq('equipo_id', equipoId).order('creado_en', { ascending: false }).limit(50),
    sb.rpc('estado_mantenimiento', { p_empresa: S.m.empresa_id }),
  ]);
  const err = [eq, js, mt, docs, ev, srv].find(r => r.error);
  if (err) { toast(msgError(err.error)); a.ficha = null; return render(); }
  a.ficha.datos = { e: eq.data, js: js.data, mt: mt.data, docs: docs.data, ev: ev.data, srv: srv.data.filter(s => s.equipo_id === equipoId) };
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
    <section class="card flat"><h2>Documentación</h2>${x.docs.length ? `<div class="tabla"><table><thead><tr><th>Documento</th><th>Vence</th><th>Estado</th></tr></thead><tbody>${x.docs.map(d => { const s = estadoDoc(d); return `<tr><td>${esc(nombreDoc(d))}${d.bloquea ? ' <span class="muted">(bloquea)</span>' : ''}</td><td>${fFecha(d.vence + 'T12:00:00')}</td><td><span class="chip ${s.chip}">${s.texto}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Sin documentación cargada.</p>'}</section>
    <section class="card flat"><h2>Mantenimiento</h2>
      ${x.srv.length ? `<div class="tabla"><table><thead><tr><th>Plan</th><th class="n">Cada</th><th class="n">Último</th><th class="n">Próximo</th><th>Estado</th></tr></thead><tbody>${x.srv.map(s => `<tr><td>${esc(s.plan)}</td><td class="n">${fNum(s.cada)} ${u}</td><td class="n">${fNum(s.ultimo_medidor)} ${u}</td><td class="n">${fNum(s.proximo)} ${u}</td><td><span class="chip ${{ vencido: 'bad', proximo: 'warn', al_dia: 'ok' }[s.estado]}">${{ vencido: 'Vencido', proximo: 'Próximo', al_dia: 'Al día' }[s.estado]}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin planes de service.</p>'}
      <h3>Trabajos realizados</h3>${x.mt.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="n">Medidor</th><th>Taller</th></tr></thead><tbody>${x.mt.map(m => `<tr><td>${fFecha(m.realizado_en + 'T12:00:00')}</td><td>${TIP[m.tipo]}${m.plan ? ' · ' + esc(m.plan.nombre) : ''}</td><td>${esc(m.descripcion)}</td><td class="n">${m.medidor != null ? fNum(m.medidor) + ' ' + u : '—'}</td><td>${esc(m.responsable || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin trabajos registrados.</p>'}</section>
    <section class="card flat"><h2>Fallas y reparaciones</h2>${fallas.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Falla</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${fallas.map(fl => `<tr><td>${fFecha(fl.j.inicio)}</td><td>${fl.critica ? '<span class="crit">C</span>' : ''}${esc(fl.texto)}</td><td>${esc(fl.nota)}</td><td>${fl.estado === 'reparada' ? `Reparada ${fl.reparada_en ? fFecha(fl.reparada_en) : ''}${fl.reparacion ? ': ' + esc(fl.reparacion) : ''}` : '<b>Abierta</b>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin fallas en el período.</p>'}</section>
    <section class="card flat"><h2>Bloqueos y liberaciones</h2>${x.ev.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th><th>Quién</th></tr></thead><tbody>${x.ev.map(v => `<tr><td>${fFecha(v.creado_en)} ${fHora(v.creado_en)}</td><td>${EV[v.tipo]}</td><td>${esc(v.detalle || '—')}</td><td>${esc(v.quien ? v.quien.nombre : '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin eventos.</p>'}</section>
    <section class="card flat"><h2>Checklists</h2>${x.js.length ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Operario</th><th>Obra</th><th class="n">Medidor</th><th class="n">Fallas</th><th>Resultado</th></tr></thead><tbody>${x.js.map(j => `<tr><td>${fFecha(j.inicio)} ${fHora(j.inicio)}</td><td>${esc(j.operario.nombre)}</td><td>${esc(j.obra ? j.obra.nombre : '—')}</td><td class="n">${fNum(j.med_ini)}${j.med_fin != null ? '→' + fNum(j.med_fin) : ''}</td><td class="n">${j.n_fallas}</td><td>${RES[j.resultado][0]}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin checklists en el período.</p>'}</section>
    <p class="small muted solo-print">Documento generado por CheckObra. Los checklists tienen foto, ubicación y firma del operario, disponibles en el sistema.</p>
  </main>`;
}

export const A = {
  fichaCerrar: () => { T().ficha = null; render(); },
  fichaImprimir: () => window.print(),
  equipoFicha: b => abrirFicha(b.dataset.id),
  jornadaImprimir: () => window.print(),
};
