// Estado global de la app y disparador de render.
export const S = {
  vista: 'cargando',         // cargando | login | registro | onboarding | elegir | app
  user: null,                // usuario de Supabase
  membresias: [],
  m: null,                   // membresía activa: { id, empresa_id, rol, nombre, empresa:{...} }
  modoOperario: false,       // un supervisor puede hacer su propio checklist
  online: navigator.onLine,
  pendientes: 0,
  rechazados: [],
  login: { modo: 'operario', slug: '', legajo: '', pin: '', email: '', pass: '', err: '', ocupado: false, aviso: '' },
  onb: { nombre: '', slug: '', rubro: 'construccion', miNombre: '', err: '', ocupado: false },
  op: null,                  // estado de la vista de operario
  adm: null,                 // estado del panel
};
export const esGestor = () => !!S.m && ['dueno', 'admin', 'supervisor'].includes(S.m.rol);
export const esMecanico = () => !!S.m && S.m.rol === 'mecanico';
export const esAdmin = () => !!S.m && ['dueno', 'admin'].includes(S.m.rol);

let _render = () => {};
export const setRender = f => { _render = f; };
export const render = () => _render();
