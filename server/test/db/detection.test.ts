// Detection (Phase 3): judging against the MAP / promo / class in force at observed_at, violation
// episodes, idempotence, rule versions (dry run before publish, frozen once published), RLS and
// the Rules routes.   npm run test:db
// Observations are append-only, so the judge tests run in one transaction that is rolled back.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, pool, type Db } from '../../src/lib/db.js';
import { judgeAccount } from '../../src/lib/judge.js';
import { dryRun, publish, replay } from '../../src/lib/ruleAdmin.js';
import { contentHash } from '../../src/lib/rules.js';
import { changeStatus, listViolations, violationDetail } from '../../src/lib/violations.js';
import { createLink, evidenceRecord, openLink } from '../../src/lib/evidenceLinks.js';
import { withSystem } from '../../src/lib/db.js';
import { overview } from '../../src/lib/overview.js';
import { closeQueue } from '../../src/lib/queue.js';
import { call, createTestAccount, createUser, expectRefused, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
const u: Record<string, TestUser> = {};

before(async () => {
  await removeTestAccounts();
  acct = await createTestAccount('detection');
  u.manager = await createUser('det-manager', 'Account manager', acct);
  u.analyst = await createUser('det-analyst', 'Analyst', acct);
  u.brand = await createUser('det-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

/** As system, inside a transaction that is always rolled back. */
async function scratch(fn: (db: Db) => Promise<void>): Promise<void> {
  const db = await pool().connect();
  try {
    await db.query("BEGIN; SELECT set_config('app.role', 'system', true)");
    await fn(db);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
}

const d = (s: string) => new Date(`2026-${s}Z`);
const one = async <T = Record<string, unknown>>(db: Db, sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as T;

interface World { account: string; product: string; listing: string; seller: string; source: string }

/** A scratch account with one product, one Walmart listing (Included) and its seller. */
async function world(db: Db, label: string): Promise<World> {
  const account = (await one<{ id: string }>(db,
    `INSERT INTO account (slug, name, brand, status) VALUES ($1, $1, 'TestBrand', 'Sandbox') RETURNING id`, [`zz-p1-test-${label}-${Date.now()}`])).id;
  const source = (await one<{ id: string }>(db, "SELECT id FROM source WHERE code = 'walmart_us'")).id;
  const product = (await one<{ id: string }>(db,
    "INSERT INTO product (account_id, product_code, name, brand, category) VALUES ($1, 'DET-1', 'Test laptop', 'TestBrand', 'Laptop') RETURNING id", [account])).id;
  const seller = (await one<{ id: string }>(db,
    "INSERT INTO seller (source_id, name, name_key) VALUES ($1, 'Det Seller', $2) RETURNING id", [source, `det seller ${Date.now()}`])).id;
  const listing = (await one<{ id: string }>(db,
    'INSERT INTO listing (source_id, url, seller_id) VALUES ($1, $2, $3) RETURNING id', [source, `https://www.walmart.com/ip/det-${Date.now()}-${label}`, seller])).id;
  await db.query(
    "INSERT INTO listing_match (account_id, listing_id, product_id, state, decided_by) VALUES ($1, $2, $3, 'Included', 'user')", [account, listing, product]);
  return { account, product, listing, seller, source };
}

async function observe(db: Db, w: World, at: Date, price: number): Promise<string> {
  return (await one<{ id: string }>(db,
    `INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES ($1, $2, 'ok', $3, 'USD', $4) RETURNING id`,
    [at, w.listing, price, w.seller])).id;
}

async function verdictOf(db: Db, w: World, obs: string) {
  return one<{ outcome: string; severity: string | null; map_amount: string | null; promo_amount: string | null; class_at_capture: string; depth_pct: string | null }>(
    db, 'SELECT outcome, severity, map_amount, promo_amount, class_at_capture, depth_pct FROM verdict WHERE account_id = $1 AND observation_id = $2', [w.account, obs]);
}

const statuses = async (db: Db, w: World) =>
  (await db.query<{ seq: number; status: string; closed: boolean; observations: number }>(
    'SELECT seq, status, episode_closed AS closed, observations FROM violation_current WHERE account_id = $1 ORDER BY seq', [w.account])).rows;

test('judge: MAP in force at observed_at ([from, to)), seller class at capture, episodes open, join and resolve', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'judge');
    // MAP $1000 from Oct 1, $900 from Oct 10 (the first row closed at the same instant).
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from, effective_to) VALUES ($1, $2, 1000, $3, $4), ($1, $2, 900, $4, NULL)",
      [w.account, w.product, d('10-01T00:00:00'), d('10-10T00:00:00')]);
    // Unauthorised until Oct 5, MAP Authorised after.
    await db.query("INSERT INTO seller_classification (account_id, seller_id, class, effective_from, effective_to) VALUES ($1, $2, 'Unauthorised', $3, $4), ($1, $2, 'MAP Authorised', $4, NULL)",
      [w.account, w.seller, d('09-01T00:00:00'), d('10-05T00:00:00')]);

    const o1 = await observe(db, w, d('09-30T12:00:00'), 500); // before any MAP
    const o2 = await observe(db, w, d('10-02T12:00:00'), 950); // 5% below 1000: Standard
    const o3 = await observe(db, w, d('10-06T12:00:00'), 800); // 20% below: Severe, now MAP Authorised
    const o4 = await observe(db, w, d('10-09T23:59:59'), 920); // 8% below 1000 (last second of the old MAP)
    const o5 = await observe(db, w, d('10-10T00:00:00'), 920); // above the new 900 MAP: compliant -> resolves
    const o6 = await observe(db, w, d('10-11T00:00:00'), 850); // 5.6% below 900: a new episode

    const r = await judgeAccount(db, w.account, { trigger: 'test' });
    assert.deepEqual([r.observations, r.verdicts, r.opened, r.resolved], [6, 6, 2, 1]);

    assert.equal((await verdictOf(db, w, o1)).outcome, 'no_map');
    const v2 = await verdictOf(db, w, o2);
    assert.deepEqual([v2.outcome, v2.severity, Number(v2.map_amount), v2.class_at_capture, Number(v2.depth_pct)], ['violation', 'Standard', 1000, 'Unauthorised', 5]);
    const v3 = await verdictOf(db, w, o3);
    assert.deepEqual([v3.severity, v3.class_at_capture], ['Severe', 'MAP Authorised']);
    assert.equal(Number((await verdictOf(db, w, o4)).map_amount), 1000);
    const v5 = await verdictOf(db, w, o5);
    assert.deepEqual([v5.outcome, Number(v5.map_amount)], ['compliant', 900]);
    assert.equal((await verdictOf(db, w, o6)).outcome, 'violation');

    assert.deepEqual(await statuses(db, w), [
      { seq: 1, status: 'Resolved', closed: true, observations: 3 },
      { seq: 2, status: 'Open', closed: false, observations: 1 },
    ]);
    const first = await one<{ class_at_capture: string; severity: string }>(db, 'SELECT class_at_capture, severity FROM violation_current WHERE account_id = $1 AND seq = 1', [w.account]);
    assert.deepEqual([first.class_at_capture, first.severity], ['Unauthorised', 'Severe']); // class at the first observation; worst severity

    // Idempotent: nothing new to judge.
    const again = await judgeAccount(db, w.account, { trigger: 'test' });
    assert.deepEqual([again.observations, again.verdicts, again.opened], [0, 0, 0]);
  });
});

