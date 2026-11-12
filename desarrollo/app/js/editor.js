// Editor de plantillas de checklist (dueño y administradores).
// Cada empresa puede personalizar una plantilla base o crear una propia. Guardar crea una versión nueva:
// las jornadas viejas siguen mostrando la versión con la que se hicieron.
import { esc, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render, esAdmin } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const RUBROS = [['construccion', 'Construcción'], ['mineria', 'Minería'], ['agro', 'Agro'], ['otro', 'Otro']];
let sec = 0;
const nuevoId = () => 'c' + Date.now().toString(36) + (sec++).toString(36);
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

/* ------------------------------------------------------------ lista */
export function vPlantillas() {
  const a = T();
  if (a.ed) return vEditor();
  const lista = a.pls;
  if (!lista) return '<p class="muted">Cargando plantillas…</p>';
  const porClave = {};
  for (const p of lista) (porClave[p.clave] ||= []).push(p);
  const filas = Object.entries(porClave).map(([clave, vs]) => {
    const propias = vs.filter(p => p.empresa_id).sort((x, y) => y.version - x.version);
    const base = vs.filter(p => !p.empresa_id).sort((x, y) => y.version - x.version)[0];   // la versión base más nueva
    const vig = propias[0] || base;
    const n = vig.secciones.reduce((k, s) => k + s.items.length, 0), c = vig.secciones.reduce((k, s) => k + s.items.filter(i => i.critico).length, 0);
    return { clave, vig, propias, base, n, c };
  }).sort((x, y) => x.vig.nombre.localeCompare(y.vig.nombre));
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Plantillas de checklist</h2>
      <p class="small muted">Cada tipo de equipo usa una plantilla. Podés ajustar las de base o crear las tuyas; los cambios valen para los checklists nuevos.</p></div>
      ${esAdmin() ? '<button class="btn sm dark" data-act="edNueva">Nueva plantilla</button>' : ''}</div>
    <div>${filas.map(f => `<div class="eqrow"><span class="eqcode">${f.propias.length ? 'Propia v' + f.vig.version : 'Base'}</span>
      <div><b>${esc(f.vig.nombre)}</b> <span class="chip plain">${esc((RUBROS.find(r => r[0] === f.vig.rubro) || [, f.vig.rubro])[1])}</span>
        <div class="small muted">${f.n} puntos · ${f.c} críticos · se mide en ${f.vig.medidor === 'km' ? 'km' : 'horas'}${f.propias.length && f.base ? ' · basada en la plantilla de CheckObra' : ''}</div></div>
      <div class="row" style="justify-content:flex-end">${esAdmin() ? `<button class="btn sm ${f.propias.length ? '' : 'primary'}" data-act="edAbrir" data-clave="${esc(f.clave)}">${f.propias.length ? 'Editar' : 'Personalizar'}</button>
        ${f.propias.length && f.base ? `<button class="btn sm ghost" data-act="edVolverBase" data-clave="${esc(f.clave)}">${a.confirm === 'base-' + f.clave ? 'Tocá de nuevo para confirmar' : 'Volver a la de base'}</button>` : ''}` : ''}</div></div>`).join('')}</div></section>`;
}

export async function cargarPlantillas() {
  const { data, error } = await sb.from('plantillas').select('id, empresa_id, clave, nombre, rubro, medidor, version, secciones').eq('activa', true);
  if (error) { toast(msgError(error)); return; }
  T().pls = data; render();
}

/* ------------------------------------------------------------ editor */
function vEditor() {
  const ed = T().ed;
  const total = ed.secciones.reduce((k, s) => k + s.items.length, 0);
  const secs = ed.secciones.map((s, si) => `<section class="sec ed-sec">
    <div class="ed-sec-h"><input class="inp" id="eds-${si}" data-eds="${si}" value="${esc(s.titulo)}" placeholder="Nombre de la sección" aria-label="Nombre de la sección">
      <div class="ed-btns"><button class="btn sm ghost" data-act="edSec" data-op="arriba" data-si="${si}" aria-label="Subir sección" ${si === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn sm ghost" data-act="edSec" data-op="abajo" data-si="${si}" aria-label="Bajar sección" ${si === ed.secciones.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn sm ghost" data-act="edSec" data-op="borrar" data-si="${si}" aria-label="Borrar sección">✕</button></div></div>
    ${s.items.map((it, ii) => `<div class="ed-item">
      <input class="inp" id="edi-${si}-${ii}" data-edi="${si}.${ii}" value="${esc(it.texto)}" maxlength="200" placeholder="Qué hay que revisar" aria-label="Punto a revisar">
      <select class="inp ed-sel ed-nivel ${it.critico ? 'n-crit' : it.alerta ? 'n-alerta' : ''}" data-vivo data-edn="${si}.${ii}" aria-label="Nivel">
        <option value="normal" ${!it.critico && !it.alerta ? 'selected' : ''}>Normal</option>
        <option value="alerta" ${it.alerta ? 'selected' : ''}>Advertencia roja</option>
        <option value="critico" ${it.critico ? 'selected' : ''}>Crítico (bloquea)</option></select>
      <div class="ed-btns"><button class="btn sm ghost" data-act="edItem" data-op="arriba" data-k="${si}.${ii}" aria-label="Subir" ${ii === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn sm ghost" data-act="edItem" data-op="abajo" data-k="${si}.${ii}" aria-label="Bajar" ${ii === s.items.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn sm ghost" data-act="edItem" data-op="borrar" data-k="${si}.${ii}" aria-label="Borrar punto">✕</button></div>
      <div class="ed-extra">
        <label class="check ed-crit"><input type="checkbox" data-edf="${si}.${ii}" ${it.foto ? 'checked' : ''}><span>Foto obligatoria</span></label>
        <select class="inp ed-sel" data-edq="${si}.${ii}" aria-label="Frecuencia"><option value="">Todos los días</option>${DIAS.map((d, k) => k ? `<option value="${k}" ${it.frecuencia && it.frecuencia.dia === k ? 'selected' : ''}>Semanal: ${d}</option>` : '').join('')}</select>
        <input class="inp ed-ayuda" data-eda="${si}.${ii}" value="${esc(it.ayuda || '')}" maxlength="400" placeholder="Ayuda para el operario (opcional)" aria-label="Ayuda"></div></div>`).join('')}
    <button class="btn sm" data-act="edItem" data-op="agregar" data-k="${si}.0" style="margin:10px 16px;align-self:flex-start">+ Agregar punto</button></section>`).join('');
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><p class="eyebrow">${ed.nueva ? 'Nueva plantilla' : 'Editando'}</p><h2>${esc(ed.nombre || 'Sin nombre')}</h2></div>
      <span class="chip plain">${total} puntos · ${ed.secciones.reduce((k, s) => k + s.items.filter(i => i.critico).length, 0)} críticos</span></div>
    <div class="form-grid"><label class="f">Nombre<input class="inp" id="ed-nom" data-ed="nombre" value="${esc(ed.nombre)}" maxlength="80"></label>
      <label class="f">Se mide en<select class="inp" id="ed-med" data-ed="medidor" ${ed.nueva ? '' : 'disabled'}><option value="horas" ${ed.medidor === 'horas' ? 'selected' : ''}>Horas (horómetro)</option><option value="km" ${ed.medidor === 'km' ? 'selected' : ''}>Kilómetros (odómetro)</option></select></label>
      <label class="f">Rubro<select class="inp" id="ed-rub" data-ed="rubro">${RUBROS.map(([v, l]) => `<option value="${v}" ${ed.rubro === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <p class="small muted">Los puntos <b>críticos</b> bloquean el equipo si fallan y no admiten "No aplica".</p></section>
    ${secs}
    <button class="btn" data-act="edSec" data-op="agregar" data-si="0">+ Agregar sección</button>
    ${ed.err ? `<p class="err" role="alert">${esc(ed.err)}</p>` : ''}
    <div class="row"><button class="btn" data-act="edCancelar">Cancelar</button><button class="btn primary" data-act="edGuardar" ${ed.ocupado ? 'disabled' : ''}>${ed.ocupado ? 'Guardando…' : 'Guardar versión nueva'}</button></div>`;
}

function abrir(clave) {
  const vs = T().pls.filter(p => p.clave === clave);
  const vig = vs.filter(p => p.empresa_id).sort((x, y) => y.version - x.version)[0] || vs.filter(p => !p.empresa_id).sort((x, y) => y.version - x.version)[0];
  T().ed = { clave, nueva: false, nombre: vig.nombre, rubro: vig.rubro, medidor: vig.medidor, secciones: structuredClone(vig.secciones).map(s => ({ ...s, items: s.items.map(i => ({ id: i.id, texto: i.texto, critico: !!i.critico,
    alerta: !!i.alerta, foto: i.foto || null, frecuencia: i.frecuencia || null, ayuda: i.ayuda || '' })) })), err: '' };
  render(); scrollTo(0, 0);
}
function validar(ed) {
  if (ed.nombre.trim().length < 2) return 'Escribí el nombre de la plantilla.';
  if (!ed.secciones.length) return 'Agregá al menos una sección.';
  for (const s of ed.secciones) {
    if (!s.titulo.trim()) return 'Hay una sección sin nombre.';
    if (!s.items.length) return `La sección "${s.titulo}" no tiene puntos.`;
    if (s.items.some(i => !i.texto.trim())) return `Hay un punto vacío en "${s.titulo}".`;
  }
  return '';
}
async function guardar() {
  const a = T(), ed = a.ed;
  ed.err = validar(ed); if (ed.err) return render();
  ed.ocupado = true; render();
  let clave = ed.clave;
  if (ed.nueva) {
    clave = 'p-' + (slug(ed.nombre) || 'plantilla');
    if (a.pls.some(p => p.clave === clave)) clave += '-' + Date.now().toString(36).slice(-4);
  }
  const propias = a.pls.filter(p => p.clave === clave && p.empresa_id === E());
  const { data: ult } = await sb.from('plantillas').select('version').eq('empresa_id', E()).eq('clave', clave).order('version', { ascending: false }).limit(1);
  const version = Math.max(0, ...propias.map(p => p.version), ...(ult || []).map(p => p.version)) + 1;
  const secciones = ed.secciones.map(s => ({ ...(s.clave ? { clave: s.clave } : {}), titulo: s.titulo.trim(), items: s.items.map(i => ({ id: i.id, texto: i.texto.trim(), critico: !!i.critico,
    ...(i.alerta && !i.critico ? { alerta: true } : {}), ...(i.foto ? { foto: 'obligatoria' } : {}),
    ...(i.frecuencia ? { frecuencia: { tipo: 'semanal', dia: i.frecuencia.dia } } : {}), ...(i.ayuda && i.ayuda.trim() ? { ayuda: i.ayuda.trim() } : {}) })) }));
  const { error } = await sb.from('plantillas').insert({ empresa_id: E(), clave, nombre: ed.nombre.trim(), rubro: ed.rubro, medidor: ed.medidor, version, secciones });
  ed.ocupado = false;
  if (error) { ed.err = msgError(error); return render(); }
  a.ed = null; toast(`Plantilla guardada (versión ${version}). Se usa en los checklists nuevos.`, 5000);
  await cargarPlantillas();
}

export const A = {
  edNueva: () => { T().ed = { clave: null, nueva: true, nombre: '', rubro: S.m.empresa.rubro || 'construccion', medidor: 'horas', secciones: [{ titulo: 'Documentación', items: [{ id: nuevoId(), texto: '', critico: false }] }], err: '' }; render(); },
  edAbrir: b => abrir(b.dataset.clave),
  edCancelar: () => { T().ed = null; render(); },
  edGuardar: guardar,
  edVolverBase: async b => {
    const a = T(), k = 'base-' + b.dataset.clave;
    if (a.confirm !== k) { a.confirm = k; return render(); }
    a.confirm = null;
    const { error } = await sb.from('plantillas').update({ activa: false }).eq('empresa_id', E()).eq('clave', b.dataset.clave);
    if (error) return toast(msgError(error));
    toast('Se vuelve a usar la plantilla de base.'); cargarPlantillas();
  },
  edSec: b => {
    const ed = T().ed, si = +b.dataset.si, op = b.dataset.op, L = ed.secciones;
    if (op === 'agregar') L.push({ titulo: '', items: [{ id: nuevoId(), texto: '', critico: false }] });
    else if (op === 'borrar') L.splice(si, 1);
    else { const j = op === 'arriba' ? si - 1 : si + 1; [L[si], L[j]] = [L[j], L[si]]; }
    render();
  },
  edItem: b => {
    const ed = T().ed, [si, ii] = b.dataset.k.split('.').map(Number), op = b.dataset.op, L = ed.secciones[si].items;
    if (op === 'agregar') { L.push({ id: nuevoId(), texto: '', critico: false }); render(); setTimeout(() => { const el = document.getElementById(`edi-${si}-${L.length - 1}`); el && el.focus(); }, 30); return; }
    if (op === 'borrar') L.splice(ii, 1);
    else { const j = op === 'arriba' ? ii - 1 : ii + 1; [L[ii], L[j]] = [L[j], L[ii]]; }
    render();
  },
};

export function alEscribir(el, v) {
  const ed = T() && T().ed; if (!ed) return false;
  if (el.dataset.ed) { ed[el.dataset.ed] = v; return true; }
  if (el.dataset.eds !== undefined) { ed.secciones[+el.dataset.eds].titulo = v; return true; }
  if (el.dataset.edi) { const [si, ii] = el.dataset.edi.split('.').map(Number); ed.secciones[si].items[ii].texto = v; return true; }
  const it = k => { const [si, ii] = k.split('.').map(Number); return ed.secciones[si].items[ii]; };
  if (el.dataset.edn) { const x = it(el.dataset.edn); x.critico = v === 'critico'; x.alerta = v === 'alerta'; render(); return true; }
  if (el.dataset.edf) { it(el.dataset.edf).foto = v ? 'obligatoria' : null; return true; }
  if (el.dataset.edq !== undefined) { it(el.dataset.edq).frecuencia = v ? { tipo: 'semanal', dia: +v } : null; return true; }
  if (el.dataset.eda !== undefined) { it(el.dataset.eda).ayuda = v; return true; }
  return false;
}
