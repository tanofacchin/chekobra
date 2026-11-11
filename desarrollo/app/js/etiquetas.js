// Etiquetas con QR para pegar en cada equipo. El QR abre la app con ese equipo ya elegido.
// Usa la librería qrcode-generator (vendor/), que define el global `qrcode`.
import { esc } from './util.js';

export const urlEquipo = id => `${location.origin}${location.pathname.replace(/index\.html$/, "")}?equipo=${encodeURIComponent(id)}`;

export function qrSvg(texto) {
  const q = window.qrcode(0, 'M');   // corrección media: se lee aunque la etiqueta se ensucie un poco
  q.addData(texto); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function vEtiquetas(equipos, empresa) {
  return `<main class="wrap wide etiquetas-pag">
    <div class="row no-print" style="justify-content:space-between"><div><h1>Etiquetas QR</h1>
      <p class="muted">${equipos.length} etiqueta${equipos.length === 1 ? '' : 's'}. Imprimilas en papel autoadhesivo o plastificalas y pegalas cerca del asiento del operador.</p></div>
      <div class="row"><button class="btn" data-act="etqCerrar">Volver</button><button class="btn primary" data-act="etqImprimir">Imprimir</button></div></div>
    <div class="etiquetas">${equipos.map(e => `<div class="etiqueta">
      <div class="etq-qr">${qrSvg(urlEquipo(e.id))}</div>
      <div class="etq-txt"><span class="etq-marca">CheckObra</span><b class="etq-cod">${esc(e.codigo)}</b><span class="etq-nom">${esc(e.nombre)}</span>
        <span class="etq-ins">Escaneá antes de operar</span><span class="etq-emp">${esc(empresa)}</span></div></div>`).join('')}</div></main>`;
}
