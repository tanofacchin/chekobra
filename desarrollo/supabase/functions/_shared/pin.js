// La contraseña real de un operario NO es su PIN: se deriva del PIN con una clave secreta del servidor
// (PIN_PEPPER). Así nadie puede probar PINs directamente contra el sistema de usuarios: solo a través de
// la función 'ingresar', que cuenta los intentos y bloquea el legajo al quinto error.
const enc = new TextEncoder();
export async function derivarClave(pepper, userId, pin) {
  if (!pepper || pepper.length < 32) throw new Error('PIN_PEPPER no configurado');
  const k = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${userId}:${pin}`)));
  let b = ''; for (const x of firma) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const correoOperario = (slug, legajo) => `${String(legajo).trim().toLowerCase()}@${String(slug).trim().toLowerCase()}.operarios.invalid`;
export const MAX_INTENTOS = 5;
