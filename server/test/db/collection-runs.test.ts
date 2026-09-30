// Phase 2b schema rules as the API's database role: tenant isolation on crawl jobs and source
// health, one run per schedule slot, held observations, append-only health history.   npm run test:db
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { closeDb, type Db } from '../../src/lib/db.js';
import { accountIds, asTenant, expectRefused, rolledBack } from './helpers.js';

let accounts: Record<string, string> = {};

before(async () => {
  accounts = await accountIds();
});

after(async () => {
  await closeDb();
});

async function sourceId(db: Db, code = 'amazon_us'): Promise<string> {
  return (await db.query<{ id: string }>('SELECT id FROM source WHERE code = $1', [code])).rows[0].id;
}

const inAccount = (db: Db, accountId: string) => db.query("SELECT set_config('app.account_id', $1, true)", [accountId]);

async function newRun(db: Db, accountId: string): Promise<string> {
  return (await db.query<{ id: string }>(`INSERT INTO crawl_run (trigger, account_id, status) VALUES ('schedule', $1, 'running') RETURNING id`, [accountId]))
    .rows[0].id;
}

test('crawl jobs and health snapshots are tenant-isolated', () =>
  rolledBack(async (db) => {
    const src = await sourceId(db);
    const lgRun = await newRun(db, accounts.lg);
    const appleRun = await newRun(db, accounts.apple);
    for (const [account, run, health] of [[accounts.lg, lgRun, 'Healthy'], [accounts.apple, appleRun, 'Blocked']]) {
      await inAccount(db, account);
      await db.query(`INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind) VALUES ($1, $2, $3, 'discover')`, [run, account, src]);
      await db.query(`INSERT INTO source_health_snapshot (account_id, source_id, crawl_run_id, health) VALUES ($1, $2, $3, $4)`, [account, src, run, health]);
    }
    await asTenant(db, accounts.lg);
    for (const t of ['crawl_job', 'source_health_snapshot']) {
      const { rows } = await db.query<{ account_id: string }>(`SELECT DISTINCT account_id FROM ${t} WHERE crawl_run_id = ANY($1)`, [[lgRun, appleRun]]);
      assert.deepEqual(rows.map((r) => r.account_id), [accounts.lg], t);
    }
    await expectRefused(db, `INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind) VALUES ($1, $2, $3, 'collect')`, [appleRun, accounts.apple, src]);
  }));

test('a schedule slot makes one run, however many ticks see it', () =>
  rolledBack(async (db) => {
    await inAccount(db, accounts.lg);
    const scheduleId = (await db.query<{ id: string }>('SELECT id FROM schedule WHERE account_id = $1 LIMIT 1', [accounts.lg])).rows[0].id;
    const slot = '2030-01-01T06:00:00Z';
    await db.query(`INSERT INTO crawl_run (trigger, account_id, schedule_id, fired_for) VALUES ('schedule', $1, $2, $3)`, [accounts.lg, scheduleId, slot]);
    await expectRefused(db, `INSERT INTO crawl_run (trigger, account_id, schedule_id, fired_for) VALUES ('schedule', $1, $2, $3)`, [accounts.lg, scheduleId, slot]);
    const again = await db.query(
      `INSERT INTO crawl_run (trigger, account_id, schedule_id, fired_for) VALUES ('schedule', $1, $2, $3)
       ON CONFLICT (schedule_id, fired_for) WHERE schedule_id IS NOT NULL DO NOTHING RETURNING id`,
      [accounts.lg, scheduleId, slot],
    );
    assert.equal(again.rowCount, 0);
  }));

test('a held observation is stored with its checks and stays append-only', () =>
  rolledBack(async (db) => {
    const listingId = (await db.query<{ id: string }>(`SELECT id FROM listing WHERE state = 'Included' LIMIT 1`)).rows[0].id;
    const id = randomUUID();
    await db.query(
      `INSERT INTO observation (id, observed_at, listing_id, status, advertised_price, currency, validation, failure_class)
       VALUES ($1, now(), $2, 'held', 9.99, 'USD', '{"held":["bounds"]}', NULL)`,
      [id, listingId],
    );
    await expectRefused(db, `UPDATE observation SET status = 'ok' WHERE id = $1`, [id]);
    await expectRefused(db, `INSERT INTO observation (observed_at, listing_id, status) VALUES (now(), $1, 'stale')`, [listingId]);
    await expectRefused(db, `INSERT INTO observation (observed_at, listing_id, status, failure_class) VALUES (now(), $1, 'failed', 'gremlins')`, [listingId]);
  }));

