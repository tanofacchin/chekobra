export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = n => String(n).padStart(2, '0');
const D = v => v instanceof Date ? v : new Date(v);
export const fFecha = v => { const d = D(v); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fHora = v => { const d = D(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayKey = v => { const d = D(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fDur = s => s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
export const fNum = n => n == null || n === '' ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
export const unidad = m => m === 'km' ? 'km' : 'h';
export const fechaLarga = () => new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
export const uuid = () => crypto.randomUUID();
export const RES = { apto: ['Apto', 'ok'], observaciones: ['Apto con observaciones', 'warn'], no_apto: ['No apto · bloqueado', 'bad'] };
export const MIN_CHECK_S = 120;

export const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

let toastT;
export function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// Mensaje legible a partir de un error de Supabase / red.
export function msgError(e) {
  if (!e) return 'Error desconocido';
  if (e.message && /Failed to fetch|NetworkError|Load failed|fetch/i.test(e.message)) return 'Sin conexión. Probá de nuevo cuando haya señal.';
  if (e.message === 'Invalid login credentials') return 'Datos de ingreso incorrectos.';
  return e.message || String(e);
}
export const esErrorDeRed = e => !!e && (e.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed|network|timeout/i.test(e.message || ''));

function cargarImagen(src) { return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; }); }

// Achica una foto, opcionalmente le estampa líneas de texto abajo y devuelve un JPEG.
export async function comprimir(blob, max, q, marca) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await cargarImagen(url);
    const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * sc), h = Math.round(im.naturalHeight * sc);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
    if (marca && marca.length) {
      const fs = Math.max(12, Math.round(w * 0.034)), lh = fs * 1.3, bh = lh * marca.length + fs * 0.9;
      x.fillStyle = 'rgba(0,0,0,.62)'; x.fillRect(0, h - bh, w, bh);
      x.fillStyle = '#f5b72e'; x.fillRect(0, h - bh, Math.max(4, w * 0.012), bh);
      x.font = `600 ${fs}px Barlow, Arial, sans-serif`; x.textBaseline = 'top';
      marca.forEach((l, i) => { x.fillStyle = i === 0 ? '#f5b72e' : '#fff'; x.fillText(l, fs * 0.9, h - bh + fs * 0.45 + i * lh, w - fs * 1.4); });
    }
    return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('No se pudo procesar la foto')), 'image/jpeg', q));
  } finally { URL.revokeObjectURL(url); }
}

// Descarga de un archivo generado en el navegador.
export function descargar(nombre, contenido, tipo) {
  const b = new Blob([contenido], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = nombre; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
