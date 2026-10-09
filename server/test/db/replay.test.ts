// Replay at scale: batches, resume from the cursor, the lease, rule-set drift, and the routes.
//   npm run test:db
// The batch tests run in a rolled-back transaction (observations are append-only); the routes run
// on a committed scratch account with no observations.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem, type Db } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { claim, runReplay, startReplay } from '../../src/lib/replay.js';
import { at, one, scratch, world } from './enforcement-world.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let acct: string;

before(async () => {
  acct = await createTestAccount('replay');
  u.platform = await createUser('rp-platform', 'admin');
  u.admin = await createUser('rp-admin', 'Administrator', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const poll = async <T>(fn: () => Promise<T>, done: (v: T) => boolean): Promise<T> => {
  let v = await fn();
  for (let i = 0; i < 40 && !done(v); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    v = await fn();
  }
  return v;
};

test('a rule-set replay works in batches, pauses, resumes from its cursor, and finds drift', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'replay');
    const same = <T>(fn: (d: Db) => Promise<T>) => fn(db);
    // A seller made Brand Direct back in September: R-00 now exempts what was judged a violation.
    await db.query("INSERT INTO seller_classification (account_id, seller_id, class, effective_from) VALUES ($1, $2, 'Brand Direct', $3)",
      [w.account, w.sellers[0], at('09-01T00:00:00')]);
    // One observation that was never judged, with microseconds (as collected): a batch ending on it
    // must not fetch it again (a JS Date cursor holds milliseconds only).
    const listing = (await one<{ id: string }>(db, 'SELECT l.id FROM listing l JOIN listing_match m ON m.listing_id = l.id WHERE m.account_id = $1 LIMIT 1', [w.account])).id;
    await db.query("INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES ('2026-10-03T00:00:00.123456Z', $1, 'ok', 1200, 'USD', $2)",
      [listing, w.sellers[1]]);

    const { id, total } = await startReplay(db, w.account, { mode: 'ruleset' }, at('10-01T00:00:00'), at('10-31T00:00:00'), null);
    assert.equal(total, 5);
    assert.equal(await runReplay(id, same, { batchSize: 2, maxBatches: 1 }), 'paused');
    let run = await one<{ status: string; processed: number; cursor_at: Date | null }>(db, 'SELECT status, processed, cursor_at FROM replay_run WHERE id = $1', [id]);
    assert.deepEqual([run.status, run.processed], ['running', 2]);
    assert.ok(run.cursor_at);

    // A worker holding the lease keeps others off.
    assert.ok(await claim(db, id));
    assert.equal(await runReplay(id, same, { batchSize: 2 }), 'busy');
    await db.query('UPDATE replay_run SET lease_until = NULL WHERE id = $1', [id]);

    assert.equal(await runReplay(id, same, { batchSize: 2 }), 'done');
    run = await one(db, 'SELECT status, processed, cursor_at FROM replay_run WHERE id = $1', [id]);
    assert.deepEqual([run.status, run.processed], ['done', 5]);
    const results = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM replay_result WHERE replay_run_id = $1', [id]);
    assert.equal(results.n, 5); // each observation once, across batches

    const { summary } = await one<{ summary: Record<string, number> }>(db, 'SELECT summary FROM replay_run WHERE id = $1', [id]);
    assert.equal(summary.observations, 5);
    assert.equal(summary.violationsLive, 4);
    assert.equal(summary.noLongerViolating, 2); // seller A's two listings are now exempt
    assert.equal(summary.newlyViolating, 0);
    assert.equal(summary.notJudged, 1);
    assert.equal(summary.changed, 3);
  });
});

test('routes: replays answer at once and finish in the background; rule-set replays are platform-only', async () => {
  const version = await withSystem(async (db) => (await db.query<{ id: string }>(
    "SELECT rv.id FROM rule_version rv JOIN rule r ON r.id = rv.rule_id WHERE r.account_id = $1 AND rv.status = 'Published' ORDER BY r.code LIMIT 1", [acct])).rows[0].id);
  const range = { from: '2026-09-01', to: '2026-10-01' };

  const res = await call(app, u.admin, 'POST', `/accounts/${acct}/rules/versions/${version}/replay`, range);
  assert.equal(res.statusCode, 202, res.body);
  const runId = res.json().id;
  const run = await poll(async () => (await call(app, u.admin, 'GET', `/accounts/${acct}/rules/replays/${runId}`)).json(), (r) => r.status === 'done' || r.status === 'failed');
  assert.equal(run.status, 'done');
  assert.equal(run.summary.observations, 0);

  assert.equal((await call(app, u.admin, 'POST', '/platform/replays', { accountIds: [acct], ...range })).statusCode, 403);
  assert.equal((await call(app, u.platform, 'POST', '/platform/replays', { accountIds: [acct], from: '2026-10-01', to: '2026-09-01' })).statusCode, 400);
  const batch = await call(app, u.platform, 'POST', '/platform/replays', { accountIds: [acct], ...range });
  assert.equal(batch.statusCode, 202, batch.body);
  const { batchId } = batch.json();
  type Batch = { batchId: string; runs: { status: string; summary: { mode: string } }[] } | undefined;
  const mine = await poll<Batch>(
    async () => (await call(app, u.platform, 'GET', '/platform/replays')).json().find((b: { batchId: string }) => b.batchId === batchId),
    (b) => !!b && b.runs.every((r) => r.status === 'done'),
  );
  assert.equal(mine?.runs.length, 1);
  assert.equal(mine?.runs[0].status, 'done');
  assert.equal(mine?.runs[0].summary.mode, 'ruleset');
});
