// Versión 2 de las plantillas base, a partir de la revisión en obra (12/11/2026):
// - sin el seguro (se controla en Vencimientos); matafuego no crítico;
// - pérdidas de aceite / combustible / fluidos: advertencia roja (no bloquea);
// - fotos obligatorias: 4 lados del equipo, balde/pala/dientes, tablero sin testigos, caja de herramientas
//   (la foto del horómetro u odómetro se pide al elegir el equipo);
// - zapatas y bulones: control semanal (viernes), configurable;
// - ayuda en el enganche rápido;
// - orden: primero lo exterior, después la cabina con el equipo apagado, al final con el equipo encendido.
// Los ids de los puntos existentes se conservan (mismo significado); los nuevos tienen ids nuevos.
import { PLANTILLAS, normalizar } from './base.mjs';

const VIERNES = 5;   // ISO: lunes = 1 … domingo = 7
const AYUDA_ENGANCHE = 'Revisá que el perno o la traba de seguridad del acople rápido esté colocado y cerrado, y que el balde o implemento no tenga juego. Si el acople tiene indicador, tiene que marcar "trabado".';

const esSeguro = t => /^seguro\b/i.test(t);
const esMatafuego = t => /matafuego/i.test(t);
const esPerdida = t => /^sin p[ée]rdidas/i.test(t);
const fotoBalde = t => /balde|dientes|^pala\b/i.test(t);
const esTablero = t => /tablero sin testigos/i.test(t);
const esEnganche = t => /enganche r[áa]pido/i.test(t);
const esSemanal = t => /zapatas y bulones/i.test(t);
// Lo que se controla con el equipo encendido (se pasa a "Con el equipo encendido" conservando el id).
const conEncendido = t => /tablero sin testigos|^bocina|alarma de retroceso|^luces|limpiaparabrisas|arranque solo en neutro/i.test(t);

const FOTOS = { clave: 'fotos', titulo: 'Recorrida exterior: fotos', items: [
  { id: 'fotos.1', texto: 'Foto del frente del equipo', critico: false, foto: 'obligatoria' },
  { id: 'fotos.2', texto: 'Foto del lado izquierdo', critico: false, foto: 'obligatoria' },
  { id: 'fotos.3', texto: 'Foto del lado derecho', critico: false, foto: 'obligatoria' },
  { id: 'fotos.4', texto: 'Foto de atrás', critico: false, foto: 'obligatoria' },
] };
const CAJA = { id: 'doc.7', texto: 'Caja de herramientas completa', critico: false, foto: 'obligatoria',
  ayuda: 'Abrí la caja y sacale una foto donde se vean todas las herramientas.' };

function ajustarItem(i) {
  const it = { id: i.id, texto: i.texto, critico: !!i.critico };
  if (esMatafuego(it.texto)) it.critico = false;
  if (esPerdida(it.texto)) { it.critico = false; it.alerta = true; }
  if (fotoBalde(it.texto) || esTablero(it.texto)) it.foto = 'obligatoria';
  if (esEnganche(it.texto)) it.ayuda = AYUDA_ENGANCHE;
  if (esSemanal(it.texto)) it.frecuencia = { tipo: 'semanal', dia: VIERNES };
  return it;
}

export function version2(t) {
  const v1 = normalizar(t);
  const secs = v1.secciones.map(s => ({ clave: s.clave, titulo: s.titulo, items: s.items.filter(i => !esSeguro(i.texto)).map(ajustarItem) }));
  const encendido = [];
  for (const s of secs) {
    if (s.clave === 'prueba' || s.clave === 'frenos') continue;
    encendido.push(...s.items.filter(i => conEncendido(i.texto)));
    s.items = s.items.filter(i => !conEncendido(i.texto));
  }
  const doc = secs.find(s => s.clave === 'doc');
  if (doc) { doc.titulo = 'Documentación y elementos de seguridad'; doc.items.push({ ...CAJA }); }
  const fluidos = secs.find(s => s.clave === 'fluidos');
  const cabina = secs.find(s => s.clave === 'cabina');
  if (cabina) cabina.titulo = 'Cabina (con el equipo apagado)';
  const exteriores = secs.filter(s => !['doc', 'fluidos', 'cabina', 'prueba', 'frenos', 'entorno'].includes(s.clave));
  const entorno = secs.find(s => s.clave === 'entorno');
  const finales = secs.filter(s => ['prueba', 'frenos'].includes(s.clave));
  const orden = [
    FOTOS, entorno, ...exteriores, fluidos, doc, cabina,
    encendido.length ? { clave: 'encendido', titulo: 'Con el equipo encendido', items: encendido } : null,
    ...finales,
  ].filter(s => s && s.items.length);
  return { ...v1, version: 2, secciones: orden };
}

export const PLANTILLAS_V2 = PLANTILLAS.map(version2);
