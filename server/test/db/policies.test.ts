// MAP Policies: manual MAP versions, the account-wide MAP history, promotion windows and
// versioned policy documents (stored in S3 with their hash). Throwaway account.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { sha256Hex } from '../../src/lib/storage.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let base: string;
let productId: string;
const u: Record<string, TestUser> = {};

before(async () => {
  await removeTestAccounts();
  const acct = await createTestAccount('policies');
  base = `/accounts/${acct}`;
  u.analyst = await createUser('pol-analyst', 'Analyst', acct);
  u.brand = await createUser('pol-brand', 'Brand user', acct);
  app = await testApp();
  productId = (await call(app, u.analyst, 'POST', `${base}/products`, { code: 'POL-1', name: 'Policy TV', model: 'PTV1', msrp: 999 })).json().id;
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('manual MAP versions: the second closes the first; the history lists both', async () => {
  const first = await call(app, u.analyst, 'POST', `${base}/products/${productId}/map`, { amount: 899, from: '2026-01-01' });
  assert.equal(first.statusCode, 201, first.body);
  const second = await call(app, u.analyst, 'POST', `${base}/products/${productId}/map`, { amount: 849, from: '2026-09-01', note: 'Fall pricing' });
  assert.equal(second.statusCode, 201, second.body);
  assert.equal(second.json().closed, first.json().id);
  const back = await call(app, u.analyst, 'POST', `${base}/products/${productId}/map`, { amount: 800, from: '2026-02-01' });
  assert.equal(back.statusCode, 409);
  const same = await call(app, u.analyst, 'POST', `${base}/products/${productId}/map`, { amount: 849, from: '2026-10-01' });
  assert.equal(same.statusCode, 409);

  const history = (await call(app, u.analyst, 'GET', `${base}/map-prices`)).json();
  assert.deepEqual(history.map((m: { version: number; amount: number; status: string }) => [m.version, m.amount, m.status]), [
    [2, 849, 'In force'],
    [1, 899, 'Superseded'],
  ]);
  assert.equal(history[0].sourceLabel, 'Manual');
  assert.equal((await call(app, u.brand, 'GET', `${base}/map-prices`)).statusCode, 200);
  assert.equal((await call(app, u.brand, 'POST', `${base}/products/${productId}/map`, { amount: 1, from: '2027-01-01' })).statusCode, 403);
});

test('promotion windows: created with products, listed with the standard MAP, cancelled', async () => {
  const bad = await call(app, u.analyst, 'POST', `${base}/promos`, { name: 'x', from: '2026-11-27', to: '2026-11-20', products: [{ productId, promoAmount: 799 }] });
  assert.equal(bad.statusCode, 400);
  const res = await call(app, u.analyst, 'POST', `${base}/promos`, {
    name: 'Black Friday', from: '2026-11-27', to: '2026-12-01', products: [{ productId, promoAmount: 799 }],
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().code, 'PW-001');
  let promos = (await call(app, u.analyst, 'GET', `${base}/promos`)).json();
  assert.equal(promos[0].status, 'Scheduled');
  assert.equal(promos[0].appliesTo, 'All sellers');
  assert.equal(promos[0].products[0].standard, 849);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/promos/${res.json().id}/cancel`)).statusCode, 200);
  promos = (await call(app, u.analyst, 'GET', `${base}/promos`)).json();
  assert.equal(promos[0].status, 'Cancelled');
});

test('policy documents: stored with their SHA-256, versioned by name, downloadable', async () => {
  const text = 'Test MAP policy v1';
  const upload = (effectiveFrom: string, body: string) =>
    call(app, u.analyst, 'POST', `${base}/policies`, {
      name: 'Test MAP Policy', effectiveFrom, fileName: 'policy.txt', contentType: 'text/plain', content: Buffer.from(body).toString('base64'),
    });
  const v1 = await upload('2026-01-01', text);
  assert.equal(v1.statusCode, 201, v1.body);
  assert.equal(v1.json().sha256, sha256Hex(text));
  assert.equal((await upload('2025-12-01', 'older')).statusCode, 409);
  assert.equal((await upload('2026-06-01', 'Test MAP policy v2')).json().version, 2);
  const docs = (await call(app, u.analyst, 'GET', `${base}/policies`)).json();
  assert.deepEqual(docs.map((d: { version: number; status: string }) => [d.version, d.status]), [[2, 'In force'], [1, 'Superseded']]);
  const dl = (await call(app, u.brand, 'GET', `${base}/policies/${docs[0].id}/download`)).json();
  assert.match(dl.url, /^https?:\/\//);
  const bad = await call(app, u.analyst, 'POST', `${base}/policies`, { name: 'x', effectiveFrom: '2026-01-01', fileName: 'a.exe', contentType: 'application/x-msdownload', content: 'AA==' });
  assert.equal(bad.statusCode, 400);
});