test('judge: promotion windows, Brand Direct, grace period, and episodes of listings no longer included', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'promo');
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, d('09-01T00:00:00')]);
    const pw = (await one<{ id: string }>(db,
      "INSERT INTO promo_window (account_id, seq, name, effective_from, effective_to) VALUES ($1, 1, 'Fall sale', $2, $3) RETURNING id",
      [w.account, d('10-01T00:00:00'), d('10-08T00:00:00')])).id;
    await db.query('INSERT INTO promo_window_product (promo_id, account_id, product_id, promo_amount) VALUES ($1, $2, $3, 850)', [pw, w.account, w.product]);
    await db.query("UPDATE account SET settings = settings || '{\"grace_hours\": 24}' WHERE id = $1", [w.account]);

    const inPromo = await observe(db, w, d('10-02T00:00:00'), 860);
    const belowPromo = await observe(db, w, d('10-03T00:00:00'), 800);
    await observe(db, w, d('10-03T12:00:00'), 800); // 12 h in: still inside grace
    await observe(db, w, d('10-04T06:00:00'), 800); // 30 h in: Open
    await judgeAccount(db, w.account, { trigger: 'test' });
    assert.equal((await verdictOf(db, w, inPromo)).outcome, 'authorised_promo');
    const bp = await verdictOf(db, w, belowPromo);
    assert.deepEqual([bp.outcome, Number(bp.promo_amount), Number(bp.depth_pct)], ['violation', 850, 5.882]);
    const events = (await db.query<{ status: string; reason: string | null }>(
      'SELECT e.status, e.reason FROM violation_event e JOIN violation v ON v.id = e.violation_id WHERE v.account_id = $1 ORDER BY e.created_at', [w.account])).rows;
    assert.deepEqual(events.map((e) => e.status), ['Needs review', 'Open']);

    // Brand Direct from Oct 5: exempt even far below MAP; the open episode is left alone.
    await db.query("INSERT INTO seller_classification (account_id, seller_id, class, effective_from) VALUES ($1, $2, 'Brand Direct', $3)", [w.account, w.seller, d('10-05T00:00:00')]);
    const bd = await observe(db, w, d('10-09T00:00:00'), 500);
    await judgeAccount(db, w.account, { trigger: 'test' });
    assert.equal((await verdictOf(db, w, bd)).outcome, 'exempt');
    assert.equal((await statuses(db, w))[0].status, 'Open');

    // The listing is excluded: its episode ends as Dismissed.
    await db.query("UPDATE listing_match SET state = 'Excluded' WHERE account_id = $1", [w.account]);
    const r = await judgeAccount(db, w.account, { trigger: 'test' });
    assert.equal(r.closedExcluded, 1);
    assert.deepEqual((await statuses(db, w))[0], { seq: 1, status: 'Dismissed', closed: true, observations: 3 });
  });
});

