// Tarjeta de combustible propia: vales con código y QR, cupos por equipo y control de las cargas observadas.
// El operario pide el vale (dentro del cupo se aprueba solo) y lo muestra en la estación o el surtidor.
// La supervisión aprueba pedidos, emite vales, revisa las cargas que el servidor marcó como observadas y fija los cupos.
import { $, esc, fFecha, fHora, fNum, dayKey, toast, msgError, ls, descargar } from './util.js';
import { sb } from './datos.js';
import { S, render, esGestor } from './estado.js';
import { qrSvg } from './etiquetas.js';

const E = () => S.m.empresa_id;
export const ORIGEN = { surtidor_propio: 'Surtidor propio', estacion: 'Estación de servicio', cisterna: 'Camión cisterna', otro: 'Otro' };
const vencido = v => v.estado === 'emitido' && v.vence_en && new Date(v.vence_en) < new Date();
const fVence = v => { const d = new Date(v.vence_en), h = (d - Date.now()) / 36e5; return h < 24 ? `vence hoy a las ${fHora(d)}` : `vence el ${fFecha(d)} ${fHora(d)}`; };
const ESTADO = v => vencido(v) ? ['Vencido', 'plain'] : { pedido: ['Pedido: esperando aprobación', 'warn'], emitido: ['Listo para usar', 'ok'], usado: ['Usado', 'plain'], anulado: ['Anulado', 'bad'] }[v.estado];
const ALERTA_CORTA = { sin_vale: 'Sin vale', vale_excedido: 'Pasó el vale', vale_usado: 'Vale ya usado', vale_anulado: 'Vale anulado', vale_vencido: 'Vale vencido', vale_sin_aprobar: 'Vale sin aprobar',
  vale_otro_equipo: 'Vale de otro equipo', vale_origen: 'Otro lugar', vale_invalido: 'Vale inexistente', cupo_dia: 'Cupo diario', cupo_semana: 'Cupo semanal', cupo_mes: 'Cupo mensual',
  seguida: 'Cargas seguidas', sin_avance: 'Medidor sin avanzar', consumo_alto: 'Consumo alto', precio_alto: 'Precio alto' };
const err = e => msgError(e);

/* ================================================================ operario */
const V = () => (S.va ||= { lista: null, exigir: false, form: null, ver: null });
export async function cargarVales() {
  const v = V(), k = 'co_vales_' + S.m.id;
  const [l, aj] = await Promise.all([
    sb.from('vales_combustible').select('*, equipo:equipos(codigo, nombre)').eq('empresa_id', E()).in('estado', ['pedido', 'emitido']).order('creado_en', { ascending: false }).limit(30),
    sb.from('ajustes_combustible').select('exigir_vale').eq('empresa_id', E()).maybeSingle()]);
  if (l.error) { const c = ls.get(k, null); v.lista = c ? c.lista : []; v.exigir = c ? c.exigir : false; }
  else { v.lista = l.data.filter(x => !vencido(x) && (!x.para_miembro || x.para_miembro === S.m.id || x.pedido_por === S.m.id)); v.exigir = !!(aj.data && aj.data.exigir_vale); ls.set(k, { lista: v.lista, exigir: v.exigir }); }
  render();
}
// Vales activos de un equipo (para elegir al registrar la carga).
export const valesDe = equipoId => (V().lista || []).filter(x => x.equipo_id === equipoId && x.estado === 'emitido' && !vencido(x));
export const exigeVale = () => !!V().exigir;

