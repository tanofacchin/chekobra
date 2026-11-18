// Cifrado simétrico (AES-GCM 256) para guardar en la base secretos de terceros (por ejemplo, credenciales de Caterpillar).
// La clave es un secreto de las funciones (64 caracteres hex), nunca está en la base: un volcado de la base no alcanza.
const b64 = u => btoa(String.fromCharCode(...u));
const desdeB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function clave(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || '')) throw new Error('Falta configurar la clave de cifrado');
  const bytes = Uint8Array.from(hex.match(/../g).map(h => parseInt(h, 16)));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function cifrar(texto, hex) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await clave(hex), new TextEncoder().encode(texto)));
  return b64(iv) + '.' + b64(datos);
}
export async function descifrar(cifrado, hex) {
  const [iv, datos] = String(cifrado).split('.');
  const t = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeB64(iv) }, await clave(hex), desdeB64(datos));
  return new TextDecoder().decode(t);
}
