// Exportación a Excel (.xlsx) con hojas organizadas, formato y gráficos nativos de Excel.
// ExcelJS arma el libro (estilos, filtros, formatos); los gráficos se agregan después con JSZip
// escribiendo las partes estándar de Office Open XML (drawings + charts). Las librerías se cargan solo al exportar.
import { sb } from './datos.js';
import { S } from './estado.js';

const LIBS = ['vendor/exceljs-4.4.0.min.js', 'vendor/jszip-3.10.1.min.js'];
let libs = null;
const cargarLibs = () => libs ||= Promise.all(LIBS.map(src => new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('No se pudo cargar ' + src)); document.head.append(s);
}))).catch(e => { libs = null; throw e; });

/* ------------------------------------------------------------ datos */
export async function jornadasParaExcel(f) {
  let q = sb.from('jornadas').select('id, inicio, fin, estado, resultado, med_ini, med_fin, uso, n_fallas, n_criticas, rapido, dur_checklist_s, lat, lng, precision_m, ubic_ref, litros, novedades, '
    + 'equipo:equipos(id, codigo, nombre, medidor), operario:miembros(id, nombre, legajo), obra:obras(id, nombre), fallas(texto, nota, critica, estado, seccion, origen, reparacion, reparada_en)')
    .eq('empresa_id', S.m.empresa_id).order('inicio', { ascending: true }).limit(5000);
  if (f.desde) q = q.gte('inicio', new Date(f.desde + 'T00:00:00').toISOString());
  if (f.hasta) q = q.lt('inicio', new Date(new Date(f.hasta + 'T00:00:00').getTime() + 864e5).toISOString());
  if (f.equipo) q = q.eq('equipo_id', f.equipo);
  if (f.operario) q = q.eq('operario_id', f.operario);
  if (f.resultado) q = q.eq('resultado', f.resultado);
  if (f.obra) q = q.eq('obra_id', f.obra);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------ estilo */
const C = { tinta: '1A1E22', gris: '59616A', linea: 'D2D6CF', fondo: 'EEF0EC', acento: 'F0A500',
  ok: '0CA30C', warn: 'FAB219', bad: 'D03B3B', okF: 'DCF1E3', okT: '1D7F46', warnF: 'FBEAD0', warnT: '9A5B00', badF: 'F9DEDC', badT: 'B3261E' };
const RES = { apto: ['Apto', C.okF, C.okT], observaciones: ['Con observaciones', C.warnF, C.warnT], no_apto: ['No apto (bloqueado)', C.badF, C.badT] };
const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + c } });
const borde = { bottom: { style: 'thin', color: { argb: 'FF' + C.linea } } };
// Excel guarda fecha/hora "de pared": se pasa la hora local como si fuera UTC.
const xl = v => { if (!v) return null; const d = new Date(v); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())); };
const soloDia = v => { const d = new Date(v); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
const ddmm = v => { const d = new Date(v); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ddmmaaaa = s => s ? s.split('-').reverse().join('/') : '';

function encabezado(ws, fila, columnas) {
  const r = ws.getRow(fila);
  columnas.forEach((c, i) => {
    const cel = r.getCell(i + 1); cel.value = c.t;
    cel.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cel.fill = fill(C.tinta);
    cel.alignment = { vertical: 'middle', horizontal: c.n ? 'right' : 'left', wrapText: true };
    ws.getColumn(i + 1).width = c.w || 14;
    if (c.f) ws.getColumn(i + 1).numFmt = c.f;
  });
  r.height = 30;
}
function titulo(ws, texto, sub) {
  ws.getCell('A1').value = texto; ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF' + C.tinta } };
  sub.forEach((s, i) => { const c = ws.getCell(`A${i + 2}`); c.value = s; c.font = { color: { argb: 'FF' + C.gris } }; });
}
function tablaSimple(ws, fila, col, cabeceras, filas, formatos = []) {
  cabeceras.forEach((t, i) => { const c = ws.getRow(fila).getCell(col + i); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(C.tinta); c.alignment = { horizontal: i ? 'right' : 'left' }; });
  filas.forEach((f, j) => f.forEach((v, i) => { const c = ws.getRow(fila + 1 + j).getCell(col + i); c.value = v; c.border = borde; if (formatos[i]) c.numFmt = formatos[i]; }));
  return { primera: fila + 1, ultima: fila + filas.length };
}

/* ------------------------------------------------------------ libro */
export async function generarExcel(js, f) {
  await cargarLibs();
  const ExcelJS = window.ExcelJS, wb = new ExcelJS.Workbook();
  wb.creator = 'CheckObra'; wb.created = new Date();
  const empresa = S.m.empresa.nombre, periodo = `${ddmmaaaa(f.desde)} al ${ddmmaaaa(f.hasta)}`;
  const filtros = [f.obraNombre && `Obra: ${f.obraNombre}`, f.equipoNombre && `Equipo: ${f.equipoNombre}`, f.operarioNombre && `Operario: ${f.operarioNombre}`, f.resultado && `Resultado: ${RES[f.resultado][0]}`].filter(Boolean).join(' · ') || 'Sin filtros';
  const generado = `Generado el ${new Date().toLocaleString('es-AR')} por CheckObra`;
  const graficos = {};   // nombre de hoja → [definición de gráfico]

  // ---------- agregados
  const cuenta = k => js.filter(j => j.resultado === k).length;
  const fallas = js.flatMap(j => j.fallas.map(x => ({ ...x, j })));
  const horas = js.filter(j => j.equipo.medidor === 'horas' && j.uso != null).reduce((s, j) => s + Number(j.uso), 0);
  const km = js.filter(j => j.equipo.medidor === 'km' && j.uso != null).reduce((s, j) => s + Number(j.uso), 0);
  const rapidos = js.filter(j => j.rapido).length;
  const durProm = js.length ? js.reduce((s, j) => s + j.dur_checklist_s, 0) / js.length : 0;
  const dias = {}; for (const j of js) { const k = ddmm(j.inicio); (dias[k] ||= { apto: 0, observaciones: 0, no_apto: 0 })[j.resultado]++; }
  const frec = {}; for (const x of fallas) { (frec[x.texto] ||= { veces: 0, critica: false }).veces++; if (x.critica) frec[x.texto].critica = true; }
  const top = Object.entries(frec).sort((a, b) => b[1].veces - a[1].veces).slice(0, 10);
  const porEq = {}, porOp = {};
  for (const j of js) {
    const e = porEq[j.equipo.id] ||= { codigo: j.equipo.codigo, nombre: j.equipo.nombre, medidor: j.equipo.medidor, n: 0, apto: 0, observaciones: 0, no_apto: 0, fallas: 0, uso: 0, dias: new Set() };
    e.n++; e[j.resultado]++; e.fallas += j.fallas.length; e.uso += Number(j.uso || 0); e.dias.add(ddmm(j.inicio));
    const o = porOp[j.operario.id] ||= { nombre: j.operario.nombre, legajo: j.operario.legajo || '', n: 0, dur: 0, rapidos: 0, fallas: 0 };
    o.n++; o.dur += j.dur_checklist_s; o.rapidos += j.rapido ? 1 : 0; o.fallas += j.fallas.length;
  }

  // ---------- Resumen
  const rs = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }], pageSetup: { ...IMPRESION, fitToHeight: 1 } });
  titulo(rs, 'Informe de checklists', [empresa, `Período: ${periodo}`, filtros, generado]);
  rs.getColumn(1).width = 34; rs.getColumn(2).width = 14; rs.getColumn(3).width = 4; rs.getColumn(4).width = 30; rs.getColumn(5).width = 11; rs.getColumn(6).width = 18; rs.getColumn(7).width = 11;
  const kpis = [['Checklists', js.length, '0'], ['Aptos', cuenta('apto'), '0'], ['Con observaciones', cuenta('observaciones'), '0'], ['No aptos (equipo bloqueado)', cuenta('no_apto'), '0'],
    ['% aptos (sin fallas)', js.length ? cuenta('apto') / js.length : 0, '0.0%'], ['Fallas reportadas', fallas.length, '0'], ['Fallas críticas', fallas.filter(x => x.critica).length, '0'],
    ['Fallas sin reparar', fallas.filter(x => x.estado === 'abierta').length, '0'], ['Horas trabajadas', horas, '#,##0.0'], ['Kilómetros recorridos', km, '#,##0'],
    ['Checklists hechos en menos de 2 minutos', rapidos, '0'], ['Duración promedio del checklist (min)', durProm / 60, '0.0']];
  tablaSimple(rs, 7, 1, ['Indicador', 'Valor'], kpis.map(k => [k[0], k[1]]));
  kpis.forEach((k, i) => { rs.getRow(8 + i).getCell(2).numFmt = k[2]; });
  const tRes = tablaSimple(rs, 7, 4, ['Resultado', 'Checklists'], Object.keys(RES).map(k => [RES[k][0], cuenta(k)]));
  const diasF = Object.entries(dias);
  const tDia = tablaSimple(rs, 12, 4, ['Día', 'Apto', 'Con observaciones', 'No apto'], diasF.map(([d, v]) => [d, v.apto, v.observaciones, v.no_apto]));
  const filaTop = Math.max(tDia.ultima, 12) + 3;
  const tTop = tablaSimple(rs, filaTop, 4, ['Falla más repetida', 'Veces'], top.map(([t, v]) => [(v.critica ? '[Crítica] ' : '') + t, v.veces]));
  rs.getColumn(4).alignment = { wrapText: true };
  const R = 'Resumen';
  graficos[R] = [
    { titulo: 'Checklists por resultado', tipo: 'col', desde: [8, 0], hasta: [19, 18], cats: rango(R, 'D', tRes), series: [{ nombre: 'Checklists', vals: rango(R, 'E', tRes), color: C.tinta, etiquetas: true }],
      datosCats: Object.keys(RES).map(k => RES[k][0]), datosVals: [Object.keys(RES).map(cuenta)], coloresPuntos: [C.ok, C.warn, C.bad] },
    diasF.length ? { titulo: 'Checklists por día', tipo: 'col', apilado: true, desde: [8, 19], hasta: [19, 39], cats: rango(R, 'D', tDia),
      series: [['E', 'Apto', C.ok, 'apto'], ['F', 'Con observaciones', C.warn, 'observaciones'], ['G', 'No apto', C.bad, 'no_apto']].map(([col, n, c]) => ({ nombre: n, vals: rango(R, col, tDia), color: c })),
      datosCats: diasF.map(d => d[0]), datosVals: ['apto', 'observaciones', 'no_apto'].map(k => diasF.map(d => d[1][k])) } : null,
    top.length ? { titulo: 'Fallas más repetidas', tipo: 'bar', desde: [8, 40], hasta: [19, 40 + Math.max(14, top.length * 2 + 6)], cats: rango(R, 'D', tTop),
      series: [{ nombre: 'Veces', vals: rango(R, 'E', tTop), color: C.tinta, etiquetas: true }], datosCats: top.map(([t, v]) => (v.critica ? '[Crítica] ' : '') + t), datosVals: [top.map(t => t[1].veces)] } : null,
  ].filter(Boolean);

  // ---------- Jornadas
  const wj = wb.addWorksheet('Jornadas', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }], pageSetup: { ...IMPRESION, printTitlesRow: '1:1' } });
  const colsJ = [{ t: 'Fecha', w: 11, f: 'dd/mm/yyyy' }, { t: 'Inicio', w: 8, f: 'hh:mm' }, { t: 'Cierre', w: 8, f: 'hh:mm' }, { t: 'Obra', w: 26 }, { t: 'Código', w: 9 }, { t: 'Equipo', w: 28 },
    { t: 'Operario', w: 22 }, { t: 'Legajo', w: 8 }, { t: 'Resultado', w: 20 }, { t: 'Fallas', w: 8, n: 1 }, { t: 'Críticas', w: 9, n: 1 }, { t: 'Detalle de fallas', w: 50 },
    { t: 'Medidor inicial', w: 11, n: 1, f: '#,##0.0' }, { t: 'Medidor final', w: 11, n: 1, f: '#,##0.0' }, { t: 'Uso', w: 9, n: 1, f: '#,##0.0' }, { t: 'Unidad', w: 7 },
    { t: 'Combustible (L)', w: 11, n: 1, f: '#,##0.0' }, { t: 'Duración checklist', w: 11, n: 1, f: '[m]:ss' }, { t: 'Checklist rápido', w: 10 }, { t: 'Estado', w: 11 },
    { t: 'Ubicación', w: 14 }, { t: 'Precisión GPS (m)', w: 10, n: 1, f: '0' }, { t: 'Novedades al cierre', w: 40 }];
  encabezado(wj, 1, colsJ);
  js.forEach((j, i) => {
    const r = wj.getRow(i + 2);
    r.values = [soloDia(j.inicio), xl(j.inicio), j.fin ? xl(j.fin) : null, j.obra ? j.obra.nombre : '', j.equipo.codigo, j.equipo.nombre, j.operario.nombre, j.operario.legajo || '',
      RES[j.resultado][0], j.n_fallas, j.n_criticas, j.fallas.map(x => `${x.critica ? '[Crítica] ' : ''}${x.texto}: ${x.nota}`).join('\n'),
      Number(j.med_ini), j.med_fin != null ? Number(j.med_fin) : null, j.uso != null ? Number(j.uso) : null, j.equipo.medidor === 'km' ? 'km' : 'h',
      j.litros != null ? Number(j.litros) : null, j.dur_checklist_s / 86400, j.rapido ? 'Sí' : 'No', { abierta: 'En curso', cerrada: 'Cerrada', rechazada: 'Rechazada' }[j.estado],
      j.lat != null ? { text: 'Ver mapa', hyperlink: `https://www.google.com/maps?q=${j.lat},${j.lng}` } : (j.ubic_ref ? 'Sin GPS: ' + j.ubic_ref : 'Sin GPS'),
      j.precision_m != null ? Math.round(j.precision_m) : null, j.novedades || ''];
    const [, fF, tF] = RES[j.resultado];
    const cr = r.getCell(9); cr.fill = fill(fF); cr.font = { bold: true, color: { argb: 'FF' + tF } };
    if (j.rapido) r.getCell(19).font = { bold: true, color: { argb: 'FF' + C.warnT } };
    if (j.lat != null) r.getCell(21).font = { color: { argb: 'FF1F5FA8' }, underline: true };
    r.getCell(12).alignment = { wrapText: true, vertical: 'top' }; r.getCell(23).alignment = { wrapText: true, vertical: 'top' };
    r.eachCell(c => { c.border = borde; c.alignment = { ...(c.alignment || {}), vertical: 'top' }; });
  });
  wj.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, js.length + 1), column: colsJ.length } };

  // ---------- Fallas
  const wf = wb.addWorksheet('Fallas', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { ...IMPRESION, printTitlesRow: '1:1' } });
  const colsF = [{ t: 'Fecha', w: 11, f: 'dd/mm/yyyy' }, { t: 'Código', w: 9 }, { t: 'Equipo', w: 28 }, { t: 'Operario', w: 22 }, { t: 'Obra', w: 24 }, { t: 'Sección', w: 22 },
    { t: 'Falla', w: 40 }, { t: 'Crítica', w: 8 }, { t: 'Detalle', w: 44 }, { t: 'Origen', w: 11 }, { t: 'Estado', w: 11 }, { t: 'Reparación', w: 40 }, { t: 'Reparada el', w: 11, f: 'dd/mm/yyyy' }];
  encabezado(wf, 1, colsF);
  fallas.forEach((x, i) => {
    const r = wf.getRow(i + 2);
    r.values = [soloDia(x.j.inicio), x.j.equipo.codigo, x.j.equipo.nombre, x.j.operario.nombre, x.j.obra ? x.j.obra.nombre : '', x.seccion || '', x.texto, x.critica ? 'Sí' : 'No', x.nota,
      x.origen === 'cierre' ? 'Al cierre' : 'Checklist', x.estado === 'reparada' ? 'Reparada' : 'Abierta', x.reparacion || '', x.reparada_en ? soloDia(x.reparada_en) : null];
    if (x.critica) r.getCell(8).font = { bold: true, color: { argb: 'FF' + C.badT } };
    r.getCell(11).fill = fill(x.estado === 'reparada' ? C.okF : C.warnF);
    [7, 9, 12].forEach(k => { r.getCell(k).alignment = { wrapText: true, vertical: 'top' }; });
    r.eachCell(c => { c.border = borde; });
  });
  wf.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, fallas.length + 1), column: colsF.length } };

  // ---------- Por equipo
  const we = wb.addWorksheet('Por equipo', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { ...IMPRESION, printTitlesRow: '1:1' } });
  const colsE = [{ t: 'Código', w: 9 }, { t: 'Equipo', w: 30 }, { t: 'Checklists', w: 11, n: 1 }, { t: 'Apto', w: 8, n: 1 }, { t: 'Con observaciones', w: 18, n: 1 }, { t: 'No apto', w: 9, n: 1 },
    { t: 'Fallas', w: 8, n: 1 }, { t: 'Uso', w: 10, n: 1, f: '#,##0.0' }, { t: 'Unidad', w: 7 }, { t: 'Días con checklist', w: 11, n: 1 }];
  encabezado(we, 1, colsE);
  const eqs = Object.values(porEq).sort((a, b) => b.n - a.n);
  eqs.forEach((e, i) => { const r = we.getRow(i + 2); r.values = [e.codigo, e.nombre, e.n, e.apto, e.observaciones, e.no_apto, e.fallas, e.uso, e.medidor === 'km' ? 'km' : 'h', e.dias.size]; r.eachCell(c => { c.border = borde; }); });
  const tE = { primera: 2, ultima: eqs.length + 1 }, PE = 'Por equipo';
  if (eqs.length) graficos[PE] = [{ titulo: 'Checklists por equipo según resultado', tipo: 'bar', apilado: true, desde: [11, 0], hasta: [20, Math.max(16, eqs.length * 2 + 6)], cats: rango(PE, 'A', tE),
    series: [['D', 'Apto', C.ok, 'apto'], ['E', 'Con observaciones', C.warn, 'observaciones'], ['F', 'No apto', C.bad, 'no_apto']].map(([col, n, c]) => ({ nombre: n, vals: rango(PE, col, tE), color: c })),
    datosCats: eqs.map(e => e.codigo), datosVals: ['apto', 'observaciones', 'no_apto'].map(k => eqs.map(e => e[k])) }];

  // ---------- Por operario
  const wo = wb.addWorksheet('Por operario', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { ...IMPRESION, printTitlesRow: '1:1' } });
  const colsO = [{ t: 'Operario', w: 26 }, { t: 'Legajo', w: 9 }, { t: 'Checklists', w: 11, n: 1 }, { t: 'Duración promedio', w: 12, n: 1, f: '[m]:ss' }, { t: 'Hechos en menos de 2 min', w: 13, n: 1 },
    { t: '% rápidos', w: 10, n: 1, f: '0%' }, { t: 'Fallas reportadas', w: 11, n: 1 }];
  encabezado(wo, 1, colsO);
  const ops = Object.values(porOp).sort((a, b) => b.n - a.n);
  ops.forEach((o, i) => { const r = wo.getRow(i + 2); r.values = [o.nombre, o.legajo, o.n, o.dur / o.n / 86400, o.rapidos, o.rapidos / o.n, o.fallas]; if (o.rapidos) r.getCell(5).font = { bold: true, color: { argb: 'FF' + C.warnT } }; r.eachCell(c => { c.border = borde; }); });
  const tO = { primera: 2, ultima: ops.length + 1 }, PO = 'Por operario';
  if (ops.length) graficos[PO] = [{ titulo: 'Checklists por operario', tipo: 'bar', desde: [8, 0], hasta: [16, Math.max(14, ops.length * 2 + 6)], cats: rango(PO, 'A', tO),
    series: [{ nombre: 'Checklists', vals: rango(PO, 'C', tO), color: C.tinta, etiquetas: true }], datosCats: ops.map(o => o.nombre), datosVals: [ops.map(o => o.n)] }];

  const buf = await wb.xlsx.writeBuffer();
  return agregarGraficos(buf, wb.worksheets.map(w => w.name), graficos);
}

