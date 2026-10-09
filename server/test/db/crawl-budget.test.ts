// Org-wide crawl budget through the API and the scheduler.   npm run test:db
// Runs on the shared database: caps are set only on a source no real account subscribes to, the
// org cap only at a value nothing reaches, and every cap the test set is removed afterwards.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { fireSchedule } from '../../src/scheduler/tick.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let acct: string;
let source: { id: string; code: string };

async function cleanup(): Promise<void> {
  // Separate statements (not one transaction), so one failure does not leave a cap behind.
  await withSystem((db) => db.query("DELETE FROM crawl_budget WHERE note = 'test'"));
  await removeTestAccounts();
  await withSystem((db) => db.query("DELETE FROM listing WHERE url LIKE 'https://example.invalid/cb-%'"));
}

before(async () => {
  await cleanup();
  u.platform = await createUser('cb-platform', 'admin');
  acct = await createTestAccount('crawl-budget');
  u.admin = await createUser('cb-admin', 'Administrator', acct);
  // A source with a collector that no real account subscribes to.
  source = await withSystem(async (db) => (await db.query<{ id: string; code: string }>(
    `SELECT s.id, s.code FROM source s
      WHERE s.active AND s.collector_status = 'live'
        AND NOT EXISTS (SELECT 1 FROM account_source a JOIN account x ON x.id = a.account_id WHERE a.source_id = s.id AND a.active AND x.slug NOT LIKE 'zz-%')
      ORDER BY s.code LIMIT 1`)).rows[0]);
  assert.ok(source, 'needs a live source no real account subscribes to');
  await withSystem(async (db) => {
    await db.query('INSERT INTO account_source (account_id, source_id) VALUES ($1, $2)', [acct, source.id]);
    const product = (await db.query<{ id: string }>("INSERT INTO product (account_id, product_code, name, brand) VALUES ($1, 'CB-1', 'Budget widget', 'TestBrand') RETURNING id", [acct])).rows[0].id;
    for (const n of [1, 2, 3]) {
      const l = (await db.query<{ id: string }>('INSERT INTO listing (source_id, url) VALUES ($1, $2) RETURNING id', [source.id, `https://example.invalid/cb-${Date.now()}-${n}`])).rows[0].id;
      await db.query("INSERT INTO listing_match (account_id, listing_id, product_id, state, decided_by) VALUES ($1, $2, $3, 'Included', 'user')", [acct, l, product]);
    }
    await db.query("INSERT INTO schedule (account_id, name, cadence, timezone) VALUES ($1, 'Every 6 hours', '0 */6 * * *', 'UTC')", [acct]);
  });
  app = await testApp();
});

after(async () => {
  await app.close();
  await cleanup();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const setCap = async (sourceId: string | null, dailyRequests: number | null) =>
  call(app, u.platform, 'PUT', '/platform/crawl-budget', { sourceId, dailyRequests, note: 'test' });

test('only platform administrators read or set the crawl budget; caps are validated and audited', async () => {
  assert.equal((await call(app, u.admin, 'GET', '/platform/crawl-budget')).statusCode, 403);
  assert.equal((await call(app, u.admin, 'PUT', '/platform/crawl-budget', { sourceId: null, dailyRequests: 5 })).statusCode, 403);
  assert.equal((await setCap(source.id, 0)).statusCode, 400);

  assert.equal((await setCap(null, 10_000_000)).statusCode, 200);
  const caps = (await setCap(source.id, 4)).json();
  assert.ok(caps.some((c: { sourceId: string; dailyRequests: number }) => c.sourceId === source.id && c.dailyRequests === 4));
  assert.equal((await setCap(source.id, 5)).statusCode, 200); // update in place
  const audit = await withSystem(async (db) => (await db.query("SELECT summary FROM audit_event WHERE action = 'crawl_budget.set' AND summary LIKE '%: 5' ORDER BY occurred_at DESC LIMIT 1")).rows);
  assert.equal(audit.length, 1);
});

test('the dashboard shows caps, today’s usage and each account’s forecast', async () => {
  const b = (await call(app, u.platform, 'GET', '/platform/crawl-budget?days=7')).json();
  assert.equal(b.days.length, 7);
  assert.equal(b.org.cap, 10_000_000);
  const s = b.sources.find((x: { id: string }) => x.id === source.id);
  assert.equal(s.cap, 5);
  const a = b.accounts.find((x: { id: string }) => x.id === acct);
  // Three included listings, one collect each, four times a day.
  assert.equal(a.forecastBySource[source.id], 12);
  assert.equal(s.overCap, true);
});

test('a firing gets what is left today under the cap; the rest is skipped as org_budget and counted', async () => {
  const scheduleId = await withSystem(async (db) => (await db.query<{ id: string }>('SELECT id FROM schedule WHERE account_id = $1', [acct])).rows[0].id);
  // Today's usage of this source so far (other runs may have used it): leave exactly 2 requests.
  const before = (await call(app, u.platform, 'GET', '/platform/crawl-budget?days=1')).json();
  const used = before.sources.find((x: { id: string }) => x.id === source.id).usedToday;
  await setCap(source.id, used + 2);

  const run = await fireSchedule(scheduleId, new Date(), 'manual', { enqueue: false });
  assert.ok(run);
  const jobs = await withSystem(async (db) => (await db.query<{ status: string; skip_reason: string | null; cost: number }>('SELECT status, skip_reason, cost FROM crawl_job WHERE crawl_run_id = $1', [run!.crawlRunId])).rows);
  assert.equal(jobs.filter((j) => j.status === 'queued').length, 2, JSON.stringify(jobs));
  assert.equal(jobs.filter((j) => j.skip_reason === 'org_budget').length, 1);
  assert.ok(jobs.every((j) => j.cost === 1));

  const after = (await call(app, u.platform, 'GET', '/platform/crawl-budget?days=1')).json();
  const s = after.sources.find((x: { id: string }) => x.id === source.id);
  assert.equal(s.usedToday, used + 2); // queued jobs count their planned cost
  assert.equal(s.orgBudgetSkipsToday, 1);
  const a = after.accounts.find((x: { id: string }) => x.id === acct);
  assert.equal(a.orgBudgetSkips7Days, 1);

  // Removing the cap.
  const caps = (await setCap(source.id, null)).json();
  assert.ok(!caps.some((c: { sourceId: string }) => c.sourceId === source.id));
});
