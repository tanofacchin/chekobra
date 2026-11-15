// Mapa de la flota: última ubicación conocida de cada equipo (último checklist con GPS o telemetría).
// Leaflet se carga solo al abrir la pestaña. Mapa base: OpenStreetMap.
import { esc, fFecha, fHora, mapsUrl, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;
let libs = null, mapa = null, vista = null;   // vista: centro y zoom, para no perderlos al redibujar
const cargarLibs = () => libs ||= new Promise((ok, no) => {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/leaflet-1.9.4.css'; document.head.append(l);
  const s = document.createElement('script'); s.src = 'vendor/leaflet-1.9.4.js'; s.onload = ok; s.onerror = () => no(new Error('No se pudo cargar el mapa')); document.head.append(s);
}).catch(e => { libs = null; throw e; });

const estadoDe = u => u.estado === 'bloqueado' ? ['bad', 'Bloqueado'] : u.estado === 'fuera_servicio' ? ['off', 'Fuera de servicio'] : u.en_uso ? ['uso', 'Trabajando ahora'] : ['ok', 'Operativo'];
const hace = t => { const h = (Date.now() - new Date(t)) / 36e5; return h < 1 ? 'hace menos de 1 h' : h < 24 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} día${Math.round(h / 24) === 1 ? '' : 's'}`; };

export async function cargarMapa() {
  const a = T(); a.mapa ||= { datos: null, filtro: '' };
  const [r] = await Promise.all([sb.rpc('ubicaciones_flota', { p_empresa: S.m.empresa_id }), cargarLibs().catch(e => toast(msgError(e)))]);
  if (r.error) { toast(msgError(r.error)); a.mapa.datos = []; } else a.mapa.datos = r.data;
  vista = null; render();
}

export function vMapa() {
  const a = T(), m = a.mapa;
  if (!m || !m.datos) return '<p class="muted">Cargando el mapa…</p>';
  const us = m.datos, sin = a.d.equipos.filter(e => e.activo && !us.some(u => u.equipo_id === e.id));
  const cuenta = k => us.filter(u => estadoDe(u)[0] === k).length;
  const filtros = [['', 'Todos', us.length], ['uso', 'Trabajando', cuenta('uso')], ['bad', 'Bloqueados', cuenta('bad')], ['ok', 'Operativos', cuenta('ok')]]
    .map(([k, l, n]) => `<button class="tab ${m.filtro === k ? 'on' : ''}" data-act="mapaFiltro" data-k="${k}">${l} (${n})</button>`).join('');
  const lista = us.filter(u => !m.filtro || estadoDe(u)[0] === m.filtro).map(u => { const [c, t] = estadoDe(u);
    return `<button class="li" data-act="mapaIr" data-id="${u.equipo_id}"><span class="t"><i class="pin-dot ${c}"></i>${esc(u.codigo)} · ${esc(u.nombre)}</span><span class="chip ${c === 'bad' ? 'bad' : c === 'uso' ? 'acc' : c === 'ok' ? 'ok' : 'plain'}">${t}</span>
      <span class="s">${esc(u.obra || (u.origen === 'telemetria' ? 'Posición de JDLink' : 'Sin obra'))}${u.operario ? ' · ' + esc(u.operario) : ''} · ${hace(u.cuando)}</span></button>`; }).join('');
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Mapa de la flota</h2>
      <p class="small muted">Última ubicación conocida de cada equipo: donde se hizo el último checklist con GPS, o la posición de JDLink si es más nueva. No es seguimiento en vivo.</p></div></div>
    <nav class="tabs">${filtros}</nav>
    ${us.length ? `<div class="mapa-grid"><div id="mapa-flota" class="mapa" role="application" aria-label="Mapa de la flota"></div><div class="mapa-lista">${lista || '<p class="muted">Ningún equipo con este filtro.</p>'}</div></div>`
      : '<div class="empty">Todavía no hay ubicaciones. Aparecen cuando los operarios hacen el checklist con el GPS activado.</div>'}
    ${sin.length ? `<p class="small muted">Sin ubicación registrada: ${sin.map(e => `<span class="eqcode">${esc(e.codigo)}</span>`).join(' ')}</p>` : ''}</section>`;
}

// Se llama después de cada dibujo: arma el mapa sobre el contenedor nuevo.
export function despues() {
  const el = document.getElementById('mapa-flota');
  if (!el) { if (mapa) { vista = { c: mapa.getCenter(), z: mapa.getZoom() }; mapa.remove(); mapa = null; } return; }
  if (el.dataset.ok || !window.L) return; el.dataset.ok = '1';
  if (mapa) { vista = { c: mapa.getCenter(), z: mapa.getZoom() }; mapa.remove(); }
  const L = window.L, m = T().mapa, us = m.datos.filter(u => !m.filtro || estadoDe(u)[0] === m.filtro);
  mapa = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(mapa);
  mapa.on('click', () => mapa.scrollWheelZoom.enable());
  const pts = [];
  us.forEach(u => {
    const [c, t] = estadoDe(u);
    const mk = L.marker([u.lat, u.lng], { title: `${u.codigo} · ${t}`, icon: L.divIcon({ className: '', html: `<span class="pin ${c}">${esc(u.codigo)}</span>`, iconSize: null, iconAnchor: [0, 0] }) }).addTo(mapa);
    mk.bindPopup(`<b>${esc(u.codigo)} · ${esc(u.nombre)}</b><br>${t}${u.obra ? '<br>' + esc(u.obra) : ''}${u.operario ? '<br>' + esc(u.operario) : ''}
      <br><span style="color:#666">${u.origen === 'telemetria' ? 'JDLink' : 'Checklist'} · ${fFecha(u.cuando)} ${fHora(u.cuando)} h</span><br><a href="${mapsUrl(u.lat, u.lng)}" target="_blank" rel="noopener">Abrir en Google Maps ↗</a>`);
    u._mk = mk; pts.push([u.lat, u.lng]);
  });
  if (m.ir) { const u = us.find(x => x.equipo_id === m.ir); m.ir = null; if (u) { mapa.setView([u.lat, u.lng], 16); u._mk.openPopup(); return; } }
  if (vista) mapa.setView(vista.c, vista.z); else if (pts.length) mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); else mapa.setView([-34.6, -64], 5);
}

export const A = {
  mapaFiltro: b => { T().mapa.filtro = b.dataset.k; vista = null; render(); },
  mapaIr: b => { T().mapa.ir = b.dataset.id; const el = document.getElementById('mapa-flota'); if (el) delete el.dataset.ok; despues(); el && el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
};