// Impresión: A4 apaisado, todo el ancho en una página, encabezado repetido.
const IMPRESION = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
const rango = (hoja, col, t) => `'${hoja}'!$${col}$${t.primera}:$${col}$${Math.max(t.primera, t.ultima)}`;

/* ------------------------------------------------------------ gráficos (Office Open XML) */
const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const txt = (sz, color, b) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"${b ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="es-AR"/></a:p></c:txPr>`;
// Escala del eje con pocos valores redondos (1, 2, 5, 10, 20, 50…).
function paso(g) {
  const n = g.datosCats.length;
  const max = Math.max(1, ...(g.apilado ? Array.from({ length: n }, (_, i) => g.datosVals.reduce((s, v) => s + (v[i] || 0), 0)) : g.datosVals.flat()));
  const bruto = max / 5, mag = 10 ** Math.floor(Math.log10(bruto));
  return Math.max(1, [1, 2, 5, 10].map(k => k * mag).find(v => v >= bruto));
}
function chartXml(g) {
  const horizontal = g.tipo === 'bar';
  const cache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
  const catCache = `<c:strCache><c:ptCount val="${g.datosCats.length}"/>${g.datosCats.map((v, i) => `<c:pt idx="${i}"><c:v>${x(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const series = g.series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${x(s.nombre)}</c:v></c:tx>
    <c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr><c:invertIfNegative val="0"/>
    ${g.coloresPuntos ? g.coloresPuntos.map((c, k) => `<c:dPt><c:idx val="${k}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr></c:dPt>`).join('') : ''}
    ${s.etiquetas ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txt(900, '1A1E22', true)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : ''}
    <c:cat><c:strRef><c:f>${x(g.cats)}</c:f>${catCache}</c:strRef></c:cat>
    <c:val><c:numRef><c:f>${x(s.vals)}</c:f>${cache(g.datosVals[i])}</c:numRef></c:val></c:ser>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/><c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"/></a:pPr><a:r><a:rPr lang="es-AR" sz="1300" b="1"><a:solidFill><a:srgbClr val="1A1E22"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${x(g.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${g.apilado ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${series}
<c:gapWidth val="${g.apilado ? 50 : 70}"/>${g.apilado ? '<c:overlap val="100"/>' : ''}<c:axId val="5001"/><c:axId val="5002"/></c:barChart>
<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/>
<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="C3C2B7"/></a:solidFill></a:ln></c:spPr>${txt(900, '59616A')}
<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 't' : 'l'}"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E1E0D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="0"/>
<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt(900, '59616A')}
<c:crossAx val="5001"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/><c:majorUnit val="${paso(g)}"/></c:valAx>
<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>
${g.series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txt(900, '1A1E22')}</c:legend>` : ''}
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>
<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D2D6CF"/></a:solidFill></a:ln></c:spPr>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="es-AR"/></a:p></c:txPr>
</c:chartSpace>`;
}
const ancla = (g, i, rid) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${g.desde[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.desde[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${g.hasta[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.hasta[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

async function agregarGraficos(buf, hojas, graficos) {
  const zip = await window.JSZip.loadAsync(buf);
  let tipos = await zip.file('[Content_Types].xml').async('string');
  let nChart = 0, nDraw = 0;
  for (const [hoja, lista] of Object.entries(graficos)) {
    if (!lista.length) continue;
    const idx = hojas.indexOf(hoja) + 1, nd = ++nDraw;
    const anclas = [], rels = [];
    lista.forEach((g, i) => {
      const nc = ++nChart;
      zip.file(`xl/charts/chart${nc}.xml`, chartXml(g));
      tipos = tipos.replace('</Types>', `<Override PartName="/xl/charts/chart${nc}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
      rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${nc}.xml"/>`);
      anclas.push(ancla(g, i, `rId${i + 1}`));
    });
    zip.file(`xl/drawings/drawing${nd}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anclas.join('')}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${nd}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    tipos = tipos.replace('</Types>', `<Override PartName="/xl/drawings/drawing${nd}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    // Relación hoja → dibujo (la hoja puede ya tener relaciones, por ejemplo hipervínculos).
    const relPath = `xl/worksheets/_rels/sheet${idx}.xml.rels`, rid = 'rIdGraficos';
    const relNueva = `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${nd}.xml"/>`;
    const relActual = zip.file(relPath) ? await zip.file(relPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    zip.file(relPath, relActual.replace('</Relationships>', relNueva + '</Relationships>'));
    let sheet = await zip.file(`xl/worksheets/sheet${idx}.xml`).async('string');
    const tag = `<drawing r:id="${rid}"/>`;
    const antes = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst'].map(t => sheet.indexOf(t)).filter(i => i >= 0);
    const pos = antes.length ? Math.min(...antes) : sheet.lastIndexOf('</worksheet>');
    sheet = sheet.slice(0, pos) + tag + sheet.slice(pos);
    if (!/xmlns:r=/.test(sheet.slice(0, 600))) sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    zip.file(`xl/worksheets/sheet${idx}.xml`, sheet);
  }
  zip.file('[Content_Types].xml', tipos);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
