// Carga inicial desde Excel: equipos, personal y obras de una sola vez (para dar de alta un cliente nuevo rápido).
// 1) se descarga la planilla modelo, 2) se completa, 3) se sube, se revisa fila por fila y 4) se importa.
// Al personal sin PIN se le genera uno: la lista con los PIN se muestra (y se descarga) una sola vez.
import { esc, toast, msgError, descargar, normal } from './util.js';
import { sb } from './datos.js';
import { S, render, esAdmin } from './estado.js';
import { excelJS, encabezadoExcel } from './excel.js';

const T = () => S.adm;
const E = () => S.m.empresa_id;
const ROLES = { operario: 'operario', operaria: 'operario', mecanico: 'mecanico', mecanica: 'mecanico', supervisor: 'supervisor', supervisora: 'supervisor', personal: 'personal', 'personal de obra': 'personal', ayudante: 'personal', oficial: 'personal', peon: 'personal' };
const ROL_TXT = { operario: 'Operario', mecanico: 'Mecánico', supervisor: 'Supervisor', personal: 'Personal de obra' };
const COLS = {
  Equipos: [{ t: 'Código', w: 12 }, { t: 'Nombre (marca y modelo)', w: 32 }, { t: 'Tipo de checklist', w: 28 }, { t: 'Horómetro u odómetro actual', w: 16, n: 1 },
    { t: 'N.º de serie / PIN', w: 22 }, { t: 'Patente', w: 12 }, { t: 'Tarifa por hora ($)', w: 14, n: 1 }, { t: 'Tarifa por día ($)', w: 14, n: 1 }],
  Personal: [{ t: 'Nombre y apellido', w: 30 }, { t: 'Legajo', w: 12 }, { t: 'Rol', w: 14 }, { t: 'PIN (6 números, opcional)', w: 18 }],
  Obras: [{ t: 'Nombre de la obra', w: 40 }, { t: 'Presupuesto mensual ($, opcional)', w: 22, n: 1 }],
};

