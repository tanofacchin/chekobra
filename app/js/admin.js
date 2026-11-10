// Panel de supervisión y administración.
import { esc, fFecha, fHora, fDur, fNum, unidad, fechaLarga, mapsUrl, dayKey, RES, toast, msgError, descargar } from './util.js';
import { sb, vigentes } from './datos.js';
import { S, render, esAdmin } from './estado.js';

const T = () => S.adm;
export function reiniciar() {
  const d = new Date(); d.setDate(d.getDate() - 6);
  S.adm = {
    tab: 'resumen', cargando: false, err: '', d: null, detalle: null, det: null, confirm: null,
    f: { desde: dayKey(d), hasta: dayKey(new Date()), equipo: '', operario: '', resultado: '' }, jornadas: null,
    liberar: null, nota: '', reparar: null, addEq: null, addPer: null, pin: null, nuevaObra: '',
  };
}
export const clave = () => { const a = T(); return a ? [a.tab, a.detalle].join(',') : ''; };
const E = () => S.m.empresa_id;

export async function cargar() {
  const a = T(); if (!a || a.cargando) return;
  a.cargando = true;
  try {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const [eq, mi, ob, pl, fa, ab, jh, tc, tu, ta] = await Promise.all([
      sb.from('equipos').select('*').eq('empresa_id', E()).order('codigo'),
      sb.from('miembros').select('id, nombre, legajo, rol, activo, user_id').eq('empresa_id', E()).order('nombre'),
      sb.from('obras').select('*').eq('empresa_id', E()).order('nombre'),
      sb.from('plantillas').select('id, empresa_id, clave, nombre, medidor, version, rubro').eq('activa', true),
      sb.from('fallas').select('*, equipo:equipos(codigo, nombre), jornada:jornadas(inicio, operario:miembros(nombre))').eq('empresa_id', E()).eq('estado', 'abierta').order('creada_en', { ascending: false }),
      sb.from('jornadas').select('id, inicio, equipo_id, resultado, operario:miembros(nombre), obra:obras(nombre)').eq('empresa_id', E()).eq('estado', 'abierta'),
      sb.from('jornadas').select('id, inicio, equipo_id, resultado, rapido, dur_checklist_s, operario:miembros(nombre)').eq('empresa_id', E()).gte('inicio', hoy.toISOString()),
      sb.from('telemetria_conexiones').select('*').eq('empresa_id', E()),
      sb.rpc('telemetria_ultimas', { p_empresa: E() }),
      sb.rpc('alertas_telemetria', { p_empresa: E() }),
    ]);
    for (const r of [eq, mi, ob, pl, fa, ab, jh, tc, tu, ta]) if (r.error) throw r.error;
    a.d = { equipos: eq.data, miembros: mi.data, obras: ob.data, plantillas: vigentes(pl.data, E()), fallas: fa.data, abiertas: ab.data, hoy: jh.data,
      jd: tc.data.find(c => c.proveedor === 'john_deere') || null, tele: Object.fromEntries(tu.data.map(l => [l.equipo_id, l])), alertasTele: ta.data };
    a.err = '';
    if (a.tab === 'jornadas') await cargarJornadas();
  } catch (e) { a.err = msgError(e); }
  a.cargando = false; render();
}

async function cargarJornadas() {
  const a = T(), f = a.f;
  let q = sb.from('jornadas').select('id, inicio, fin, estado, resultado, med_ini, med_fin, uso, n_fallas, n_criticas, rapido, dur_checklist_s, lat, lng, precision_m, ubic_ref, litros, novedades, equipo:equipos(id, codigo, nombre, medidor, plantilla_clave), operario:miembros(id, nombre, legajo), obra:obras(nombre), fallas(texto, nota, critica, estado)')
    .eq('empresa_id', E()).order('inicio', { ascending: false }).limit(1000);
  if (f.desde) q = q.gte('inicio', new Date(f.desde + 'T00:00:00').toISOString());
  if (f.hasta) q = q.lt('inicio', new Date(new Date(f.hasta + 'T00:00:00').getTime() + 864e5).toISOString());
  if (f.equipo) q = q.eq('equipo_id', f.equipo);
  if (f.operario) q = q.eq('operario_id', f.operario);
  if (f.resultado) q = q.eq('resultado', f.resultado);
  const { data, error } = await q;
  if (error) { a.err = msgError(error); return; }
  a.jornadas = data;
}

async function cargarDetalle(id) {
  const a = T(); a.det = null; render();
  const { data: j, error } = await sb.from('jornadas')
    .select('*, equipo:equipos(codigo, nombre, medidor), operario:miembros(nombre, legajo), obra:obras(nombre), plantilla:plantillas(nombre, version, secciones), fallas(*)')
    .eq('id', id).single();
  if (error) { a.det = { err: msgError(error) }; return render(); }
  const paths = [j.selfie_path, j.firma_path, ...j.fallas.map(f => f.foto_path)].filter(Boolean);
  const urls = {};
  if (paths.length) {
    const { data } = await sb.storage.from('evidencias').createSignedUrls(paths, 3600);
    (data || []).forEach(u => { if (u.signedUrl) urls[u.path] = u.signedUrl; });
  }
  a.det = { j, urls }; render();
}

