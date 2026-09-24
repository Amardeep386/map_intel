// Sources, subscriptions, terms (generate + import), matrix and schedules through the API, on a
// throwaway account.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { accountIds, call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
let base: string;
let lgId: string;
let groupId: string;
const u: Record<string, TestUser> = {};

before(async () => {
  acct = await createTestAccount('config');
  base = `/accounts/${acct}`;
  lgId = (await accountIds()).lg;
  await withSystem(async (db) => {
    for (const [code, name, model, cat] of [
      ['TST-1', 'TestBrand 55" OLED TV', 'TB55OLED', 'TV'],
      ['TST-2', 'TestBrand 65" OLED TV', 'TB65OLED', 'TV'],
      ['TST-3', 'Soundbar X', 'TBSBX', 'Audio'],
    ]) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO product (account_id, product_code, name, brand, category, model_number) VALUES ($1, $2, $3, 'TestBrand', $4, $5) RETURNING id`,
        [acct, code, name, cat, model],
      );
      await db.query(`INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, 'MPN', $3)`, [acct, rows[0].id, model]);
    }
  });
  u.manager = await createUser('cfg-manager', 'Account manager', acct);
  u.analyst = await createUser('cfg-analyst', 'Analyst', acct);
  u.brand = await createUser('cfg-brand', 'Brand user', acct);
  u.lgManager = await createUser('cfg-lg', 'Account manager', lgId);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestUsers();
  await removeTestAccounts();
  await closeQueue();
  await closeDb();
});

test('catalogue lists all 7 sources with collector-declared options', async () => {
  const sources = (await call(app, u.brand, 'GET', '/sources')).json();
  assert.equal(sources.length, 7);
  const amazon = sources.find((s: { code: string }) => s.code === 'amazon_us');
  assert.equal(amazon.collectorStatus, 'live');
  assert.ok(amazon.options.some((o: { key: string }) => o.key === 'buy_box_only'));
  assert.equal(sources.find((s: { code: string }) => s.code === 'ebay_us').collectorStatus, 'planned');
  assert.equal((await call(app, u.manager, 'POST', '/sources', {})).statusCode, 403);
});

test('subscribe with options; bad options and Analysts are refused', async () => {
  const res = await call(app, u.manager, 'PUT', `${base}/subscriptions/amazon_us`, { active: true, options: { search_pages: 3 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().source.subscription.values.search_pages, 3);
  assert.equal(res.json().source.subscription.values.buy_box_only, true);
  for (const code of ['walmart_us', 'ebay_us', 'bestbuy_us']) {
    assert.equal((await call(app, u.manager, 'PUT', `${base}/subscriptions/${code}`, { active: true })).statusCode, 200);
  }
  assert.equal((await call(app, u.manager, 'PUT', `${base}/subscriptions/amazon_us`, { active: true, options: { search_pages: 99 } })).statusCode, 400);
  assert.equal((await call(app, u.manager, 'PUT', `${base}/subscriptions/nope`, { active: true })).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'PUT', `${base}/subscriptions/walmart_us`, { active: false })).statusCode, 403);
  const subs = (await call(app, u.analyst, 'GET', `${base}/subscriptions`)).json();
  assert.equal(subs.sources.filter((s: { subscription: unknown }) => s.subscription).length, 4);
});

test('generate from catalogue: dry run changes nothing, commit creates, a re-run skips duplicates', async () => {
  const body = { group: 'F26: Brand + Model', template: '{Brand} {Model}', identifierTypes: ['MPN'] };
  const dry = (await call(app, u.analyst, 'POST', `${base}/terms/generate`, { ...body, dryRun: true })).json();
  assert.equal(dry.dryRun, true);
  assert.equal(dry.toCreate, 6); // 3 keyword + 3 MPN
  assert.equal((await call(app, u.analyst, 'GET', `${base}/terms`)).json().total, 0);

  const done = (await call(app, u.analyst, 'POST', `${base}/terms/generate`, { ...body, dryRun: false })).json();
  assert.equal(done.created, 6);
  groupId = done.groupId;
  assert.equal((await call(app, u.analyst, 'POST', `${base}/terms/generate`, { ...body, dryRun: true })).json().alreadyExist, 6);

  const tvOnly = (await call(app, u.analyst, 'POST', `${base}/terms/generate`, { group: 'TV names', products: { category: 'tv' }, dryRun: true })).json();
  assert.equal(tvOnly.products, 2);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/terms/generate`, { group: 'x', template: '{Colour}' })).statusCode, 400);
  assert.equal((await call(app, u.brand, 'POST', `${base}/terms/generate`, body)).statusCode, 403);
});

test('bulk import: problems are listed per line; commit creates groups and terms', async () => {
  const csv = [
    'type,value,product_code,group',
    'keyword,TestBrand OLED TV deal,TST-1,Deals',
    'seller,https://www.amazon.com/s?me=XYZ,,Known offenders',
    'url,not-a-url,,Known offenders',
    'keyword,Soundbar X cheap,TST-9,Deals',
    'identifier,TB55OLED,TST-1,Deals',
  ].join('\n');
  const dry = (await call(app, u.manager, 'POST', `${base}/terms/import`, { csv, dryRun: true })).json();
  assert.equal(dry.rows, 5);
  assert.equal(dry.toCreate, 2);
  assert.deepEqual(dry.problems.map((p: { line: number }) => p.line), [4, 5]);
  assert.equal(dry.alreadyExist.length, 1); // TB55OLED was generated above
  assert.deepEqual(dry.newGroups.sort(), ['Deals', 'Known offenders']);
  const done = (await call(app, u.manager, 'POST', `${base}/terms/import`, { csv, dryRun: false, batchLabel: 'Test import' })).json();
  assert.equal(done.created, 2);
  const groups = (await call(app, u.analyst, 'GET', `${base}/term-groups`)).json();
  assert.deepEqual(groups.map((g: { name: string }) => g.name).sort(), ['Deals', 'F26: Brand + Model', 'Known offenders']);
});

