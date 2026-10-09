// SSO identity rules for Google and Microsoft (pure).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleIdentity, microsoftIdentity, pkceChallenge } from '../src/lib/sso.js';

test('Google: verified email only, issuer checked', () => {
  assert.deepEqual(googleIdentity({ iss: 'https://accounts.google.com', sub: '123', email: 'A@LG.com', email_verified: true, name: 'A' }), { subject: '123', email: 'a@lg.com', name: 'A' });
  assert.throws(() => googleIdentity({ iss: 'https://accounts.google.com', sub: '1', email: 'a@lg.com', email_verified: false }), /did not confirm/);
  assert.throws(() => googleIdentity({ iss: 'https://evil.example', sub: '1', email: 'a@lg.com', email_verified: true }), /issuer/);
});

test('Microsoft: work or school only, the sign-in name (not the editable email), tenant + object id', () => {
  const tid = '11111111-2222-3333-4444-555555555555';
  const base = { iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, oid: 'oid-1', preferred_username: 'Jane@LGE.com', email: 'ceo@lg.com', name: 'Jane' };
  assert.deepEqual(microsoftIdentity(base, 'organizations'), { subject: `${tid}:oid-1`, email: 'jane@lge.com', name: 'Jane' });
  const consumer = '9188040d-6c67-4c5b-b112-36a304b66dad';
  assert.throws(() => microsoftIdentity({ ...base, tid: consumer, iss: `https://login.microsoftonline.com/${consumer}/v2.0` }, 'common'), /work or school/);
  assert.throws(() => microsoftIdentity({ ...base, iss: 'https://login.microsoftonline.com/other/v2.0' }, 'organizations'), /issuer/);
  assert.throws(() => microsoftIdentity(base, 'aaaaaaaa-0000-0000-0000-000000000000'), /not allowed/);
  assert.doesNotThrow(() => microsoftIdentity(base, tid));
  assert.throws(() => microsoftIdentity({ ...base, preferred_username: 'not-an-email' }, 'organizations'), /sign-in name/);
});

test('PKCE challenge is the S256 of the verifier (RFC 7636 appendix B)', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
