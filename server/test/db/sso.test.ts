// Single sign-on against a mock OpenID Connect provider running in the test (discovery, keys,
// token endpoint with PKCE, signed ID tokens). Who gets in, who does not, and the checks that
// stop forged or replayed sign-ins.   npm run test:db
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { registerProvider, SsoError } from '../../src/lib/sso.js';
import { TEST_EMAIL_DOMAIN, call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

const SSO_DOMAIN = `sso.${TEST_EMAIL_DOMAIN}`;
let app: FastifyInstance;
let idp: Server;
let issuer: string;
let acct: string;
const u: Record<string, TestUser> = {};
// What the mock provider will put in the ID token for each code it hands out.
const pending = new Map<string, { claims: JWTPayload; challenge: string }>();
let sign: (claims: JWTPayload) => Promise<string>;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (o: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const f = new URLSearchParams(body);
      const p = pending.get(f.get('code') ?? '');
      pending.delete(f.get('code') ?? '');
      const verifierOk = p && createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === p.challenge;
      if (!p || !verifierOk || f.get('client_secret') !== 'mock-secret' || f.get('client_id') !== 'mock-client') return json({ error: 'invalid_grant' }, 400);
      return json({ id_token: await sign(p.claims), token_type: 'Bearer' });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience('mock-client').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  registerProvider({
    id: 'mock',
    name: 'Mock',
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    clientId: 'mock-client',
    clientSecret: 'mock-secret',
    scope: 'openid email profile',
    identity: (c) => {
      if (c.email_verified !== true || typeof c.email !== 'string') throw new SsoError('Mock did not confirm this email address');
      return { subject: String(c.sub), email: c.email.toLowerCase(), name: typeof c.name === 'string' ? c.name : null };
    },
  });

  acct = await createTestAccount('sso');
  u.admin = await createUser('sso-admin', 'Administrator', acct);
  u.existing = await createUser('sso-existing', 'Analyst', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  idp.close();
  await withSystem((db) => db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${SSO_DOMAIN}`]));
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

interface Outcome { location: URL; ssoCode: string | null; error: string | null }

/** Start at the API, "sign in" at the mock provider as `claims`, come back to the callback. */
async function signInWith(claims: JWTPayload, tamper: { cookie?: string; nonce?: string; verifierWrong?: boolean } = {}): Promise<Outcome> {
  const start = await app.inject({ method: 'GET', url: '/auth/sso/mock/start' });
  assert.equal(start.statusCode, 302, start.body);
  const auth = new URL(String(start.headers.location));
  assert.equal(auth.origin + auth.pathname, `${issuer}/authorize`);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  const code = `code-${Math.random().toString(36).slice(2)}`;
  pending.set(code, {
    claims: { nonce: tamper.nonce ?? auth.searchParams.get('nonce')!, ...claims },
    challenge: tamper.verifierWrong ? 'nope' : auth.searchParams.get('code_challenge')!,
  });
  const back = await app.inject({
    method: 'GET',
    url: `/auth/sso/mock/callback?code=${code}&state=${encodeURIComponent(auth.searchParams.get('state')!)}`,
    headers: { cookie: tamper.cookie ?? cookie },
  });
  assert.equal(back.statusCode, 302, back.body);
  const location = new URL(String(back.headers.location));
  return { location, ssoCode: location.searchParams.get('sso'), error: location.searchParams.get('sso_error') };
}

const exchange = (code: string) => app.inject({ method: 'POST', url: '/auth/sso/exchange', payload: { code } });

test('the provider list and the start redirect; unknown providers go back with an error', async () => {
  const list = (await app.inject({ method: 'GET', url: '/auth/sso/providers' })).json();
  assert.ok(list.some((p: { id: string }) => p.id === 'mock'));
  const r = await app.inject({ method: 'GET', url: '/auth/sso/nope/start' });
  assert.match(new URL(String(r.headers.location)).searchParams.get('sso_error')!, /not available/);
});

test('an existing user signs in by verified email, then by the linked subject; the one-time code works once', async () => {
  const o = await signInWith({ sub: 'sub-existing', email: u.existing.email.toUpperCase(), email_verified: true, name: 'Existing' });
  assert.equal(o.error, null);
  assert.ok(o.ssoCode);
  const ex = await exchange(o.ssoCode!);
  assert.equal(ex.statusCode, 200, ex.body);
  assert.equal(ex.json().user.email, u.existing.email);
  assert.equal((await call(app, { id: '', email: '', token: ex.json().token }, 'GET', '/auth/me')).statusCode, 200);
  assert.equal((await exchange(o.ssoCode!)).statusCode, 401); // used

  // Later sign-ins match the linked subject even if the email changed at the provider.
  const again = await signInWith({ sub: 'sub-existing', email: `renamed@${SSO_DOMAIN}`, email_verified: true });
  assert.equal((await exchange(again.ssoCode!)).json().user.email, u.existing.email);
});

test('nobody else gets in: unknown email, unverified email, wrong browser, wrong nonce, wrong PKCE verifier', async () => {
  const stranger = await signInWith({ sub: 'sub-stranger', email: 'someone@example.com', email_verified: true });
  assert.match(stranger.error!, /has no access to MAP Intel/);
  assert.match((await signInWith({ sub: 's2', email: u.existing.email, email_verified: false })).error!, /did not confirm/);
  assert.match((await signInWith({ sub: 's3', email: u.existing.email, email_verified: true }, { cookie: 'mi_sso=other' })).error!, /did not match this browser/);
  assert.match((await signInWith({ sub: 's4', email: u.existing.email, email_verified: true }, { nonce: 'forged' })).error!, /did not match this browser/);
  assert.match((await signInWith({ sub: 's5', email: u.existing.email, email_verified: true }, { verifierWrong: true })).error!, /refused the sign-in/);
});

test('an allowed email domain joins with the default role; public domains cannot be allowed', async () => {
  const bad = await call(app, u.admin, 'PATCH', `/accounts/${acct}/settings`, { settings: { ssoDomains: ['gmail.com'] } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /public email domains/);
  const ok = await call(app, u.admin, 'PATCH', `/accounts/${acct}/settings`, { settings: { ssoDomains: [SSO_DOMAIN.toUpperCase()], ssoDefaultRole: 'Analyst' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json().settings.ssoDomains, [SSO_DOMAIN]);

  const o = await signInWith({ sub: 'sub-new', email: `newcomer@${SSO_DOMAIN}`, email_verified: true, name: 'New Comer' });
  const ex = (await exchange(o.ssoCode!)).json();
  assert.equal(ex.user.name, 'New Comer');
  const me = (await call(app, { id: '', email: '', token: ex.token }, 'GET', '/auth/me')).json();
  assert.deepEqual(me.accounts.map((a: { id: string; role: string }) => [a.id, a.role]), [[acct, 'Analyst']]);
  const audit = await withSystem(async (db) => (await db.query("SELECT 1 FROM audit_event WHERE account_id = $1 AND action = 'member.sso_joined'", [acct])).rowCount);
  assert.equal(audit, 1);
  // No password works for an SSO-created user.
  assert.equal((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: `newcomer@${SSO_DOMAIN}`, password: 'anything-at-all-123' } })).statusCode, 401);
});

test('an invited person accepts the invite by signing in; MFA still applies after SSO', async () => {
  const email = `invited@${SSO_DOMAIN}`;
  await withSystem(async (db) => {
    const id = (await db.query<{ id: string }>("INSERT INTO app_user (email, full_name, password_hash, status) VALUES ($1, 'Invited Person', 'x', 'Invited') RETURNING id", [email])).rows[0].id;
    await db.query("INSERT INTO user_invite (account_id, user_id, role, token_hash, expires_at) VALUES ($1, $2, 'Brand user', $3, now() + interval '1 day')",
      [acct, id, `test-${Date.now()}`]);
  });
  const o = await signInWith({ sub: 'sub-invited', email, email_verified: true });
  const ex = (await exchange(o.ssoCode!)).json();
  const me = (await call(app, { id: '', email: '', token: ex.token }, 'GET', '/auth/me')).json();
  assert.equal(me.accounts.find((a: { id: string }) => a.id === acct).role, 'Brand user');

  // The account now requires MFA (set directly: the admin here has no MFA session): SSO leads to set-up.
  await withSystem((db) => db.query("UPDATE account SET settings = settings || '{\"mfa_required\": true}' WHERE id = $1", [acct]));
  const next = await signInWith({ sub: 'sub-invited', email, email_verified: true });
  const step = (await exchange(next.ssoCode!)).json();
  assert.equal(step.mfa, 'setup');
  assert.equal(step.token, undefined);
});
