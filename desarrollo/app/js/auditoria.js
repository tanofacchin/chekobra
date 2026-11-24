// Registro de auditoría: quién cambió qué y cuándo (solo dueño y administración). No se puede editar ni borrar.
import { esc, fFecha, fHora, dayKey, toast, msgError, descargar } from './util.js';
import { sb } from './datos.js';
import { S, render } from './estado.js';

const T = () => S.adm;
const TABLA = { equipos: 'Equipo', miembros: 'Persona', obras: 'Obra', plantillas: 'Plantilla de checklist', planes_mantenimiento: 'Plan de service', documentos: 'Documento',
  mantenimientos: 'Trabajo de mantenimiento', cargas_combustible: 'Carga de combustible', jornadas: 'Checklist', ordenes_trabajo: 'Orden de trabajo', empresas: 'Datos de la empresa', telemetria_conexiones: 'Telemetría',
  marcaciones: 'Marcación', ajustes_asistencia: 'Horario del tarjetero', feriados: 'Feriado', lugares_marcacion: 'Lugar permitido para marcar' };
const ACCION = { alta: 'Alta', cambio: 'Cambio', baja: 'Borrado', liberacion: 'Liberó el equipo', fuera_servicio: 'Sacó de servicio', en_servicio: 'Volvió a servicio',
  asignacion: 'Asignó equipos y obras', pin: 'Cambió el PIN', restablecer_2fa: 'Restableció la verificación en dos pasos', conectar_telemetria: 'Conectó', desconectar_telemetria: 'Desconectó', alta_personal: 'Dio de alta',
  marcacion_manual: 'Cargó una marcación a mano', anular_marcacion: 'Anuló una marcación', validar_marcacion: 'Confirmó una marcación', autorizar_marcacion: 'Autorizó una marcación fuera de las ubicaciones', rechazar_marcacion: 'Rechazó una marcación', renovar_qr: 'Renovó el QR de la obra' };
const CAMPO = { nombre: 'nombre', codigo: 'código', activo: 'activo', activa: 'activa', rol: 'rol', legajo: 'legajo', recibir_avisos: 'recibe avisos', bloqueado_en: 'bloqueo por PIN',
  tarifa_hora: 'tarifa por hora', tarifa_dia: 'tarifa por día', plantilla_clave: 'tipo de checklist', serie: 'n.º de serie', patente: 'patente', medidor: 'medidor',
  consumo_referencia: 'consumo de referencia', capacidad_tanque: 'capacidad del tanque', secciones: 'puntos del checklist', vence: 'vencimiento', bloquea: 'bloquea al vencer',
  cada: 'cada', anticipo: 'aviso previo', litros: 'litros', precio_litro: 'precio por litro', costo: 'costo', descripcion: 'descripción', tipo: 'tipo', version: 'versión', detalle: 'detalle',
  equipos: 'equipos', obras: 'obras', telemetria_ref: 'id de telemetría' };
const ROL = { dueno: 'Dueño', admin: 'Administración', supervisor: 'Supervisor', operario: 'Operario', mecanico: 'Mecánico', personal: 'Personal de obra', reloj: 'Reloj del obrador' };
const valor = v => v == null ? '—' : v === true ? 'sí' : v === false ? 'no' : Array.isArray(v) ? (v.length ? v.join(', ') : 'todos') : typeof v === 'object' ? JSON.stringify(v) : String(v);
const textoAccion = r => r.accion === 'alta' && r.tabla === 'miembros' ? 'Alta de persona' : r.accion === 'baja' ? `Borró ${(TABLA[r.tabla] || r.tabla).toLowerCase()}`
  : r.accion === 'alta' ? `Alta de ${(TABLA[r.tabla] || r.tabla).toLowerCase()}` : r.accion === 'cambio' ? `Cambió ${(TABLA[r.tabla] || r.tabla).toLowerCase()}` : (ACCION[r.accion] || r.accion);
export function detalle(r) {
  if (r.accion === 'cambio' && r.despues) return Object.keys(r.despues).map(k => `${CAMPO[k] || k}: ${k === 'rol' ? ROL[r.antes && r.antes[k]] || '—' : valor(r.antes && r.antes[k])} → ${k === 'rol' ? ROL[r.despues[k]] : valor(r.despues[k])}`).join(' · ');
  if (r.accion === 'asignacion') return `equipos: ${valor(r.despues.equipos)} · obras: ${valor(r.despues.obras)}`;
  const d = r.despues || r.antes; if (!d) return '';
  if (d.detalle) return d.detalle;
  return ['rol', 'legajo', 'medidor', 'plantilla_clave', 'vence', 'litros', 'tipo'].filter(k => d[k] != null).map(k => `${CAMPO[k] || k}: ${k === 'rol' ? ROL[d[k]] || d[k] : valor(d[k])}`).join(' · ');
}

