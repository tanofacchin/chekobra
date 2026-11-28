// Prueba de la carga inicial desde Excel: baja la planilla modelo, la completa (equipos con datos de combustible,
// personal de obra y obras), la sube, la revisa y la importa. Deja la planilla modelo en e2e/capturas/.
// Crea una empresa nueva con nombre al azar y al final la borra.
//
//   APP_URL=http://localhost:8080/ SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... node e2e/tarjetero.mjs
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
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
  duenaId = (await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: correo, password: clave, email_confirm: true }) })).id;
  await p.click('[data-act="modoLogin"][data-m="correo"]'); await p.fill('#l-mail', correo); await p.fill('#l-pass', clave); await p.click('button[type="submit"]');
  await p.waitForSelector('#o-nom'); await p.fill('#o-nom', 'Prueba importar'); await p.fill('#o-slug', slug); await p.fill('#o-mi', 'Dueña Prueba'); await p.click('button[type="submit"]');
  await p.waitForSelector('#priv-ok'); await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); await ver('Primeros pasos');
  await tab('personal'); await p.click('[data-act="impAbrir"]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="impModelo"]')]);
  const modelo = DIR + 'operapto-planilla-para-importar.xlsx'; await dl.saveAs(modelo);
  paso('planilla modelo descargada');
  // completarla en el navegador con ExcelJS (la misma librería de la app)
  const b64 = readFileSync(modelo).toString('base64');
  const lleno = await p.evaluate(async b64 => {
    const wb = new window.ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer);
    const tipo = wb.getWorksheet('Listas').getCell('A1').value;
    wb.getWorksheet('Equipos').getRow(2).values = ['EX-01', 'Excavadora John Deere 210G', tipo, 4800, '1FF210GX', '', 38000, null, 400, 18, 250, 4000];
    wb.getWorksheet('Personal').getRow(2).values = ['Juan Pérez', '101', 'Operario', ''];
    wb.getWorksheet('Personal').getRow(3).values = ['Ana Gómez', '301', 'Personal de obra', '111111'];
    wb.getWorksheet('Obras').getRow(2).values = ['Ruta 5 - Tramo Norte', 5000000];
    const lista = wb.getWorksheet('Personal').getCell('C2').dataValidation.formulae[0];
    const buf = await wb.xlsx.writeBuffer(); let s = ''; new Uint8Array(buf).forEach(x => { s += String.fromCharCode(x); });
    return { b64: btoa(s), lista, roles: [1, 2, 3, 4].map(i => wb.getWorksheet('Listas').getCell('B' + i).value) };
  }, b64);
  if (!lleno.roles.includes('Personal de obra') || !lleno.lista.endsWith('$B$4')) throw new Error('la lista de roles no tiene "Personal de obra"');
  const completa = DIR + 'planilla-completa.xlsx'; writeFileSync(completa, Buffer.from(lleno.b64, 'base64'));
  await p.setInputFiles('#imp-arch', completa); await ver('EX-01'); await ver('Ana Gómez');
  await p.click('[data-act="impConfirmar"]'); await ver('Descargar los PIN', 60000);
  const [emp] = await api(`/rest/v1/empresas?slug=eq.${slug}&select=id`);
  const [eq] = await api(`/rest/v1/equipos?empresa_id=eq.${emp.id}&select=capacidad_tanque,consumo_referencia,cupo_dia_l,cupo_mes_l,tarifa_hora`);
  const ms = await api(`/rest/v1/miembros?empresa_id=eq.${emp.id}&legajo=not.is.null&select=legajo,rol&order=legajo`);
  if (Number(eq.capacidad_tanque) !== 400 || Number(eq.consumo_referencia) !== 18 || Number(eq.cupo_dia_l) !== 250 || Number(eq.cupo_mes_l) !== 4000) throw new Error('combustible del equipo: ' + JSON.stringify(eq));
  if (ms.map(m => m.rol).join() !== 'operario,personal') throw new Error('roles: ' + JSON.stringify(ms));
  paso('planilla completa importada: equipo con tanque, consumo y cupos; operario y personal de obra; obra');
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
