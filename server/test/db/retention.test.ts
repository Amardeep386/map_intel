// Retention and the audit hash chain against the database.   npm run test:db
// Everything runs in rolled-back transactions: observations and evidence are append-only and the
// database is shared, so nothing here is ever committed.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb, type Db } from '../../src/lib/db.js';
import { judgeAccount } from '../../src/lib/judge.js';
import { runRetention } from '../../src/lib/retention.js';
import { one, scratch } from './enforcement-world.js';
import { expectRefused, rolledBack } from './helpers.js';

after(() => closeDb());

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function account(db: Db, label: string, settings: Record<string, unknown> = {}) {
  const id = (await one<{ id: string }>(db, "INSERT INTO account (slug, name, brand, status, settings) VALUES ($1, $1, 'TestBrand', 'Sandbox', $2) RETURNING id",
    [`zz-p1-test-ret-${label}-${Date.now()}`, JSON.stringify(settings)])).id;
  const product = (await one<{ id: string }>(db, "INSERT INTO product (account_id, product_code, name, brand) VALUES ($1, 'RET-1', 'Retention TV', 'TestBrand') RETURNING id", [id])).id;
  return { id, product };
}

test('retention: per-account and shared-listing periods, Object Lock, protection, failed files, dry run', async () => {
  await scratch(async (db) => {
    const a = await account(db, 'a', { retention_observation_days: 400 });
    const b = await account(db, 'b');
    const source = (await one<{ id: string }>(db, "SELECT id FROM source WHERE code = 'walmart_us'")).id;
    const listing = async (n: string) => (await one<{ id: string }>(db, 'INSERT INTO listing (source_id, url) VALUES ($1, $2) RETURNING id', [source, `https://www.walmart.com/ip/ret-${n}-${Date.now()}`])).id;
    const map = async (acct: { id: string; product: string }, l: string) =>
      db.query("INSERT INTO listing_match (account_id, listing_id, product_id, state, decided_by) VALUES ($1, $2, $3, 'Included', 'user')", [acct.id, l, acct.product]);
    const l1 = await listing('1');
    const l2 = await listing('2');
    await map(a, l1);
    await map(a, l2);
    await map(b, l2); // shared with B, who keeps observations 730 days
    const observe = async (l: string, days: number, status = 'blocked', price: number | null = null) =>
      (await one<{ id: string; observed_at: Date }>(db,
        "INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency) VALUES ($1, $2, $3, $4, 'USD') RETURNING id, observed_at",
        [daysAgo(days), l, status, price])).id;
    const evidence = async (obs: string, lockDays: number, uris: string[]) => {
      const o = await one<{ observed_at: Date }>(db, 'SELECT observed_at FROM observation WHERE id = $1', [obs]);
      return (await one<{ id: string }>(db,
        "INSERT INTO evidence (observation_id, observed_at, html_uri, screenshot_uri, method, captured_at, lock_until) VALUES ($1, $2, $3, $4, 'http+render', $2, $5) RETURNING id",
        [obs, o.observed_at, uris[0] ?? null, uris[1] ?? null, daysAgo(-lockDays)])).id;
    };

    const o1 = await observe(l1, 500); // past A's 400 days: goes
    const o2 = await observe(l2, 500); // shared with B (730 days): stays
    const o3 = await observe(l1, 380); // evidence past 365 days goes; the observation stays (380 < 400)
    const e3 = await evidence(o3, -10, ['s3://bucket/ret/o3.html', 's3://bucket/ret/o3.png']);
    const o4 = await observe(l1, 380);
    const e4 = await evidence(o4, 30, ['s3://bucket/ret/o4.html']); // still locked: stays
    const o6 = await observe(l1, 380);
    const e6 = await evidence(o6, -10, ['fail://ret/o6.html']); // the file cannot be deleted: row stays
    // An old violation still open: protected even though it is past every period.
    await db.query('INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)', [a.id, a.product, daysAgo(1000)]);
    const o5 = await observe(l1, 600, 'ok', 700);
    await judgeAccount(db, a.id, { trigger: 'test' });
    const open = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM violation_current WHERE account_id = $1 AND NOT episode_closed', [a.id]);
    assert.equal(open.n, 1);

    const deleted: string[] = [];
    const deleteFile = async (uri: string) => {
      if (uri.startsWith('fail://')) throw new Error('still locked');
      deleted.push(uri);
    };

    const dry = await runRetention(db, { apply: false, deleteFile });
    assert.equal(dry.observations, 1);
    assert.equal(dry.evidence, 2); // e3 and e6 are candidates; e4 is locked
    assert.deepEqual(deleted, []);

    const r = await runRetention(db, { apply: true, deleteFile });
    assert.deepEqual(deleted.sort(), ['s3://bucket/ret/o3.html', 's3://bucket/ret/o3.png']);
    assert.equal(r.evidence, 1);
    assert.equal(r.evidenceFiles, 2);
    assert.equal(r.evidenceSkipped, 1);
    assert.equal(r.observations, 1);

    const left = async (table: string, ids: string[]) =>
      (await db.query(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])).rows.map((x) => x.id).sort();
    assert.deepEqual(await left('observation', [o1, o2, o3, o4, o5, o6]), [o2, o3, o4, o5, o6].sort());
    assert.deepEqual(await left('evidence', [e3, e4, e6]), [e4, e6].sort());
    // The verdict of the protected observation stays, of course.
    assert.equal((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM verdict WHERE observation_id = $1', [o5])).n, 1);
  });
});

test('audit chain: old events are purged from the start of the chain, which still verifies from the checkpoint', async () => {
  await scratch(async (db) => {
    const a = await account(db, 'audit', { retention_audit_days: 365 });
    const event = (days: number, summary: string) =>
      db.query("INSERT INTO audit_event (account_id, occurred_at, actor_type, actor_label, action, entity_type, summary) VALUES ($1, $2, 'system', 'Test', 'test.event', 'test', $3)",
        [a.id, daysAgo(days), summary]);
    for (const d of [800, 700, 600]) await event(d, `old ${d}`);
    await event(10, 'recent');
    let v = await one<{ checked: string; broken_seq: string | null }>(db, 'SELECT * FROM app_audit_verify($1)', [a.id]);
    assert.deepEqual([Number(v.checked), v.broken_seq], [4, null]);

    const r = await runRetention(db, { apply: true, deleteFile: async () => undefined });
    assert.equal(r.audit[a.id], 3);
    const cp = await one<{ purged_count: string }>(db, 'SELECT purged_count FROM audit_checkpoint WHERE account_id = $1', [a.id]);
    assert.equal(Number(cp.purged_count), 3);
    v = await one(db, 'SELECT * FROM app_audit_verify($1)', [a.id]);
    assert.deepEqual([Number(v.checked), v.broken_seq], [1, null]);

    // New events chain on; tampering is found.
    await event(1, 'new');
    v = await one(db, 'SELECT * FROM app_audit_verify($1)', [a.id]);
    assert.deepEqual([Number(v.checked), v.broken_seq], [2, null]);
    await db.query('ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only');
    await db.query("UPDATE audit_event SET summary = 'changed' WHERE account_id = $1 AND summary = 'recent'", [a.id]);
    await db.query('ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only');
    const bad = await one<{ broken_reason: string }>(db, 'SELECT * FROM app_audit_verify($1)', [a.id]);
    assert.equal(bad.broken_reason, 'content changed');
  });
});

test('the API role cannot switch purging on', async () => {
  await rolledBack(async (db) => {
    const obs = await one<{ id: string }>(db, 'SELECT id FROM observation LIMIT 1');
    await db.query("SELECT set_config('app.purging', 'on', true), set_config('app.role', 'system', true)");
    assert.equal((await one<{ p: boolean }>(db, 'SELECT app_purging() AS p')).p, false);
    await expectRefused(db, 'DELETE FROM observation WHERE id = $1', [obs.id]);
    // Audit events the API role reaches outside an account: none (row-level security), so nothing goes.
    assert.equal((await db.query('DELETE FROM audit_event WHERE seq = (SELECT min(seq) FROM audit_event)')).rowCount, 0);
  });
});
