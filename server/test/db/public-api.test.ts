// The read-only public API, API keys and data exports.   npm run test:db
// Datasets with observations run in a rolled-back transaction as the tenant (observations are
// append-only); the routes run on a committed scratch account that has products only.
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { DATASETS } from '../../src/lib/datasets.js';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { closeRateLimiter, hit, reset } from '../../src/lib/rateLimit.js';
import { scratch, world } from './enforcement-world.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let acct: string;
let base: string;
let key: string;
let keyId: string;
const asKey = (k: string): TestUser => ({ id: '', email: '', token: k });

before(async () => {
  acct = await createTestAccount('public-api');
  base = `/accounts/${acct}`;
  u.admin = await createUser('pa-admin', 'Administrator', acct);
  u.brand = await createUser('pa-brand', 'Brand user', acct);
  await withSystem(async (db) => {
    for (const [code, name] of [['PA-1', 'Alpha TV'], ['PA-2', 'Beta TV'], ['PA-3', '=HYPERLINK("x")']]) {
      const p = (await db.query<{ id: string }>("INSERT INTO product (account_id, product_code, name, brand, category) VALUES ($1, $2, $3, 'TestBrand', 'TV') RETURNING id", [acct, code, name])).rows[0].id;
      await db.query("INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, 'UPC', $3)", [acct, p, `0000${code.slice(3)}`]);
    }
  });
  app = await testApp();
});

after(async () => {
  await app.close();
  if (keyId) await reset(`apikey:${keyId}`);
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeRateLimiter();
  await closeDb();
});

test('keys: created by an administrator, shown once, listed without the secret; Brand users cannot', async () => {
  assert.equal((await call(app, u.brand, 'POST', `${base}/api-keys`, { name: 'BI' })).statusCode, 403);
  const res = await call(app, u.admin, 'POST', `${base}/api-keys`, { name: 'Power BI', expiresInDays: 365 });
  assert.equal(res.statusCode, 201, res.body);
  key = res.json().key;
  keyId = res.json().id;
  assert.match(key, /^mik_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$/);
  const list = (await call(app, u.admin, 'GET', `${base}/api-keys`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].prefix, key.slice(4, 12));
  assert.ok(!JSON.stringify(list).includes(key));
});

test('the key reads its own account page by page; it is never a session, and a session cannot use /v1', async () => {
  const index = (await call(app, asKey(key), 'GET', '/v1')).json();
  assert.equal(index.account.name, 'Test public-api');
  assert.deepEqual(index.datasets.map((d: { id: string }) => d.id), ['products', 'violations', 'observations', 'sellers', 'cases']);

  const p1 = (await call(app, asKey(key), 'GET', '/v1/products?limit=2')).json();
  assert.deepEqual(p1.data.map((r: { product_code: string }) => r.product_code), ['PA-1', 'PA-2']);
  assert.equal(p1.data[0].upc, '00001');
  assert.ok(p1.next_cursor);
  const p2 = (await call(app, asKey(key), 'GET', `/v1/products?limit=2&cursor=${p1.next_cursor}`)).json();
  assert.deepEqual(p2.data.map((r: { product_code: string }) => r.product_code), ['PA-3']);
  assert.equal(p2.next_cursor, null);
  assert.equal((await call(app, asKey(key), 'GET', '/v1/products?cursor=nonsense')).statusCode, 400);

  assert.equal((await call(app, u.admin, 'GET', '/v1/products')).statusCode, 401);
  assert.equal((await call(app, asKey(key), 'GET', `${base}/settings`)).statusCode, 401);
  assert.equal((await call(app, asKey(`${key.slice(0, -1)}x`), 'GET', '/v1')).statusCode, 401);

  const log = (await call(app, u.admin, 'GET', `${base}/api-keys/${keyId}/log`)).json();
  assert.ok(log.length >= 4);
  assert.ok(log.some((l: { path: string; rows: number; status: number }) => l.path.startsWith('/v1/products?limit=2&cursor') && l.rows === 1 && l.status === 200));
});

