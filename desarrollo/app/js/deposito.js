// Depósito del taller: artículos con stock, compras (costo promedio), conteos y salidas por orden de trabajo.
import { esc, fFecha, fHora, fNum, toast, msgError, normal, filtrar } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const fPeso = v => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
export const UNIDADES = { u: 'unidades', l: 'litros', kg: 'kg', m: 'metros', juego: 'juegos' };
export const bajo = a => a.minimo != null && Number(a.stock) <= Number(a.minimo);

export async function cargarDeposito() {
  const a = T(); a.dep ||= { lista: null, busca: '', solo: '' };
  const { data, error } = await sb.from('articulos').select('*').eq('empresa_id', E()).order('descripcion');
  if (error) { toast(msgError(error)); a.dep.lista = []; } else a.dep.lista = data;
  render();
}
async function cargarMovs(id) {
  const { data } = await sb.from('movimientos_stock').select('*, quien:miembros(nombre), orden:ordenes_trabajo(numero)').eq('articulo_id', id).order('fecha', { ascending: false }).limit(30);
  T().dep.movs = { id, lista: data || [] }; render();
}

// Alertas del resumen: artículos en o por debajo del mínimo.
export const alertasDeposito = arts => (arts || []).filter(x => x.activo && bajo(x)).slice(0, 8).map(x =>
  ['warn', `Poco stock · ${x.descripcion}`, `Quedan ${fNum(x.stock)} ${UNIDADES[x.unidad]} (mínimo ${fNum(x.minimo)})`, '<button class="btn sm" data-act="depIr">Ver</button>']);

