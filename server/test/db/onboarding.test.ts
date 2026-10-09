// Guided onboarding through the API: create an account, steps follow the real configuration,
// go-live only when ready, baseline crawl fired once by the scheduler.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { fireBaselines } from '../../src/scheduler/tick.js';
import { TEST_ACCOUNT_PREFIX, call, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let id: string;
let base: string;

const doneSteps = (s: { steps: { key: string; done: boolean }[] }) => s.steps.filter((x) => x.done).map((x) => x.key);

before(async () => {
  u.platform = await createUser('ob-platform', 'admin');
  u.member = await createUser('ob-member', 'member');
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('only platform administrators create accounts; input is validated', async () => {
  const body = { name: 'Onboarding Test Co', brand: 'TestBrand', slug: `${TEST_ACCOUNT_PREFIX}-onboarding` };
  assert.equal((await call(app, u.member, 'POST', '/accounts', body)).statusCode, 403);
  assert.equal((await call(app, null, 'POST', '/accounts', body)).statusCode, 401);
  assert.equal((await call(app, u.platform, 'POST', '/accounts', { ...body, timezone: 'Mars/Base' })).statusCode, 400);
  assert.equal((await call(app, u.platform, 'POST', '/accounts', { ...body, slug: 'Bad Slug' })).statusCode, 400);

  const res = await call(app, u.platform, 'POST', '/accounts', { ...body, regions: ['US', 'CA'], accentLight: '#a50034' });
  assert.equal(res.statusCode, 201, res.body);
  const s = res.json();
  id = s.id;
  base = `/accounts/${id}`;
  assert.equal(s.status, 'Onboarding');
  assert.equal(s.guided, true);
  assert.equal(s.currentStep, 'account');
  assert.equal(s.ready, false);
  // Default rules come from the account triggers, so only the rules step is done.
  assert.deepEqual(doneSteps(s), ['rules']);

  assert.equal((await call(app, u.platform, 'POST', '/accounts', body)).statusCode, 409);

  const audit = await withSystem(async (db) => (await db.query("SELECT action FROM audit_event WHERE account_id = $1 AND action = 'account.created'", [id])).rowCount);
  assert.equal(audit, 1);
});

test('the step position is saved; go-live is refused until every required check passes', async () => {
  const s = (await call(app, u.platform, 'PATCH', `${base}/onboarding`, { currentStep: 'catalogue' })).json();
  assert.equal(s.currentStep, 'catalogue');
  assert.equal((await call(app, u.platform, 'PATCH', `${base}/onboarding`, { currentStep: 'nope' })).statusCode, 400);
  assert.equal((await call(app, u.member, 'GET', `${base}/onboarding`)).statusCode, 403);

  const res = await call(app, u.platform, 'POST', `${base}/onboarding/go-live`);
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /Catalogue: Products imported/);
});

test('steps follow the configuration; go-live makes the account Active; the baseline crawl fires once', async () => {
  await withSystem(async (db) => {
    await db.query("INSERT INTO account_membership (account_id, user_id, role) VALUES ($1, $2, 'Administrator')", [id, u.member.id]);
    const product = (await db.query<{ id: string }>("INSERT INTO product (account_id, product_code, name, brand) VALUES ($1, 'OB-1', 'Onboarding widget', 'TestBrand') RETURNING id", [id])).rows[0].id;
    await db.query("INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, 'MPN', 'OB-1')", [id, product]);
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 99, now() - interval '1 day')", [id, product]);
    const source = (await db.query<{ id: string }>("SELECT id FROM source WHERE code = 'walmart_us'")).rows[0].id;
    const seller = (await db.query<{ id: string }>('INSERT INTO seller (source_id, name, name_key) VALUES ($1, $2, $3) RETURNING id', [source, 'OB Authorised', `ob authorised ${Date.now()}`])).rows[0].id;
    await db.query("INSERT INTO seller_classification (account_id, seller_id, class) VALUES ($1, $2, 'MAP Authorised')", [id, seller]);
    await db.query('INSERT INTO account_source (account_id, source_id) VALUES ($1, $2)', [id, source]);
    const group = (await db.query<{ id: string }>("INSERT INTO term_group (account_id, name) VALUES ($1, 'Brand SKUs') RETURNING id", [id])).rows[0].id;
    await db.query("INSERT INTO term (account_id, group_id, type, value) VALUES ($1, $2, 'url', 'https://www.walmart.com/browse/electronics/onboarding-widgets/3944_1')", [id, group]);
    await db.query("INSERT INTO term_group_subscription (account_id, group_id, source_category, mode) VALUES ($1, $2, 'Marketplace', 'All')", [id, group]);
    await db.query("INSERT INTO schedule (account_id, name, cadence) VALUES ($1, 'Daily', '0 6 * * *')", [id]);
    const template = (await db.query<{ id: string }>('SELECT id FROM report_template ORDER BY code LIMIT 1')).rows[0].id;
    await db.query("INSERT INTO report_definition (account_id, name, template_id, cadence) VALUES ($1, 'Weekly MAP', $2, '0 8 * * 1')", [id, template]);
  });

  const s = (await call(app, u.member, 'GET', `${base}/onboarding`)).json();
  assert.deepEqual(doneSteps(s), ['account', 'catalogue', 'map', 'sellers', 'sources', 'rules', 'reports']);
  assert.equal(s.ready, true);

  // Nothing fires before go-live.
  assert.equal((await fireBaselines(new Date(), { enqueue: false })).filter((r) => r.accountId === id).length, 0);

  const live = await call(app, u.member, 'POST', `${base}/onboarding/go-live`);
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.json().status, 'Active');
  assert.ok(live.json().baseline.requestedAt);
  assert.equal((await call(app, u.member, 'POST', `${base}/onboarding/go-live`)).statusCode, 409);

  const fired = (await fireBaselines(new Date(), { enqueue: false })).filter((r) => r.accountId === id);
  assert.equal(fired.length, 1);
  assert.equal((await fireBaselines(new Date(), { enqueue: false })).filter((r) => r.accountId === id).length, 0);
  const after = (await call(app, u.member, 'GET', `${base}/onboarding`)).json();
  assert.ok(after.baseline.firedAt);
  assert.deepEqual(after.baseline.runs.map((r: { id: string }) => r.id), [fired[0].crawlRunId]);

  // Once live, the go-live facts cannot be rewritten.
  await withSystem(async (db) => {
    await assert.rejects(db.query('UPDATE account_onboarding SET went_live_at = now() WHERE account_id = $1', [id]), /already went live/);
  });
});