/* ------------------------------------------------------------ planilla modelo */
async function modelo() {
  const X = await excelJS(), wb = new X.Workbook(), d = T().d;
  const pls = Object.values(d.plantillas).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const ay = wb.addWorksheet('Cómo completar');
  [['Planilla para cargar datos en Operapto'], [''], ['1. Completá las hojas Equipos, Personal y Obras (podés dejar vacía la que no uses).'],
    ['2. No cambies los títulos de la primera fila.'], ['3. "Tipo de checklist": elegilo de la lista (son las plantillas disponibles).'],
    ['4. Rol: Operario, Mecánico, Supervisor o Personal de obra (solo marca entrada y salida). Si no ponés PIN, Operapto genera uno y te lo muestra al importar.'],
    ['5. Subí el archivo en Operapto: Personal y obras → Importar desde Excel. Antes de cargar, te muestra qué está bien y qué hay que corregir.']]
    .forEach((r, i) => { ay.getRow(i + 1).values = r; });
  ay.getCell('A1').font = { bold: true, size: 14 }; ay.getColumn(1).width = 110;
  const lst = wb.addWorksheet('Listas', { state: 'hidden' });
  pls.forEach((p, i) => { lst.getCell(`A${i + 1}`).value = p.nombre; });
  ['Operario', 'Mecánico', 'Supervisor'].forEach((r, i) => { lst.getCell(`B${i + 1}`).value = r; });
  for (const [hoja, cols] of Object.entries(COLS)) {
    const ws = wb.addWorksheet(hoja, { views: [{ state: 'frozen', ySplit: 1 }] });
    encabezadoExcel(ws, 1, cols);
    for (let r = 2; r <= 300; r++) {
      if (hoja === 'Equipos') ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Listas!$A$1:$A$${pls.length}`] };
      if (hoja === 'Personal') { ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Listas!$B$1:$B$3'] }; ws.getCell(`D${r}`).numFmt = '@'; ws.getCell(`B${r}`).numFmt = '@'; }
    }
  }
  // Ejemplos en la hoja de instrucciones (no en las de datos: se importarían si alguien se olvida de borrarlos).
  [[''], ['Ejemplos de cómo queda cada fila:'], ['Equipos:  EX-01 | Excavadora John Deere 210G | ' + (pls.find(p => p.clave === 'excavadora') || pls[0]).nombre + ' | 4800 | 1FF210GXAKF123456 | | 38000 |'],
    ['Personal: Juan Pérez | 101 | Operario | (vacío: se genera el PIN)'], ['Obras:    Ruta 5 - Tramo Norte | 5000000']].forEach(r => ay.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ------------------------------------------------------------ lectura y revisión */
const texto = v => { if (v == null) return ''; if (typeof v === 'object') v = v.text ?? v.result ?? (v.richText ? v.richText.map(t => t.text).join('') : ''); return String(v).trim(); };
const numero = v => { const t = texto(v).replace(/\$|\s/g, ''); if (!t) return null; const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : NaN; };
function filas(ws, ncols) {
  const out = [];
  if (!ws) return out;
  ws.eachRow({ includeEmpty: false }, (row, i) => { if (i === 1) return; const v = Array.from({ length: ncols }, (_, k) => row.getCell(k + 1).value); if (v.some(x => texto(x))) out.push({ fila: i, v }); });
  return out;
}
async function leer(file) {
  const X = await excelJS(), wb = new X.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const d = T().d, hoja = n => wb.worksheets.find(w => normal(w.name) === normal(n));
  const pls = Object.values(d.plantillas), plDe = t => { const q = normal(t); return pls.find(p => normal(p.nombre) === q || p.clave === q); };
  const codigos = new Set(d.equipos.map(e => e.codigo)), legajos = new Set(d.miembros.map(m => (m.legajo || '').toLowerCase())), obras = new Set(d.obras.map(o => normal(o.nombre)));
  const vistos = { cod: new Set(), leg: new Set(), obra: new Set() };
  const equipos = filas(hoja('Equipos'), 8).map(({ fila, v }) => {
    const r = { fila, codigo: texto(v[0]).toUpperCase().replace(/\s+/g, '-'), nombre: texto(v[1]), tipo: texto(v[2]), med: numero(v[3]), serie: texto(v[4]), patente: texto(v[5]).toUpperCase(), th: numero(v[6]), td: numero(v[7]), err: [] };
    const pl = plDe(r.tipo); r.plantilla = pl;
    if (!/^[A-Z0-9-]{2,16}$/.test(r.codigo)) r.err.push('código inválido (letras, números o guiones)');
    else if (codigos.has(r.codigo)) r.err.push('ya existe un equipo con ese código');
    else if (vistos.cod.has(r.codigo)) r.err.push('código repetido en la planilla');
    vistos.cod.add(r.codigo);
    if (r.nombre.length < 2) r.err.push('falta el nombre');
    if (!pl) r.err.push(r.tipo ? `no hay un checklist "${r.tipo}"` : 'falta el tipo de checklist');
    for (const [k, l] of [['med', 'horómetro u odómetro'], ['th', 'tarifa por hora'], ['td', 'tarifa por día']]) if (Number.isNaN(r[k]) || r[k] < 0) r.err.push(`${l} no es un número`);
    return r;
  });
  const personal = filas(hoja('Personal'), 4).map(({ fila, v }) => {
    const r = { fila, nombre: texto(v[0]), legajo: texto(v[1]), rolTxt: texto(v[2]), pin: texto(v[3]).replace(/\D/g, ''), err: [] };
    r.rol = ROLES[normal(r.rolTxt) || 'operario'];
    if (r.nombre.length < 2) r.err.push('falta el nombre');
    if (!/^[A-Za-z0-9._-]{1,30}$/.test(r.legajo)) r.err.push('legajo inválido');
    else if (legajos.has(r.legajo.toLowerCase())) r.err.push('ya existe ese legajo');
    else if (vistos.leg.has(r.legajo.toLowerCase())) r.err.push('legajo repetido en la planilla');
    vistos.leg.add(r.legajo.toLowerCase());
    if (!r.rol) r.err.push(`rol "${r.rolTxt}" no válido (Operario, Mecánico, Supervisor o Personal de obra)`);
    if (texto(v[3]) && !/^\d{6}$/.test(r.pin)) r.err.push('el PIN tiene que tener 6 números');
    return r;
  });
  const obrasN = filas(hoja('Obras'), 2).map(({ fila, v }) => {
    const r = { fila, nombre: texto(v[0]), presu: numero(v[1]), err: [] };
    if (r.nombre.length < 2) r.err.push('falta el nombre');
    else if (obras.has(normal(r.nombre))) r.err.push('ya existe esa obra');
    else if (vistos.obra.has(normal(r.nombre))) r.err.push('obra repetida en la planilla');
    vistos.obra.add(normal(r.nombre));
    if (Number.isNaN(r.presu) || r.presu < 0) r.err.push('presupuesto no es un número');
    return r;
  });
  if (!equipos.length && !personal.length && !obrasN.length) throw new Error('La planilla no tiene datos en las hojas Equipos, Personal u Obras.');
  return { equipos, personal, obras: obrasN };
}

/* ------------------------------------------------------------ importación */
const pinAlAzar = () => { const n = new Uint32Array(1); crypto.getRandomValues(n); return String(100000 + n[0] % 900000); };
async function importar() {
  const im = T().imp, x = im.datos, res = { obras: 0, equipos: 0, personal: [], errores: [] };
  im.ocupado = true; im.progreso = 'Obras…'; render();
  const ob = x.obras.filter(r => !r.err.length);
  if (ob.length) {
    const { error } = await sb.from('obras').insert(ob.map(r => ({ empresa_id: E(), nombre: r.nombre, presupuesto_mensual: r.presu })));
    if (error) res.errores.push('Obras: ' + msgError(error)); else res.obras = ob.length;
  }
  im.progreso = 'Equipos…'; render();
  const eq = x.equipos.filter(r => !r.err.length);
  if (eq.length) {
    const { error } = await sb.from('equipos').insert(eq.map(r => ({ empresa_id: E(), codigo: r.codigo, nombre: r.nombre, plantilla_clave: r.plantilla.clave, medidor: r.plantilla.medidor,
      ultimo_medidor: r.med, serie: r.serie || null, patente: r.patente || null, tarifa_hora: r.plantilla.medidor === 'km' ? null : r.th, tarifa_dia: r.td })));
    if (error) res.errores.push('Equipos: ' + msgError(error)); else res.equipos = eq.length;
  }
  const pe = x.personal.filter(r => !r.err.length);
  for (const [i, r] of pe.entries()) {
    im.progreso = `Personal ${i + 1} de ${pe.length}…`; render();
    const pin = r.pin || pinAlAzar();
    const { data, error } = await sb.functions.invoke('operarios', { body: { accion: 'alta', empresa_id: E(), nombre: r.nombre, legajo: r.legajo, pin, rol: r.rol } });
    if (error || (data && data.error)) {
      let msg = data && data.error; if (!msg) { try { msg = (await error.context.json()).error; } catch { msg = msgError(error); } }
      res.errores.push(`${r.nombre} (legajo ${r.legajo}): ${msg}`);
    } else res.personal.push({ nombre: r.nombre, legajo: r.legajo, rol: r.rol, pin, generado: !r.pin });
  }
  im.ocupado = false; im.progreso = ''; im.resultado = res; im.datos = null; render();
  T().recargar();
}
async function pinsExcel(lista) {
  const X = await excelJS(), wb = new X.Workbook(), ws = wb.addWorksheet('Accesos');
  ws.getRow(1).values = [`Accesos a Operapto · ${S.m.empresa.nombre} · código de empresa: ${S.m.empresa.slug}`]; ws.getRow(1).font = { bold: true };
  encabezadoExcel(ws, 3, [{ t: 'Nombre', w: 30 }, { t: 'Legajo', w: 12 }, { t: 'Rol', w: 14 }, { t: 'PIN', w: 10 }]);
  lista.forEach((p, i) => { ws.getRow(4 + i).values = [p.nombre, p.legajo, ROL_TXT[p.rol], p.pin]; });
  ws.getRow(5 + lista.length).values = ['Entregá a cada persona su PIN en privado. Puede cambiarse desde Personal y obras.'];
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ------------------------------------------------------------ vista */
export function vImportar() {
  const im = T().imp; if (!im) return '';
  const tabla = (tit, rs, col) => !rs.length ? '' : `<h3>${tit}: ${rs.filter(r => !r.err.length).length} bien${rs.some(r => r.err.length) ? ` · <span class="txt-bad">${rs.filter(r => r.err.length).length} con errores</span>` : ''}</h3>
    <div class="tabla tabla-cel"><table><tbody>${rs.map(r => `<tr class="${r.err.length ? 'fila-mal' : ''}"><td data-l="Fila" class="n">${r.fila}</td><td>${col(r)}</td><td data-l="Estado">${r.err.length ? `<span class="txt-bad">${esc(r.err.join(' · '))}</span>` : '<span class="chip ok">Bien</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  let cuerpo;
  if (im.resultado) {
    const r = im.resultado;
    cuerpo = `<div class="okbox">Listo: ${r.obras} obra${r.obras === 1 ? '' : 's'}, ${r.equipos} equipo${r.equipos === 1 ? '' : 's'} y ${r.personal.length} persona${r.personal.length === 1 ? '' : 's'}.</div>
      ${r.errores.length ? `<div class="badbox small">No se pudo cargar:<br>${r.errores.map(esc).join('<br>')}</div>` : ''}
      ${r.personal.length ? `<div class="warnbox small"><b>Guardá esta lista ahora:</b> los PIN no se vuelven a mostrar. Entregá a cada persona el suyo en privado. Entran con el código de empresa <b class="mono">${esc(S.m.empresa.slug)}</b>.</div>
        <div class="tabla tabla-cel"><table><thead><tr><th>Nombre</th><th>Legajo</th><th>Rol</th><th>PIN</th></tr></thead><tbody>${r.personal.map(p => `<tr><td>${esc(p.nombre)}</td><td data-l="Legajo">${esc(p.legajo)}</td><td data-l="Rol">${esc(ROL_TXT[p.rol])}</td><td data-l="PIN" class="mono"><b>${p.pin}</b></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="btn sm dark" data-act="impPins">Descargar los PIN (Excel)</button><button class="btn sm ghost" data-act="impImprimir">Imprimir</button></div>` : ''}
      <button class="btn sm" data-act="impCerrar">Cerrar</button>`;
  } else if (im.datos) {
    const x = im.datos, ok = [...x.obras, ...x.equipos, ...x.personal].filter(r => !r.err.length).length;
    cuerpo = `${tabla('Obras', x.obras, r => esc(r.nombre))}${tabla('Equipos', x.equipos, r => `<b>${esc(r.codigo)}</b> ${esc(r.nombre)} <span class="small muted">· ${esc(r.plantilla ? r.plantilla.nombre : r.tipo)}</span>`)}
      ${tabla('Personal', x.personal, r => `${esc(r.nombre)} <span class="small muted">· legajo ${esc(r.legajo)} · ${esc(ROL_TXT[r.rol] || r.rolTxt)}${r.pin ? '' : ' · PIN automático'}</span>`)}
      <p class="small muted">Se cargan solo las filas que están bien. Las otras corregilas en la planilla y volvé a subirla (las ya cargadas van a figurar como "ya existe").</p>
      <div class="row"><button class="btn sm" data-act="impCerrar">Cancelar</button><button class="btn sm primary" data-act="impConfirmar" ${ok && !im.ocupado ? '' : 'disabled'}>${im.ocupado ? esc(im.progreso || 'Cargando…') : `Cargar ${ok} fila${ok === 1 ? '' : 's'}`}</button></div>`;
  } else {
    cuerpo = `<ol class="pasos"><li>Descargá la planilla modelo y completá las hojas <b>Equipos</b>, <b>Personal</b> y <b>Obras</b>.</li><li>Subila acá: antes de cargar, te mostramos qué está bien y qué hay que corregir.</li></ol>
      ${im.err ? `<p class="err">${esc(im.err)}</p>` : ''}
      <div class="row"><button class="btn sm" data-act="impModelo">Descargar planilla modelo</button>
        <label class="btn sm dark">${im.ocupado ? 'Leyendo…' : 'Subir planilla completa'}<input class="vh" type="file" id="imp-arch" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-file="importar"></label>
        <button class="btn sm ghost" data-act="impCerrar">Cerrar</button></div>`;
  }
  return `<section class="card imp" id="importar"><h2>Importar desde Excel</h2>${cuerpo}</section>`;
}

export const A = {
  impAbrir: () => { if (!esAdmin()) return toast('Solo el dueño o un administrador puede importar.'); T().imp = { err: '' }; if (T().tab !== 'personal') { T().tab = 'personal'; } render(); setTimeout(() => { const el = document.getElementById('importar'); el && el.scrollIntoView({ block: 'start' }); }, 50); },
  impCerrar: () => { T().imp = null; render(); },
  impModelo: async () => { try { descargar(`operapto-planilla-para-importar.xlsx`, await modelo(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } catch (e) { toast('No se pudo armar la planilla: ' + msgError(e), 6000); } },
  impConfirmar: () => importar(),
  impPins: async () => { try { descargar(`operapto-${S.m.empresa.slug}-accesos.xlsx`, await pinsExcel(T().imp.resultado.personal), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } catch (e) { toast(msgError(e)); } },
  impImprimir: () => window.print(),
};
export async function alArchivo(input) {
  const im = T().imp, file = input.files && input.files[0]; if (!im || !file) return;
  im.ocupado = true; im.err = ''; render();
  try { im.datos = await leer(file); } catch (e) { im.err = /zip|central directory|signature/i.test(e.message) ? 'El archivo no es un Excel (.xlsx). Guardalo como "Libro de Excel" y probá de nuevo.' : msgError(e); }
  im.ocupado = false; render();
}
