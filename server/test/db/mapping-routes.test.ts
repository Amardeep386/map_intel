// Mapping Center routes: listing import (dry run, commit), queue with signals, decisions with
// reason + scope -> suppression, rules, summary, roles and audit. Throwaway account; the test
// listings and sellers are removed afterwards.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { accountIds, call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let base: string;
let lg: string;
const u: Record<string, TestUser> = {};

const cleanup = () =>
  withSystem(async (db) => {
    await db.query(`DELETE FROM listing WHERE url LIKE '%mi-routes-test%'`);
    await db.query("DELETE FROM seller WHERE name ILIKE 'ZZ Route%'");
  });

const csv = (rows: string[]) => ({ fileName: 'candidates.csv', content: Buffer.from(rows.join('\n')).toString('base64') });

before(async () => {
  await removeTestAccounts();
  await cleanup();
  lg = (await accountIds()).lg;
  const acct = await createTestAccount('mapping-routes');
  base = `/accounts/${acct}`;
  u.analyst = await createUser('mr-analyst', 'Analyst', acct);
  u.brand = await createUser('mr-brand', 'Brand user', acct);
  app = await testApp();
  await call(app, u.analyst, 'POST', `${base}/products`, { code: 'MR-1', name: 'RouteBrand 65" Q7 OLED TV', model: 'Q7OLED65', asin: 'B0ZZROUTE1', msrp: 1500 });
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await cleanup();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const FILE = csv([
  'URL,Title,Price,Seller,Condition',
  'https://www.amazon.com/dp/B0ZZROUTE1?mi-routes-test=1,RouteBrand 65" Q7 OLED TV,1499,ZZ Route Seller A,New',
  'https://www.walmart.com/ip/mi-routes-test-2,RouteBrand 65 inch Q7 OLED television,1350,ZZ Route Seller B,',
  'https://www.walmart.com/ip/mi-routes-test-3,RouteBrand 65 inch Q7 OLED television,1320,ZZ Route Seller B,',
  'https://www.walmart.com/ip/mi-routes-test-4,RouteBrand Q7 OLED 65" (Renewed),999,ZZ Route Seller C,Refurbished',
  'https://unknown.example/mi-routes-test-5,Something,10,Someone,',
  'not-a-url,x,1,y,',
]);

test('listing import: the dry run checks rows and infers the source; commit stages them through the matcher', async () => {
  const dry = await call(app, u.analyst, 'POST', `${base}/mapping/import`, { ...FILE, dryRun: true });
  assert.equal(dry.statusCode, 200, dry.body);
  assert.deepEqual(dry.json().summary, { newListings: 4, alreadyKnown: 0, errors: 2 });
  assert.equal(dry.json().changes[0].sourceCode, 'amazon_us');
  const commit = await call(app, u.analyst, 'POST', `${base}/mapping/import`, { ...FILE, dryRun: false });
  assert.equal(commit.statusCode, 200, commit.body);
  assert.deepEqual(commit.json().outcome, { Included: 1, Excluded: 1, Staged: 2, Retired: 0 });
  assert.equal((await call(app, u.brand, 'POST', `${base}/mapping/import`, { ...FILE, dryRun: true })).statusCode, 403);
});

test('the queue lists staged listings with six signals and the proposed product', async () => {
  const q = (await call(app, u.analyst, 'GET', `${base}/mapping/queue`)).json();
  assert.equal(q.total, 2);
  assert.equal(q.items[0].signals.length, 6);
  assert.equal(q.items[0].proposed.code, 'MR-1');
  assert.ok(q.items[0].priority >= q.items[1].priority);
  const summary = (await call(app, u.analyst, 'GET', `${base}/mapping/summary`)).json();
  assert.deepEqual(summary.states, { Staged: 2, Included: 1, Excluded: 1, Retired: 0 });
  assert.equal(summary.thresholds.include, 90);
  assert.equal((await call(app, u.brand, 'GET', `${base}/mapping/queue`)).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'GET', `/accounts/${lg}/mapping/queue`)).statusCode, 403);
});

test('excluding with seller + product scope creates a suppression that takes the other listing too', async () => {
  const q = (await call(app, u.analyst, 'GET', `${base}/mapping/queue`)).json();
  const first = q.items[0].id;
  const noReason = await call(app, u.analyst, 'POST', `${base}/mapping/decisions`, { listingIds: [first], action: 'exclude' });
  assert.equal(noReason.statusCode, 400);
  const res = await call(app, u.analyst, 'POST', `${base}/mapping/decisions`, { listingIds: [first], action: 'exclude', reason: 'Out of region', scope: 'seller_product' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().suppression.code, 'SUP-001');
  assert.equal(res.json().suppression.alsoExcluded, 1);
  assert.equal((await call(app, u.analyst, 'GET', `${base}/mapping/queue`)).json().total, 0);

  const sups = (await call(app, u.analyst, 'GET', `${base}/mapping/suppressions`)).json();
  assert.equal(sups[0].rule, 'ZZ Route Seller B × MR-1');
  assert.equal(sups[0].hits, 2);
  const detail = (await call(app, u.analyst, 'GET', `${base}/mapping/listings/${first}`)).json();
  assert.equal(detail.history[0].is_label, true);
  assert.equal(detail.history[0].reason, 'Out of region');
  const { events } = (await call(app, u.analyst, 'GET', `${base}/audit?entity=listing`)).json();
  assert.match(events[0].summary, /Excluded 1 listing \(Out of region, Seller \+ product\) → suppression SUP-001, 1 more excluded/);

  assert.equal((await call(app, u.analyst, 'POST', `${base}/mapping/suppressions/${sups[0].id}/revoke`)).statusCode, 200);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/mapping/suppressions/${sups[0].id}/revoke`)).statusCode, 404);
});

test('listings per state, restore and include as another SKU; rules can be switched off', async () => {
  const excluded = (await call(app, u.analyst, 'GET', `${base}/mapping/listings?state=excluded`)).json();
  assert.equal(excluded.total, 3);
  const renewed = excluded.items.find((i: { title: string }) => /Renewed/.test(i.title));
  assert.equal(renewed.rule_code, 'EXC-CONDITION');
  const other = (await call(app, u.analyst, 'POST', `${base}/products`, { code: 'MR-2', name: 'RouteBrand 65" Q7 OLED TV (Renewed programme)', model: 'Q7OLED65R' })).json();
  await call(app, u.analyst, 'POST', `${base}/mapping/decisions`, { listingIds: [renewed.id], action: 'restore' });
  const inc = await call(app, u.analyst, 'POST', `${base}/mapping/decisions`, { listingIds: [renewed.id], action: 'include', productId: other.id });
  assert.equal(inc.statusCode, 200, inc.body);
  const included = (await call(app, u.analyst, 'GET', `${base}/mapping/listings?state=Included&q=Renewed`)).json();
  assert.equal(included.items[0].product_code, 'MR-2');
  assert.equal(included.items[0].decided_label, u.analyst.email);

  const rules = (await call(app, u.analyst, 'GET', `${base}/mapping/rules`)).json();
  assert.equal(rules.length, 6);
  const cond = rules.find((r: { code: string }) => r.code === 'EXC-CONDITION');
  assert.ok(cond.hits >= 1);
  assert.equal((await call(app, u.analyst, 'PATCH', `${base}/mapping/rules/${cond.id}`, { active: false })).statusCode, 200);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/mapping/apply-rules`)).statusCode, 200);
});
