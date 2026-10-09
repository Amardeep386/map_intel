// MFA codes: RFC 6238 test vectors, drift, replay, sealing, recovery codes.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base32Decode, base32Encode, checkTotp, hashRecoveryCode, looksLikeRecoveryCode, newRecoveryCodes, newSecret, openSecret, otpauthUri, sealSecret, stepAt, totp,
} from '../src/lib/mfa.js';

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (8-digit codes; ours are the last six).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('totp matches the RFC 6238 test vectors', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']] as const) {
    assert.equal(totp(RFC_SECRET, Math.floor(t / 30)), code, `T=${t}`);
  }
});

test('base32 round-trips; secrets are 160 bits', () => {
  const s = newSecret();
  assert.equal(s.length, 32);
  assert.equal(base32Decode(s).length, 20);
  assert.equal(base32Encode(base32Decode(s)), s);
});

test('checkTotp: one step of drift either way, never an old or reused step, six digits only', () => {
  const now = new Date('2026-10-09T10:00:10Z');
  const s = stepAt(now);
  assert.equal(checkTotp(RFC_SECRET, totp(RFC_SECRET, s), now, null), s);
  assert.equal(checkTotp(RFC_SECRET, totp(RFC_SECRET, s - 1), now, null), s - 1);
  assert.equal(checkTotp(RFC_SECRET, totp(RFC_SECRET, s + 1), now, null), s + 1);
  assert.equal(checkTotp(RFC_SECRET, totp(RFC_SECRET, s - 2), now, null), null);
  assert.equal(checkTotp(RFC_SECRET, totp(RFC_SECRET, s), now, s), null); // already used
  assert.equal(checkTotp(RFC_SECRET, ` ${totp(RFC_SECRET, s).slice(0, 3)} ${totp(RFC_SECRET, s).slice(3)}`, now, null), s); // spaces are fine
  assert.equal(checkTotp(RFC_SECRET, 'abcdef', now, null), null);
});

test('sealed secrets open again and are different every time; tampering fails', () => {
  const a = sealSecret(RFC_SECRET);
  const b = sealSecret(RFC_SECRET);
  assert.notEqual(a, b);
  assert.equal(openSecret(a), RFC_SECRET);
  const parts = a.split(':');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => openSecret(parts.join(':')));
});

test('recovery codes: ten, readable, hashed case- and dash-insensitively', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.ok(codes.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c)));
  assert.equal(new Set(codes).size, 10);
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].toLowerCase().replace('-', '')));
  assert.ok(looksLikeRecoveryCode(codes[0]) && !looksLikeRecoveryCode('123456'));
  // 0, 1 and 8 typed for O, I and B still match.
  assert.equal(hashRecoveryCode('YATA-2ISO'), hashRecoveryCode('yata-21s0'));
  assert.equal(hashRecoveryCode('BBBB-AAAA'), hashRecoveryCode('8888aaaa'));
});

test('otpauth URI for authenticator apps', () => {
  assert.equal(otpauthUri('ABC', 'a@b.com'), 'otpauth://totp/Mirethos%20MAP%20Intel%3Aa%40b.com?secret=ABC&issuer=Mirethos%20MAP%20Intel&algorithm=SHA1&digits=6&period=30');
});
