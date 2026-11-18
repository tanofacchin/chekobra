import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cifrar, descifrar } from './cifrado.js';

const K = 'a'.repeat(64), OTRA = 'b'.repeat(64);
test('cifra y descifra', async () => {
  const c = await cifrar('secreto-de-caterpillar', K);
  assert.notEqual(c, 'secreto-de-caterpillar');
  assert.ok(!c.includes('secreto'));
  assert.equal(await descifrar(c, K), 'secreto-de-caterpillar');
});
test('cada cifrado es distinto (iv al azar)', async () => {
  assert.notEqual(await cifrar('x', K), await cifrar('x', K));
});
test('con otra clave no se puede descifrar', async () => {
  await assert.rejects(descifrar(await cifrar('x', K), OTRA));
});
test('sin clave válida no cifra', async () => {
  await assert.rejects(cifrar('x', ''), /clave de cifrado/);
});
