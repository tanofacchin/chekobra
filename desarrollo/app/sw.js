// Service worker: guarda la app en el teléfono para que abra sin señal.
// Los datos (Supabase) nunca se cachean acá: la app maneja su propia copia y su bandeja de salida.
const VERSION = 'checkobra-v4';
const ARCHIVOS = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/supabase-2.118.0.js',
  'js/main.js', 'js/estado.js', 'js/util.js', 'js/datos.js', 'js/cola.js', 'js/operario.js', 'js/admin.js', 'js/config.js', 'js/politica.js', 'js/editor.js', 'js/etiquetas.js', 'js/mantenimiento.js', 'js/indicadores.js', 'js/reportes.js',
  'vendor/qrcode-generator-1.4.4.js', 'privacidad.html',
  'icons/icono.svg', 'icons/icono-192.png', 'icons/icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // Red primero (para recibir actualizaciones), copia guardada si no hay señal.
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(ca => ca.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(VERSION).then(ca => ca.put(e.request, c)); return res; })));
  }
});