export function vDeposito() {
  const a = T(), dp = a.dep || {};
  if (!dp.lista) return '<p class="muted">Cargando el depósito…</p>';
  const arts = dp.lista.filter(x => x.activo && (!dp.solo || bajo(x)));
  const valor = arts.reduce((s, x) => s + Math.max(0, Number(x.stock)) * Number(x.costo_promedio || 0), 0);
  const nb = dp.lista.filter(x => x.activo && bajo(x)).length;
  const f = dp.form;
  const form = !f ? '' : f.tipo === 'nuevo' ? `<section class="card"><h2>Nuevo artículo</h2><div class="form-grid">
      <label class="f">Descripción<input class="inp" id="dp-desc" data-dp="descripcion" value="${esc(f.descripcion)}" placeholder="Ej.: Filtro de aceite JD RE504836" maxlength="160"></label>
      <label class="f">Código <small>Opcional</small><input class="inp" id="dp-cod" data-dp="codigo" value="${esc(f.codigo)}"></label>
      <label class="f">Unidad<select class="inp" id="dp-un" data-dp="unidad">${Object.entries(UNIDADES).map(([k, l]) => `<option value="${k}" ${f.unidad === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Stock mínimo <small>Avisa al llegar</small><input class="inp num" id="dp-min" type="number" inputmode="decimal" data-dp="minimo" value="${esc(f.minimo)}"></label>
      <label class="f">Ubicación <small>Opcional</small><input class="inp" id="dp-ub" data-dp="ubicacion" value="${esc(f.ubicacion)}" placeholder="Estante B2"></label>
      <label class="f">Cantidad que hay hoy<input class="inp num" id="dp-cant" type="number" inputmode="decimal" data-dp="cantidad" value="${esc(f.cantidad)}"></label>
      <label class="f">Costo unitario <small>Opcional</small><input class="inp num" id="dp-costo" type="number" inputmode="decimal" data-dp="costo" value="${esc(f.costo)}"></label></div>
      ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="depCancelar">Cancelar</button><button class="btn sm primary" data-act="depGuardar">Guardar</button></div></section>`
    : `<section class="card"><h2>${f.tipo === 'ingreso' ? 'Compra' : 'Conteo'} · ${esc(f.art.descripcion)}</h2>
      <p class="small muted">${f.tipo === 'ingreso' ? 'Lo que entró al depósito y a qué precio: el costo promedio se recalcula solo.' : `Contá lo que hay y cargalo: el stock pasa a ese número (hoy figura ${fNum(f.art.stock)}).`}</p>
      <div class="form-grid"><label class="f">${f.tipo === 'ingreso' ? 'Cantidad que entró' : 'Cantidad contada'}<input class="inp num" id="dp-cant" type="number" inputmode="decimal" data-dp="cantidad" value="${esc(f.cantidad)}"></label>
      ${f.tipo === 'ingreso' ? `<label class="f">Costo unitario<input class="inp num" id="dp-costo" type="number" inputmode="decimal" data-dp="costo" value="${esc(f.costo)}"></label>` : ''}
      <label class="f">Nota <small>Opcional</small><input class="inp" id="dp-nota" data-dp="notas" value="${esc(f.notas)}" placeholder="${f.tipo === 'ingreso' ? 'Proveedor, factura…' : ''}"></label></div>
      ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}<div class="row"><button class="btn sm" data-act="depCancelar">Cancelar</button><button class="btn sm primary" data-act="depGuardar">Guardar</button></div></section>`;
  const filas = arts.map(x => {
    const dq = normal([x.codigo, x.descripcion, x.ubicacion].filter(Boolean).join(' ')), q = normal(dp.busca).trim();
    const mv = dp.movs && dp.movs.id === x.id;
    return `<div class="eqrow" data-q="${esc(dq)}" ${q && !dq.includes(q) ? 'hidden' : ''}><span class="eqcode">${esc(x.codigo || '—')}</span>
      <div><b>${esc(x.descripcion)}</b> ${bajo(x) ? '<span class="chip warn">Poco stock</span>' : ''}
        <div class="small"><b class="num">${fNum(x.stock)} ${UNIDADES[x.unidad]}</b>${x.minimo != null ? ` · mínimo ${fNum(x.minimo)}` : ''}${x.ubicacion ? ' · ' + esc(x.ubicacion) : ''}${x.costo_promedio != null ? ` · ${fPeso(x.costo_promedio)} c/u` : ''}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn sm" data-act="depMov" data-k="ingreso" data-id="${x.id}">Compra</button><button class="btn sm ghost" data-act="depMov" data-k="ajuste" data-id="${x.id}">Conteo</button>
        <button class="btn sm ghost" data-act="depVerMovs" data-id="${x.id}">${mv ? 'Ocultar' : 'Movimientos'}</button></div>
      ${mv ? `<div class="movs" style="grid-column:1/-1">${dp.movs.lista.map(m => `<div class="mov"><span class="small muted">${fFecha(m.fecha)} ${fHora(m.fecha)}</span><span>${{ ingreso: 'Compra', egreso: 'Salida', devolucion: 'Devolución', ajuste: 'Conteo' }[m.tipo]} <b>${fNum(m.cantidad)}</b>${m.costo_unitario != null && m.tipo === 'ingreso' ? ` a ${fPeso(m.costo_unitario)}` : ''}${m.orden ? ` · OT ${m.orden.numero}` : ''}${m.notas ? ' · ' + esc(m.notas) : ''}${m.quien ? ' · ' + esc(m.quien.nombre) : ''}</span><span></span></div>`).join('') || '<p class="muted small">Sin movimientos.</p>'}</div>` : ''}</div>`;
  }).join('');
  return `${form}<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Depósito (${arts.length})</h2>
      <p class="small muted">Los repuestos que el mecánico usa en una orden salen de acá y toman su costo promedio. Valor del stock: <b>${fPeso(valor)}</b>.</p></div>
      ${f ? '' : '<button class="btn sm dark" data-act="depNuevo">Nuevo artículo</button>'}</div>
    <div class="row"><input class="inp" id="dep-busca" type="search" data-buscar=".eqrow[data-q]" placeholder="Buscar por código, descripción o ubicación" value="${esc(dp.busca)}" autocomplete="off" style="flex:1 1 240px">
      <button class="btn sm ${dp.solo ? 'dark' : 'ghost'}" data-act="depSoloBajo">Poco stock (${nb})</button></div>
    <p class="muted small" data-sin-resultados hidden>Ningún artículo coincide.</p>
    ${arts.length ? `<div>${filas}</div>` : '<div class="empty">Todavía no hay artículos. Cargá los repuestos que tenés en el taller.</div>'}</section>`;
}

export const A = {
  depIr: () => { const a = T(); a.tab = 'taller'; a.ot ||= { filtro: 'abiertas', lista: null, det: null, nueva: null }; a.ot.det = null; a.tallerVista = 'deposito'; cargarDeposito(); },
  depNuevo: () => { T().dep.form = { tipo: 'nuevo', descripcion: '', codigo: '', unidad: 'u', minimo: '', ubicacion: '', cantidad: '', costo: '', err: '' }; render(); },
  depMov: b => { const x = T().dep.lista.find(q => q.id === b.dataset.id); T().dep.form = { tipo: b.dataset.k, art: x, cantidad: '', costo: x.costo_promedio ?? '', notas: '', err: '' }; render(); scrollTo(0, 0); },
  depCancelar: () => { T().dep.form = null; render(); },
  depSoloBajo: () => { const d = T().dep; d.solo = d.solo ? '' : '1'; render(); },
  depVerMovs: b => { const d = T().dep; if (d.movs && d.movs.id === b.dataset.id) { d.movs = null; return render(); } cargarMovs(b.dataset.id); },
  depGuardar: async () => {
    const f = T().dep.form; f.err = '';
    const num = v => v === '' || v == null ? null : +v;
    if (f.tipo === 'nuevo') {
      if (f.descripcion.trim().length < 2) f.err = 'Escribí la descripción.'; else if (num(f.cantidad) == null || num(f.cantidad) < 0) f.err = 'Indicá cuánto hay hoy (0 si no hay).';
      if (f.err) return render();
      const { data, error } = await sb.from('articulos').insert({ empresa_id: E(), descripcion: f.descripcion.trim(), codigo: f.codigo.trim() || null, unidad: f.unidad, minimo: num(f.minimo), ubicacion: f.ubicacion.trim() || null }).select('id').single();
      if (error) { f.err = /duplicate|unique/.test(error.message) ? 'Ya hay un artículo con ese código.' : msgError(error); return render(); }
      if (num(f.cantidad) > 0) await sb.from('movimientos_stock').insert({ empresa_id: E(), articulo_id: data.id, tipo: 'ingreso', cantidad: num(f.cantidad), costo_unitario: num(f.costo), miembro_id: S.m.id, notas: 'Stock inicial' });
      toast('Artículo agregado.');
    } else {
      if (num(f.cantidad) == null || num(f.cantidad) < 0 || (f.tipo === 'ingreso' && !(num(f.cantidad) > 0))) { f.err = 'Indicá la cantidad.'; return render(); }
      const { error } = await sb.from('movimientos_stock').insert({ empresa_id: E(), articulo_id: f.art.id, tipo: f.tipo, cantidad: num(f.cantidad), costo_unitario: f.tipo === 'ingreso' ? num(f.costo) : null, miembro_id: S.m.id, notas: f.notas.trim() || null });
      if (error) { f.err = msgError(error); return render(); }
      toast(f.tipo === 'ingreso' ? 'Compra registrada.' : 'Conteo registrado.');
    }
    T().dep.form = null; cargarDeposito(); T().recargar();
  },
};
export function alEscribir(el, v) {
  const a = T(); if (!a || !a.dep) return false;
  if (el.id === 'dep-busca') { a.dep.busca = v; filtrar(el.dataset.buscar, v); return true; }
  if (el.dataset.dp && a.dep.form) { a.dep.form[el.dataset.dp] = v; return true; }
  return false;
}
