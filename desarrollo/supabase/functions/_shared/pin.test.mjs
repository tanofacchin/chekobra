import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivarClave, correoOperario } from './pin.js';

const P = 'x'.repeat(40);
test('la clave derivada depende del PIN, del usuario y del secreto', async () => {
  const a = await derivarClave(P, 'u1', '123456');
  assert.equal(a, await derivarClave(P, 'u1', '123456'));          // estable
  assert.notEqual(a, await derivarClave(P, 'u1', '123457'));       // otro PIN
  assert.notEqual(a, await derivarClave(P, 'u2', '123456'));       // otro usuario
  assert.notEqual(a, await derivarClave('y'.repeat(40), 'u1', '123456')); // otro secreto
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);                          // 32 bytes en base64url
  assert.ok(!a.includes('123456'));
});
test('exige un secreto largo', async () => {
  await assert.rejects(() => derivarClave('corto', 'u1', '123456'));
});
test('correo interno del operario', () => {
  assert.equal(correoOperario(' MiEmpresa ', 'AB-12'), 'ab-12@miempresa.operarios.invalid');
});
