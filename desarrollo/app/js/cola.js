// Bandeja de salida en el teléfono (IndexedDB). Todo lo que carga el operario pasa por acá:
// si hay señal se envía enseguida; si no, queda guardado y se reenvía solo.
// Cada envío lleva un client_id: reenviarlo nunca duplica registros en el servidor.
import { esErrorDeRed } from './util.js';

const DB = 'checkobra', ST = 'envios';
let dbp;
function abrir() {
  return dbp ||= new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' });
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((ok, no) => {
    const t = db.transaction(ST, modo); const st = t.objectStore(ST); let res;
    Promise.resolve(fn(st)).then(v => { res = v; });
    t.oncomplete = () => ok(res); t.onerror = () => no(t.error);
  });
}
const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

export const cola = {
  agregar: e => tx('readwrite', st => req(st.put({ ...e, estado: 'pendiente', creado: Date.now() }))),
  guardar: e => tx('readwrite', st => req(st.put(e))),
  borrar: id => tx('readwrite', st => req(st.delete(id))),
  listar: () => tx('readonly', st => req(st.getAll())).then(l => l.sort((a, b) => a.creado - b.creado)),
};

let corriendo = null;
// Envía todo lo pendiente, en orden. Devuelve { enviados, pendientes, rechazados }.
export function sincronizar(sb, alCambiar) {
  return corriendo ||= (async () => {
    let enviados = 0;
    try {
      for (const e of await cola.listar()) {
        if (e.estado === 'rechazado') continue;
        try {
          const r = e.tipo === 'checklist' ? await enviarChecklist(sb, e) : await enviarCierre(sb, e);
          if (r === 'esperar') continue;
          await cola.borrar(e.id); enviados++;
          alCambiar && alCambiar({ tipo: 'enviado', envio: e, respuesta: r });
        } catch (err) {
          if (esErrorDeRed(err)) break; // sin señal: se reintenta después
          e.estado = 'rechazado'; e.error = err.message || String(err);
          await cola.guardar(e);
          alCambiar && alCambiar({ tipo: 'rechazado', envio: e });
        }
      }
    } finally { corriendo = null; }
    const l = await cola.listar();
    return { enviados, pendientes: l.filter(x => x.estado !== 'rechazado').length, rechazados: l.filter(x => x.estado === 'rechazado') };
  })();
}

async function subir(sb, a) {
  const { error } = await sb.storage.from('evidencias').upload(a.path, a.blob, { contentType: a.tipo, upsert: false });
  if (error && !/exists|Duplicate/i.test(error.message) && String(error.statusCode) !== '409') {
    if (/fetch|network/i.test(error.message)) { const e = new TypeError(error.message); throw e; }
    throw new Error('No se pudo subir una foto: ' + error.message);
  }
}

async function enviarChecklist(sb, e) {
  for (const a of e.archivos) await subir(sb, a);
  const { data, error } = await sb.rpc('enviar_checklist', { p: e.payload });
  if (error) throw error.message && /fetch/i.test(error.message) ? new TypeError(error.message) : new Error(error.message);
  return data;
}

async function enviarCierre(sb, e) {
  let jid = e.payload.jornada_id;
  if (!jid) {
    // La jornada se inició sin señal: buscar su id por el client_id del checklist.
    const { data, error } = await sb.from('jornadas').select('id').eq('client_id', e.payload.checklist_client_id).maybeSingle();
    if (error) throw new TypeError(error.message);
    if (!data) return 'esperar';
    jid = data.id;
  }
  const p = e.payload;
  const { error } = await sb.rpc('cerrar_jornada', {
    p_jornada: jid, p_med_fin: p.med_fin, p_litros: p.litros, p_novedades: p.novedades, p_falla: p.falla, p_equipo_asegurado: true,
  });
  if (error) {
    if (/ya está cerrada/.test(error.message)) return { ya: true };
    throw /fetch/i.test(error.message) ? new TypeError(error.message) : new Error(error.message);
  }
  return { jornada_id: jid };
}
