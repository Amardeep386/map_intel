// Account settings, invites, role changes and user status, through the API.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import {
  TEST_EMAIL_DOMAIN,
  accountIds,
  call,
  createTestAccount,
  createUser,
  removeTestAccounts,
  removeTestUsers,
  testApp,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let acct: string;
let base: string;
let inviteToken: string;
let invitedUserId: string;
const invitedEmail = `invitee@${TEST_EMAIL_DOMAIN}`;
const u: Record<string, TestUser> = {};

before(async () => {
  acct = await createTestAccount('users');
  base = `/accounts/${acct}`;
  u.platform = await createUser('us-platform', 'admin');
  u.admin = await createUser('us-admin', 'Administrator', acct);
  u.manager = await createUser('us-manager', 'Account manager', acct);
  u.analyst = await createUser('us-analyst', 'Analyst', acct);
  u.lgManager = await createUser('us-lg', 'Account manager', (await accountIds()).lg);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestUsers();
  await removeTestAccounts();
  await closeQueue();
  await closeDb();
});

test('settings: defaults, validation, audited change, budget feeds the matrix', async () => {
  const s = (await call(app, u.analyst, 'GET', `${base}/settings`)).json();
  assert.equal(s.settings.requestBudget, 3000);
  assert.equal(s.settings.matchInclude, 90);
  assert.equal((await call(app, u.analyst, 'PATCH', `${base}/settings`, { name: 'x' })).statusCode, 403);
  assert.equal((await call(app, u.manager, 'PATCH', `${base}/settings`, { settings: { matchReview: 95 } })).statusCode, 400);
  assert.equal((await call(app, u.manager, 'PATCH', `${base}/settings`, { timezone: 'Mars/Base' })).statusCode, 400);
  assert.equal((await call(app, u.manager, 'PATCH', `${base}/settings`, { contractFrom: '2026-10-01', contractTo: '2026-01-01' })).statusCode, 400);

  const res = await call(app, u.manager, 'PATCH', `${base}/settings`, {
    name: 'Test Users Co',
    regions: ['US', 'CA'],
    seats: 8,
    settings: { requestBudget: 5000, mapTolerancePct: 1.5 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().seats, 8);
  assert.deepEqual(res.json().regions, ['US', 'CA']);
  assert.equal((await call(app, u.analyst, 'GET', `${base}/matrix`)).json().budget, 5000);
  const { events } = (await call(app, u.manager, 'GET', `${base}/audit?entity=account`)).json();
  assert.equal(events[0].action, 'settings.updated');
  assert.equal(events[0].before.settings.requestBudget, 3000);
  assert.equal(events[0].after.settings.requestBudget, 5000);
});

test('invite: Account managers cannot grant Administrator; the link is single-use and sets a password', async () => {
  assert.equal(
    (await call(app, u.manager, 'POST', `${base}/users/invite`, { email: `x@${TEST_EMAIL_DOMAIN}`, name: 'X', role: 'Administrator' })).statusCode,
    403,
  );
  assert.equal((await call(app, u.analyst, 'POST', `${base}/users/invite`, { email: invitedEmail, name: 'Invitee', role: 'Analyst' })).statusCode, 403);

  const inv = await call(app, u.manager, 'POST', `${base}/users/invite`, { email: invitedEmail, name: 'Invitee', role: 'Analyst' });
  assert.equal(inv.statusCode, 201);
  assert.equal(inv.json().status, 'invited');
  inviteToken = new URL(inv.json().inviteUrl).searchParams.get('invite')!;
  invitedUserId = inv.json().userId;

  const users = (await call(app, u.manager, 'GET', `${base}/users`)).json();
  assert.equal(users.invites.length, 1);
  assert.ok(!users.grantableRoles.includes('Administrator'));

  // An invited user cannot sign in before accepting.
  assert.equal((await call(app, null, 'POST', '/auth/login', { email: invitedEmail, password: 'anything-long-enough' })).statusCode, 401);
  const info = (await call(app, null, 'GET', `/auth/invite/${inviteToken}`)).json();
  assert.deepEqual([info.email, info.role, info.state], [invitedEmail, 'Analyst', 'open']);
  assert.equal((await call(app, null, 'POST', '/auth/accept-invite', { token: inviteToken, password: 'short' })).statusCode, 400);

  const accepted = await call(app, null, 'POST', '/auth/accept-invite', { token: inviteToken, password: 'a-good-long-password-42', name: 'Ivy Invitee' });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().accountId, acct);
  assert.equal((await call(app, null, 'POST', '/auth/accept-invite', { token: inviteToken, password: 'a-good-long-password-42' })).statusCode, 410);
  assert.equal((await call(app, null, 'GET', '/auth/invite/not-a-real-token-at-all-xxxxxx')).statusCode, 404);

  const login = await call(app, null, 'POST', '/auth/login', { email: invitedEmail, password: 'a-good-long-password-42' });
  assert.equal(login.statusCode, 200);
  const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${login.json().token}` } })).json();
  assert.deepEqual(me.accounts.map((a: { role: string }) => a.role), ['Analyst']);
  assert.equal(me.name, 'Ivy Invitee');
});

test('inviting someone who already has an account adds them directly', async () => {
  const other = await createUser('us-existing', 'Analyst', (await accountIds()).apple);
  const res = await call(app, u.manager, 'POST', `${base}/users/invite`, { email: other.email, name: 'Existing', role: 'Brand user' });
  assert.equal(res.json().status, 'added');
  assert.equal((await call(app, u.manager, 'POST', `${base}/users/invite`, { email: other.email, name: 'Existing', role: 'Brand user' })).statusCode, 409);
});

test('roles: Account managers cannot touch Administrators; the last Administrator stays', async () => {
  assert.equal((await call(app, u.manager, 'PATCH', `${base}/users/${invitedUserId}`, { role: 'Brand user' })).json().role, 'Brand user');
  assert.equal((await call(app, u.manager, 'PATCH', `${base}/users/${invitedUserId}`, { role: 'Administrator' })).statusCode, 403);
  assert.equal((await call(app, u.manager, 'DELETE', `${base}/users/${u.admin.id}`)).statusCode, 403);
  assert.equal((await call(app, u.platform, 'PATCH', `${base}/users/${u.admin.id}`, { role: 'Analyst' })).statusCode, 409);
  assert.equal((await call(app, u.admin, 'DELETE', `${base}/users/${u.admin.id}`)).statusCode, 409);
});

test('removing a member takes away access at once', async () => {
  assert.equal((await call(app, u.manager, 'DELETE', `${base}/users/${u.analyst.id}`)).statusCode, 204);
  assert.equal((await call(app, u.analyst, 'GET', `${base}/settings`)).statusCode, 403);
  const actions = (await call(app, u.manager, 'GET', `${base}/audit?entity=app_user`)).json().events.map((e: { action: string }) => e.action);
  for (const a of ['invite.accepted', 'member.added', 'member.role_changed', 'member.removed']) assert.ok(actions.includes(a), a);
});

test('a disabled user is signed out on the next request; only platform admins can disable', async () => {
  assert.equal((await call(app, u.manager, 'PATCH', `/users/${u.manager.id}`, { status: 'Disabled' })).statusCode, 403);
  assert.equal((await call(app, u.platform, 'PATCH', `/users/${u.manager.id}`, { status: 'Disabled' })).statusCode, 200);
  assert.equal((await call(app, u.manager, 'GET', `${base}/settings`)).statusCode, 401);
  assert.equal((await call(app, u.platform, 'PATCH', `/users/${u.manager.id}`, { status: 'Active' })).statusCode, 200);
  assert.equal((await call(app, u.manager, 'GET', `${base}/settings`)).statusCode, 200);
  assert.equal((await call(app, u.lgManager, 'GET', `${base}/users`)).statusCode, 403);
});
