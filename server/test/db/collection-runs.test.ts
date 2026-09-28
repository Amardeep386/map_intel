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