test('facts are append-only; a published version is frozen; the API role cannot write verdicts', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'frozen');
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, d('09-01T00:00:00')]);
    await observe(db, w, d('10-02T00:00:00'), 700);
    await judgeAccount(db, w.account, { trigger: 'test' });
    const vid = (await one<{ id: string }>(db, 'SELECT id FROM violation WHERE account_id = $1', [w.account])).id;
    await expectRefused(db, "UPDATE verdict SET outcome = 'compliant' WHERE account_id = $1", [w.account]);
    await expectRefused(db, 'DELETE FROM violation WHERE id = $1', [vid]);
    await expectRefused(db, 'UPDATE violation_event SET status = $2 WHERE violation_id = $1', [vid, 'Resolved']);
    await expectRefused(db, "INSERT INTO violation_event (account_id, violation_id, status) VALUES ($1, $2, 'Dismissed')", [w.account, vid]); // no reason
    const r01 = (await one<{ id: string }>(db, "SELECT rv.id FROM rule_version rv JOIN rule r ON r.id = rv.rule_id WHERE r.account_id = $1 AND r.code = 'R-01'", [w.account])).id;
    await expectRefused(db, "UPDATE rule_version SET priority = 1 WHERE id = $1", [r01]);
    await expectRefused(db, 'DELETE FROM rule_version WHERE id = $1', [r01]);

    await db.query('SAVEPOINT api');
    await db.query("SELECT set_config('app.role', '', true)");
    await db.query('SET LOCAL ROLE mapintel_tenant');
    await db.query("SELECT set_config('app.account_id', $1, true)", [w.account]);
    assert.equal((await db.query('SELECT 1 FROM verdict')).rowCount, 1);
    await expectRefused(db, 'DELETE FROM verdict');
    await db.query("SELECT set_config('app.account_id', $1, true)", [acct]);
    assert.equal((await db.query('SELECT 1 FROM verdict')).rowCount, 0); // another account sees nothing
    await db.query('ROLLBACK TO SAVEPOINT api');
  });
});