/* ------------------------------------------------------------ vistas */
const chipRes = r => { const [t, c] = RES[r] || ['—', '']; return `<span class="chip ${c}">${t}</span>`; };
function chipEquipo(e) {
  if (e.estado === 'bloqueado') return '<span class="chip bad">Bloqueado</span>';
  if (e.estado === 'fuera_servicio') return '<span class="chip">Fuera de servicio</span>';
  if (T().d.abiertas.some(j => j.equipo_id === e.id)) return '<span class="chip acc">En uso</span>';
  return '<span class="chip ok">Operativo</span>';
}

export function vista() {
  const a = T();
  if (!a.d) return `<main class="wrap wide">${a.err ? `<div class="badbox">${esc(a.err)}</div><button class="btn" data-act="admRecargar">Reintentar</button>` : '<p class="muted">Cargando panel…</p>'}</main>`;
  if (a.detalle) return `<main class="wrap wide"><button class="btn ghost sm" data-act="admVolver" style="align-self:flex-start">← Volver</button>${vDetalle()}</main>`;
  const tabs = [['resumen', 'Resumen'], ['jornadas', 'Jornadas'], ['fallas', `Fallas${a.d.fallas.length ? ` (${a.d.fallas.length})` : ''}`], ['equipos', 'Equipos'], ['personal', 'Personal y obras']]
    .map(([k, l]) => `<button class="tab ${a.tab === k ? 'on' : ''}" data-act="admTab" data-k="${k}">${l}</button>`).join('');
  const body = { resumen: vResumen, jornadas: vJornadas, fallas: vFallas, equipos: vEquipos, personal: vPersonal }[a.tab]();
  return `<main class="wrap wide"><section class="row" style="justify-content:space-between;align-items:flex-end"><div><p class="eyebrow">${esc(fechaLarga())}</p><h1>${esc(S.m.empresa.nombre)}</h1></div>
    <button class="btn sm ghost" data-act="admRecargar">${a.cargando ? 'Actualizando…' : 'Actualizar'}</button></section>
    ${a.err ? `<div class="badbox">${esc(a.err)}</div>` : ''}<nav class="tabs">${tabs}</nav>${body}</main>`;
}

function vResumen() {
  const d = T().d, activos = d.equipos.filter(e => e.activo);
  const bloq = activos.filter(e => e.estado === 'bloqueado');
  const att = [];
  bloq.forEach(e => att.push(['bad', `${e.codigo} bloqueado`, `${e.motivo_bloqueo || 'Falla crítica'} · desde ${e.bloqueado_en ? fFecha(e.bloqueado_en) + ' ' + fHora(e.bloqueado_en) : '—'}`, `<button class="btn sm" data-act="admTab" data-k="equipos">Liberar</button>`]));
  d.fallas.filter(f => !f.critica).slice(0, 8).forEach(f => att.push(['warn', `${f.equipo.codigo} · ${f.texto}`, `${f.nota} · ${f.jornada && f.jornada.operario ? f.jornada.operario.nombre + ' · ' : ''}${fFecha(f.creada_en)}`, `<button class="btn sm" data-act="admTab" data-k="fallas">Ver</button>`]));
  d.hoy.filter(j => j.rapido).forEach(j => { const e = activos.find(x => x.id === j.equipo_id); att.push(['warn', `Checklist muy rápido · ${e ? e.codigo : ''}`, `${j.operario.nombre} lo completó en ${fDur(j.dur_checklist_s)}`, `<button class="btn sm" data-act="admVer" data-id="${j.id}">Ver</button>`]); });
  d.abiertas.filter(j => Date.now() - new Date(j.inicio) > 14 * 36e5).forEach(j => { const e = activos.find(x => x.id === j.equipo_id); att.push(['warn', `Jornada sin cerrar · ${e ? e.codigo : ''}`, `${j.operario.nombre} · desde ${fFecha(j.inicio)} ${fHora(j.inicio)}`, `<button class="btn sm" data-act="admVer" data-id="${j.id}">Ver</button>`]); });
  const TIT = { horometro: 'Horómetro distinto al de la máquina', lejos: 'Checklist lejos de la máquina', sin_checklist: 'Máquina usada sin checklist' };
  d.alertasTele.forEach(x => { const e = d.equipos.find(q => q.id === x.equipo_id); att.push([x.tipo === 'sin_checklist' ? 'bad' : 'warn', `${TIT[x.tipo]} · ${e ? e.codigo : ''}`, `${x.detalle} · ${fFecha(x.fecha + 'T12:00:00')} · dato de John Deere`, x.jornada_id ? `<button class="btn sm" data-act="admVer" data-id="${x.jornada_id}">Ver</button>` : '']); });
  const sinCheck = activos.filter(e => e.estado === 'operativo' && !d.hoy.some(j => j.equipo_id === e.id));
  const vacio = !d.equipos.length ? `<section class="card"><h2>Primeros pasos</h2><ol class="pasos">
      <li>Cargá las obras en <button class="linkbtn" data-act="admTab" data-k="personal">Personal y obras</button>.</li>
      <li>Dá de alta los equipos en <button class="linkbtn" data-act="admTab" data-k="equipos">Equipos</button>.</li>
      <li>Dá de alta a los operarios con legajo y PIN. Entran con el código de empresa <b class="mono">${esc(S.m.empresa.slug)}</b>.</li></ol></section>` : '';
  return `${vacio}<div class="kpis">
      <div class="kpi"><b>${d.hoy.length}</b><span>Checklists hoy</span></div>
      <div class="kpi"><b>${d.abiertas.length}</b><span>Equipos trabajando ahora</span></div>
      <div class="kpi ${bloq.length ? 'bad' : ''}"><b>${bloq.length}</b><span>Equipos bloqueados</span></div>
      <div class="kpi ${d.fallas.length ? 'warn' : ''}"><b>${d.fallas.length}</b><span>Fallas sin reparar</span></div></div>
    <div class="cols">
      <section class="card"><h2>Requiere atención</h2>${att.length ? `<div>${att.map(([s, t, x, b]) => `<div class="att"><span class="sev ${s}"></span><div><div class="t">${esc(t)}</div><div class="s">${esc(x)}</div></div>${b}</div>`).join('')}</div>` : '<div class="empty">Nada pendiente. Todos los equipos están en orden.</div>'}</section>
      <div class="stack">
        <section class="card"><h2>En obra ahora</h2>${d.abiertas.length ? `<div>${d.abiertas.map(j => { const e = d.equipos.find(x => x.id === j.equipo_id); return `<button class="li" data-act="admVer" data-id="${j.id}"><span class="t">${esc(e ? e.codigo : '')} · ${esc(j.operario.nombre)}</span>${chipRes(j.resultado)}<span class="s">${esc(j.obra ? j.obra.nombre : '')} · desde ${fHora(j.inicio)} h</span></button>`; }).join('')}</div>` : '<p class="muted">Ningún equipo con jornada abierta.</p>'}</section>
        <section class="card flat"><h3>Sin checklist hoy (${sinCheck.length})</h3><p class="small">${sinCheck.length ? sinCheck.map(e => `<span class="eqcode">${esc(e.codigo)}</span>`).join(' ') : 'Todos los equipos operativos ya tienen checklist.'}</p></section>
      </div></div>`;
}

