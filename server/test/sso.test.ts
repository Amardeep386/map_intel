// SSO identity rules for Google (pure).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleIdentity, pkceChallenge } from '../src/lib/sso.js';

test('Google: verified email only, issuer checked', () => {
  assert.deepEqual(googleIdentity({ iss: 'https://accounts.google.com', sub: '123', email: 'A@LG.com', email_verified: true, name: 'A' }), { subject: '123', email: 'a@lg.com', name: 'A' });
  assert.throws(() => googleIdentity({ iss: 'https://accounts.google.com', sub: '1', email: 'a@lg.com', email_verified: false }), /did not confirm/);
  assert.throws(() => googleIdentity({ iss: 'https://evil.example', sub: '1', email: 'a@lg.com', email_verified: true }), /issuer/);
});

test('PKCE challenge is the S256 of the verifier (RFC 7636 appendix B)', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