test('rule versions: publish needs a dry run of the exact draft; publishing closes the old version; replay fills the shadow set', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'rules');
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, d('09-01T00:00:00')]);
    await observe(db, w, d('10-02T00:00:00'), 990); // 1% below: inside the 2% tolerance
    await observe(db, w, d('10-03T00:00:00'), 900);
    await judgeAccount(db, w.account, { trigger: 'test' });

    const rule = (await one<{ id: string }>(db, "SELECT id FROM rule WHERE account_id = $1 AND code = 'R-01'", [w.account])).id;
    const body = { scope: {}, condition: { type: 'below_map' as const, tolerancePct: 0, minDepth: 0 }, verdict: 'violation' as const, severity: { minorBelowPct: 5, severeAbovePct: 15 }, priority: 100 };
    const draft = (await one<{ id: string }>(db,
      `INSERT INTO rule_version (account_id, rule_id, version, scope, condition, verdict, severity, priority, content_hash)
       VALUES ($1, $2, 2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [w.account, rule, body.scope, body.condition, body.verdict, body.severity, body.priority, contentHash(body)])).id;

    await assert.rejects(publish(db, draft, null), /dry run/);
    const dr = await dryRun(db, w.account, draft, d('10-01T00:00:00'), d('10-31T00:00:00'), null);
    assert.deepEqual([dr.result.observations, dr.result.violationsLive, dr.result.violationsCandidate, dr.result.newlyViolating], [2, 1, 2, 1]);
    assert.equal(dr.result.bySeller[0].seller, 'Det Seller');

    // Editing the draft after the dry run invalidates it.
    const edited = { ...body, condition: { ...body.condition, tolerancePct: 0.5 } };
    await db.query('UPDATE rule_version SET condition = $2, content_hash = $3 WHERE id = $1', [draft, edited.condition, contentHash(edited)]);
    await assert.rejects(publish(db, draft, null), /dry run/);
    await dryRun(db, w.account, draft, d('10-01T00:00:00'), d('10-31T00:00:00'), null);
    const now = new Date();
    const p = await publish(db, draft, null, now);
    assert.equal(p.closed?.version, 1);
    const versions = (await db.query<{ version: number; status: string; valid_to: Date | null }>(
      'SELECT version, status, valid_to FROM rule_version WHERE rule_id = $1 ORDER BY version', [rule])).rows;
    assert.deepEqual(versions.map((v) => [v.version, v.status]), [[1, 'Closed'], [2, 'Published']]);
    assert.equal(versions[0].valid_to?.getTime(), now.getTime());

    // Observations before `now` keep their v1 verdicts; a replay of v2 shows what v2 would have said.
    const rp = await replay(db, w.account, draft, d('10-01T00:00:00'), d('10-31T00:00:00'), null);
    assert.equal(rp.summary.newlyViolating, 1);
    const shadow = (await db.query<{ outcome: string; live_outcome: string }>(
      'SELECT outcome, live_outcome FROM replay_result WHERE replay_run_id = $1 ORDER BY observed_at', [rp.id])).rows;
    assert.deepEqual(shadow.map((s) => [s.outcome, s.live_outcome]), [['violation', 'compliant'], ['violation', 'violation']]);
  });
});

test('routes: Rules list, draft -> publish refused -> dry run -> publish; roles', async () => {
  const base = `/accounts/${acct}/rules`;
  const list = await call(app, u.analyst, 'GET', base);
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(list.json().map((r: { code: string }) => r.code), ['R-00', 'R-01']);
  assert.equal((await call(app, u.brand, 'GET', base)).statusCode, 403);

  const r01 = list.json()[1];
  const draft = { condition: { type: 'below_map', tolerancePct: 1 }, verdict: 'violation', priority: 100 };
  assert.equal((await call(app, u.analyst, 'PUT', `${base}/${r01.id}/draft`, draft)).statusCode, 403);
  const saved = await call(app, u.manager, 'PUT', `${base}/${r01.id}/draft`, draft);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().version, 2);
  const refused = await call(app, u.manager, 'POST', `${base}/${r01.id}/draft/publish`, {});
  assert.equal(refused.statusCode, 409);
  const dry = await call(app, u.manager, 'POST', `${base}/${r01.id}/draft/dry-run`, { from: '2026-09-01', to: '2026-10-01' });
  assert.equal(dry.statusCode, 200, dry.body);
  const pub = await call(app, u.manager, 'POST', `${base}/${r01.id}/draft/publish`, {});
  assert.equal(pub.statusCode, 200, pub.body);
  assert.equal(pub.json().closed.version, 1);
  const detail = (await call(app, u.analyst, 'GET', `${base}/${r01.id}`)).json();
  assert.deepEqual(detail.versions.map((v: { version: number; status: string }) => [v.version, v.status]), [[2, 'Published'], [1, 'Closed']]);

  const created = await call(app, u.manager, 'POST', base, { name: 'eBay strict', scope: { sources: ['ebay_us'] }, condition: { type: 'below_map', tolerancePct: 0 }, verdict: 'needs_review' });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().code, 'R-02');
  const bad = await call(app, u.manager, 'POST', base, { name: 'x', condition: { type: 'below_map' }, verdict: 'violation', severity: { minorBelowPct: 20, severeAbovePct: 10 } });
  assert.equal(bad.statusCode, 400);
});

test('violations: list, detail with history, status changes as events (reasons, closed episodes refused)', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'vlist');
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, d('09-01T00:00:00')]);
    await observe(db, w, d('10-02T00:00:00'), 700);
    await observe(db, w, d('10-03T00:00:00'), 650);
    await judgeAccount(db, w.account, { trigger: 'test' });

    const { total, rows } = await listViolations(db, w.account, { status: ['Open'], q: 'det-1' });
    const mine = rows.filter((r) => r.product_id === w.product);
    assert.equal(total, 1);
    assert.equal(mine.length, 1);
    const v = mine[0];
    assert.deepEqual([v.code, v.seller, v.source_code, v.severity, v.observations, v.last_price, v.last_map], ['V-00001', 'Det Seller', 'walmart_us', 'Severe', 2, 650, 1000]);

    await assert.rejects(changeStatus(db, w.account, v.id, 'Dismissed', null, null), /reason/);
    await changeStatus(db, w.account, v.id, 'Under notice', null, null);
    await assert.rejects(changeStatus(db, w.account, v.id, 'Under notice', null, null), /already/);
    await changeStatus(db, w.account, v.id, 'Resolved', 'Seller fixed the price by phone', null);
    await assert.rejects(changeStatus(db, w.account, v.id, 'Open', null, null), /ended/);

    const det = await violationDetail(db, v.id);
    assert.deepEqual(det!.events.map((e: { status: string }) => e.status), ['Open', 'Under notice', 'Resolved']);
    assert.equal(det!.history.length, 2);
    assert.ok(det!.history.every((h: { in_violation: boolean }) => h.in_violation));

    // A later breach of the same listing opens a new violation.
    await observe(db, w, d('10-05T00:00:00'), 600);
    await judgeAccount(db, w.account, { trigger: 'test' });
    assert.equal((await listViolations(db, w.account, { productId: w.product })).total, 2);
  });
});

test('routes: Violations read for Brand users, status changes for Analysts, CSV export', async () => {
  const base = `/accounts/${acct}/violations`;
  const res = await call(app, u.brand, 'GET', `${base}?status=Open,Needs%20review&active=true`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().total, 0);
  assert.equal((await call(app, u.brand, 'GET', `${base}?status=Bogus`)).statusCode, 400);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(app, u.brand, 'POST', `${base}/${missing}/status`, { status: 'Dismissed', reason: 'x' })).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/${missing}/status`, { status: 'Dismissed', reason: 'x' })).statusCode, 404);
  const csv = await call(app, u.analyst, 'GET', `${base}.csv`);
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.ok(csv.body.startsWith('Violation,SKU,Product'));
});