// Bloque en el inicio del operario.
export function vOperario(equipos) {
  const v = V();
  if (!v.lista) { if (!v.cargando) { v.cargando = true; cargarVales().finally(() => { v.cargando = false; }); } return ''; }
  const lista = v.lista.map(x => { const [t, c] = ESTADO(x); return `<div class="vale-li"><div><b>${esc(x.equipo ? x.equipo.codigo : '')}</b> · hasta ${fNum(x.litros_max)} L
      <div class="small muted">Vale ${x.numero}${x.estado === 'emitido' && x.vence_en ? ' · ' + fVence(x) : ''}${x.origen ? ' · ' + ORIGEN[x.origen] : ''}</div><span class="chip ${c}">${t}</span></div>
      ${x.estado === 'emitido' ? `<button class="btn primary sm" data-act="vaVer" data-id="${x.id}"><span class="mono">${esc(x.codigo)}</span> Mostrar</button>`
        : x.pedido_por === S.m.id ? `<button class="btn ghost sm" data-act="vaCancelar" data-id="${x.id}">Cancelar</button>` : ''}</div>`; }).join('');
  return `<section class="card"><div class="row" style="justify-content:space-between"><h2>Vales de combustible</h2><button class="btn sm dark" data-act="vaPedir">Pedir vale</button></div>
    ${v.exigir ? '<p class="small muted">Tu empresa pide vale para cargar. Mostrá el código en la estación o en el surtidor y anotalo en el ticket.</p>' : ''}
    ${lista ? `<div>${lista}</div>` : '<p class="muted small">No tenés vales abiertos.</p>'}</section>`;
}
// Pantalla del vale para mostrar al playero o al encargado del surtidor.
export function vVer() {
  const x = (V().lista || []).find(y => y.id === V().ver); if (!x) return '';
  return `<main class="wrap"><section class="card vale-ver"><p class="eyebrow">Vale de combustible ${x.numero} · ${esc(S.m.empresa.nombre)}</p>
    <h1>${esc(x.equipo.codigo)} · ${esc(x.equipo.nombre)}</h1>
    <div class="vale-cod mono">${esc(x.codigo)}</div><div class="vale-qr">${qrSvg('OPERAPTO-VALE ' + x.codigo)}</div>
    <dl class="kv"><dt>Hasta</dt><dd><b>${fNum(x.litros_max)} L</b></dd>${x.origen ? `<dt>Dónde</dt><dd>${ORIGEN[x.origen]}${x.proveedor ? ' · ' + esc(x.proveedor) : ''}</dd>` : ''}
      <dt>Vence</dt><dd>${fFecha(x.vence_en)} ${fHora(x.vence_en)} h</dd></dl>
    <p class="small muted">Que el playero anote el código en el ticket. Después registrá la carga eligiendo este vale.</p>
    <div class="row"><button class="btn" data-act="vaCerrar">Volver</button><button class="btn primary" data-act="vaCargar" data-id="${x.id}">Registrar la carga</button></div></section></main>`;
}
export function vPedir(equipos) {
  const f = V().form; if (!f) return '';
  return `<main class="wrap"><section><p class="eyebrow">Combustible</p><h1>Pedir vale</h1></section>
    <label class="f">Equipo<select class="inp" id="va-eq" data-va="equipo" data-vivo><option value="">Elegí el equipo</option>${equipos.map(e => `<option value="${e.id}" ${f.equipo === e.id ? 'selected' : ''}>${esc(e.codigo)} · ${esc(e.nombre)}</option>`).join('')}</select></label>
    ${f.cupo !== undefined && f.equipo ? `<p class="small ${f.cupo != null && f.cupo <= 0 ? 'err' : 'muted'}">${f.cupo == null ? 'Este equipo no tiene cupo.' : f.cupo <= 0 ? 'Este equipo ya usó su cupo: el pedido lo tiene que aprobar el supervisor.' : `Cupo disponible: <b>${fNum(f.cupo)} L</b>. Dentro del cupo se aprueba solo.`}</p>` : ''}
    <div class="form-grid"><label class="f">Litros<input class="inp num" id="va-l" type="number" inputmode="decimal" data-va="litros" value="${esc(f.litros)}"></label>
      <label class="f">Dónde vas a cargar<select class="inp" id="va-o" data-va="origen"><option value="">Donde sea</option>${Object.entries(ORIGEN).map(([k, l]) => `<option value="${k}" ${f.origen === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="f">Para qué <small>Opcional</small><input class="inp" id="va-m" data-va="motivo" value="${esc(f.motivo)}" maxlength="300" placeholder="Ej.: movimiento de suelo en Ruta 5"></label>
    ${f.err ? `<p class="err" role="alert">${esc(f.err)}</p>` : ''}
    <div class="row"><button class="btn" data-act="vaPedirCancelar">Cancelar</button><button class="btn primary" data-act="vaPedirOk" ${f.ocupado ? 'disabled' : ''}>${f.ocupado ? 'Pidiendo…' : 'Pedir vale'}</button></div></main>`;
}
export const abierto = () => !!(S.va && (S.va.form || S.va.ver));

/* ================================================================ panel */
const P = () => S.adm;
const Q = () => (P().va ||= { vales: null, obs: null, pedidos: null, emitir: null, ctl: null, apr: null, cupos: null, aj: null });
export async function cargarPanel() {
  const q = Q(), d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const m0 = new Date(); m0.setDate(Math.min(m0.getDate() - ((m0.getDay() + 6) % 7), 1)); m0.setHours(0, 0, 0, 0);   // desde el lunes o el día 1, lo que sea antes
  const [vs, ob, cg, aj] = await Promise.all([
    sb.from('vales_combustible').select('*, equipo:equipos(codigo, nombre), pide:miembros!vales_combustible_pedido_por_fkey(nombre), para:miembros!vales_combustible_para_miembro_fkey(nombre), carga:cargas_combustible!vales_combustible_carga_id_fkey(litros, control)')
      .eq('empresa_id', E()).or(`creado_en.gte.${d30.toISOString()},estado.in.(pedido,emitido)`).order('numero', { ascending: false }).limit(300),
    sb.from('cargas_combustible').select('*, equipo:equipos(codigo, nombre, medidor), quien:miembros!cargas_combustible_miembro_id_fkey(nombre), vale:vales_combustible!cargas_combustible_vale_id_fkey(numero, codigo, litros_max)')
      .eq('empresa_id', E()).eq('control', 'observada').order('cargado_en', { ascending: false }).limit(100),
    sb.from('cargas_combustible').select('equipo_id, litros, cargado_en').eq('empresa_id', E()).gte('cargado_en', m0.toISOString()),
    sb.from('ajustes_combustible').select('*').eq('empresa_id', E()).maybeSingle()]);
  const e = [vs, ob, cg].find(r => r.error);
  if (e) { toast(err(e.error)); }
  q.vales = vs.data || []; q.obs = ob.data || []; q.cargasMes = cg.data || [];
  q.ajustes = aj.data || { exigir_vale: false, vale_horas: 24, aprobar_solo: true, tolerancia_precio: 15 };
  q.aj ||= { ...q.ajustes };
  const fotos = q.obs.map(c => c.foto_path).filter(Boolean); q.fotos = {};
  if (fotos.length) { const { data } = await sb.storage.from('evidencias').createSignedUrls(fotos, 3600); (data || []).forEach(u => { if (u.signedUrl) q.fotos[u.path] = u.signedUrl; }); }
  render();
}
export const pendientesPanel = () => { const q = P() && P().va; return q && q.vales ? q.vales.filter(v => v.estado === 'pedido').length + q.obs.length : null; };

export function vPanel(sub) {
  const q = Q(), a = P();
  if (!q.vales) { if (!q.cargando) { q.cargando = true; cargarPanel().finally(() => { q.cargando = false; }); } return '<p class="muted">Cargando…</p>'; }
  return sub === 'cupos' ? vCupos() : vControles();
}

function vControles() {
  const q = Q(), a = P(), pedidos = q.vales.filter(v => v.estado === 'pedido'), activos = q.vales.filter(v => v.estado === 'emitido' && !vencido(v));
  const eqs = a.d.equipos.filter(e => e.activo);
  const obs = q.obs.map(c => { const propia = c.miembro_id === S.m.id, ct = q.ctl && q.ctl.id === c.id;
    return `<div class="rev">${c.foto_path && q.fotos[c.foto_path] ? `<a href="${q.fotos[c.foto_path]}" target="_blank" rel="noopener"><img src="${q.fotos[c.foto_path]}" alt="Foto de la carga" loading="lazy"></a>` : '<div class="rev-sin">Sin foto</div>'}
      <div><b>${esc(c.equipo.codigo)}</b> · ${fNum(c.litros)} L <span class="small muted">${fFecha(c.cargado_en)} ${fHora(c.cargado_en)} · ${esc(c.quien ? c.quien.nombre : '')}</span>
        <div class="small muted">${ORIGEN[c.origen] || ''}${c.proveedor ? ' · ' + esc(c.proveedor) : ''}${c.precio_litro != null ? ` · $ ${fNum(c.precio_litro)}/L` : ''}${c.vale ? ` · vale ${c.vale.numero} (${fNum(c.vale.litros_max)} L)` : ''}</div>
        <ul class="alertas-carga">${(c.alertas || []).map(x => `<li><b>${esc(ALERTA_CORTA[x.k] || x.k)}:</b> ${esc(x.t)}</li>`).join('')}</ul>
        <div class="row">${ct ? `<input class="inp" id="va-ctl" data-vac="nota" value="${esc(q.ctl.nota)}" placeholder="${q.ctl.aprobar ? 'Comentario (opcional)' : 'Motivo del rechazo'}" style="flex:1 1 160px"><button class="btn sm" data-act="vaCtlCancelar">Cancelar</button><button class="btn sm primary" data-act="vaCtlOk">${q.ctl.aprobar ? 'Aprobar' : 'Rechazar'}</button>`
          : propia ? '<span class="small muted">Es tuya: la tiene que controlar otra persona.</span>'
          : `<button class="btn sm primary" data-act="vaCtl" data-id="${c.id}" data-k="1">Aprobar</button><button class="btn sm ghost" data-act="vaCtl" data-id="${c.id}" data-k="0">Rechazar</button>`}</div></div></div>`; }).join('');
  const ped = pedidos.map(v => { const ap = q.apr && q.apr.id === v.id;
    return `<div class="att" style="grid-template-columns:1fr auto"><div><div class="t">${esc(v.equipo.codigo)} · ${fNum(v.litros_max)} L <span class="small muted">vale ${v.numero} · ${esc(v.pide ? v.pide.nombre : '')} · ${fFecha(v.creado_en)} ${fHora(v.creado_en)}</span></div>
        <div class="s">${v.motivo ? '“' + esc(v.motivo) + '”' : 'Sin motivo'}${v.origen ? ' · ' + ORIGEN[v.origen] : ''}</div>
        ${ap ? `<div class="row"><input class="inp num" id="va-apl" type="number" data-vap="litros" value="${esc(q.apr.litros)}" style="width:110px" placeholder="Litros"><input class="inp" id="va-apm" data-vap="motivo" value="${esc(q.apr.motivo)}" placeholder="Motivo si lo rechazás" style="flex:1 1 160px">
          <button class="btn sm" data-act="vaAprCancelar">Cancelar</button><button class="btn sm ghost" data-act="vaRechazar">Rechazar</button><button class="btn sm primary" data-act="vaAprOk">Aprobar</button></div>` : ''}</div>
      ${ap ? '' : v.pedido_por === S.m.id ? '<span class="small muted">Es tuyo</span>' : `<button class="btn sm primary" data-act="vaApr" data-id="${v.id}">Revisar</button>`}</div>`; }).join('');
  const f = q.emitir;
  const form = f ? `<section class="card" id="va-emitir"><h2>Emitir un vale</h2>
      <div class="form-grid"><label class="f">Equipo<select class="inp" id="ve-eq" data-ve="equipo"><option value="">Elegí</option>${eqs.map(e => `<option value="${e.id}" ${f.equipo === e.id ? 'selected' : ''}>${esc(e.codigo)} · ${esc(e.nombre)}</option>`).join('')}</select></label>
        <label class="f">Litros<input class="inp num" id="ve-l" type="number" data-ve="litros" value="${esc(f.litros)}"></label>
        <label class="f">Para <small>Opcional</small><select class="inp" id="ve-p" data-ve="para"><option value="">Cualquier operario del equipo</option>${a.d.miembros.filter(m => m.activo && ['operario', 'mecanico', 'supervisor'].includes(m.rol)).map(m => `<option value="${m.id}" ${f.para === m.id ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></label>
        <label class="f">Dónde<select class="inp" id="ve-o" data-ve="origen"><option value="">Donde sea</option>${Object.entries(ORIGEN).map(([k, l]) => `<option value="${k}" ${f.origen === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Estación <small>Opcional</small><input class="inp" id="ve-pr" data-ve="proveedor" value="${esc(f.proveedor)}" placeholder="Ej.: YPF Ruta 9 km 12"></label>
        <label class="f">Obra <small>Opcional</small><select class="inp" id="ve-ob" data-ve="obra"><option value="">—</option>${a.d.obras.filter(o => o.activa).map(o => `<option value="${o.id}" ${f.obra === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label></div>
      ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="vaEmitirCancelar">Cancelar</button><button class="btn sm primary" data-act="vaEmitirOk">Emitir</button></div></section>` : '';
  const lista = q.vales.slice(0, 80).map(v => { const [t, c] = ESTADO(v);
    return `<tr><td data-l="Vale"><b>${v.numero}</b> <span class="mono small">${esc(v.codigo)}</span></td><td data-l="Equipo">${esc(v.equipo.codigo)}</td><td class="n" data-l="Litros">${fNum(v.litros_max)}${v.carga ? ` <span class="small muted">→ ${fNum(v.carga.litros)}</span>` : ''}</td>
      <td data-l="Para">${esc(v.para ? v.para.nombre : v.pide ? v.pide.nombre : 'Cualquiera')}${v.aprobado_solo ? ' <span class="small muted">(automático)</span>' : ''}</td><td data-l="Emitido">${v.emitido_en ? fFecha(v.emitido_en) + ' ' + fHora(v.emitido_en) : '—'}</td>
      <td data-l="Estado"><span class="chip ${c}">${t}</span>${v.carga && v.carga.control !== 'ok' ? ` <span class="chip ${v.carga.control === 'rechazada' ? 'bad' : 'warn'}">${{ observada: 'Carga observada', aprobada: 'Carga aprobada', rechazada: 'Carga rechazada' }[v.carga.control]}</span>` : ''}${v.anulado_motivo ? `<div class="small muted">${esc(v.anulado_motivo)}</div>` : ''}</td>
      <td>${v.estado === 'emitido' && !vencido(v) ? (q.anu && q.anu.id === v.id ? `<span class="row"><input class="inp" id="va-anu" data-vaa="motivo" value="${esc(q.anu.motivo)}" placeholder="Motivo" style="width:140px"><button class="btn sm primary" data-act="vaAnularOk">Anular</button></span>` : `<button class="btn sm ghost" data-act="vaAnular" data-id="${v.id}">Anular</button>`) : ''}</td></tr>`; }).join('');
  const usados = q.vales.filter(v => v.estado === 'usado').length;
  return `${form}<div class="kpis"><div class="kpi ${q.obs.length ? 'warn' : ''}"><b>${q.obs.length}</b><span>Cargas observadas</span></div><div class="kpi ${pedidos.length ? 'warn' : ''}"><b>${pedidos.length}</b><span>Pedidos de vale</span></div>
      <div class="kpi"><b>${activos.length}</b><span>Vales listos para usar</span></div><div class="kpi"><b>${usados}</b><span>Vales usados (30 días)</span></div></div>
    <section class="card"><h2>Cargas observadas (${q.obs.length})</h2><p class="small muted">Cada carga pasa por controles automáticos: vale, cupo, consumo según las horas trabajadas, medidor, precio y cargas seguidas. Las que no cierran quedan acá. Aprobala si tiene explicación; si no, rechazala: queda marcada como irregular para investigar. Nunca la controla quien cargó.</p>
      ${obs ? `<div class="rev-grid">${obs}</div>` : '<div class="empty">No hay cargas observadas.</div>'}</section>
    <section class="card"><h2>Pedidos de vale (${pedidos.length})</h2><p class="small muted">${q.ajustes.aprobar_solo ? 'Los pedidos dentro del cupo se aprueban solos; acá llegan los que pasan el cupo o los de un equipo que ya tiene otro vale abierto.' : 'Todos los pedidos esperan tu aprobación (se cambia en "Cupos y ajustes").'}</p>
      ${ped ? `<div>${ped}</div>` : '<p class="muted">No hay pedidos pendientes.</p>'}</section>
    <section class="card"><div class="row" style="justify-content:space-between"><h2>Vales</h2><div class="row">${f ? '' : '<button class="btn sm dark" data-act="vaEmitir">Emitir un vale</button>'}<button class="btn sm ghost" data-act="vaExcel">Excel</button></div></div>
      ${lista ? `<div class="tabla tabla-cel"><table><thead><tr><th>Vale</th><th>Equipo</th><th class="n">Litros</th><th>Para</th><th>Emitido</th><th>Estado</th><th></th></tr></thead><tbody>${lista}</tbody></table></div>` : '<div class="empty">Todavía no hay vales.</div>'}</section>`;
}

function vCupos() {
  const q = Q(), a = P(), aj = q.aj, eqs = a.d.equipos.filter(e => e.activo);
  const ini = k => { const d = new Date(); d.setHours(0, 0, 0, 0); if (k === 'semana') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); if (k === 'mes') d.setDate(1); return d; };
  const usado = (id, k) => q.cargasMes.filter(c => c.equipo_id === id && new Date(c.cargado_en) >= ini(k)).reduce((s, c) => s + Number(c.litros), 0);
  const ed = q.cupos || {};
  const barra = (u, c) => c ? `<span class="nivel cupo"><span class="${u > c ? 'bajo' : u > c * 0.8 ? 'medio' : ''}" style="width:${Math.min(100, 100 * u / c)}%"></span></span>` : '';
  const filas = eqs.map(e => { const v = ed[e.id] || { dia: e.cupo_dia_l ?? '', semana: e.cupo_semana_l ?? '', mes: e.cupo_mes_l ?? '' };
    const cambio = ['dia', 'semana', 'mes'].some(k => String(v[k]) !== String(e['cupo_' + k + '_l'] ?? ''));
    return `<tr><td data-l="Equipo"><b>${esc(e.codigo)}</b> <span class="muted small">${esc(e.nombre)}</span>${e.capacidad_tanque ? `<div class="small muted">Tanque ${fNum(e.capacidad_tanque)} L</div>` : ''}</td>
      ${['dia', 'semana', 'mes'].map(k => { const u = usado(e.id, k), c = Number(e['cupo_' + k + '_l']) || 0;
        return `<td class="n" data-l="${{ dia: 'Por día', semana: 'Por semana', mes: 'Por mes' }[k]}"><input class="inp num tarifa" id="cu-${k}-${e.id}" type="number" min="0" data-cu="${k}" data-id="${e.id}" value="${esc(v[k])}" placeholder="Sin cupo">
          <div class="small muted">usó ${fNum(u)} L${c ? ` de ${fNum(c)}` : ''}</div>${barra(u, c)}</td>`; }).join('')}
      <td><button class="btn sm ${cambio ? 'primary' : 'ghost'}" data-act="vaCupoOk" data-id="${e.id}">Guardar</button></td></tr>`; }).join('');
  return `<div class="cols"><section class="card"><h2>Ajustes</h2>
      <label class="check"><input type="checkbox" id="vj-ex" data-vj="exigir_vale" ${aj.exigir_vale ? 'checked' : ''}><span>Pedir vale para cargar <small class="muted">(sin vale, la carga queda observada)</small></span></label>
      <label class="check"><input type="checkbox" id="vj-ap" data-vj="aprobar_solo" ${aj.aprobar_solo ? 'checked' : ''}><span>Aprobar solos los pedidos dentro del cupo</span></label>
      <div class="form-grid"><label class="f">El vale dura <small>Horas</small><input class="inp num" type="number" id="vj-h" data-vj="vale_horas" value="${esc(aj.vale_horas)}"></label>
        <label class="f">Precio alto desde <small>% sobre el de referencia</small><input class="inp num" type="number" id="vj-t" data-vj="tolerancia_precio" value="${esc(aj.tolerancia_precio)}"></label></div>
      <div class="row"><button class="btn sm primary" data-act="vaAjOk">Guardar ajustes</button></div>
      <p class="small muted">El consumo alto se calcula con el consumo de referencia de cada equipo (L/h o L/100 km), que se carga en la ficha del equipo junto con la capacidad del tanque.</p></section>
    <section class="card"><h2>Cupos por equipo</h2><p class="small muted">Litros máximos por día, semana y mes. Dentro del cupo, los vales se aprueban solos; si una carga lo pasa, queda observada. Vacío: sin límite.</p>
      <div class="tabla tabla-cel"><table><thead><tr><th>Equipo</th><th class="n">Por día (L)</th><th class="n">Por semana (L)</th><th class="n">Por mes (L)</th><th></th></tr></thead><tbody>${filas}</tbody></table></div></section></div>`;
}

/* ================================================================ acciones */
export const A = {
  vaIrPanel: () => { const a = P(); a.tab = 'combustible'; a.cbSub = 'vales'; if (a.va) a.va.vales = null; render(); },
  // operario
  vaPedir: () => { V().form = { equipo: '', litros: '', origen: '', motivo: '', err: '' }; render(); scrollTo(0, 0); },
  vaPedirCancelar: () => { V().form = null; render(); },
  vaPedirOk: async () => {
    const f = V().form; f.err = '';
    if (!f.equipo) f.err = 'Elegí el equipo.'; else if (!(+f.litros > 0)) f.err = 'Indicá los litros.';
    if (f.err) return render();
    f.ocupado = true; render();
    const { data, error } = await sb.rpc('pedir_vale', { p: { equipo_id: f.equipo, litros: +f.litros, origen: f.origen || null, motivo: f.motivo || null } });
    f.ocupado = false;
    if (error) { f.err = err(error); return render(); }
    V().form = null;
    toast(data.estado === 'emitido' ? `Vale ${data.numero} aprobado: código ${data.codigo}.` : `Vale ${data.numero} pedido: espera la aprobación del supervisor.`, 6000);
    await cargarVales(); if (data.estado === 'emitido') { V().ver = data.id; render(); }
  },
  vaVer: b => { V().ver = b.dataset.id; render(); scrollTo(0, 0); },
  vaCerrar: () => { V().ver = null; render(); },
  vaCancelar: async b => { const { error } = await sb.rpc('anular_vale', { p_id: b.dataset.id, p_motivo: '' }); if (error) return toast(err(error)); toast('Pedido cancelado.'); cargarVales(); },
  // panel
  vaCtl: b => { Q().ctl = { id: b.dataset.id, aprobar: b.dataset.k === '1', nota: '' }; render(); setTimeout(() => { const i = $('#va-ctl'); i && i.focus(); }, 30); },
  vaCtlCancelar: () => { Q().ctl = null; render(); },
  vaCtlOk: async () => {
    const q = Q(), c = q.ctl; if (!c.aprobar && c.nota.trim().length < 3) return toast('Escribí el motivo del rechazo.');
    const { error } = await sb.rpc('controlar_carga', { p_id: c.id, p_aprobar: c.aprobar, p_nota: c.nota.trim() || null });
    if (error) return toast(err(error));
    toast(c.aprobar ? 'Carga aprobada.' : 'Carga rechazada: queda marcada como irregular.'); q.ctl = null; q.obs = q.obs.filter(x => x.id !== c.id); render(); P().recargar();
  },
  vaApr: b => { const v = Q().vales.find(x => x.id === b.dataset.id); Q().apr = { id: v.id, litros: v.litros_max, motivo: '' }; render(); },
  vaAprCancelar: () => { Q().apr = null; render(); },
  vaAprOk: async () => {
    const q = Q(), x = q.apr; if (!(+x.litros > 0)) return toast('Indicá los litros.');
    const { error } = await sb.rpc('aprobar_vale', { p_id: x.id, p_litros: +x.litros }); if (error) return toast(err(error));
    toast('Vale aprobado.'); q.apr = null; cargarPanel(); P().recargar();
  },
  vaRechazar: async () => {
    const q = Q(), x = q.apr; if (x.motivo.trim().length < 3) return toast('Escribí el motivo del rechazo.');
    const { error } = await sb.rpc('anular_vale', { p_id: x.id, p_motivo: x.motivo.trim() }); if (error) return toast(err(error));
    toast('Pedido rechazado.'); q.apr = null; cargarPanel(); P().recargar();
  },
  vaEmitir: () => { Q().emitir = { equipo: '', litros: '', para: '', origen: '', proveedor: '', obra: '', err: '' }; render(); scrollTo(0, 0); },
  vaEmitirCancelar: () => { Q().emitir = null; render(); },
  vaEmitirOk: async () => {
    const q = Q(), f = q.emitir; f.err = '';
    if (!f.equipo) f.err = 'Elegí el equipo.'; else if (!(+f.litros > 0)) f.err = 'Indicá los litros.';
    if (f.err) return render();
    const { data, error } = await sb.rpc('pedir_vale', { p: { equipo_id: f.equipo, litros: +f.litros, para_miembro: f.para || null, origen: f.origen || null, proveedor: f.proveedor || null, obra_id: f.obra || null } });
    if (error) { f.err = err(error); return render(); }
    q.emitir = null; toast(`Vale ${data.numero} emitido · código ${data.codigo}`, 8000); cargarPanel();
  },
  vaAnular: b => { Q().anu = { id: b.dataset.id, motivo: '' }; render(); },
  vaAnularOk: async () => {
    const q = Q(), x = q.anu; if (x.motivo.trim().length < 3) return toast('Escribí el motivo.');
    const { error } = await sb.rpc('anular_vale', { p_id: x.id, p_motivo: x.motivo.trim() }); if (error) return toast(err(error));
    q.anu = null; toast('Vale anulado.'); cargarPanel();
  },
  vaCupoOk: async b => {
    const q = Q(), e = P().d.equipos.find(x => x.id === b.dataset.id), v = (q.cupos || {})[e.id] || { dia: e.cupo_dia_l ?? '', semana: e.cupo_semana_l ?? '', mes: e.cupo_mes_l ?? '' };
    const n = s => s === '' || s == null ? null : +s;
    if (['dia', 'semana', 'mes'].some(k => n(v[k]) != null && !(n(v[k]) > 0))) return toast('El cupo tiene que ser mayor a cero (o vacío).');
    const { error } = await sb.from('equipos').update({ cupo_dia_l: n(v.dia), cupo_semana_l: n(v.semana), cupo_mes_l: n(v.mes) }).eq('id', e.id);
    if (error) return toast(err(error));
    if (q.cupos) delete q.cupos[e.id];
    toast(`Cupo de ${e.codigo} guardado.`); await P().recargar(); render();
  },
  vaAjOk: async () => {
    const q = Q(), aj = q.aj, h = Math.round(+aj.vale_horas), t = Math.round(+aj.tolerancia_precio);
    if (!(h >= 1 && h <= 720)) return toast('El vale dura de 1 a 720 horas.');
    if (!(t >= 0 && t <= 100)) return toast('El precio alto va de 0 a 100 %.');
    const { error } = await sb.from('ajustes_combustible').upsert({ empresa_id: E(), exigir_vale: !!aj.exigir_vale, aprobar_solo: !!aj.aprobar_solo, vale_horas: h, tolerancia_precio: t, actualizado_en: new Date().toISOString() });
    if (error) return toast(err(error));
    q.ajustes = { ...aj }; toast('Ajustes guardados.');
  },
  vaExcel: async () => {
    try {
      const { hojaSimple } = await import('./excel.js'), q = Q();
      const blob = await hojaSimple('Vales', `Vales de combustible · ${S.m.empresa.nombre}`, 'Últimos 30 días y los abiertos',
        [{ t: 'Vale', w: 7, n: 1 }, { t: 'Código', w: 9 }, { t: 'Equipo', w: 10 }, { t: 'Litros del vale', w: 10, n: 1 }, { t: 'Litros cargados', w: 10, n: 1 }, { t: 'Para / pidió', w: 22 },
          { t: 'Emitido', w: 16, f: 'dd/mm/yyyy hh:mm' }, { t: 'Estado', w: 14 }, { t: 'Control de la carga', w: 14 }, { t: 'Motivo', w: 40 }],
        q.vales.map(v => [v.numero, v.codigo, v.equipo.codigo, Number(v.litros_max), v.carga ? Number(v.carga.litros) : null, (v.para || v.pide || {}).nombre || '',
          v.emitido_en ? new Date(v.emitido_en) : null, ESTADO(v)[0], v.carga ? v.carga.control : '', v.anulado_motivo || v.motivo || '']));
      descargar(`operapto-${S.m.empresa.slug}-vales-${dayKey(new Date())}.xlsx`, blob, blob.type);
    } catch (e) { toast('No se pudo armar el Excel: ' + err(e), 6000); }
  },
};

export function alEscribir(el, v) {
  if (el.dataset.va && S.va && S.va.form) {
    const f = S.va.form; f[el.dataset.va] = v;
    if (el.dataset.va === 'equipo') { f.cupo = undefined; if (v) sb.rpc('cupo_disponible', { p_equipo: v }).then(r => { if (S.va.form === f && f.equipo === v) { f.cupo = r.error ? undefined : r.data; render(); } }); render(); }
    return true;
  }
  const q = P() && P().va; if (!q) return false;
  if (el.dataset.vac && q.ctl) { q.ctl.nota = v; return true; }
  if (el.dataset.vap && q.apr) { q.apr[el.dataset.vap] = v; return true; }
  if (el.dataset.ve && q.emitir) { q.emitir[el.dataset.ve] = v; return true; }
  if (el.dataset.vaa && q.anu) { q.anu.motivo = v; return true; }
  if (el.dataset.vj && q.aj) { q.aj[el.dataset.vj] = v; return true; }
  if (el.dataset.cu) { const e = P().d.equipos.find(x => x.id === el.dataset.id); q.cupos ||= {}; q.cupos[e.id] ||= { dia: e.cupo_dia_l ?? '', semana: e.cupo_semana_l ?? '', mes: e.cupo_mes_l ?? '' }; q.cupos[e.id][el.dataset.cu] = v; return true; }
  return false;
}