function vJornadas() {
  const a = T(), f = a.f, d = a.d;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const rows = a.jornadas;
  return `<section class="card"><div class="filters">
      <label>Desde<input class="inp" type="date" id="fl-desde" data-fa="desde" data-vivo value="${f.desde}"></label>
      <label>Hasta<input class="inp" type="date" id="fl-hasta" data-fa="hasta" data-vivo value="${f.hasta}"></label>
      <label>Equipo<select class="inp" id="fl-eq" data-fa="equipo" data-vivo>${opt('', 'Todos', f.equipo)}${d.equipos.map(e => opt(e.id, e.codigo + ' · ' + e.nombre, f.equipo)).join('')}</select></label>
      <label>Operario<select class="inp" id="fl-op" data-fa="operario" data-vivo>${opt('', 'Todos', f.operario)}${d.miembros.map(m => opt(m.id, m.nombre, f.operario)).join('')}</select></label>
      <label>Resultado<select class="inp" id="fl-res" data-fa="resultado" data-vivo>${opt('', 'Todos', f.resultado)}${Object.entries(RES).map(([k, [l]]) => opt(k, l, f.resultado)).join('')}</select></label>
    </div><div class="row" style="justify-content:space-between"><span class="muted">${rows ? `${rows.length} jornada${rows.length === 1 ? '' : 's'}${rows.length === 1000 ? ' (máximo; acotá las fechas)' : ''}` : 'Cargando…'}</span>
    <button class="btn sm dark" data-act="admCsv" ${rows && rows.length ? '' : 'disabled'}>Exportar a Excel (CSV)</button></div></section>
    ${!rows ? '' : rows.length ? `<div class="list">${rows.map(j => `<button class="jrow" data-act="admVer" data-id="${j.id}">
      <span class="d">${fFecha(j.inicio)}<br>${fHora(j.inicio)}${j.fin ? '–' + fHora(j.fin) : ''}</span>
      <span><span class="t" style="display:block">${esc(j.equipo.codigo)} · ${esc(j.equipo.nombre)}</span><span class="s" style="display:block">${esc(j.obra ? j.obra.nombre : '—')}</span></span>
      <span class="t">${esc(j.operario.nombre)}</span>
      <span class="s">${j.n_fallas ? `${j.n_fallas} falla${j.n_fallas > 1 ? 's' : ''}${j.n_criticas ? ` (${j.n_criticas} crít.)` : ''}` : 'Sin fallas'} · ${j.estado === 'abierta' ? 'en curso' : j.estado === 'cerrada' ? 'cerrada' : 'rechazada'}</span>
      <span class="flags">${j.rapido ? '<span class="chip warn">Rápido</span>' : ''}${chipRes(j.resultado)}</span></button>`).join('')}</div>`
      : '<div class="empty">No hay jornadas con estos filtros.</div>'}`;
}

