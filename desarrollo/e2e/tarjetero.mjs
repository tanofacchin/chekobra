// Prueba de punta a punta del tarjetero: celular propio, QR de la obra, reloj del obrador y panel de asistencia.
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
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, geolocation: OBRA, permissions: ['geolocation'], timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: true });
const p = await ctx.newPage(); const errores = [];
p.on('pageerror', e => errores.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ').trim()));
p.on('console', m => { if (m.type() === 'error' && !/the server responded with a status of 4\d\d|tile\.openstreetmap|ERR_/.test(m.text())) errores.push(m.text()); });
const ver = (t, timeout = 25000) => p.getByText(t, { exact: false }).first().waitFor({ timeout });
const tab = async k => { await p.click(`[data-act="admTab"][data-k="${k}"]`); await sleep(1200); };
const sub = async k => { await p.click(`[data-act="asVista"][data-k="${k}"]`); await sleep(1500); };
const foto = DIR + 'foto.png';

try {
  await p.goto(APP); await ver('Operario');
  writeFileSync(foto, Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#5a7a8a'; x.fillRect(0, 0, 600, 600); x.fillStyle = '#f0b400'; x.beginPath(); x.arc(300, 260, 120, 0, 7); x.fill(); return c.toDataURL('image/png').split(',')[1]; }), 'base64'));
  duenaId = (await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: correo, password: clave, email_confirm: true }) })).id;
  const salir = async () => { await p.click('[data-act="salir"]'); try { await ver('Supervisión', 10000); } catch (e) { console.log('toast:', await p.textContent('#toast').catch(() => '?'), await p.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80))); throw e; } };
  const duena = async () => {
    await p.setViewportSize({ width: 1280, height: 900 }); await p.click('[data-act="modoLogin"][data-m="correo"]');
    await p.fill('#l-mail', correo); await p.fill('#l-pass', clave); await p.click('button[type="submit"]');
  };
  const legajo = async (leg, pin) => {
    await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-act="modoLogin"][data-m="operario"]');
    await p.fill('#l-slug', slug); await p.fill('#l-leg', leg); await p.fill('#l-pin', pin); await p.click('button[type="submit"]');
    await p.waitForSelector('#priv-ok, [data-act="opNueva"], [data-act="tjMarcar"], [data-act="rlObra"], #rl-leg', { timeout: 25000 });
    if (await p.$('#priv-ok')) { await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); }
  };

  // ---------- la dueña crea la empresa, la obra y el personal (incluido un reloj del obrador)
  await duena();
  await p.waitForSelector('#o-nom'); await p.fill('#o-nom', 'Prueba tarjetero'); await p.fill('#o-slug', slug); await p.fill('#o-mi', 'Dueña Prueba'); await p.click('button[type="submit"]');
  await p.waitForSelector('#priv-ok'); await p.check('#priv-ok'); await p.click('[data-act="aceptarPrivacidad"]'); await ver('Primeros pasos');
  await tab('personal');
  await p.fill('#nueva-obra', 'Ruta 5'); await p.click('[data-act="admObraNueva"]'); await ver('Ruta 5');
  for (const [nom, leg, pin, rol] of [['Juan Operario', '101', '123456', 'operario'], ['Ana Personal', '301', '111111', 'personal'], ['Reloj obrador', 'RELOJ1', '222222', 'reloj']]) {
    await p.click('[data-act="admPerNuevo"]'); await p.fill('#np-nom', nom); await p.fill('#np-leg', leg); await p.fill('#np-pin', pin); await p.selectOption('#np-rol', rol);
    await p.click('[data-act="admPerGuardar"]'); await ver(nom);
  }
  await ver('Teléfono fijo del obrador');
  const [emp] = await api(`/rest/v1/empresas?slug=eq.${slug}&select=id`);
  const [ana] = await api(`/rest/v1/miembros?empresa_id=eq.${emp.id}&legajo=eq.301&select=id`);
  await api('/rest/v1/costos_personal', { method: 'POST', body: JSON.stringify({ miembro_id: ana.id, empresa_id: emp.id, costo_hora: 6000 }) });
  paso('alta de personal de obra y de un reloj del obrador');

  // ---------- asistencia: ubicación de la obra (con "estoy en la obra") y cartel QR
  await tab('asistencia'); await ver('Trabajando ahora');
  await sub('ajustes'); await ver('Obras: ubicación y QR');
  await p.click('[data-act="asUbic"]'); await p.click('[data-act="asUbicAqui"]'); await sleep(1500);
  await p.fill('#ub-rad', '200'); await p.click('[data-act="asUbicOk"]'); await ver('Ubicación de la obra guardada');
  await p.click('[data-act="asCartel"]'); await ver('Cartel QR · Ruta 5'); await p.waitForSelector('.cartel-qr svg');
  await p.screenshot({ path: DIR + 'tarjetero-cartel.png', fullPage: true });
  await p.click('[data-act="asCartelCerrar"]');
  const [qr] = await api(`/rest/v1/obras_qr?empresa_id=eq.${emp.id}&select=token`);
  paso('ubicación de la obra y cartel QR'); await salir();

  // ---------- personal de obra: marca entrada desde su celular
  await legajo('301', '111111'); await p.waitForSelector('[data-act="tjMarcar"]');
  await p.click('[data-act="tjMarcar"]'); await ver('Ubicación tomada');
  await p.selectOption('#tj-obra', { label: 'Ruta 5' });
  await p.setInputFiles('#tj-selfie', foto); await p.waitForSelector('.tj-foto img');
  await p.click('[data-act="tjConfirmar"]'); await ver('Entrada marcada'); await ver('Adentro desde', 30000);
  await p.screenshot({ path: DIR + 'tarjetero-personal.png', fullPage: true });
  paso('personal de obra marca entrada con GPS y foto'); await salir();

  // ---------- el operario escanea el QR de la obra (entrada) y después marca la salida lejos de la obra
  await legajo('101', '123456'); await p.waitForSelector('[data-act="opNueva"]');
  await p.goto(APP + '?marcar=' + qr.token);
  await ver('Escaneaste el QR de la obra', 30000);
  await p.setInputFiles('#tj-selfie', foto); await p.waitForSelector('.tj-foto img');
  await p.click('[data-act="tjConfirmar"]'); await ver('Entrada marcada'); await ver('Adentro desde', 30000);
  await p.screenshot({ path: DIR + 'tarjetero-operario.png', fullPage: true });
  await sleep(2500);
  await ctx.setGeolocation(LEJOS);
  await p.click('[data-act="tjMarcar"][data-k="salida"]'); await ver('Ubicación tomada');
  await p.setInputFiles('#tj-selfie', foto); await p.waitForSelector('.tj-foto img');
  await p.click('[data-act="tjConfirmar"]'); await ver('Queda para que la revise el supervisor', 30000);
  await ctx.setGeolocation(OBRA);
  paso('operario: entrada con el QR de la obra y salida fuera de la obra (queda para revisar)'); await salir();

  // ---------- reloj del obrador: PIN equivocado y después la salida de Ana
  await legajo('RELOJ1', '222222'); await p.click('[data-act="rlObra"]'); await p.waitForSelector('#rl-leg');
  const marcarReloj = async (leg, pin) => {
    await p.fill('#rl-leg', leg); await p.fill('#rl-pin', pin);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.rl-btn')]);
    await fc.setFiles(foto);
  };
  await marcarReloj('301', '000000'); await ver('Quedan 4 intentos', 30000);
  await p.click('[data-act="rlListo"]');
  await marcarReloj('301', '111111'); await ver('Ana Personal', 30000); await p.waitForSelector('.rl-res.sal');
  await p.screenshot({ path: DIR + 'tarjetero-reloj.png', fullPage: true });
  await p.click('[data-act="rlListo"]'); await ver('Últimas en este reloj');
  paso('reloj del obrador: PIN equivocado cuenta intentos; con el PIN bueno marca la salida');
  await salir();

  // ---------- la dueña: presentes del día, revisión, horas para sueldos (Excel) y mano de obra en costos
  await duena(); await p.waitForSelector('[data-act="admTab"][data-k="asistencia"]');
  await tab('asistencia'); await ver('Ya se fueron'); await ver('Ana Personal'); await ver('Juan Operario');
  await ver('para revisar');
  await p.screenshot({ path: DIR + 'tarjetero-hoy.png', fullPage: true });
  await sub('revisar'); await ver('Fuera de la obra'); await p.click('[data-act="asValidar"]'); await ver('No hay nada para revisar');
  await sub('periodo'); await ver('Por persona'); await ver('Ana Personal');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="asExcel"]')]);
  const xls = DIR + 'tarjetero.xlsx'; await dl.saveAs(xls); if (statSync(xls).size < 5000) throw new Error('Excel vacío');
  await p.screenshot({ path: DIR + 'tarjetero-periodo.png', fullPage: true });
  await p.click('[data-act="asAbrir"]'); await ver('Marcas');
  await tab('costos'); await p.waitForSelector('[data-act="csAbrir"]'); await p.click('[data-act="csAbrir"]'); await ver('mano de obra del tarjetero');
  await p.screenshot({ path: DIR + 'tarjetero-costos.png', fullPage: true });
  paso('panel: presentes, revisión, Excel para sueldos y mano de obra por obra');
  await tab('auditoria'); await ver('Confirmó una marcación');
  paso('auditoría: alta del reloj y marcación confirmada');

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