test('health snapshots are never edited', () =>
  rolledBack(async (db) => {
    await inAccount(db, accounts.lg);
    const run = await newRun(db, accounts.lg);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO source_health_snapshot (account_id, source_id, crawl_run_id, health) VALUES ($1, $2, $3, 'Degraded') RETURNING id`,
      [accounts.lg, await sourceId(db), run],
    );
    await expectRefused(db, `UPDATE source_health_snapshot SET health = 'Healthy' WHERE id = $1`, [rows[0].id]);
    await expectRefused(db, 'DELETE FROM source_health_snapshot WHERE id = $1', [rows[0].id]);
  }));

test('evidence is visible to the accounts that map the listing', () =>
  rolledBack(async (db) => {
    const { rows } = await db.query<{ id: string; account_id: string }>(
      `SELECT e.id, p.account_id FROM evidence e
         JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
         JOIN listing l ON l.id = o.listing_id JOIN product p ON p.id = l.product_id LIMIT 1`,
    );
    if (!rows[0]) return; // no P0 evidence in this database
    const got = (await db.query<{ a: string[] }>('SELECT app_evidence_accounts($1) AS a', [rows[0].id])).rows[0].a;
    assert.ok(got.includes(rows[0].account_id));
    assert.deepEqual((await db.query<{ a: string[] }>('SELECT app_evidence_accounts($1) AS a', [randomUUID()])).rows[0].a, []);
  }));

test('results pages (M4): tenant-isolated, append-only, linked to the listings they showed', () =>
  rolledBack(async (db) => {
    const src = await sourceId(db);
    const page = async (account: string) => {
      await inAccount(db, account);
      const run = await newRun(db, account);
      const job = (await db.query<{ id: string }>(`INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind) VALUES ($1, $2, $3, 'discover') RETURNING id`, [run, account, src])).rows[0].id;
      return (
        await db.query<{ id: string }>(
          `INSERT INTO results_page (account_id, crawl_run_id, crawl_job_id, source_id, page_no, url, fetched_at, method, items_found, html_sha256)
           VALUES ($1, $2, $3, $4, 1, 'https://www.amazon.com/s?k=x', now(), 'browser', 1, 'abc') RETURNING id`,
          [account, run, job, src],
        )
      ).rows[0].id;
    };
    const lgPage = await page(accounts.lg);
    const applePage = await page(accounts.apple);
    const listingId = (await db.query<{ id: string }>(`SELECT id FROM listing WHERE source_id = $1 LIMIT 1`, [src])).rows[0].id;
    await inAccount(db, accounts.lg);
    await db.query(`INSERT INTO results_page_listing (results_page_id, account_id, listing_id, position) VALUES ($1, $2, $3, 1)`, [lgPage, accounts.lg, listingId]);
    await asTenant(db, accounts.lg);
    const seen = await db.query<{ id: string }>('SELECT id FROM results_page WHERE id = ANY($1)', [[lgPage, applePage]]);
    assert.deepEqual(seen.rows.map((r) => r.id), [lgPage]);
    await expectRefused(db, `UPDATE results_page SET items_found = 9 WHERE id = $1`, [lgPage]);
    await expectRefused(db, `DELETE FROM results_page_listing WHERE results_page_id = $1`, [lgPage]);
  }));

test('stop on block (M5): two blocked results in a row cancel the source’s queued jobs in the run', () =>
  rolledBack(async (db) => {
    const { stopSourceIfBlocked } = await import('../../src/collector/stopOnBlock.js');
    await inAccount(db, accounts.lg);
    const amazon = await sourceId(db);
    const walmart = await sourceId(db, 'walmart_us');
    const run = await newRun(db, accounts.lg);
    const job = (source: string, status: string, failure: string | null, minutesAgo = 0) =>
      db.query(
        `INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind, status, failure_class, finished_at)
         VALUES ($1, $2, $3, 'collect', $4, $5, CASE WHEN $4 IN ('done', 'failed') THEN now() - make_interval(mins => $6) END)`,
        [run, accounts.lg, source, status, failure, minutesAgo],
      );
    await job(amazon, 'done', null, 3);
    await job(amazon, 'failed', 'blocked', 2);
    for (let i = 0; i < 3; i++) await job(amazon, 'queued', null);
    await job(walmart, 'queued', null);
    await db.query('UPDATE crawl_run SET jobs_total = 6, jobs_done = 2 WHERE id = $1', [run]);
    assert.equal(await stopSourceIfBlocked(db, run, amazon), 0, 'one blocked result is not a streak');
    await job(amazon, 'failed', 'blocked', 1);
    assert.equal(await stopSourceIfBlocked(db, run, amazon), 3);
    const jobs = (await db.query<{ source_id: string; status: string; skip_reason: string | null }>('SELECT source_id, status, skip_reason FROM crawl_job WHERE crawl_run_id = $1', [run])).rows;
    assert.equal(jobs.filter((j) => j.source_id === amazon && j.skip_reason === 'cancelled').length, 3);
    assert.equal(jobs.find((j) => j.source_id === walmart)?.status, 'queued', 'other sources keep going');
    const r = (await db.query<{ jobs_total: number; stopped: Record<string, { cancelled: number }> }>('SELECT jobs_total, stopped FROM crawl_run WHERE id = $1', [run])).rows[0];
    assert.equal(r.jobs_total, 3);
    assert.equal(r.stopped.amazon_us.cancelled, 3);
  }));
