// Password resets: links made by an administrator, used once within an hour, ending older
// sessions; "Forgot password?" opens one ticket for Mirethos and says nothing about the email.
//   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { closeRateLimiter, reset } from '../../src/lib/rateLimit.js';
import { TEST_EMAIL_DOMAIN, call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let acct: string;
let base: string;
const NEW_PASSWORD = 'a-brand-new-password-2026';

const cleanTickets = () => withSystem((db) => db.query('DELETE FROM ticket WHERE title LIKE $1', [`Password reset requested: %@${TEST_EMAIL_DOMAIN}`]));

before(async () => {
  await cleanTickets();
  acct = await createTestAccount('reset');
  base = `/accounts/${acct}`;
  u.admin = await createUser('rs-admin', 'Administrator', acct);
  u.member = await createUser('rs-member', 'Analyst', acct);
  u.brand = await createUser('rs-brand', 'Brand user', acct);
  u.platform = await createUser('rs-platform', 'admin');
  app = await testApp();
  for (const k of ['forgot:127.0.0.1', 'reset:127.0.0.1']) await reset(k);
});

after(async () => {
  await app.close();
  await cleanTickets();
  await removeTestAccounts();
  await removeTestUsers();
  for (const k of ['forgot:127.0.0.1', 'reset:127.0.0.1']) await reset(k);
  await closeQueue();
  await closeRateLimiter();
  await closeDb();
});

test('an administrator makes a one-hour link; it sets a new password once and ends older sessions', async () => {
  assert.equal((await call(app, u.brand, 'POST', `${base}/users/${u.member.id}/password-reset`)).statusCode, 403);
  const r = await call(app, u.admin, 'POST', `${base}/users/${u.member.id}/password-reset`);
  assert.equal(r.statusCode, 200, r.body);
  const token = new URL(r.json().resetUrl).searchParams.get('reset')!;
  assert.ok(token.length > 30);
  assert.ok(new Date(r.json().expiresAt).getTime() - Date.now() <= 3_600_000 + 5_000);

  assert.deepEqual((await call(app, null, 'GET', `/auth/reset/${token}`)).json(), { email: u.member.email, state: 'open' });
  assert.equal((await call(app, null, 'POST', '/auth/reset', { token, password: 'short' })).statusCode, 400);

  await new Promise((res) => setTimeout(res, 1100)); // the old session is issued in an earlier second
  const done = await call(app, null, 'POST', '/auth/reset', { token, password: NEW_PASSWORD });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal((await call(app, u.member, 'GET', '/auth/me')).statusCode, 401); // the old session is over
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.member.email, password: NEW_PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal((await call(app, { id: '', email: '', token: login.json().token }, 'GET', '/auth/me')).statusCode, 200);

  assert.equal((await call(app, null, 'POST', '/auth/reset', { token, password: NEW_PASSWORD })).statusCode, 410);
  assert.equal((await call(app, null, 'GET', `/auth/reset/${token}`)).json().state, 'used');
  const audit = await withSystem(async (db) => (await db.query("SELECT action FROM audit_event WHERE entity_id = $1 AND action IN ('member.password_reset_link', 'user.password_reset') ORDER BY seq", [u.member.id])).rows.map((x) => x.action));
  assert.deepEqual(audit, ['member.password_reset_link', 'user.password_reset']);
});

test('a newer link replaces an older one; only Mirethos resets an administrator of the platform', async () => {
  const first = new URL((await call(app, u.admin, 'POST', `${base}/users/${u.brand.id}/password-reset`)).json().resetUrl).searchParams.get('reset')!;
  await call(app, u.admin, 'POST', `${base}/users/${u.brand.id}/password-reset`);
  assert.equal((await call(app, null, 'GET', `/auth/reset/${first}`)).json().state, 'used');

  assert.equal((await call(app, u.admin, 'POST', `/users/${u.platform.id}/password-reset`)).statusCode, 403);
  const p = await call(app, u.platform, 'POST', `/users/${u.platform.id}/password-reset`);
  assert.equal(p.statusCode, 200, p.body);
  const found = (await call(app, u.platform, 'GET', `/users?email=${encodeURIComponent(u.brand.email)}`)).json();
  assert.equal(found[0].id, u.brand.id);
});

test('Forgot password: the same answer for anyone; one ticket a day for a real user', async () => {
  const unknown = await call(app, null, 'POST', '/auth/forgot', { email: `nobody@${TEST_EMAIL_DOMAIN}` });
  const known = await call(app, null, 'POST', '/auth/forgot', { email: u.admin.email.toUpperCase() });
  assert.deepEqual([unknown.statusCode, known.statusCode], [200, 200]);
  assert.deepEqual(unknown.json(), known.json());
  await call(app, null, 'POST', '/auth/forgot', { email: u.admin.email });
  const tickets = await withSystem(async (db) => (await db.query<{ title: string; priority: string; account_id: string }>(
    'SELECT title, priority, account_id FROM ticket WHERE title LIKE $1', [`Password reset requested: %@${TEST_EMAIL_DOMAIN}`])).rows);
  assert.deepEqual(tickets, [{ title: `Password reset requested: ${u.admin.email}`, priority: 'High', account_id: acct }]);
});
