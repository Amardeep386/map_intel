// Role checks on real routes, as the API role against the real database.   npm run test:db
// A 400 means the permission check passed and body validation ran; 403 means refused.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { buildApp } from '../../src/api/app.js';
import { closeDb } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { accountIds, call, createUser, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let ids: Record<string, string>;
const u: Record<string, TestUser> = {};

before(async () => {
  ids = await accountIds();
  u.admin = await createUser('admin', 'admin');
  u.manager = await createUser('manager', 'Account manager', ids.lg);
  u.analyst = await createUser('analyst', 'Analyst', ids.lg);
  u.brand = await createUser('brand', 'Brand user', ids.lg);
  u.outsider = await createUser('outsider', 'Analyst', ids.apple);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('a route without a declared permission cannot be registered', async () => {
  const extra = await buildApp();
  try {
    assert.throws(() => extra.get('/no-permission', async () => 'x'), /has no permission/);
  } finally {
    await extra.close();
  }
});

test('signed-out callers get 401 on everything but public routes', async () => {
  assert.equal((await call(app, null, 'GET', '/health')).statusCode, 200);
  assert.equal((await call(app, null, 'GET', '/accounts')).statusCode, 401);
  assert.equal((await call(app, null, 'GET', `/accounts/${ids.lg}/products`)).statusCode, 401);
  assert.equal((await call(app, null, 'GET', '/auth/me')).statusCode, 401);
});

test('Brand user: reads own catalogue, cannot add SKUs, sees no other account', async () => {
  assert.equal((await call(app, u.brand, 'GET', `/accounts/${ids.lg}/products`)).statusCode, 200);
  assert.equal((await call(app, u.brand, 'GET', `/accounts/${ids.lg}/observations?limit=1`)).statusCode, 200);
  assert.equal((await call(app, u.brand, 'POST', `/accounts/${ids.lg}/products`, {})).statusCode, 403);
  assert.equal((await call(app, u.brand, 'GET', `/accounts/${ids.apple}/products`)).statusCode, 403);
  const accounts = (await call(app, u.brand, 'GET', '/accounts')).json();
  assert.deepEqual(
    accounts.map((a: { slug: string }) => a.slug),
    ['lg'],
  );
});

test('Analyst and Account manager pass the catalogue.write check', async () => {
  assert.equal((await call(app, u.analyst, 'POST', `/accounts/${ids.lg}/products`, {})).statusCode, 400);
  assert.equal((await call(app, u.manager, 'POST', `/accounts/${ids.lg}/products`, {})).statusCode, 400);
});

test('a member of another account gets 403; an unknown account gets 404', async () => {
  assert.equal((await call(app, u.outsider, 'GET', `/accounts/${ids.lg}/products`)).statusCode, 403);
  assert.equal((await call(app, u.admin, 'GET', '/accounts/00000000-0000-0000-0000-000000000000/products')).statusCode, 404);
  assert.equal((await call(app, u.brand, 'GET', '/accounts/not-a-uuid/products')).statusCode, 404);
});

test('platform routes are for Mirethos administrators only', async () => {
  assert.equal((await call(app, u.manager, 'GET', '/crawl-runs')).statusCode, 403);
  assert.equal((await call(app, u.admin, 'GET', '/crawl-runs')).statusCode, 200);
});

test('/auth/me lists accounts with the role and allowed actions', async () => {
  const me = (await call(app, u.brand, 'GET', '/auth/me')).json();
  assert.equal(me.accounts.length, 1);
  assert.equal(me.accounts[0].role, 'Brand user');
  assert.ok(me.accounts[0].actions.includes('catalogue.read'));
  assert.ok(!me.accounts[0].actions.includes('settings.write'));
  const admin = (await call(app, u.admin, 'GET', '/auth/me')).json();
  assert.ok(admin.accounts.length >= 3);
  assert.ok(admin.accounts.every((a: { role: string }) => a.role === 'Administrator'));
});
