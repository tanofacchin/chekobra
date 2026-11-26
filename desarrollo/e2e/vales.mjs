// Prueba de punta a punta de los vales de combustible: pedido con aprobación automática, vale en pantalla,
// carga con vale, carga observada por los controles, y en el panel: rechazo, aprobación de pedidos, emisión, cupos y Excel.
// Crea una empresa nueva con nombre al azar y al final la borra.
//
//   APP_URL=http://localhost:8080/ SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... node e2e/tarjetero.mjs
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = process.env.APP_URL || 'http://localhost:8080/';
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
if (!SB || !KEY) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY'); process.exit(2); }
const DIR = new URL('./capturas/', import.meta.url).pathname; mkdirSync(DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = 'e2e-' + randomBytes(4).toString('hex');
const correo = `duena@${slug}.invalid`, clave = 'E2e-' + randomBytes(9).toString('base64url');
async function api(path, opts = {}) {
  const r = await fetch(SB + path, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

let duenaId = null, ok = 0;
const paso = n => { ok++; console.log('✔', n); };
const OBRA = { latitude: -31.42, longitude: -64.19, accuracy: 8 }, LEJOS = { latitude: -31.48, longitude: -64.19, accuracy: 8 };
const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, geolocation: OBRA, permissions: ['geolocation'], timezoneId: 'America/Argentina/Buenos_Aires', serviceWorkers: 'block', acceptDownloads: true });
// SERVIR_LOCAL=app: la app se sirve desde esta carpeta pero bajo la dirección de APP_URL (la publicada),
// para probar la huella con el origen real cuando la red no llega al sitio publicado.
if (process.env.SERVIR_LOCAL) {
  const { readFile } = await import('node:fs/promises'), { join, extname } = await import('node:path');
  const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  await ctx.route(APP + '**', async r => {
    let ruta = new URL(r.request().url()).pathname.slice(new URL(APP).pathname.length) || 'index.html';
    if (ruta.endsWith('/')) ruta += 'index.html';
    try { await r.fulfill({ body: await readFile(join(process.env.SERVIR_LOCAL, ruta)), contentType: TIPOS[extname(ruta)] || 'application/octet-stream' }); }
    catch { await r.fulfill({ status: 404, body: 'no encontrado' }); }
  });
}
const p = await ctx.newPage(); const errores = [];
p.on('pageerror', e => errores.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ').trim()));
p.on('console', m => { if (m.type() === 'error' && !/the server responded with a status of 4\d\d|tile\.openstreetmap|ERR_/.test(m.text())) errores.push(m.text()); });
const ver = (t, timeout = 25000) => p.getByText(t, { exact: false }).first().waitFor({ timeout });
const tab = async k => { await p.click(`[data-act="admTab"][data-k="${k}"]`); await sleep(1200); };
const sub = async k => { await p.click(`[data-act="asVista"][data-k="${k}"]`); await sleep(1500); };
const foto = DIR + 'foto.png';

try {
  await p.goto(APP); await ver('Operario');
  writeFileSync(foto, Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#334'; x.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; }), 'base64'));
  duenaId = (await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: correo, password: clave, email_confirm: true }) })).id;
  const salir = async () => { await p.click('[data-act="salir"]'); await ver('Supervisión'); };
  const duena = async () => { await p.setViewportSize({ width: 1280, height: 900 }); await p.click('[data-act="modoLogin"][data-m="correo"]'); await p.fill('#l-mail', correo); await p.fill('#l-pass', clave); await p.click('button[type="submit"]'); };
  const legajo = async (leg, pin) => {
    await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-act="modoLogin"][data-m="operario"]');
    await p.fill('#l-slug', slug); await p.fill('#l-leg', leg); await p.fill('#l-pin', pin); await p.click('button[type="submit"]');
    await p.waitForSelector('#priv-ok, [data-act="opNueva"]', { timeout: 25000 });
    if (await p.$('#priv-ok')) { await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); }
  };

  // ---------- empresa, operario y equipo con tanque de 300 L, consumo de 20 L/h y cupo de 250 L por día
  await duena();
  await p.waitForSelector('#o-nom'); await p.fill('#o-nom', 'Prueba vales'); await p.fill('#o-slug', slug); await p.fill('#o-mi', 'Dueña Prueba'); await p.click('button[type="submit"]');
  await p.waitForSelector('#priv-ok'); await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); await ver('Primeros pasos');
  await tab('personal');
  await p.click('[data-act="admPerNuevo"]'); await p.fill('#np-nom', 'Juan Operario'); await p.fill('#np-leg', '101'); await p.fill('#np-pin', '123456'); await p.click('[data-act="admPerGuardar"]'); await ver('Juan Operario');
  const [emp] = await api(`/rest/v1/empresas?slug=eq.${slug}&select=id`);
  await api('/rest/v1/equipos', { method: 'POST', body: JSON.stringify({ empresa_id: emp.id, codigo: 'CB-01', nombre: 'Cargadora de prueba', plantilla_clave: 'excavadora', ultimo_medidor: 1000, capacidad_tanque: 300, consumo_referencia: 20, cupo_dia_l: 250 }) });
  await api(`/rest/v1/empresas?id=eq.${emp.id}`, { method: 'PATCH', body: JSON.stringify({ precio_gasoil: 1000 }) });
  paso('empresa, operario y equipo con cupo'); await salir();

  // ---------- el operario pide un vale (dentro del cupo: se aprueba solo), lo muestra y registra la carga con el vale
  await legajo('101', '123456'); await p.waitForSelector('[data-act="vaPedir"]');
  await p.click('[data-act="vaPedir"]'); await p.selectOption('#va-eq', { label: 'CB-01 · Cargadora de prueba' }); await ver('Cupo disponible');
  await p.fill('#va-l', '150'); await p.selectOption('#va-o', 'estacion'); await p.fill('#va-m', 'Movimiento de suelo');
  await p.click('[data-act="vaPedirOk"]'); await ver('aprobado: código'); await p.waitForSelector('.vale-cod');
  const codigo = (await p.textContent('.vale-cod')).trim();
  await p.screenshot({ path: DIR + 'vales-vale.png', fullPage: true });
  await p.click('[data-act="vaCargar"]'); await p.waitForSelector('#cg-vale');
  if (await p.inputValue('#cg-vale') === '') throw new Error('el vale no quedó elegido en la carga');
  await p.fill('#cg-l', '150'); await p.fill('#cg-m', '1010'); await p.fill('#cg-pr', '1050');
  await p.click('[data-act="opCargaGuardar"]'); await ver('Carga de 150 L registrada'); await sleep(4000);
  const [c1] = await api(`/rest/v1/cargas_combustible?empresa_id=eq.${emp.id}&select=control,vale_id`);
  if (!c1 || c1.control !== 'ok' || !c1.vale_id) throw new Error('la carga con vale no quedó bien: ' + JSON.stringify(c1));
  paso(`vale ${codigo} aprobado solo, mostrado y usado en la carga`);

  // ---------- un segundo pedido pasa el cupo (queda pedido) y una carga sin vale queda observada
  await p.click('[data-act="vaPedir"]'); await p.selectOption('#va-eq', { label: 'CB-01 · Cargadora de prueba' }); await p.fill('#va-l', '200'); await p.click('[data-act="vaPedirOk"]');
  await ver('espera la aprobación'); await ver('Pedido: esperando aprobación');
  await p.click('[data-act="opCarga"]'); await p.selectOption('#cg-eq', { label: 'CB-01 · Cargadora de prueba' });
  await p.fill('#cg-l', '120'); await p.fill('#cg-m', '1011'); await p.click('[data-act="opCargaGuardar"]');
  await ver('Queda observada', 30000);
  await p.screenshot({ path: DIR + 'vales-operario.png', fullPage: true });
  paso('pedido fuera del cupo espera aprobación; carga sin vale y con consumo alto queda observada'); await salir();

  // ---------- la dueña: aviso en el resumen, rechaza la carga, aprueba el pedido, emite un vale, cupos y ajustes
  await duena(); await ver('carga de combustible observada'); await ver('pedido de vale');
  await p.click('[data-act="vaIrPanel"] >> nth=0'); await ver('Cargas observadas (1)'); await ver('Consumo alto'); await ver('Cupo diario');
  await p.screenshot({ path: DIR + 'vales-panel.png', fullPage: true });
  await p.click('[data-act="vaCtl"][data-k="0"]'); await p.fill('#va-ctl', 'No coincide con las horas trabajadas'); await p.click('[data-act="vaCtlOk"]'); await ver('marcada como irregular');
  await p.click('[data-act="vaApr"]'); await p.fill('#va-apl', '100'); await p.click('[data-act="vaAprOk"]'); await ver('Vale aprobado');
  await p.click('[data-act="vaEmitir"]'); await p.selectOption('#ve-eq', { label: 'CB-01 · Cargadora de prueba' }); await p.fill('#ve-l', '80'); await p.fill('#ve-pr', 'YPF Ruta 9'); await p.click('[data-act="vaEmitirOk"]'); await ver('emitido · código');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="vaExcel"]')]); await dl.saveAs(DIR + 'vales.xlsx');
  await p.click('[data-act="cbSub"][data-k="cupos"]'); await p.waitForSelector('[data-cu="semana"]');
  await p.fill('[data-cu="semana"]', '1000'); await p.click('[data-act="vaCupoOk"]'); await ver('Cupo de CB-01 guardado');
  await p.check('#vj-ex'); await p.click('[data-act="vaAjOk"]'); await ver('Ajustes guardados');
  await p.screenshot({ path: DIR + 'vales-cupos.png', fullPage: true });
  const [eq] = await api(`/rest/v1/equipos?empresa_id=eq.${emp.id}&select=cupo_semana_l`), [aj] = await api(`/rest/v1/ajustes_combustible?empresa_id=eq.${emp.id}&select=exigir_vale`);
  if (Number(eq.cupo_semana_l) !== 1000 || !aj.exigir_vale) throw new Error('no se guardaron cupos o ajustes');
  paso('panel: carga rechazada, pedido aprobado, vale emitido, Excel, cupos y ajustes');
  await tab('combustible'); await p.click('[data-act="cbSub"][data-k="cargas"]'); await ver('Irregular');
  await tab('auditoria'); await ver('Marcó una carga como irregular'); await ver('Aprobó un vale de combustible');
  paso('la carga figura como irregular y todo queda en la auditoría');

  console.log(`\n${ok} pasos bien · errores en la página: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
  if (errores.length) process.exitCode = 1;
} catch (e) {
  console.log('FALLÓ:', e.message.split('\n')[0]);
  if (process.env.DEPURAR) { const ms = await api(`/rest/v1/marcaciones?select=tipo,cuando,modo,verificada,observacion,miembro:miembros!marcaciones_miembro_id_fkey(nombre),empresa:empresas!inner(slug)&empresa.slug=eq.${slug}&order=cuando`).catch(x => x.message); console.log(JSON.stringify(ms)); } if (errores.length) console.log('errores en la página:', errores.join(' | ')); process.exitCode = 1;
  await p.screenshot({ path: DIR + 'error.png', fullPage: true }).catch(() => {});
} finally {
  try {
    const ms = await api(`/rest/v1/miembros?select=user_id,empresa:empresas!inner(slug)&empresa.slug=eq.${slug}`);
    await api(`/rest/v1/empresas?slug=eq.${slug}`, { method: 'DELETE' });
    for (const id of new Set([duenaId, ...(ms || []).map(m => m.user_id)].filter(Boolean))) await api(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    console.log('limpieza: empresa y usuarios de prueba borrados');
  } catch (e) { console.log('limpieza incompleta:', e.message); process.exitCode = 1; }
  await b.close();
}