test('evidence links: token hashed, scoped, counted; the record lists the judged facts with a stable hash', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'links');
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, d('09-01T00:00:00')]);
    await observe(db, w, d('10-02T00:00:00'), 700);
    await judgeAccount(db, w.account, { trigger: 'test' });
    const vid = (await one<{ id: string }>(db, 'SELECT id FROM violation WHERE account_id = $1', [w.account])).id;

    const link = await createLink(db, { accountId: w.account, scope: 'violation:view', violationId: vid, days: 30, via: 'test' });
    assert.match(link.url, /\/evidence\/[A-Za-z0-9_-]{43}$/);
    const stored = await one<{ token_hash: string }>(db, 'SELECT token_hash FROM evidence_link WHERE id = $1', [link.id]);
    assert.notEqual(stored.token_hash, link.token); // only the hash is kept

    const opened = await openLink(db, link.token);
    assert.deepEqual([opened?.state, opened?.scope, opened?.violation_id], ['open', 'violation:view', vid]);
    await openLink(db, link.token);
    assert.equal((await one<{ views: number }>(db, 'SELECT views FROM evidence_link WHERE id = $1', [link.id])).views, 2);
    assert.equal(await openLink(db, 'not-a-real-token-but-long-enough'), null);

    await db.query('UPDATE evidence_link SET revoked_at = now() WHERE id = $1', [link.id]);
    assert.equal((await openLink(db, link.token))?.state, 'revoked');
    assert.equal((await one<{ views: number }>(db, 'SELECT views FROM evidence_link WHERE id = $1', [link.id])).views, 2); // not counted

    const r1 = await evidenceRecord(db, vid);
    const r2 = await evidenceRecord(db, vid);
    assert.equal(r1!.record, 'V-00001');
    assert.deepEqual([r1!.map, r1!.advertised, r1!.depthPct, r1!.seller.classAtCapture], [1000, 700, 30, 'Unknown']);
    assert.equal(r1!.observations.length, 1);
    assert.match(r1!.recordSha256, /^[0-9a-f]{64}$/);
    assert.equal(r1!.recordSha256, r2!.recordSha256);
  });
});