test('120 calls a minute per key, then 429', async () => {
  for (let i = 0; i < 120; i++) await hit(`apikey:${keyId}`, { max: 120, windowSeconds: 60 });
  const r = await call(app, asKey(key), 'GET', '/v1');
  assert.equal(r.statusCode, 429);
  assert.equal(r.headers['retry-after'], '60');
  await reset(`apikey:${keyId}`);
});

test('a revoked key stops at once; creating and revoking are audited', async () => {
  assert.equal((await call(app, u.admin, 'DELETE', `${base}/api-keys/${keyId}`)).statusCode, 204);
  assert.equal((await call(app, asKey(key), 'GET', '/v1')).statusCode, 401);
  const actions = await withSystem(async (db) => (await db.query("SELECT action FROM audit_event WHERE account_id = $1 AND action LIKE 'api_key.%' ORDER BY seq", [acct])).rows.map((r) => r.action));
  assert.deepEqual(actions, ['api_key.created', 'api_key.revoked']);
});

test('exports: CSV (formula-safe, BOM) and XLSX; only datasets the role may read; audited', async () => {
  const csv = await call(app, u.admin, 'GET', `${base}/exports/products?format=csv`);
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers['content-disposition']), /products-\d{4}-\d{2}-\d{2}\.csv/);
  const lines = csv.body.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('Product code,Name,Brand'));
  assert.ok(lines[3].includes(`"'=HYPERLINK(""x"")"`)); // not a live formula

  const x = await app.inject({ method: 'GET', url: `${base}/exports/products?format=xlsx`, headers: { authorization: `Bearer ${u.admin.token}` } });
  assert.equal(x.statusCode, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.rawPayload);
  const ws = wb.worksheets[0];
  assert.equal(ws.name, 'Products');
  assert.equal(ws.rowCount, 4);
  assert.equal(ws.getRow(2).getCell(1).value, 'PA-1');

  assert.equal((await call(app, u.brand, 'GET', `${base}/exports/sellers`)).statusCode, 403);
  assert.equal((await call(app, u.brand, 'GET', `${base}/exports/products`)).statusCode, 200);
  assert.equal((await call(app, u.admin, 'GET', `${base}/exports/nope`)).statusCode, 404);
  const exported = await withSystem(async (db) => (await db.query("SELECT count(*)::int AS n FROM audit_event WHERE account_id = $1 AND action = 'data.exported'", [acct])).rows[0].n);
  assert.equal(exported, 3);
});

test('datasets with observations, violations, sellers and cases, as the tenant', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'public-api');
    await db.query('SET LOCAL ROLE mapintel_tenant');
    await db.query("SELECT set_config('app.account_id', $1, true), set_config('app.role', '', true)", [w.account]);
    const v = await DATASETS.violations.page(db, { limit: 3, status: 'active' });
    assert.equal(v.rows.length, 3);
    assert.ok(v.next);
    assert.deepEqual(Object.keys(v.rows[0]).sort(), DATASETS.violations.columns.map((c) => c.key).sort());
    const v2 = await DATASETS.violations.page(db, { limit: 3, status: 'active', after: v.next });
    assert.equal(v2.rows.length, 1);
    assert.equal(v2.next, null);
    const o = await DATASETS.observations.page(db, { limit: 10, from: new Date('2026-09-01T00:00:00Z') });
    assert.equal(o.rows.length, 4);
    assert.ok(o.rows.every((r) => r.outcome === 'violation' && r.price === 700 && r.map === 1000));
    const s = await DATASETS.sellers.page(db, { limit: 10 });
    assert.deepEqual(s.rows.map((r) => r.open_violations), [2, 2]);
    const c = await DATASETS.cases.page(db, { limit: 10 });
    assert.equal(c.rows.length, 0);
  });
});