function vFallas() {
  const a = T(), fs = a.d.fallas;
  if (!fs.length) return '<div class="empty">No hay fallas abiertas.</div>';
  return `<div class="list">${fs.map(f => `<div class="eqrow"><span class="eqcode">${esc(f.equipo.codigo)}</span><div>
      <div>${f.critica ? '<span class="crit">CRÍTICO</span>' : ''}<b>${esc(f.texto)}</b></div><div class="small">${esc(f.nota)}</div>
      <div class="small muted">${f.jornada && f.jornada.operario ? esc(f.jornada.operario.nombre) + ' · ' : ''}${fFecha(f.creada_en)} ${fHora(f.creada_en)}${f.origen === 'cierre' ? ' · al cierre' : ''}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn sm" data-act="admVer" data-id="${f.jornada_id}">Ver jornada</button>${f.critica ? '' : `<button class="btn sm primary" data-act="admReparar" data-id="${f.id}">Reparada</button>`}</div>
      ${a.reparar === f.id ? `<div style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px"><label class="f">¿Qué se hizo?<textarea class="inp" id="rep-nota" data-ad="nota" placeholder="Ej.: se cambió el neumático">${esc(a.nota)}</textarea></label>
        <div class="row"><button class="btn sm" data-act="admCancelar">Cancelar</button><button class="btn sm primary" data-act="admRepararOk" data-id="${f.id}">Guardar</button></div></div>` : ''}</div>`).join('')}</div>
    <p class="small muted">Las fallas críticas se cierran al liberar el equipo desde la pestaña Equipos.</p>`;
}

