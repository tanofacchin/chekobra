// Conexión con Caterpillar (Cat VisionLink) por la API ISO 15143-3: la empresa carga las credenciales que le da Caterpillar.
import { esc, fFecha, toast, msgError } from './util.js';
import { sb } from './datos.js';
import { S, render, esAdmin } from './estado.js';

const T = () => S.adm;
const hace = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `el ${fFecha(t)}`; };
async function llamar(body) {
  const { data, error } = await sb.functions.invoke('caterpillar', { body: { empresa_id: S.m.empresa_id, ...body } });
  if (error || (data && data.error)) {
    let msg = data && data.error;
    if (!msg) { try { msg = (await error.context.json()).error; } catch { msg = msgError(error); } }
    throw new Error(msg);
  }
  return data;
}

export function vCat() {
  const a = T(), c = a.d.cat, adm = esAdmin(), f = a.catForm;
  const conectada = c && c.estado !== 'desconectada';
  const est = !conectada ? ['', 'No conectado'] : c.estado === 'conectada' ? ['ok', 'Conectado'] : ['bad', 'Error'];
  const sinV = c && c.maquinas_sin_vincular && c.maquinas_sin_vincular.length ? c.maquinas_sin_vincular : [];
  const form = f ? `<div class="stack"><div class="form-grid">
        <label class="f">Client ID<input class="inp mono" id="cat-id" data-cat="client_id" value="${esc(f.client_id)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="fleet_mgmt_… o iso15143_…"></label>
        <label class="f">Client secret<input class="inp mono" id="cat-sec" data-cat="client_secret" type="password" value="${esc(f.client_secret)}" autocomplete="new-password" spellcheck="false"></label></div>
      <details><summary class="small">Opciones avanzadas</summary><label class="f">Scope <small>Solo si Caterpillar te indicó uno</small><input class="inp mono" id="cat-scope" data-cat="scope" value="${esc(f.scope)}" placeholder="manage:all"></label></details>
      <p class="small muted">Se prueban antes de guardarlas y se guardan cifradas: nadie, ni siquiera desde el panel, las puede volver a ver.</p>
      ${f.err ? `<p class="err">${esc(f.err)}</p>` : ''}
      <div class="row"><button class="btn sm" data-act="catCancelar">Cancelar</button><button class="btn sm primary" data-act="catGuardar" ${f.ocupado ? 'disabled' : ''}>${f.ocupado ? 'Probando con Caterpillar…' : 'Conectar'}</button></div></div>` : '';
  return `<section class="card"><div class="row" style="justify-content:space-between"><div><h2>Caterpillar VisionLink</h2>
      <p class="small muted">Horas de motor, ubicación y combustible de las máquinas Cat, para controlar los checklists. Se vincula por N.º de serie.</p></div>
      <span class="chip ${est[0]}">${est[1]}</span></div>
    ${c && c.error && conectada ? `<div class="badbox">${esc(c.error)}</div>` : ''}
    ${conectada && c.ultima_sync ? `<p class="small muted">Última actualización ${hace(c.ultima_sync)}${c.cuenta_externa ? ` · credencial ${esc(c.cuenta_externa)}` : ''}.</p>` : ''}
    ${sinV.length ? `<div class="warnbox"><b>${sinV.length} máquina${sinV.length > 1 ? 's' : ''} de Caterpillar sin vincular.</b> Cargá su número de serie en el equipo correspondiente:
      <ul style="margin:6px 0 0;padding-left:18px">${sinV.slice(0, 10).map(m => `<li><span class="mono">${esc(m.serie || m.pin || '—')}</span> ${esc([m.oem, m.modelo].filter(Boolean).join(' '))}</li>`).join('')}</ul></div>` : ''}
    ${!conectada && !f ? `<details class="small"><summary>¿Cómo consigo las credenciales?</summary><ol class="pasos">
        <li>Pedile a Caterpillar acceso a la <b>API ISO 15143-3 (AEMP 2.0)</b> de tu flota: desde digital.cat.com (API Access) o por tu concesionario Cat (en Argentina, Finning).</li>
        <li>Te mandan un <b>client id</b> y un <b>client secret</b> por correo. No son el usuario y la contraseña de VisionLink.</li>
        <li>Cargalos acá con "Conectar Caterpillar".</li></ol></details>` : ''}
    ${form}
    ${f ? '' : `<div class="row">${conectada ? `<button class="btn sm dark" data-act="catSync" ${a.catOcupado ? 'disabled' : ''}>${a.catOcupado ? 'Actualizando…' : 'Actualizar ahora'}</button>` : ''}
      ${adm ? `<button class="btn sm ${conectada ? 'ghost' : 'primary'}" data-act="catConectar">${conectada ? 'Cambiar credenciales' : 'Conectar Caterpillar'}</button>` : ''}
      ${adm && conectada ? `<button class="btn sm ghost" data-act="catDesconectar">${a.confirm === 'cat' ? 'Tocá de nuevo para desconectar' : 'Desconectar'}</button>` : ''}</div>`}</section>`;
}

export const A = {
  catConectar: () => { T().catForm = { client_id: '', client_secret: '', scope: '', err: '', ocupado: false }; render(); },
  catCancelar: () => { T().catForm = null; render(); },
  catGuardar: async () => {
    const f = T().catForm; f.err = '';
    if (f.client_id.trim().length < 4 || f.client_secret.trim().length < 8) { f.err = 'Cargá el client id y el client secret que te dio Caterpillar.'; return render(); }
    f.ocupado = true; render();
    try {
      const r = await llamar({ accion: 'conectar', client_id: f.client_id, client_secret: f.client_secret, scope: f.scope });
      T().catForm = null;
      toast(`Caterpillar conectado: ${r.maquinas} máquina${r.maquinas === 1 ? '' : 's'}, ${r.vinculadas} vinculada${r.vinculadas === 1 ? '' : 's'}.`, 7000);
      T().recargar();
    } catch (e) { f.ocupado = false; f.client_secret = ''; f.err = e.message; render(); }
  },
  catSync: async () => {
    const a = T(); a.catOcupado = true; render();
    try { const r = await llamar({ accion: 'sincronizar' }); toast(`Caterpillar: ${r.vinculadas} de ${r.maquinas} máquinas actualizadas.`); }
    catch (e) { toast(e.message, 7000); }
    a.catOcupado = false; a.recargar();
  },
  catDesconectar: async () => {
    const a = T(); if (a.confirm !== 'cat') { a.confirm = 'cat'; return render(); } a.confirm = null;
    try { await llamar({ accion: 'desconectar' }); toast('Caterpillar desconectado. Las credenciales se borraron.'); } catch (e) { toast(e.message, 6000); }
    a.recargar();
  },
};
export function alEscribir(el, v) {
  const f = T() && T().catForm; if (!f || !el.dataset.cat) return false;
  f[el.dataset.cat] = v; return true;
}