test('routes: /e/:token refuses unknown, expired and wrong-scope links; creating a link needs violations.write', async () => {
  assert.equal((await call(app, null, 'GET', '/e/not-a-real-token-but-long-enough')).statusCode, 404);
  const tokens = await withSystem(async (db) => {
    const report = await createLink(db, { accountId: acct, scope: 'report:view', reportRunId: '00000000-0000-4000-8000-000000000001', via: 'test' });
    const old = await createLink(db, { accountId: acct, scope: 'report:view', reportRunId: '00000000-0000-4000-8000-000000000002', via: 'test', days: 1, now: new Date(Date.now() - 3 * 86_400_000) });
    return { report: report.token, old: old.token };
  });
  const wrong = await call(app, null, 'GET', `/e/${tokens.report}`);
  assert.equal(wrong.statusCode, 403);
  const expired = await call(app, null, 'GET', `/e/${tokens.old}`);
  assert.equal(expired.statusCode, 410);
  assert.equal(expired.json().state, 'expired');
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(app, u.brand, 'POST', `/accounts/${acct}/violations/${missing}/links`, {})).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `/accounts/${acct}/violations/${missing}/links`, {})).statusCode, 404);
});

test('overview: compliance, open violations, time to compliance, trend split by class, degraded days', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'overview');
    const now = new Date();
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, at(60)]);
    await db.query("INSERT INTO seller_classification (account_id, seller_id, class, effective_from) VALUES ($1, $2, 'Unauthorised', $3)", [w.account, w.seller, at(60)]);
    await observe(db, w, at(6), 800);   // below
    await observe(db, w, at(5), 800);   // below
    await observe(db, w, at(4), 1000);  // compliant: resolved after 48 h
    await observe(db, w, at(2), 980);   // inside tolerance
    await observe(db, w, at(1), 700);   // below again: open, Severe
    await judgeAccount(db, w.account, { trigger: 'test' });
    // A degraded Walmart run three days ago.
    await db.query('INSERT INTO account_source (account_id, source_id, options) VALUES ($1, $2, $3)', [w.account, w.source, '{}']);
    const run = (await one<{ id: string }>(db, "INSERT INTO crawl_run (trigger, account_id, status, jobs_total, jobs_done) VALUES ('schedule', $1, 'finished', 2, 2) RETURNING id", [w.account])).id;
    await db.query(
      `INSERT INTO source_health_snapshot (account_id, source_id, crawl_run_id, jobs_planned, jobs_executed, health, created_at)
       VALUES ($1, $2, $3, 4, 3, 'Degraded', $4)`, [w.account, w.source, run, at(3)]);

    const o = await overview(db, w.account, { days: 30, now });
    assert.equal(o.kpis.compliance, 40); // 2 of 5 judged prices at or above MAP (minus tolerance)
    assert.equal(o.kpis.openViolations, 1);
    assert.equal(o.kpis.unauthorisedSellers, 1);
    assert.equal(o.kpis.skusMonitored, 1);
    assert.equal(o.kpis.medianTtcHours, 48);
    assert.equal(o.kpis.coverage, 75);
    assert.deepEqual(o.severity, [{ name: 'Minor', value: 0 }, { name: 'Standard', value: 0 }, { name: 'Severe', value: 2 }]);
    assert.equal(o.trend.length, 31);
    assert.equal(o.trend.reduce((n, d) => n + d.unauthorised, 0), 3);
    assert.equal(o.trend.reduce((n, d) => n + d.authorised, 0), 0);
    assert.deepEqual(o.degradedDays.map((d) => d.sources), [['Walmart.com']]);
    assert.match(o.quality.note ?? '', /Walmart\.com degraded/);
    assert.equal(o.recent.length, 1);
    assert.equal(o.topSellers[0].seller, 'Det Seller');
    assert.equal(o.topSellers[0].violations, 2);
  });
});

