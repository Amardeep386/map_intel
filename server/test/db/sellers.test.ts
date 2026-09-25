// Sellers: add, spellings merged, effective-dated classification, aliases, links, contacts,
// audit and roles. Throwaway account; test sellers are removed afterwards.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let base: string;
const u: Record<string, TestUser> = {};
let xyz: string;

const removeTestSellers = () => withSystem((db) => db.query("DELETE FROM seller WHERE name ILIKE 'ZZ Test%'"));

before(async () => {
  await removeTestAccounts();
  await removeTestSellers();
  const acct = await createTestAccount('sellers');
  base = `/accounts/${acct}`;
  u.analyst = await createUser('sel-analyst', 'Analyst', acct);
  u.brand = await createUser('sel-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await removeTestSellers();
  await closeQueue();
  await closeDb();
});

test('adding a seller; a second spelling of it is refused as already listed', async () => {
  const res = await call(app, u.analyst, 'POST', `${base}/sellers`, { source: 'amazon_us', name: 'ZZ Test XYZ Electronics, LLC' });
  assert.equal(res.statusCode, 201, res.body);
  xyz = res.json().id;
  const again = await call(app, u.analyst, 'POST', `${base}/sellers`, { source: 'amazon_us', name: 'Sold by zz test xyz electronics' });
  assert.equal(again.statusCode, 409);
  const list = (await call(app, u.analyst, 'GET', `${base}/sellers`)).json();
  assert.deepEqual(list.map((s: { name: string; classification: string }) => [s.name, s.classification]), [['ZZ Test XYZ Electronics, LLC', 'Unknown']]);
  assert.equal((await call(app, u.brand, 'GET', `${base}/sellers`)).statusCode, 403);
});

test('a classification change is a new record; the history keeps both', async () => {
  assert.equal((await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/classification`, { class: 'Unauthorised' })).statusCode, 400); // needs a note
  const res = await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/classification`, { class: 'Unauthorised', note: 'Not on the authorised list v9' });
  assert.equal(res.statusCode, 201, res.body);
  const same = await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/classification`, { class: 'Unauthorised', note: 'again' });
  assert.equal(same.statusCode, 409);
  const detail = (await call(app, u.analyst, 'GET', `${base}/sellers/${xyz}`)).json();
  assert.equal(detail.classification, 'Unauthorised');
  assert.deepEqual(detail.history.map((h: { class: string; to: string | null }) => [h.class, h.to === null]), [['Unauthorised', true], ['Unknown', false]]);
  assert.equal(detail.history[0].set_by, u.analyst.email);
  const { events } = (await call(app, u.analyst, 'GET', `${base}/audit?entity=seller`)).json();
  assert.ok(events.some((e: { action: string; before: { class: string } | null }) => e.action === 'seller.classified' && e.before?.class === 'Unknown'));
});

test('aliases, links and contacts', async () => {
  assert.equal((await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/aliases`, { alias: 'ZZ Test XYZ Elec' })).statusCode, 201);
  const tm = (await call(app, u.analyst, 'POST', `${base}/sellers`, { source: 'amazon_us', name: 'ZZ Test TechMart' })).json().id;
  assert.equal((await call(app, u.analyst, 'POST', `${base}/sellers/${tm}/aliases`, { alias: 'ZZ Test XYZ Elec' })).statusCode, 409);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/links`, { otherSellerId: tm, reason: 'Shared address', confidence: 62 })).statusCode, 201);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/sellers/${tm}/links`, { otherSellerId: xyz, reason: 'dup' })).statusCode, 409);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/contacts`, { kind: 'email', value: 'not-an-email' })).statusCode, 400);
  const c = await call(app, u.analyst, 'POST', `${base}/sellers/${xyz}/contacts`, { kind: 'email', value: 'legal@xyz.example', label: 'Notices' });
  assert.equal(c.statusCode, 201);
  let detail = (await call(app, u.analyst, 'GET', `${base}/sellers/${xyz}`)).json();
  assert.deepEqual(detail.aliases.map((a: { alias: string }) => a.alias), ['ZZ Test XYZ Elec']);
  assert.deepEqual(detail.links.map((l: { name: string; confidence: number }) => [l.name, l.confidence]), [['ZZ Test TechMart', 62]]);
  assert.equal(detail.contacts[0].value, 'legal@xyz.example');
  assert.equal((await call(app, u.analyst, 'DELETE', `${base}/sellers/${xyz}/contacts/${c.json().id}`)).statusCode, 204);
  detail = (await call(app, u.analyst, 'GET', `${base}/sellers/${xyz}`)).json();
  assert.equal(detail.contacts.length, 0);
  assert.equal((await call(app, u.brand, 'POST', `${base}/sellers/${xyz}/aliases`, { alias: 'x' })).statusCode, 403);
});
