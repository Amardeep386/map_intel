// Credential vault encryption (no database; test keys only).   npm test
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decrypt, encrypt, hintFor, parseKeyring, setKeyringForTests } from '../src/lib/vault.js';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');
const owner = { accountId: '11111111-1111-1111-1111-111111111111', kind: 'sftp' };

test('round trip; the ciphertext does not contain the secret', () => {
  setKeyringForTests(`k1:${k1}`, 'k1');
  const sealed = encrypt('s3cret-sftp-password', owner);
  assert.equal(sealed.keyId, 'k1');
  assert.ok(!sealed.ciphertext.toString('utf8').includes('s3cret'));
  assert.equal(decrypt(sealed, owner), 's3cret-sftp-password');
});

test('every encryption uses a fresh IV', () => {
  setKeyringForTests(`k1:${k1}`, 'k1');
  const a = encrypt('same', owner);
  const b = encrypt('same', owner);
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test('tampering is detected', () => {
  setKeyringForTests(`k1:${k1}`, 'k1');
  const sealed = encrypt('value', owner);
  const flipped = Buffer.from(sealed.ciphertext);
  flipped[0] ^= 0xff;
  assert.throws(() => decrypt({ ...sealed, ciphertext: flipped }, owner));
});

test("a secret copied onto another account's row does not decrypt", () => {
  setKeyringForTests(`k1:${k1}`, 'k1');
  const sealed = encrypt('value', owner);
  assert.throws(() => decrypt(sealed, { ...owner, accountId: '22222222-2222-2222-2222-222222222222' }));
  assert.throws(() => decrypt(sealed, { ...owner, kind: 'slack' }));
});

test('after switching the active key, old secrets still decrypt and new ones use the new key', () => {
  setKeyringForTests(`k1:${k1}`, 'k1');
  const old = encrypt('old', owner);
  setKeyringForTests(`k1:${k1},k2:${k2}`, 'k2');
  assert.equal(decrypt(old, owner), 'old');
  assert.equal(encrypt('new', owner).keyId, 'k2');
});

test('a removed key cannot decrypt', () => {
  setKeyringForTests(`k1:${k1}`, 'k1');
  const sealed = encrypt('x', owner);
  setKeyringForTests(`k2:${k2}`, 'k2');
  assert.throws(() => decrypt(sealed, owner), /not in VAULT_KEYS/);
});

test('keys must be 32 bytes; hints show at most the last 4 characters of long secrets', () => {
  assert.throws(() => parseKeyring(`k1:${randomBytes(16).toString('base64')}`), /32 bytes/);
  assert.throws(() => parseKeyring('nocolon'), /id:base64key/);
  assert.equal(hintFor('short'), '••••');
  assert.equal(hintFor('abcdefghijkl1234'), '…1234');
});
