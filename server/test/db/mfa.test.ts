// Multi-factor sign-in through the API: set-up, the second step, replay, recovery codes, accounts
// that require it, administrator reset, and the brake on guessing.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { stepAt, totp } from '../../src/lib/mfa.js';
import { closeQueue } from '../../src/lib/queue.js';
import { reset } from '../../src/lib/rateLimit.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

const PASSWORD = 'not-a-real-password-123';
let app: FastifyInstance;
const u: Record<string, TestUser> = {};
const secrets: Record<string, string> = {};
let acct: string;
let base: string;
// Each code is used once: walk forward through the allowed steps (now and now + 1).
const step = () => stepAt(new Date());

const login = (email: string) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
const post = (url: string, payload: unknown, token?: string) =>
  app.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers: token ? { authorization: `Bearer ${token}` } : {} });
const asToken = (token: string): TestUser => ({ id: '', email: '', token });

before(async () => {
  acct = await createTestAccount('mfa');
  base = `/accounts/${acct}`;
  u.admin = await createUser('mfa-admin', 'Administrator', acct);
  u.member = await createUser('mfa-member', 'Analyst', acct);
  for (const x of ['mfa-admin', 'mfa-member']) await reset(`mfa:${u[x === 'mfa-admin' ? 'admin' : 'member'].id}`);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('a signed-in user turns MFA on: wrong code refused, first right code confirms, ten recovery codes', async () => {
  const start = (await post('/auth/mfa/enrol', {}, u.admin.token)).json();
  assert.match(start.secret, /^[A-Z2-7]{32}$/);
  assert.match(start.uri, /^otpauth:\/\/totp\//);
  assert.match(start.qrSvg, /^<svg/);
  secrets.admin = start.secret;
  assert.equal((await post('/auth/mfa/enrol/confirm', { code: '000000' }, u.admin.token)).statusCode, 400);
  const ok = await post('/auth/mfa/enrol/confirm', { code: totp(secrets.admin, step()) }, u.admin.token);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().recoveryCodes.length, 10);
  secrets.adminRecovery = ok.json().recoveryCodes[0];
  u.adminMfa = asToken(ok.json().token);
  const me = (await call(app, u.adminMfa, 'GET', '/auth/me')).json();
  assert.deepEqual([me.mfa.enabled, me.mfa.session, me.mfa.recoveryCodesLeft], [true, true, 10]);
  assert.equal((await post('/auth/mfa/enrol', {}, u.admin.token)).statusCode, 409);
});

test('sign-in asks for the code; a challenge is not a session; a code works once; recovery codes work once', async () => {
  const first = (await login(u.admin.email)).json();
  assert.equal(first.mfa, 'code');
  assert.equal(first.token, undefined);
  assert.equal((await call(app, asToken(first.challenge), 'GET', '/auth/me')).statusCode, 401);

  // The step used to confirm set-up cannot be used again; a later one can (read from the database,
  // so a 30-second boundary between tests does not matter).
  const last = await withSystem(async (db) => Number((await db.query('SELECT mfa_last_step FROM app_user WHERE id = $1', [u.admin.id])).rows[0].mfa_last_step));
  assert.equal((await post('/auth/mfa/verify', { challenge: first.challenge, code: totp(secrets.admin, last) })).statusCode, 401);
  const ok = await post('/auth/mfa/verify', { challenge: first.challenge, code: totp(secrets.admin, Math.max(last + 1, step())) });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await call(app, asToken(ok.json().token), 'GET', '/auth/me')).json().mfa.session, true);

  const second = (await login(u.admin.email)).json();
  const rec = await post('/auth/mfa/verify', { challenge: second.challenge, code: secrets.adminRecovery.toLowerCase() });
  assert.equal(rec.statusCode, 200, rec.body);
  assert.equal(rec.json().usedRecoveryCode, true);
  const third = (await login(u.admin.email)).json();
  assert.equal((await post('/auth/mfa/verify', { challenge: third.challenge, code: secrets.adminRecovery })).statusCode, 401);
  await reset(`mfa:${u.admin.id}`);
});

test('an account that requires MFA: only from an MFA session; others are refused until they set it up at sign-in', async () => {
  // Switching it on from a session without MFA would shut the caller out: refused.
  assert.equal((await call(app, u.admin, 'PATCH', `${base}/settings`, { settings: { mfaRequired: true } })).statusCode, 409);
  const on = await call(app, u.adminMfa, 'PATCH', `${base}/settings`, { settings: { mfaRequired: true } });
  assert.equal(on.statusCode, 200, on.body);

  // The member's old session no longer opens the account.
  const refused = await call(app, u.member, 'GET', `${base}/settings`);
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().error, /requires multi-factor sign-in/);
  assert.equal((await call(app, u.admin, 'GET', `${base}/settings`)).statusCode, 403); // the admin's non-MFA session too

  // Signing in again leads straight into set-up.
  const l = (await login(u.member.email)).json();
  assert.equal(l.mfa, 'setup');
  assert.equal((await post('/auth/mfa/verify', { challenge: l.challenge, code: '123456' })).statusCode, 401); // wrong kind of challenge
  const start = (await post('/auth/mfa/setup', { challenge: l.challenge })).json();
  secrets.member = start.secret;
  const done = await post('/auth/mfa/setup/confirm', { challenge: l.challenge, code: totp(secrets.member, step()) });
  assert.equal(done.statusCode, 200, done.body);
  u.memberMfa = asToken(done.json().token);
  assert.equal((await call(app, u.memberMfa, 'GET', `${base}/settings`)).statusCode, 200);

  // Turning it off while the account requires it: refused.
  const off = await post('/auth/mfa/disable', { code: totp(secrets.member, step() + 1) }, u.memberMfa.token);
  assert.equal(off.statusCode, 409);
  assert.match(off.json().error, /required by Test mfa/);

  const users = (await call(app, u.adminMfa, 'GET', `${base}/users`)).json();
  assert.equal(users.members.find((m: { email: string }) => m.email === u.member.email).mfaEnabled, true);
});

test('an administrator resets a member who lost their phone; it is audited', async () => {
  assert.equal((await call(app, u.memberMfa, 'POST', `${base}/users/${u.admin.id}/mfa/reset`)).statusCode, 403); // an Analyst cannot
  const r = await call(app, u.adminMfa, 'POST', `${base}/users/${u.member.id}/mfa/reset`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await call(app, u.adminMfa, 'POST', `${base}/users/${u.member.id}/mfa/reset`)).statusCode, 409);
  const audit = await withSystem(async (db) => (await db.query("SELECT action FROM audit_event WHERE account_id = $1 AND action = 'member.mfa_reset'", [acct])).rowCount);
  assert.equal(audit, 1);
  assert.equal((await login(u.member.email)).json().mfa, 'setup');
});

test('guessing codes is braked after five tries', async () => {
  await call(app, u.adminMfa, 'PATCH', `${base}/settings`, { settings: { mfaRequired: false } });
  const l = (await login(u.admin.email)).json();
  for (let i = 0; i < 5; i++) assert.equal((await post('/auth/mfa/verify', { challenge: l.challenge, code: '000000' })).statusCode, 401);
  assert.equal((await post('/auth/mfa/verify', { challenge: l.challenge, code: totp(secrets.admin, step() + 1) })).statusCode, 429);
  await reset(`mfa:${u.admin.id}`);
});
