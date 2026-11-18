// Prueba de punta a punta en el navegador contra un proyecto de Supabase (idealmente "operapto-pruebas").
// Crea una empresa nueva con nombre al azar, recorre el circuito principal y al final la borra.
//
//   APP_URL=http://localhost:8080/ SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... node e2e/recorrido.mjs
//
// La app servida en APP_URL tiene que apuntar al mismo proyecto (js/config.js).
// Requiere Playwright con Chromium. Las capturas quedan en e2e/capturas/ (fuera de git).
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
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

// ---------- servicio (solo para preparar y limpiar)
async function api(path, opts = {}) {
  const r = await fetch(SB + path, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
// ---------- TOTP (RFC 6238) para la verificación en dos pasos
function totp(secreto, paso = Math.floor(Date.now() / 30000)) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of secreto.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const k = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', k).update(m).digest(), o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
let ultimoPaso = 0;
async function codigo(secreto) {   // nunca el mismo código dos veces
  let p = Math.floor(Date.now() / 30000);
  if (p <= ultimoPaso) { await sleep((ultimoPaso + 1) * 30000 - Date.now() + 500); p = Math.floor(Date.now() / 30000); }
  ultimoPaso = p; return totp(secreto, p);
}

let duenaId = null, ok = 0;
const paso = n => { ok++; console.log('✔', n); };
const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, geolocation: { latitude: -31.42, longitude: -64.19, accuracy: 7 }, permissions: ['geolocation'], timezoneId: 'America/Argentina/Buenos_Aires' });
const p = await ctx.newPage(); const errores = [];
p.on('pageerror', e => errores.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ').trim()));
p.on('console', m => { if (m.type() === 'error' && !/the server responded with a status of 4\d\d|tile\.openstreetmap|ERR_/.test(m.text())) errores.push(m.text()); });
const ver = (t, timeout = 25000) => p.getByText(t, { exact: false }).first().waitFor({ timeout });
const tab = async k => { await p.click(`[data-act="admTab"][data-k="${k}"]`); await sleep(1500); };
const foto = (() => { const f = DIR + 'foto.png'; return f; })();
let secreto = null;

try {
  // imagen de prueba para las fotos
  await p.goto(APP); await ver('Operario');
  writeFileSync(foto, Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#7a8a5a'; x.fillRect(0, 0, 800, 600); x.fillStyle = '#f0b400'; x.fillRect(200, 200, 400, 200); return c.toDataURL('image/png').split(',')[1]; }), 'base64'));
  // la pantalla de ingreso entra entera en un celular (un estilo pisado ya corrió el campo del PIN fuera de lugar)
  await p.setViewportSize({ width: 390, height: 844 });
  for (const id of ['#l-slug', '#l-leg', '#l-pin']) { const r = await (await p.$(id)).boundingBox(); if (!r || r.x < 0 || r.x + r.width > 390) throw new Error(`campo ${id} fuera de lugar`); }
  paso('pantalla de ingreso en el celular');
  duenaId = (await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: correo, password: clave, email_confirm: true }) })).id;

  const salir = async () => { await p.click('[data-act="salir"]'); await ver('Supervisión'); };
  const duena = async () => {
    await p.setViewportSize({ width: 1280, height: 900 }); await p.click('[data-act="modoLogin"][data-m="correo"]');
    await p.fill('#l-mail', correo); await p.fill('#l-pass', clave); await p.click('button[type="submit"]');
    if (secreto) { await p.waitForSelector('form[data-form="mfa"] button[type="submit"]:not([disabled])'); await p.fill('#mfa-cod', await codigo(secreto)); await p.click('form[data-form="mfa"] button[type="submit"]'); }
  };
  const legajo = async (leg, pin) => {
    await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-act="modoLogin"][data-m="operario"]');
    await p.fill('#l-slug', slug); await p.fill('#l-leg', leg); await p.fill('#l-pin', pin); await p.click('button[type="submit"]');
    await p.waitForSelector('#priv-ok, [data-act="opNueva"], [data-act="otRecargar"]', { timeout: 25000 });
    if (await p.$('#priv-ok')) { await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); }
  };

  // ---------- la dueña crea la empresa y activa la verificación en dos pasos
  await duena();
  await p.waitForSelector('#o-nom'); await p.fill('#o-nom', 'Prueba automática'); await p.fill('#o-slug', slug); await p.fill('#o-mi', 'Dueña Prueba'); await p.click('button[type="submit"]');
  await ver('Activá la verificación en dos pasos'); await p.waitForSelector('#mfa-secreto');
  secreto = (await p.textContent('#mfa-secreto')).trim();
  await p.fill('#mfa-cod', '000000'); await p.click('form[data-form="mfa"] button[type="submit"]'); await ver('Código incorrecto');
  await p.fill('#mfa-cod', await codigo(secreto)); await p.click('form[data-form="mfa"] button[type="submit"]');
  await p.waitForSelector('#priv-ok'); await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); await ver('Primeros pasos');
  paso('alta de empresa con verificación en dos pasos obligatoria');

  await tab('personal'); await ver('Tu seguridad'); await ver('Celular principal');
  await p.fill('#nueva-obra', 'Ruta 5'); await p.click('[data-act="admObraNueva"]'); await ver('Ruta 5');
  for (const [nom, leg, pin, rol] of [['Juan Operario', '101', '123456', 'operario'], ['Mario Mecánico', '201', '654321', 'mecanico']]) {
    await p.click('[data-act="admPerNuevo"]'); await p.fill('#np-nom', nom); await p.fill('#np-leg', leg); await p.fill('#np-pin', pin); await p.selectOption('#np-rol', rol);
    await p.click('[data-act="admPerGuardar"]'); await ver(nom);
  }
  await tab('equipos'); await p.click('[data-act="admEqNuevo"]'); await p.fill('#ne-cod', 'EX-01'); await p.selectOption('#ne-tipo', 'excavadora'); await p.fill('#ne-nom', 'Excavadora de prueba'); await p.fill('#ne-med', '4800'); await p.click('[data-act="admEqGuardar"]'); await ver('Excavadora de prueba');
  paso('obra, operario, mecánico y equipo');
  await salir();

  // ---------- el operario hace el checklist con una falla crítica
  await legajo('101', '123456'); await ver('Iniciar jornada');
  await p.click('[data-act="opNueva"]'); await p.click('.eq:not([disabled])'); await p.selectOption('#f-obra', { index: 1 }); await p.fill('#f-med', '4800');
  await p.setInputFiles('#f-medfoto', foto); await p.waitForSelector('label[for="f-medfoto"] img');
  await p.click('#nextBtn'); await p.click('[data-act="opGps"]'); await ver('Ubicación registrada'); await p.click('#nextBtn');
  await p.setInputFiles('#f-selfie', foto); await p.waitForSelector('.photo img'); await p.click('#nextBtn');
  await sleep(1500);
  for (const i of await p.$$eval('[data-act="opResp"][data-v="ok"]', bs => bs.map(x => x.dataset.id)))
    await p.click(`[data-act="opResp"][data-id="${i}"][data-v="${i === 'cabina.1' ? 'falla' : 'ok'}"]`);
  await p.fill('[data-nota="cabina.1"]', 'Cinturón cortado');
  for (const id of await p.$$eval('input[data-file="item"]', xs => xs.filter(x => x.id.startsWith('fi-')).map(x => x.id))) { await p.setInputFiles('#' + id, foto); await sleep(150); }
  await p.click('#nextBtn'); await ver('Revisá y firmá'); await p.check('#f-decl');
  await p.$eval('#sig', e => e.scrollIntoView({ block: 'center' })); const bx = await (await p.$('#sig')).boundingBox();
  await p.mouse.move(bx.x + 30, bx.y + 100); await p.mouse.down(); await p.mouse.move(bx.x + 150, bx.y + 60, { steps: 6 }); await p.mouse.up(); await sleep(300);
  await p.click('#nextBtn'); await ver('No apto'); await ver('Registro enviado', 60000);
  paso('checklist con falla crítica: equipo bloqueado');
  await p.click('[data-act="opInicio"]'); await salir();

  // ---------- la dueña vuelve a entrar (pide el código) y arma la orden
  await duena(); await ver('EX-01 bloqueado'); paso('segundo ingreso con código de verificación');
  await tab('fallas'); await p.click('[data-act="otDesdeFalla"]'); await ver('Nueva orden de trabajo');
  await p.selectOption('#sel-nueva', { label: 'Mario Mecánico' }); await p.click('[data-act="otNuevaGuardar"]'); await ver('OT 1 creada');
  paso('orden de trabajo asignada al mecánico'); await salir();

  // ---------- el mecánico la termina y el equipo se libera
  await legajo('201', '654321'); await ver('Mis órdenes de trabajo');
  await p.click('[data-act="otAbrir"]'); await ver('Fallas a reparar');
  await p.click('[data-act="otEstado"][data-k="en_curso"]'); await ver('Orden en curso.');
  await p.click('[data-act="otRepNuevo"]'); await p.fill('#ot-rd', 'Cinturón'); await p.fill('#ot-rc', '1'); await p.fill('#ot-rp', '45000'); await p.click('[data-act="otRepGuardar"]'); await ver('$ 45.000');
  await p.click('[data-act="otTerminar"]'); await p.fill('#ot-tr', 'Se cambió el cinturón de seguridad'); await p.fill('#ot-h', '2');
  await p.click('[data-act="otTerminarOk"]'); await ver('EX-01 quedó liberado');
  paso('el mecánico termina la orden y libera el equipo'); await salir();

  // ---------- auditoría
  await duena(); await tab('auditoria'); await ver('Alta de persona'); await ver('Liberó el equipo'); await ver('Mario Mecánico');
  await p.screenshot({ path: DIR + 'auditoria.png', fullPage: true });
  paso('auditoría con altas y liberación');

  console.log(`\n${ok} pasos bien · errores en la página: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
  if (errores.length) process.exitCode = 1;
} catch (e) {
  console.log('FALLÓ:', e.message.split('\n')[0]); if (errores.length) console.log('errores en la página:', errores.join(' | ')); process.exitCode = 1;
  await p.screenshot({ path: DIR + 'error.png', fullPage: true }).catch(() => {});
} finally {
  // ---------- limpieza: la empresa (con todo lo suyo) y los usuarios creados
  try {
    const ms = await api(`/rest/v1/miembros?select=user_id,empresa:empresas!inner(slug)&empresa.slug=eq.${slug}`);
    await api(`/rest/v1/empresas?slug=eq.${slug}`, { method: 'DELETE' });
    for (const id of new Set([duenaId, ...(ms || []).map(m => m.user_id)].filter(Boolean))) await api(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    console.log('limpieza: empresa y usuarios de prueba borrados');
  } catch (e) { console.log('limpieza incompleta:', e.message); process.exitCode = 1; }
  await b.close();
}