function rango(dias) { const d = new Date(); d.setDate(d.getDate() - dias + 1); return { desde: dayKey(d), hasta: dayKey(new Date()) }; }
export async function cargarAuditoria() {
  const a = T(); a.au ||= { ...rango(30), quien: '', tabla: '', filas: null };
  const f = a.au; f.filas = null; render();
  let q = sb.from('auditoria').select('*').eq('empresa_id', S.m.empresa_id).order('cuando', { ascending: false }).limit(500)
    .gte('cuando', new Date(f.desde + 'T00:00:00').toISOString()).lt('cuando', new Date(new Date(f.hasta + 'T00:00:00').getTime() + 864e5).toISOString());
  if (f.quien) q = q.eq('quien', f.quien);
  if (f.tabla) q = q.eq('tabla', f.tabla);
  const { data, error } = await q;
  if (error) { toast(msgError(error)); f.filas = []; } else f.filas = data;
  render();
}

export function vAuditoria() {
  const a = T(), f = a.au || { ...rango(30), quien: '', tabla: '', filas: null };
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const personas = [...new Set(a.d.miembros.filter(m => ['dueno', 'admin', 'supervisor'].includes(m.rol)).map(m => m.nombre))].sort();
  const filtros = `<section class="card"><p class="small muted">Quién dio de alta, cambió o borró equipos, personas, obras, plantillas, tarifas, documentos y planes; quién liberó equipos o cambió un PIN. Este registro no se puede modificar ni borrar.</p>
    <div class="filters ind-filtros">
      <label>Desde<input class="inp" type="date" id="au-des" data-au="desde" data-vivo value="${f.desde}"></label>
      <label>Hasta<input class="inp" type="date" id="au-has" data-au="hasta" data-vivo value="${f.hasta}"></label>
      <label>Persona<select class="inp" id="au-qui" data-au="quien" data-vivo>${opt('', 'Todas', f.quien)}${personas.map(p => opt(p, p, f.quien)).join('')}${opt('Sistema', 'Sistema', f.quien)}</select></label>
      <label>Sobre<select class="inp" id="au-tab" data-au="tabla" data-vivo>${opt('', 'Todo', f.tabla)}${Object.entries(TABLA).map(([k, l]) => opt(k, l, f.tabla)).join('')}</select></label>
      <label>&nbsp;<button class="btn sm dark" data-act="auExcel" ${f.filas && f.filas.length ? '' : 'disabled'}>Descargar Excel</button></label></div></section>`;
  if (!f.filas) return filtros + '<p class="muted">Cargando…</p>';
  if (!f.filas.length) return filtros + '<div class="empty">Sin cambios registrados con estos filtros.</div>';
  let dia = '';
  const filas = f.filas.map(r => { const d = fFecha(r.cuando), cab = d !== dia ? `<tr class="sub"><td colspan="4">${new Date(r.cuando).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</td></tr>` : ''; dia = d;
    return `${cab}<tr><td class="n">${fHora(r.cuando)}</td><td><b>${esc(r.quien || '—')}</b>${r.rol ? `<br><span class="small muted">${esc(ROL[r.rol] || r.rol)}</span>` : ''}</td>
      <td><b>${esc(textoAccion(r))}</b>${r.registro ? ` · ${esc(r.registro)}` : ''}</td><td class="small">${esc(detalle(r))}</td></tr>`; }).join('');
  return `${filtros}<section class="card"><h2>Cambios (${f.filas.length}${f.filas.length === 500 ? ', los más recientes; acotá las fechas' : ''})</h2>
    <div class="tabla"><table><thead><tr><th class="n">Hora</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table></div></section>`;
}

export const A = {
  auExcel: async () => {
    const f = T().au;
    try {
      const { hojaSimple } = await import('./excel.js');
      const blob = await hojaSimple('Auditoría', `Registro de auditoría · ${S.m.empresa.nombre}`, `Del ${f.desde.split('-').reverse().join('/')} al ${f.hasta.split('-').reverse().join('/')}`,
        [{ t: 'Fecha y hora', w: 17, f: 'dd/mm/yyyy hh:mm' }, { t: 'Quién', w: 24 }, { t: 'Rol', w: 12 }, { t: 'Acción', w: 26 }, { t: 'Sobre', w: 30 }, { t: 'Detalle', w: 80 }],
        f.filas.map(r => [new Date(r.cuando), r.quien || '', ROL[r.rol] || r.rol || '', textoAccion(r), r.registro || '', detalle(r)]));
      descargar(`operapto-${S.m.empresa.slug}-auditoria-${f.desde}-al-${f.hasta}.xlsx`, blob, blob.type);
    } catch (e) { toast('No se pudo armar el Excel: ' + msgError(e), 6000); }
  },
};
export function alEscribir(el, v) {
  const a = T(); if (!a || !el.dataset.au) return false;
  a.au[el.dataset.au] = v; cargarAuditoria(); return true;
}
