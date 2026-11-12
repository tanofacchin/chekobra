// Mantenimiento preventivo, vencimientos de documentación e historial de trabajos (supervisión).
import { esc, fFecha, fNum, unidad, dayKey, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render, esAdmin } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const hoy = () => dayKey(new Date());
export const TIPOS_DOC = {
  seguro: ['Seguro', 'equipo'], vtv: ['VTV / RTO', 'equipo'], matafuego: ['Matafuego', 'equipo'],
  habilitacion_equipo: ['Habilitación del equipo', 'equipo'], ruta: ['Habilitación RUTA', 'equipo'],
  licencia: ['Licencia de conducir', 'persona'], habilitacion_operador: ['Habilitación de operador', 'persona'],
  curso: ['Curso / capacitación', 'persona'], apto_medico: ['Apto médico', 'persona'], otro: ['Otro', 'ambos'],
};
const ESTADO_PLAN = { vencido: ['bad', 'Service vencido'], proximo: ['warn', 'Service próximo'], al_dia: ['ok', 'Al día'] };

// Estado de un documento según su fecha y el aviso anticipado.
export function estadoDoc(d) {
  const dias = Math.round((new Date(d.vence + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 864e5);
  if (dias < 0) return { clave: 'vencido', chip: 'bad', texto: `Vencido hace ${-dias} día${dias === -1 ? '' : 's'}`, dias };
  if (dias <= d.aviso_dias) return { clave: 'por_vencer', chip: 'warn', texto: dias === 0 ? 'Vence hoy' : `Vence en ${dias} día${dias === 1 ? '' : 's'}`, dias };
  return { clave: 'vigente', chip: 'ok', texto: 'Vigente', dias };
}
export const nombreDoc = d => (TIPOS_DOC[d.tipo] || ['Documento'])[0] + (d.descripcion ? ` · ${d.descripcion}` : '');

export async function cargarMant() {
  const a = T();
  const [pl, hi] = await Promise.all([
    sb.from('planes_mantenimiento').select('*').eq('empresa_id', E()).eq('activo', true),
    sb.from('mantenimientos').select('*, equipo:equipos(codigo, nombre, medidor), plan:planes_mantenimiento(nombre), quien:miembros(nombre)').eq('empresa_id', E()).order('realizado_en', { ascending: false }).limit(60),
  ]);
  if (pl.error || hi.error) return toast(msgError(pl.error || hi.error));
  a.mt = { ...(a.mt || {}), planes: pl.data, hist: hi.data };
  render();
}

/* ------------------------------------------------------------ vista */
export function vMantenimiento() {
  const a = T(), d = a.d, mt = a.mt || {};
  return `${vServices(d, mt)}${vDocumentos(d, mt)}${vHistorial(d, mt)}`;
}

function barra(e) {
  const usado = Math.max(0, Math.min(1, (e.actual - e.ultimo_medidor) / e.cada));
  return `<div class="mt-bar" role="img" aria-label="${Math.round(usado * 100)}% del intervalo usado"><i class="${ESTADO_PLAN[e.estado][0]}" style="width:${(usado * 100).toFixed(0)}%"></i></div>`;
}

function vServices(d, mt) {
  const f = mt.formPlan;
  const filas = d.services.map(e => {
    const u = unidad(e.medidor), [c, t] = ESTADO_PLAN[e.estado];
    return `<div class="eqrow"><span class="eqcode">${esc(e.codigo)}</span><div><b>${esc(e.plan)}</b> <span class="chip ${c}">${t}</span>
        <div class="small muted">${esc(e.equipo)} · cada <span class="num">${fNum(e.cada)} ${u}</span> · último a las <span class="num">${fNum(e.ultimo_medidor)} ${u}</span>${e.ultimo_en ? ' el ' + fFecha(e.ultimo_en + 'T12:00:00') : ''}</div>
        ${barra(e)}
        <div class="small">Actual <span class="num">${fNum(e.actual)} ${u}</span> · próximo a las <span class="num">${fNum(e.proximo)} ${u}</span> · ${e.faltan <= 0 ? `<b style="color:var(--bad)">pasado por ${fNum(-e.faltan)} ${u}</b>` : `faltan <span class="num">${fNum(e.faltan)} ${u}</span>`}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn sm ${e.estado === 'al_dia' ? 'ghost' : 'primary'}" data-act="mtTrabajo" data-equipo="${e.equipo_id}" data-plan="${e.plan_id}">Registrar service</button>
        ${esAdmin() ? `<button class="btn sm ghost" data-act="mtPlanBorrar" data-id="${e.plan_id}">${T().confirm === 'plan-' + e.plan_id ? 'Tocá de nuevo' : 'Quitar'}</button>` : ''}</div></div>`;
  }).join('');
  const eq = f && d.equipos.find(x => x.id === f.equipo_id);
  const u = eq ? unidad(eq.medidor) : 'h';
  const sugerencias = eq ? (eq.medidor === 'km' ? [['Service 10.000 km', 10000, 500], ['Service 20.000 km', 20000, 1000]] : [['Service 250 h', 250, 25], ['Service 500 h', 500, 50], ['Service 1.000 h', 1000, 50], ['Service 2.000 h', 2000, 100]]) : [];
  const form = f ? `<div class="mt-form"><h3>Nuevo plan de service</h3><div class="form-grid">
      <label class="f">Equipo<select class="inp" id="mp-eq" data-mp="equipo_id" data-vivo><option value="">Elegí el equipo</option>${d.equipos.filter(x => x.activo).map(x => `<option value="${x.id}" ${f.equipo_id === x.id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join('')}</select></label>
      <label class="f">Nombre<input class="inp" id="mp-nom" data-mp="nombre" value="${esc(f.nombre)}" placeholder="Service 250 h"></label>
      <label class="f">Cada (${u})<input class="inp num" id="mp-cada" type="number" inputmode="decimal" data-mp="cada" value="${esc(f.cada)}"></label>
      <label class="f">Avisar cuando falten (${u})<input class="inp num" id="mp-ant" type="number" inputmode="decimal" data-mp="anticipo" value="${esc(f.anticipo)}"></label>
      <label class="f">Último service a las (${u}) <small>Si no sabés, dejá el valor actual</small><input class="inp num" id="mp-ult" type="number" inputmode="decimal" data-mp="ultimo_medidor" value="${esc(f.ultimo_medidor)}"></label>
      <label class="f">Fecha del último service <small>Opcional</small><input class="inp" id="mp-fec" type="date" data-mp="ultimo_en" value="${esc(f.ultimo_en)}"></label></div>
      ${sugerencias.length ? `<div class="row small">Sugeridos: ${sugerencias.map(([n, c, an]) => `<button class="btn sm ghost" data-act="mtSugerir" data-n="${n}" data-c="${c}" data-a="${an}">${n}</button>`).join('')}</div>` : ''}
      ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="mtCancelar" data-f="formPlan">Cancelar</button><button class="btn sm primary" data-act="mtPlanGuardar">Guardar plan</button></div></div>` : '';
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Services programados</h2>
      <p class="small muted">Se calcula con el horómetro u odómetro de los checklists y, si hay, con el dato de John Deere.</p></div>
      ${f ? '' : '<button class="btn sm dark" data-act="mtPlanNuevo">Agregar plan</button>'}</div>
    ${form}${filas ? `<div>${filas}</div>` : '<div class="empty">Todavía no hay planes. Agregá uno por equipo (por ejemplo, service cada 250 horas).</div>'}
    ${vTrabajo(d, mt, 'service')}</section>`;
}

function vDocumentos(d, mt) {
  const f = mt.formDoc, docs = [...d.docs].sort((x, y) => x.vence.localeCompare(y.vence));
  const quien = x => x.equipo_id ? (d.equipos.find(e => e.id === x.equipo_id) || {}).codigo : (d.miembros.find(m => m.id === x.miembro_id) || {}).nombre;
  const filas = docs.map(x => {
    const st = estadoDoc(x);
    return `<div class="eqrow"><span class="eqcode">${esc(quien(x) || '—')}</span><div><b>${esc(nombreDoc(x))}</b> <span class="chip ${st.chip}">${st.texto}</span>${x.bloquea ? ' <span class="chip plain">Bloquea al vencer</span>' : ''}
        <div class="small muted">Vence el ${fFecha(x.vence + 'T12:00:00')} · aviso ${x.aviso_dias} días antes</div>
        ${mt.renovar === x.id ? `<div class="row" style="margin-top:6px"><input class="inp" id="ren-${x.id}" type="date" data-ren="vence" value="${esc(mt.renVence || '')}" style="flex:0 1 200px"><button class="btn sm" data-act="mtCancelar" data-f="renovar">Cancelar</button><button class="btn sm primary" data-act="mtRenovarOk" data-id="${x.id}">Guardar</button></div>` : ''}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn sm ${st.clave === 'vigente' ? 'ghost' : 'primary'}" data-act="mtRenovar" data-id="${x.id}">Renovar</button>
        <button class="btn sm ghost" data-act="mtDocBorrar" data-id="${x.id}">${T().confirm === 'doc-' + x.id ? 'Tocá de nuevo' : 'Quitar'}</button></div></div>`;
  }).join('');
  const tipos = f ? Object.entries(TIPOS_DOC).filter(([, [, ap]]) => ap === 'ambos' || ap === (f.aplica === 'equipo' ? 'equipo' : 'persona')) : [];
  const form = f ? `<div class="mt-form"><h3>Nuevo vencimiento</h3><div class="form-grid">
      <label class="f">Corresponde a<select class="inp" id="md-ap" data-md="aplica" data-vivo><option value="equipo" ${f.aplica === 'equipo' ? 'selected' : ''}>Un equipo</option><option value="persona" ${f.aplica === 'persona' ? 'selected' : ''}>Una persona</option></select></label>
      <label class="f">${f.aplica === 'equipo' ? 'Equipo' : 'Persona'}<select class="inp" id="md-ref" data-md="ref"><option value="">Elegí</option>${(f.aplica === 'equipo' ? d.equipos.filter(x => x.activo).map(x => [x.id, x.codigo + ' · ' + x.nombre]) : d.miembros.filter(m => m.activo).map(m => [m.id, m.nombre])).map(([v, l]) => `<option value="${v}" ${f.ref === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="f">Tipo<select class="inp" id="md-tipo" data-md="tipo">${tipos.map(([k, [l]]) => `<option value="${k}" ${f.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Detalle <small>Opcional: aseguradora, número, categoría</small><input class="inp" id="md-desc" data-md="descripcion" value="${esc(f.descripcion)}" maxlength="80"></label>
      <label class="f">Vence el<input class="inp" id="md-vence" type="date" data-md="vence" value="${esc(f.vence)}"></label>
      <label class="f">Avisar con (días de anticipación)<input class="inp num" id="md-aviso" type="number" inputmode="numeric" data-md="aviso_dias" value="${esc(f.aviso_dias)}"></label></div>
      <label class="check"><input type="checkbox" id="md-bloq" data-md="bloquea" ${f.bloquea ? 'checked' : ''}><span>Al vencer, no dejar iniciar jornada ${f.aplica === 'equipo' ? 'con este equipo' : 'a esta persona'}</span></label>
      ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="mtCancelar" data-f="formDoc">Cancelar</button><button class="btn sm primary" data-act="mtDocGuardar">Guardar</button></div></div>` : '';
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Vencimientos</h2>
      <p class="small muted">Seguros, VTV, matafuegos y habilitaciones de los equipos; licencias, cursos y aptos de las personas.</p></div>
      ${f ? '' : '<button class="btn sm dark" data-act="mtDocNuevo">Agregar vencimiento</button>'}</div>
    ${form}${filas ? `<div>${filas}</div>` : '<div class="empty">Sin vencimientos cargados.</div>'}</section>`;
}

function vTrabajo(d, mt, desde) {
  const f = mt.formTrabajo; if (!f || f.desde !== desde) return '';
  const eq = d.equipos.find(x => x.id === f.equipo_id), u = eq ? unidad(eq.medidor) : 'h';
  const planes = (mt.planes || []).filter(p => p.equipo_id === f.equipo_id);
  return `<div class="mt-form"><h3>Registrar trabajo</h3><div class="form-grid">
    <label class="f">Equipo<select class="inp" id="mw-eq" data-mw="equipo_id" data-vivo><option value="">Elegí el equipo</option>${d.equipos.map(x => `<option value="${x.id}" ${f.equipo_id === x.id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join('')}</select></label>
    <label class="f">Tipo<select class="inp" id="mw-tipo" data-mw="tipo" data-vivo><option value="service" ${f.tipo === 'service' ? 'selected' : ''}>Service</option><option value="reparacion" ${f.tipo === 'reparacion' ? 'selected' : ''}>Reparación</option><option value="otro" ${f.tipo === 'otro' ? 'selected' : ''}>Otro</option></select></label>
    ${f.tipo === 'service' && planes.length ? `<label class="f">Plan<select class="inp" id="mw-plan" data-mw="plan_id"><option value="">Sin plan</option>${planes.map(p => `<option value="${p.id}" ${f.plan_id === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>` : ''}
    <label class="f">${eq && eq.medidor === 'km' ? 'Odómetro' : 'Horómetro'} (${u})<input class="inp num" id="mw-med" type="number" inputmode="decimal" data-mw="medidor" value="${esc(f.medidor)}"></label>
    <label class="f">Fecha<input class="inp" id="mw-fec" type="date" data-mw="realizado_en" value="${esc(f.realizado_en)}"></label>
    <label class="f">Taller o mecánico <small>Opcional</small><input class="inp" id="mw-resp" data-mw="responsable" value="${esc(f.responsable)}"></label>
    <label class="f">Costo <small>Opcional</small><input class="inp num" id="mw-costo" type="number" inputmode="decimal" data-mw="costo" value="${esc(f.costo)}"></label></div>
    <label class="f">Qué se hizo<textarea class="inp" id="mw-desc" data-mw="descripcion" placeholder="Ej.: cambio de aceite de motor, filtros de aire y combustible">${esc(f.descripcion)}</textarea></label>
    ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="mtCancelar" data-f="formTrabajo">Cancelar</button><button class="btn sm primary" data-act="mtTrabajoGuardar">Guardar</button></div></div>`;
}

function vHistorial(d, mt) {
  const h = mt.hist;
  const TIP = { service: 'Service', reparacion: 'Reparación', otro: 'Otro' };
  return `<section class="card"><div class="row" style="justify-content:space-between"><h2>Historial de trabajos</h2>
      ${mt.formTrabajo && mt.formTrabajo.desde === 'historial' ? '' : '<button class="btn sm dark" data-act="mtTrabajo" data-desde="historial">Registrar trabajo</button>'}</div>
    ${vTrabajo(d, mt, 'historial')}
    ${!h ? '<p class="muted">Cargando…</p>' : h.length ? `<div>${h.map(x => `<div class="eqrow"><span class="eqcode">${esc(x.equipo.codigo)}</span><div><b>${TIP[x.tipo]}${x.plan ? ' · ' + esc(x.plan.nombre) : ''}</b> <span class="small muted">${fFecha(x.realizado_en + 'T12:00:00')}</span>
        <div class="small">${esc(x.descripcion)}</div>
        <div class="small muted">${x.medidor != null ? `<span class="num">${fNum(x.medidor)} ${unidad(x.equipo.medidor)}</span> · ` : ''}${x.responsable ? esc(x.responsable) + ' · ' : ''}${x.costo != null ? '$ ' + fNum(x.costo) + ' · ' : ''}cargó ${esc(x.quien ? x.quien.nombre : '—')}</div></div><span></span></div>`).join('')}</div>` : '<div class="empty">Sin trabajos registrados.</div>'}</section>`;
}

/* ------------------------------------------------------------ acciones */
const mt = () => (T().mt ||= {});
async function guardarYRecargar(promesa, ok, campo) {
  const { error } = await promesa;
  if (error) { toast(msgError(error), 6000); return false; }
  if (campo) mt()[campo] = null;
  toast(ok); await Promise.all([S.adm.recargar(), cargarMant()]); return true;
}
export const A = {
  mtPlanNuevo: () => { mt().formPlan = { equipo_id: '', nombre: '', cada: '', anticipo: '', ultimo_medidor: '', ultimo_en: '', err: '' }; render(); },
  mtSugerir: b => { const f = mt().formPlan; f.nombre = b.dataset.n; f.cada = b.dataset.c; f.anticipo = b.dataset.a; render(); },
  mtCancelar: b => { mt()[b.dataset.f] = null; render(); },
  mtPlanGuardar: async () => {
    const f = mt().formPlan; f.err = '';
    if (!f.equipo_id) f.err = 'Elegí el equipo.'; else if (f.nombre.trim().length < 2) f.err = 'Poné un nombre (ej.: Service 250 h).';
    else if (!(+f.cada > 0)) f.err = 'Indicá cada cuánto se hace.'; else if (f.ultimo_medidor === '' || +f.ultimo_medidor < 0) f.err = 'Indicá a cuánto se hizo el último service.';
    if (f.err) return render();
    await guardarYRecargar(sb.from('planes_mantenimiento').insert({ empresa_id: E(), equipo_id: f.equipo_id, nombre: f.nombre.trim(), cada: +f.cada,
      anticipo: f.anticipo === '' ? 0 : +f.anticipo, ultimo_medidor: +f.ultimo_medidor, ultimo_en: f.ultimo_en || null }), 'Plan de service guardado.', 'formPlan');
  },
  mtPlanBorrar: async b => {
    const k = 'plan-' + b.dataset.id; if (T().confirm !== k) { T().confirm = k; return render(); } T().confirm = null;
    await guardarYRecargar(sb.from('planes_mantenimiento').update({ activo: false }).eq('id', b.dataset.id), 'Plan quitado.');
  },
  mtTrabajo: b => {
    const eqId = b.dataset.equipo || '', e = T().d.equipos.find(x => x.id === eqId), est = T().d.services.find(x => x.plan_id === b.dataset.plan);
    mt().formTrabajo = { desde: b.dataset.desde || 'service', equipo_id: eqId, tipo: 'service', plan_id: b.dataset.plan || '', medidor: est ? est.actual : (e && e.ultimo_medidor != null ? e.ultimo_medidor : ''),
      realizado_en: hoy(), responsable: '', costo: '', descripcion: est ? est.plan : '', err: '' };
    if (!mt().planes) cargarMant(); render();
  },
  mtTrabajoGuardar: async () => {
    const f = mt().formTrabajo; f.err = '';
    if (!f.equipo_id) f.err = 'Elegí el equipo.'; else if (f.descripcion.trim().length < 3) f.err = 'Contá qué se hizo.';
    else if (f.tipo === 'service' && f.plan_id && f.medidor === '') f.err = 'Para un service de plan hace falta el horómetro u odómetro.';
    if (f.err) return render();
    await guardarYRecargar(sb.from('mantenimientos').insert({ empresa_id: E(), equipo_id: f.equipo_id, plan_id: f.tipo === 'service' && f.plan_id ? f.plan_id : null, tipo: f.tipo,
      descripcion: f.descripcion.trim(), medidor: f.medidor === '' ? null : +f.medidor, realizado_en: f.realizado_en || hoy(),
      costo: f.costo === '' ? null : +f.costo, responsable: f.responsable.trim() || null }), 'Trabajo registrado.', 'formTrabajo');
  },
  mtDocNuevo: () => { mt().formDoc = { aplica: 'equipo', ref: '', tipo: 'seguro', descripcion: '', vence: '', aviso_dias: 30, bloquea: false, err: '' }; render(); },
  mtDocGuardar: async () => {
    const f = mt().formDoc; f.err = '';
    if (!f.ref) f.err = f.aplica === 'equipo' ? 'Elegí el equipo.' : 'Elegí la persona.'; else if (!f.vence) f.err = 'Indicá la fecha de vencimiento.';
    if (f.err) return render();
    await guardarYRecargar(sb.from('documentos').insert({ empresa_id: E(), equipo_id: f.aplica === 'equipo' ? f.ref : null, miembro_id: f.aplica === 'persona' ? f.ref : null,
      tipo: f.tipo, descripcion: f.descripcion.trim() || null, vence: f.vence, aviso_dias: Math.max(0, Math.min(365, +f.aviso_dias || 0)), bloquea: !!f.bloquea }), 'Vencimiento guardado.', 'formDoc');
  },
  mtRenovar: b => { mt().renovar = b.dataset.id; mt().renVence = ''; render(); },
  mtRenovarOk: async b => {
    if (!mt().renVence) return toast('Elegí la nueva fecha de vencimiento.');
    if (await guardarYRecargar(sb.from('documentos').update({ vence: mt().renVence }).eq('id', b.dataset.id), 'Vencimiento renovado.')) mt().renovar = null;
  },
  mtDocBorrar: async b => {
    const k = 'doc-' + b.dataset.id; if (T().confirm !== k) { T().confirm = k; return render(); } T().confirm = null;
    await guardarYRecargar(sb.from('documentos').delete().eq('id', b.dataset.id), 'Vencimiento quitado.');
  },
};

export function alEscribir(el, v) {
  const m = T() && T().mt; if (!m) return false;
  if (el.dataset.mp && m.formPlan) {
    m.formPlan[el.dataset.mp] = v;
    if (el.dataset.mp === 'equipo_id') { const e = T().d.equipos.find(x => x.id === v); if (e && m.formPlan.ultimo_medidor === '') m.formPlan.ultimo_medidor = e.ultimo_medidor ?? ''; render(); }
    return true;
  }
  if (el.dataset.md && m.formDoc) {
    m.formDoc[el.dataset.md] = v;
    if (el.dataset.md === 'aplica') { m.formDoc.ref = ''; m.formDoc.tipo = v === 'equipo' ? 'seguro' : 'licencia'; render(); }
    return true;
  }
  if (el.dataset.mw && m.formTrabajo) { m.formTrabajo[el.dataset.mw] = v; if (['equipo_id', 'tipo'].includes(el.dataset.mw)) render(); return true; }
  if (el.dataset.ren) { m.renVence = v; return true; }
  return false;
}