test('terms: search, deactivate, duplicate refused, delete', async () => {
  const list = (await call(app, u.analyst, 'GET', `${base}/terms?q=OLED&type=keyword`)).json();
  assert.equal(list.total, 3);
  const term = list.terms.find((t: { group: { id: string } }) => t.group.id === groupId);
  const off = await call(app, u.analyst, 'PATCH', `${base}/terms/${term.id}`, { active: false });
  assert.equal(off.json().active, false);
  const dup = await call(app, u.analyst, 'POST', `${base}/terms`, { type: 'identifier', value: 'tb55oled', groupId });
  assert.equal(dup.statusCode, 409);
  const one = await call(app, u.analyst, 'POST', `${base}/terms`, { type: 'brand', value: 'TestBrand', groupId, productCode: 'TST-1' });
  assert.equal(one.statusCode, 201);
  assert.equal((await call(app, u.analyst, 'DELETE', `${base}/terms/${one.json().id}`)).statusCode, 204);
  assert.equal((await call(app, u.brand, 'GET', `${base}/terms`)).statusCode, 403);
});

test('matrix: cells drive the request estimate; Some must use subscribed sources', async () => {
  // Active terms in the generated group: 2 keyword (one deactivated) + 3 identifier.
  const all = (await call(app, u.manager, 'PUT', `${base}/matrix/${groupId}/Marketplace`, { mode: 'All' })).json();
  const g = all.groups.find((x: { id: string }) => x.id === groupId);
  // amazon: 2×3 + 3×1 = 9; walmart: 2×2 + 3 = 7; ebay (planned): 2×3 + 3 = 9
  assert.equal(g.requests, 25);
  assert.equal(g.plannedRequests, 9);
  const some = (await call(app, u.manager, 'PUT', `${base}/matrix/${groupId}/Marketplace`, { mode: 'Some', sourceCodes: ['amazon_us'] })).json();
  assert.equal(some.groups.find((x: { id: string }) => x.id === groupId).requests, 9);
  assert.equal(
    (await call(app, u.manager, 'PUT', `${base}/matrix/${groupId}/Marketplace`, { mode: 'Some', sourceCodes: ['target_us'] })).statusCode,
    400,
  );
  assert.equal((await call(app, u.manager, 'PUT', `${base}/matrix/${groupId}/Nowhere`, { mode: 'All' })).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'PUT', `${base}/matrix/${groupId}/Marketplace`, { mode: 'None' })).statusCode, 403);
  const view = (await call(app, u.analyst, 'GET', `${base}/matrix`)).json();
  assert.equal(view.budget, 3000);
  assert.equal(view.total, 9);
});

test('schedules: cadence is validated; resolve picks the highest priority match', async () => {
  const bad = await call(app, u.manager, 'POST', `${base}/schedules`, { name: 'Bad', cadence: 'every morning x' });
  assert.equal(bad.statusCode, 400);
  const daily = await call(app, u.manager, 'POST', `${base}/schedules`, { name: 'Daily', cadence: '0 6 * * *', selector: { categories: ['Marketplace'] } });
  assert.equal(daily.statusCode, 201);
  assert.ok(daily.json().nextRun);
  const fast = await call(app, u.manager, 'POST', `${base}/schedules`, {
    name: 'Group fast',
    cadence: '0 */6 * * *',
    priority: 20,
    selector: { termGroups: [groupId] },
  });
  assert.equal(fast.statusCode, 201);
  const hit = (await call(app, u.analyst, 'GET', `${base}/schedules/resolve?source=amazon_us&termGroup=${groupId}`)).json();
  assert.equal(hit.schedule.name, 'Group fast');
  const other = (await call(app, u.analyst, 'GET', `${base}/schedules/resolve?source=walmart_us`)).json();
  assert.equal(other.schedule.name, 'Daily');
  const patched = await call(app, u.manager, 'PATCH', `${base}/schedules/${fast.json().id}`, { active: false });
  assert.equal(patched.json().nextRun, null);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/schedules`, { name: 'x', cadence: '0 6 * * *' })).statusCode, 403);
});

test('every configuration change is in the audit log; other accounts cannot see any of it', async () => {
  const { events } = (await call(app, u.manager, 'GET', `${base}/audit?limit=200`)).json();
  const actions = new Set(events.map((e: { action: string }) => e.action));
  for (const a of ['subscription.created', 'terms.generated', 'terms.imported', 'term.updated', 'term.created', 'term.deleted', 'matrix.updated', 'schedule.created', 'schedule.updated']) {
    assert.ok(actions.has(a), `missing ${a}`);
  }
  assert.equal((await call(app, u.lgManager, 'GET', `${base}/terms`)).statusCode, 403);
  assert.equal((await call(app, u.lgManager, 'GET', `${base}/matrix`)).statusCode, 403);
});