test('reports: a Listing MAP snapshot has a working evidence link on every violation row; the rule set and quality note are frozen in', async () => {
  const { buildSnapshot, snapshotCsv } = await import('../../src/lib/reports.js');
  const { queueRun } = await import('../../src/lib/reportRunner.js');
  await scratch(async (db) => {
    const w = await world(db, 'report');
    const now = new Date();
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)", [w.account, w.product, at(60)]);
    await observe(db, w, at(3), 800);
    await observe(db, w, at(2), 1000); // resolved
    await observe(db, w, at(1), 900);  // open again
    await judgeAccount(db, w.account, { trigger: 'test' });

    const q = await queueRun(db, { accountId: w.account, templateCode: 'listing_map', params: { timeframe: 'last_7_days' }, trigger: 'test', now });
    assert.equal(q.code, 'RPT-0001');
    await assert.rejects(queueRun(db, { accountId: w.account, templateCode: 'listing_map', params: { timeframe: 'never' }, trigger: 'test' }), /parameters/);
    const run = await one<{ period_from: Date; period_to: Date }>(db, 'SELECT period_from, period_to FROM report_run WHERE id = $1', [q.id]);
    const s = await buildSnapshot(db, {
      runId: q.id, runCode: q.code, name: 'Weekly', accountId: w.account, template: { code: 'listing_map', name: 'Listing MAP Report', version: 1 },
      params: { timeframe: 'last_7_days', statuses: ['Open', 'Needs review', 'Under notice', 'Resolved'], rowCap: 1000 },
      period: { from: run.period_from, to: run.period_to, label: 'x' }, now,
    });
    assert.equal(s.rows.length, 2);
    assert.deepEqual(s.rows.map((r) => r.status).sort(), ['Open', 'Resolved']);
    assert.deepEqual(s.ruleSet.map((r) => `${r.code} v${r.version}`), ['R-00 v1', 'R-01 v1']);
    assert.equal(s.summary.compliance, 33.3);
    // Every row's link opens that row's violation, scoped and tied to the run.
    for (const r of s.rows) {
      const token = r.evidenceUrl.split('/evidence/')[1];
      const l = await openLink(db, token);
      assert.equal(l?.state, 'open');
      assert.equal(l?.scope, 'violation:view');
      const v = await one<{ seq: number }>(db, 'SELECT seq FROM violation WHERE id = $1', [l!.violation_id]);
      assert.equal(`V-${String(v.seq).padStart(5, '0')}`, r.code);
    }
    assert.equal((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM evidence_link WHERE report_run_id = $1', [q.id])).n, 2);
    assert.equal(snapshotCsv(s).trim().split('\r\n').length, 3);

    await db.query('UPDATE report_run SET snapshot = $2 WHERE id = $1', [q.id, JSON.stringify(s)]);
    await expectRefused(db, "UPDATE report_run SET snapshot = '{}' WHERE id = $1", [q.id]); // frozen
  });
});

test('routes: report templates with adoption counts; definitions validated; Brand users see only shared reports', async () => {
  const base = `/accounts/${acct}/reports`;
  const t = await call(app, u.analyst, 'GET', `${base}/templates`);
  assert.equal(t.statusCode, 200, t.body);
  assert.deepEqual(t.json().map((x: { code: string }) => x.code).sort(), ['listing_map', 'monthly_trend', 'seller_detail']);
  const good = { name: 'Weekly MAP report', templateCode: 'listing_map', params: { timeframe: 'previous_week' }, cadence: '0 8 * * 1', recipients: ['map-room@example.com'] };
  assert.equal((await call(app, u.analyst, 'POST', `${base}/definitions`, good)).statusCode, 403);
  assert.equal((await call(app, u.manager, 'POST', `${base}/definitions`, { ...good, cadence: 'every monday' })).statusCode, 400);
  assert.equal((await call(app, u.manager, 'POST', `${base}/definitions`, { ...good, params: { timeframe: 'someday' } })).statusCode, 400);
  assert.equal((await call(app, u.manager, 'POST', `${base}/definitions`, { ...good, destinations: { sftp: { credentialId: '00000000-0000-4000-8000-000000000000' } } })).statusCode, 400);
  const created = await call(app, u.manager, 'POST', `${base}/definitions`, good);
  assert.equal(created.statusCode, 200, created.body);
  assert.ok(created.json().last_fired_slot, 'the latest past slot is marked fired, so it waits for the next one');
  await call(app, u.manager, 'POST', `${base}/definitions`, { ...good, name: 'Brand copy', visibility: 'Brand users' });
  const mine = (await call(app, u.analyst, 'GET', `${base}/definitions`)).json();
  assert.equal(mine.length, 2);
  assert.ok(mine[0].next_run);
  assert.deepEqual((await call(app, u.brand, 'GET', `${base}/definitions`)).json().map((d: { name: string }) => d.name), ['Brand copy']);
  const off = await call(app, u.manager, 'PATCH', `${base}/definitions/${created.json().id}`, { active: false });
  assert.equal(off.json().active, false);
  assert.equal((await call(app, null, 'GET', '/r/not-a-real-token-but-long-enough')).statusCode, 404);
});
