// Data Health routes: per-source health and KPIs, failures, "Re-run failed", roles and tenant
// isolation. Throwaway account with a finished run written as the collector would.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { recordRunHealth } from '../../src/lib/health.js';
import { closeQueue, sourceQueue } from '../../src/lib/queue.js';
import { accountIds, call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
let base: string;
const u: Record<string, TestUser> = {};
const queued: string[] = [];

before(async () => {
  await removeTestAccounts();
  acct = await createTestAccount('health');
  base = `/accounts/${acct}`;
  u.analyst = await createUser('dh-analyst', 'Analyst', acct);
  u.manager = await createUser('dh-manager', 'Account manager', acct);
  u.brand = await createUser('dh-brand', 'Brand user', acct);
  u.lgAnalyst = await createUser('dh-lg-analyst', 'Analyst', (await accountIds()).lg);

  // Walmart subscribed; a finished run: 3 collects (2 ok, 1 blocked) and one robots-skipped discovery.
  await withSystem(async (db) => {
    const walmart = (await db.query<{ id: string }>(`SELECT id FROM source WHERE code = 'walmart_us'`)).rows[0].id;
    await db.query(`INSERT INTO account_source (account_id, source_id, options) VALUES ($1, $2, '{}')`, [acct, walmart]);
    const run = (
      await db.query<{ id: string }>(
        `INSERT INTO crawl_run (trigger, account_id, status, jobs_total, jobs_done, egress_label, finished_at) VALUES ('schedule', $1, 'finished', 3, 3, 'test', now()) RETURNING id`,
        [acct],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind, url, status, failure_class, skip_reason, error, finished_at) VALUES
         ($1, $2, $3, 'collect', 'https://www.walmart.com/ip/1', 'done', NULL, NULL, NULL, now()),
         ($1, $2, $3, 'collect', 'https://www.walmart.com/ip/2', 'done', NULL, NULL, NULL, now()),
         ($1, $2, $3, 'collect', 'https://www.walmart.com/ip/3', 'failed', 'blocked', NULL, 'blocked: captcha', now()),
         ($1, $2, $3, 'discover', NULL, 'skipped', NULL, 'not_executable', NULL, now())`,
      [run, acct, walmart],
    );
    return run;
  });
  const run = await withSystem(async (db) => (await db.query<{ id: string }>('SELECT id FROM crawl_run WHERE account_id = $1', [acct])).rows[0].id);
  await recordRunHealth(run);
  app = await testApp();
});

after(async () => {
  for (const id of queued) await sourceQueue('walmart_us').remove(id).catch(() => undefined);
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('health: KPIs and one row per subscribed source from the latest snapshot', async () => {
  const res = await call(app, u.analyst, 'GET', `${base}/health`);
  assert.equal(res.statusCode, 200, res.body);
  const h = res.json();
  const w = h.sources.find((s: { code: string }) => s.code === 'walmart_us');
  assert.equal(w.health, 'Degraded'); // 1 of 3 pages blocked
  assert.deepEqual([w.fetch, w.jobs.skipped, w.failures, w.mainFailure], [{ ok: 2, total: 3 }, { not_executable: 1 }, { blocked: 1 }, 'blocked']);
  assert.equal(h.kpis.coverage, 75); // 3 executed of 4 wanted
  assert.equal(h.lastRun.egress, 'test');
});

test('failures: failed and not-executable work, newest first', async () => {
  const res = await call(app, u.analyst, 'GET', `${base}/health/walmart_us/failures`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().map((f: { failureClass: string }) => f.failureClass).sort(), ['blocked', 'not_executable']);
});

test('roles: Brand user and other accounts cannot see Data Health; only managers re-run', async () => {
  assert.equal((await call(app, u.brand, 'GET', `${base}/health`)).statusCode, 403);
  assert.equal((await call(app, u.lgAnalyst, 'GET', `${base}/health`)).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/health/rerun`, {})).statusCode, 403);
});

test('re-run failed: a new manual run with the failed jobs, audited', async () => {
  const res = await call(app, u.manager, 'POST', `${base}/health/rerun`, { source: 'walmart_us' });
  assert.equal(res.statusCode, 202, res.body);
  assert.equal(res.json().jobs, 1);
  const jobs = await withSystem(async (db) =>
    (await db.query<{ id: string; url: string; status: string }>('SELECT id, url, status FROM crawl_job WHERE crawl_run_id = $1', [res.json().crawlRunId])).rows,
  );
  queued.push(...jobs.map((j) => j.id));
  assert.deepEqual(jobs.map((j) => [j.url, j.status]), [['https://www.walmart.com/ip/3', 'queued']]);
  const audit = await withSystem(async (db) => (await db.query(`SELECT 1 FROM audit_event WHERE account_id = $1 AND action = 'crawl_run.rerun'`, [acct])).rowCount);
  assert.equal(audit, 1);
});

test('evidence of a shared listing opens for an account that maps it, not for others', async () => {
  const lg = (await accountIds()).lg;
  const evidenceId = await withSystem(async (db) =>
    (
      await db.query<{ id: string }>(
        `SELECT e.id FROM evidence e JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
           JOIN listing_match m ON m.listing_id = o.listing_id AND m.account_id = $1
          ORDER BY e.captured_at DESC LIMIT 1`,
        [lg],
      )
    ).rows[0]?.id,
  );
  if (!evidenceId) return; // no collected LG evidence in this database yet
  const ok = await call(app, u.lgAnalyst, 'GET', `/evidence/${evidenceId}`);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.match(ok.json().html.sha256, /^[0-9a-f]{64}$/);
  assert.equal((await call(app, u.analyst, 'GET', `/evidence/${evidenceId}`)).statusCode, 403);
});