function vEquipos() {
  const a = T(), d = a.d;
  const rows = d.equipos.map(e => {
    const pl = d.plantillas[e.plantilla_clave];
    return `<div class="eqrow"><span class="eqcode">${esc(e.codigo)}</span><div><b>${esc(e.nombre)}</b> ${chipEquipo(e)}${e.activo ? '' : ' <span class="chip">Dado de baja</span>'}
      <div class="small muted">${esc(pl ? pl.nombre : e.plantilla_clave)}${e.serie ? ' · Serie ' + esc(e.serie) : ''}${e.patente ? ' · ' + esc(e.patente) : ''} · <span class="num">${fNum(e.ultimo_medidor)} ${unidad(e.medidor)}</span></div>
      ${d.tele[e.id] ? lineaTele(d.tele[e.id], e) : ''}
      ${e.estado === 'bloqueado' ? `<div class="small" style="color:var(--bad);font-weight:600">Motivo: ${esc(e.motivo_bloqueo || '')}</div>` : ''}
      ${e.estado === 'fuera_servicio' && e.motivo_bloqueo ? `<div class="small muted">Motivo: ${esc(e.motivo_bloqueo)}</div>` : ''}</div>
      <div class="row" style="justify-content:flex-end">${e.estado === 'bloqueado' ? `<button class="btn sm primary" data-act="admLiberar" data-id="${e.id}">Liberar</button>`
        : `<button class="btn sm ghost" data-act="admServicio" data-id="${e.id}">${e.estado === 'fuera_servicio' ? 'Volver a servicio' : 'Fuera de servicio'}</button>`}</div>
      ${a.liberar === e.id ? `<div style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px"><label class="f">¿Qué se reparó?<textarea class="inp" id="lib-nota" data-ad="nota" placeholder="Ej.: se cambió la manguera del cilindro de pluma">${esc(a.nota)}</textarea></label>
        <div class="row"><button class="btn sm" data-act="admCancelar">Cancelar</button><button class="btn sm primary" data-act="admLiberarOk" data-id="${e.id}">Liberar equipo</button></div></div>` : ''}</div>`;
  }).join('');
  const n = a.addEq, pls = Object.values(d.plantillas).sort((x, y) => x.nombre.localeCompare(y.nombre));
  const form = n ? `<section class="card"><h2>Nuevo equipo</h2><div class="form-grid">
      <label class="f">Código interno<input class="inp" id="ne-cod" data-ne="codigo" value="${esc(n.codigo)}" placeholder="EX-01" maxlength="16"></label>
      <label class="f">Tipo de checklist<select class="inp" id="ne-tipo" data-ne="plantilla" data-vivo>${pls.map(p => `<option value="${p.clave}" ${n.plantilla === p.clave ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
      <label class="f">Nombre (marca y modelo)<input class="inp" id="ne-nom" data-ne="nombre" value="${esc(n.nombre)}" placeholder="Excavadora John Deere 210G"></label>
      <label class="f">N.º de serie / PIN <small>Para vincular con JDLink</small><input class="inp" id="ne-serie" data-ne="serie" value="${esc(n.serie)}"></label>
      <label class="f">Patente <small>Si tiene</small><input class="inp" id="ne-pat" data-ne="patente" value="${esc(n.patente)}"></label>
      <label class="f">${(d.plantillas[n.plantilla] || {}).medidor === 'km' ? 'Odómetro actual (km)' : 'Horómetro actual (h)'}<input class="inp num" id="ne-med" type="number" inputmode="decimal" data-ne="med" value="${esc(n.med)}"></label></div>
      ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="admEqCancelar">Cancelar</button><button class="btn sm primary" data-act="admEqGuardar">Guardar equipo</button></div></section>` : '';
  return `${vJd()}${form}<section class="card"><div class="row" style="justify-content:space-between"><h2>Flota (${d.equipos.length})</h2>${n ? '' : '<button class="btn sm dark" data-act="admEqNuevo">Agregar equipo</button>'}</div>
    ${d.equipos.length ? `<div>${rows}</div>` : '<div class="empty">Todavía no hay equipos. Agregá el primero.</div>'}</section>`;
}

function hace(t) {
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `el ${fFecha(t)}`;
}
function lineaTele(l, e) {
  const p = [];
  if (l.horas != null) p.push(`<span class="num">${fNum(l.horas)} h</span>`);
  if (l.odometro_km != null && e.medidor === 'km') p.push(`<span class="num">${fNum(l.odometro_km)} km</span>`);
  if (l.combustible_pct != null) p.push(`combustible ${fNum(l.combustible_pct)}%`);
  if (l.lat != null) p.push(`<a href="${mapsUrl(l.lat, l.lng)}" target="_blank" rel="noopener">ubicación ↗</a>`);
  return `<div class="small tele">JDLink ${hace(l.medido_en)}: ${p.join(' · ')}</div>`;
}
function vJd() {
  const a = T(), c = a.d.jd, adm = esAdmin();
  const est = !c || c.estado === 'desconectada' ? ['', 'No conectado'] : c.estado === 'conectada' ? ['ok', 'Conectado'] : c.estado === 'pendiente' ? ['warn', 'Autorización pendiente'] : ['bad', 'Error'];
  const sinV = c && c.maquinas_sin_vincular && c.maquinas_sin_vincular.length ? c.maquinas_sin_vincular : [];
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>John Deere JDLink</h2>
      <p class="small muted">Horas de motor, ubicación y combustible de cada máquina, para controlar los checklists. Se vincula por N.º de serie / PIN.</p></div>
      <span class="chip ${est[0]}">${est[1]}</span></div>
    ${c && c.error ? `<div class="badbox">${esc(c.error)}</div>` : ''}
    ${c && c.ultima_sync ? `<p class="small muted">Última actualización ${hace(c.ultima_sync)}.</p>` : ''}
    ${sinV.length ? `<div class="warnbox"><b>${sinV.length} máquina${sinV.length > 1 ? 's' : ''} de JDLink sin vincular.</b> Cargá su número de serie en el equipo correspondiente:
      <ul style="margin:6px 0 0;padding-left:18px">${sinV.slice(0, 10).map(m => `<li><span class="mono">${esc(m.pin || m.serie || '—')}</span> ${esc([m.oem, m.modelo].filter(Boolean).join(' '))}</li>`).join('')}</ul></div>` : ''}
    <div class="row">${c && ['conectada', 'error'].includes(c.estado) ? `<button class="btn sm dark" data-act="admJdSync" ${a.jdOcupado ? 'disabled' : ''}>${a.jdOcupado ? 'Actualizando…' : 'Actualizar ahora'}</button>` : ''}
      ${adm ? `<button class="btn sm ${c && c.estado === 'conectada' ? 'ghost' : 'primary'}" data-act="admJdConectar" ${a.jdOcupado ? 'disabled' : ''}>${c && c.estado !== 'desconectada' ? 'Volver a conectar' : 'Conectar John Deere'}</button>` : ''}
      ${adm && c && c.estado !== 'desconectada' ? `<button class="btn sm ghost" data-act="admJdDesconectar">${a.confirm === 'jd' ? 'Tocá de nuevo para desconectar' : 'Desconectar'}</button>` : ''}</div></section>`;
}

function vPersonal() {
  const a = T(), d = a.d, adm = esAdmin(), n = a.addPer;
  const roles = { dueno: 'Dueño', admin: 'Administración', supervisor: 'Supervisor', operario: 'Operario' };
  const per = d.miembros.map(m => `<div class="eqrow"><span class="eqcode">${esc(m.legajo || '—')}</span><div><b>${esc(m.nombre)}</b> <span class="chip plain">${roles[m.rol]}</span>${m.activo ? '' : ' <span class="chip">Inactivo</span>'}</div>
      <div class="row" style="justify-content:flex-end">${adm && m.rol !== 'dueno' && m.legajo ? `<button class="btn sm ghost" data-act="admPin" data-id="${m.id}">Cambiar PIN</button>` : ''}
      ${adm && m.rol !== 'dueno' ? `<button class="btn sm ghost" data-act="admActivo" data-id="${m.id}">${m.activo ? 'Desactivar' : 'Activar'}</button>` : ''}</div>
      ${a.pin && a.pin.id === m.id ? `<div style="grid-column:1/-1" class="row"><input class="inp num" id="pin-nuevo" data-pin="pin" inputmode="numeric" maxlength="6" placeholder="Nuevo PIN (6 números)" value="${esc(a.pin.pin)}" style="flex:1 1 180px">
        <button class="btn sm" data-act="admCancelar">Cancelar</button><button class="btn sm primary" data-act="admPinOk">Guardar</button></div>` : ''}</div>`).join('');
  const form = n ? `<div class="form-grid"><label class="f">Nombre y apellido<input class="inp" id="np-nom" data-np="nombre" value="${esc(n.nombre)}"></label>
      <label class="f">Legajo<input class="inp" id="np-leg" data-np="legajo" value="${esc(n.legajo)}" autocapitalize="none"></label>
      <label class="f">PIN de 6 números<input class="inp num" id="np-pin" data-np="pin" inputmode="numeric" maxlength="6" value="${esc(n.pin)}"></label>
      <label class="f">Rol<select class="inp" id="np-rol" data-np="rol"><option value="operario" ${n.rol === 'operario' ? 'selected' : ''}>Operario</option><option value="supervisor" ${n.rol === 'supervisor' ? 'selected' : ''}>Supervisor</option></select></label></div>
      ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="admPerCancelar">Cancelar</button><button class="btn sm primary" data-act="admPerGuardar" ${n.ocupado ? 'disabled' : ''}>Dar de alta</button></div>`
    : adm ? '<button class="btn sm dark" data-act="admPerNuevo" style="align-self:flex-start">Dar de alta a una persona</button>' : '';
  return `<div class="cols"><section class="card"><h2>Personal (${d.miembros.length})</h2>
      <p class="small muted">Los operarios entran con el código de empresa <b class="mono">${esc(S.m.empresa.slug)}</b>, su legajo y su PIN.</p>${form}${per ? `<div>${per}</div>` : ''}</section>
    <div class="stack"><section class="card"><h2>Obras</h2>${d.obras.length ? `<div>${d.obras.map(o => `<div class="att" style="grid-template-columns:1fr auto"><div class="t">${esc(o.nombre)}${o.activa ? '' : ' <span class="chip">Cerrada</span>'}</div><button class="btn sm ghost" data-act="admObra" data-id="${o.id}">${o.activa ? 'Cerrar' : 'Reabrir'}</button></div>`).join('')}</div>` : '<p class="muted">Sin obras cargadas.</p>'}
      <div class="row"><input class="inp" id="nueva-obra" data-ad="nuevaObra" value="${esc(a.nuevaObra)}" placeholder="Nombre de la obra" style="flex:1 1 200px"><button class="btn sm dark" data-act="admObraNueva">Agregar</button></div></section></div></div>`;
}

function vDetalle() {
  const a = T(), det = a.det;
  if (!det) return '<p class="muted">Cargando…</p>';
  if (det.err) return `<div class="badbox">${esc(det.err)}</div>`;
  const j = det.j, u = unidad(j.equipo.medidor), url = p => p && det.urls[p];
  const flags = [j.rapido ? `<span class="chip warn">Checklist en ${fDur(j.dur_checklist_s)}</span>` : '', j.lat == null ? '<span class="chip warn">Sin GPS</span>' : ''].join('');
  const fallas = j.fallas.map(f => `<div class="fl">${f.critica ? '<span class="crit">CRÍTICO</span>' : ''}<b>${esc(f.texto)}</b><span class="small muted">${esc(f.seccion || (f.origen === 'cierre' ? 'Reportada al cierre' : ''))}</span><span>${esc(f.nota)}</span>
    ${url(f.foto_path) ? `<img src="${url(f.foto_path)}" alt="Foto de la falla" style="max-width:260px;border-radius:8px">` : ''}
    ${f.estado === 'reparada' ? `<span class="chip ok">Reparada ${fFecha(f.reparada_en)}${f.reparacion ? ': ' + esc(f.reparacion) : ''}</span>` : '<span class="chip warn">Abierta</span>'}</div>`).join('');
  const all = j.plantilla.secciones.map(s => s.items.map(i => { const r = j.respuestas[i.id] || {}; return `<div><span>${i.critico ? '<span class="crit">C</span>' : ''}${esc(i.texto)}</span><span class="chip ${r.v === 'ok' ? 'ok' : r.v === 'falla' ? 'bad' : 'plain'}">${r.v === 'ok' ? 'Bien' : r.v === 'falla' ? 'Falla' : r.v === 'na' ? 'N/A' : '—'}</span></div>`; }).join('')).join('');
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><p class="eyebrow">${fFecha(j.inicio)} · ${fHora(j.inicio)} h</p><h1>${esc(j.equipo.codigo)} · ${esc(j.equipo.nombre)}</h1></div>${chipRes(j.resultado)}</div>
    ${flags ? `<div class="row">${flags}</div>` : ''}
    <dl class="kv"><dt>Operario</dt><dd>${esc(j.operario.nombre)}${j.operario.legajo ? ' · legajo ' + esc(j.operario.legajo) : ''}</dd><dt>Obra</dt><dd>${esc(j.obra ? j.obra.nombre : '—')}</dd>
      <dt>Plantilla</dt><dd>${esc(j.plantilla.nombre)} v${j.plantilla.version} · ${j.total_items} puntos</dd>
      <dt>Checklist</dt><dd>${fDur(j.dur_checklist_s)}${j.motivo_rapido ? ` · "${esc(j.motivo_rapido)}"` : ''}</dd>
      <dt>Estado</dt><dd>${j.estado === 'abierta' ? 'Jornada en curso' : j.estado === 'cerrada' ? `Cerrada ${fHora(j.fin)} h` : 'Rechazada: equipo bloqueado'}</dd>
      <dt>${j.equipo.medidor === 'km' ? 'Odómetro' : 'Horómetro'}</dt><dd class="num">${fNum(j.med_ini)} → ${j.med_fin != null ? fNum(j.med_fin) : '…'} ${u}${j.uso != null ? ` (${fNum(j.uso)} ${u})` : ''}</dd>
      ${j.litros != null ? `<dt>Combustible</dt><dd class="num">${fNum(j.litros)} L</dd>` : ''}
      <dt>Ubicación</dt><dd>${j.lat != null ? `<span class="num">${j.lat.toFixed(5)}, ${j.lng.toFixed(5)}</span> ±${Math.round(j.precision_m || 0)} m · <a href="${mapsUrl(j.lat, j.lng)}" target="_blank" rel="noopener">Ver mapa ↗</a>` : `Sin GPS · ${esc(j.ubic_ref || '—')}`}</dd>
      <dt>Recibido</dt><dd>${fFecha(j.recibido_en)} ${fHora(j.recibido_en)} h</dd></dl>
    ${j.novedades ? `<div class="card flat"><b>Novedades al cierre:</b> ${esc(j.novedades)}</div>` : ''}</section>
    <div class="det-grid">
      <section class="card flat"><h3>Fallas (${j.fallas.length})</h3>${fallas || '<p class="muted">Sin fallas registradas.</p>'}
        <details><summary>Ver los ${j.total_items} puntos</summary><div class="allitems">${all}</div></details></section>
      <section class="card flat"><h3>Foto y firma</h3>${url(j.selfie_path) ? `<img src="${url(j.selfie_path)}" alt="Foto del operario con el equipo">` : '<div class="empty">Foto no disponible</div>'}
        ${url(j.firma_path) ? `<div class="firma-img"><img src="${url(j.firma_path)}" alt="Firma del operario"></div>` : ''}<p class="small muted">Firmó la declaración jurada de revisión personal.</p></section>
    </div>`;
}

/* ------------------------------------------------------------ CSV */
function csv() {
  const q = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const n = v => v == null ? '' : String(v).replace('.', ',');
  const head = ['Fecha', 'Hora inicio', 'Hora cierre', 'Obra', 'Código', 'Equipo', 'Operario', 'Legajo', 'Medidor inicial', 'Medidor final', 'Uso', 'Unidad', 'Resultado', 'Fallas', 'Críticas', 'Detalle de fallas', 'Fallas abiertas', 'Duración checklist (s)', 'Checklist rápido', 'Latitud', 'Longitud', 'Precisión (m)', 'Referencia sin GPS', 'Estado', 'Combustible (L)', 'Novedades'];
  const rows = T().jornadas.map(j => [fFecha(j.inicio), fHora(j.inicio), j.fin ? fHora(j.fin) : '', j.obra ? j.obra.nombre : '', j.equipo.codigo, j.equipo.nombre, j.operario.nombre, j.operario.legajo || '',
    n(j.med_ini), n(j.med_fin), n(j.uso), unidad(j.equipo.medidor), RES[j.resultado][0], j.n_fallas, j.n_criticas, j.fallas.map(f => `${f.texto}: ${f.nota}`).join(' | '),
    j.fallas.filter(f => f.estado === 'abierta').length, j.dur_checklist_s, j.rapido ? 'Sí' : 'No', j.lat != null ? n(j.lat.toFixed(6)) : '', j.lng != null ? n(j.lng.toFixed(6)) : '',
    j.precision_m != null ? Math.round(j.precision_m) : '', j.ubic_ref || '', j.estado, n(j.litros), j.novedades || '']);
  return '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n');
}

/* ------------------------------------------------------------ acciones */
async function rpc(nombre, args, ok) {
  const { error } = await sb.rpc(nombre, args);
  if (error) { toast(msgError(error), 6000); return false; }
  if (ok) toast(ok);
  await cargar(); return true;
}
export const A = {
  admRecargar: () => cargar(),
  admTab: async b => { const a = T(); a.tab = b.dataset.k; a.confirm = null; render(); if (a.tab === 'jornadas') { a.jornadas = null; render(); await cargarJornadas(); render(); } },
  admVer: b => { T().detalle = b.dataset.id; cargarDetalle(b.dataset.id); },
  admVolver: () => { T().detalle = null; T().det = null; render(); },
  admCsv: () => { descargar(`checkobra-jornadas-${dayKey(new Date())}.csv`, csv(), 'text/csv;charset=utf-8'); toast('Archivo descargado. Se abre con Excel.'); },
  admCancelar: () => { const a = T(); a.liberar = null; a.reparar = null; a.pin = null; a.nota = ''; render(); },
  admLiberar: b => { const a = T(); a.liberar = b.dataset.id; a.nota = ''; render(); },
  admLiberarOk: async b => { const a = T(); if (a.nota.trim().length < 3) return toast('Contá qué se reparó antes de liberar.'); if (await rpc('liberar_equipo', { p_equipo: b.dataset.id, p_reparacion: a.nota }, 'Equipo liberado.')) { a.liberar = null; a.nota = ''; render(); } },
  admReparar: b => { const a = T(); a.reparar = b.dataset.id; a.nota = ''; render(); },
  admRepararOk: async b => { const a = T(); if (a.nota.trim().length < 3) return toast('Contá qué se hizo.'); if (await rpc('reparar_falla', { p_falla: b.dataset.id, p_reparacion: a.nota }, 'Falla marcada como reparada.')) { a.reparar = null; a.nota = ''; render(); } },
  admServicio: async b => { const e = T().d.equipos.find(x => x.id === b.dataset.id); await rpc('cambiar_servicio', { p_equipo: e.id, p_fuera: e.estado !== 'fuera_servicio', p_motivo: null }, e.estado === 'fuera_servicio' ? 'Equipo de vuelta en servicio.' : 'Equipo fuera de servicio.'); },
  admEqNuevo: () => { T().addEq = { codigo: '', plantilla: 'excavadora', nombre: '', serie: '', patente: '', med: '', err: '' }; render(); },
  admEqCancelar: () => { T().addEq = null; render(); },
  admEqGuardar: async () => {
    const a = T(), n = a.addEq, cod = n.codigo.trim().toUpperCase().replace(/\s+/g, '-'), pl = a.d.plantillas[n.plantilla];
    n.err = !/^[A-Z0-9-]{2,16}$/.test(cod) ? 'El código lleva letras, números o guiones (ej.: EX-01).' : a.d.equipos.some(e => e.codigo === cod) ? 'Ya existe un equipo con ese código.' : !n.nombre.trim() ? 'Escribí marca y modelo.' : '';
    if (n.err) return render();
    const { error } = await sb.from('equipos').insert({ empresa_id: E(), codigo: cod, nombre: n.nombre.trim(), plantilla_clave: n.plantilla, medidor: pl.medidor,
      serie: n.serie.trim() || null, patente: n.patente.trim().toUpperCase() || null, ultimo_medidor: n.med === '' ? null : +n.med });
    if (error) { n.err = msgError(error); return render(); }
    a.addEq = null; toast('Equipo agregado.'); cargar();
  },
  admJdConectar: async () => {
    const a = T(); a.jdOcupado = true; render();
    const { data, error } = await sb.functions.invoke('johndeere', { body: { accion: 'conectar', empresa_id: E(), volver_a: location.origin + location.pathname } });
    a.jdOcupado = false;
    if (error || (data && data.error)) { render(); return toast((data && data.error) || await errorFuncion(error), 7000); }
    location.href = data.url;
  },
  admJdSync: async () => {
    const a = T(); a.jdOcupado = true; render();
    const { data, error } = await sb.functions.invoke('johndeere', { body: { accion: 'sincronizar', empresa_id: E() } });
    a.jdOcupado = false;
    if (error || (data && data.error)) toast((data && data.error) || await errorFuncion(error), 7000);
    else toast(`JDLink: ${data.vinculadas} de ${data.maquinas} máquinas actualizadas.`);
    cargar();
  },
  admJdDesconectar: async () => {
    const a = T(); if (a.confirm !== 'jd') { a.confirm = 'jd'; return render(); } a.confirm = null;
    const { data, error } = await sb.functions.invoke('johndeere', { body: { accion: 'desconectar', empresa_id: E() } });
    if (error || (data && data.error)) return toast((data && data.error) || await errorFuncion(error));
    toast('John Deere desconectado.'); cargar();
  },
  admPerNuevo: () => { T().addPer = { nombre: '', legajo: '', pin: '', rol: 'operario', err: '', ocupado: false }; render(); },
  admPerCancelar: () => { T().addPer = null; render(); },
  admPerGuardar: async () => {
    const n = T().addPer;
    n.err = n.nombre.trim().length < 2 ? 'Escribí el nombre.' : !/^[A-Za-z0-9._-]{1,30}$/.test(n.legajo.trim()) ? 'El legajo admite letras, números, punto y guion.' : !/^\d{6}$/.test(n.pin) ? 'El PIN tiene que tener 6 números.' : '';
    if (n.err) return render();
    n.ocupado = true; render();
    const { data, error } = await sb.functions.invoke('operarios', { body: { accion: 'alta', empresa_id: E(), nombre: n.nombre, legajo: n.legajo.trim(), pin: n.pin, rol: n.rol } });
    n.ocupado = false;
    if (error || (data && data.error)) { n.err = (data && data.error) || await errorFuncion(error); return render(); }
    T().addPer = null; toast(`Alta lista. Entra con: ${S.m.empresa.slug} · legajo ${n.legajo.trim()} · su PIN.`, 7000); cargar();
  },
  admPin: b => { T().pin = { id: b.dataset.id, pin: '' }; render(); },
  admPinOk: async () => {
    const p = T().pin; if (!/^\d{6}$/.test(p.pin)) return toast('El PIN tiene que tener 6 números.');
    const { data, error } = await sb.functions.invoke('operarios', { body: { accion: 'pin', miembro_id: p.id, pin: p.pin } });
    if (error || (data && data.error)) return toast((data && data.error) || await errorFuncion(error), 6000);
    T().pin = null; toast('PIN cambiado.'); render();
  },
  admActivo: async b => {
    const m = T().d.miembros.find(x => x.id === b.dataset.id);
    const { error } = await sb.from('miembros').update({ activo: !m.activo }).eq('id', m.id);
    if (error) return toast(msgError(error)); cargar();
  },
  admObraNueva: async () => {
    const a = T(), v = a.nuevaObra.trim(); if (v.length < 2) return toast('Escribí el nombre de la obra.');
    const { error } = await sb.from('obras').insert({ empresa_id: E(), nombre: v });
    if (error) return toast(msgError(error)); a.nuevaObra = ''; cargar();
  },
  admObra: async b => {
    const o = T().d.obras.find(x => x.id === b.dataset.id);
    const { error } = await sb.from('obras').update({ activa: !o.activa }).eq('id', o.id);
    if (error) return toast(msgError(error)); cargar();
  },
};
async function errorFuncion(error) {
  try { const b = await error.context.json(); return b.error || error.message; } catch { return msgError(error); }
}

export function alEscribir(el, v) {
  const a = T(); if (!a) return false;
  if (el.dataset.fa) { a.f[el.dataset.fa] = v; a.jornadas = null; render(); cargarJornadas().then(render); return true; }
  if (el.dataset.ne && a.addEq) { a.addEq[el.dataset.ne] = v; if (el.dataset.ne === 'plantilla') render(); return true; }
  if (el.dataset.np && a.addPer) { a.addPer[el.dataset.np] = v; return true; }
  if (el.dataset.pin && a.pin) { a.pin.pin = v; return true; }
  if (el.dataset.ad) { a[el.dataset.ad] = v; return true; }
  return false;
}
