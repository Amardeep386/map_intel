// Enforcement cases (Phase 4 · M2): open a case from one seller's violations, move it on, Under
// notice, recurrence, owner / due date / IP flag, and the routes.   npm run test:db
// Observations are append-only, so the lib tests run in one transaction that is rolled back.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { addViolations, caseDetail, createCase, listCases, moveCase, updateCase } from '../../src/lib/cases.js';
import { closeDb, type Db } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { one, scratch, world } from './enforcement-world.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
const u: Record<string, TestUser> = {};

before(async () => {
  await removeTestAccounts();
  acct = await createTestAccount('cases');
  u.manager = await createUser('case-manager', 'Account manager', acct);
  u.analyst = await createUser('case-analyst', 'Analyst', acct);
  u.brand = await createUser('case-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const statusOf = async (db: Db, violationId: string) => (await one<{ status: string }>(db, 'SELECT status FROM violation_current WHERE id = $1', [violationId])).status;

test('a case covers one seller’s active violations; each violation goes into one case only', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'open');
    const [a, b] = w.sellers;
    await assert.rejects(createCase(db, w.account, { violationIds: [w.violations[a][0], w.violations[b][0]] }, null), /one seller/);

    const c = await createCase(db, w.account, { violationIds: [w.violations[a][0]], note: 'First look' }, null);
    assert.equal(c.code, 'C-00001');
    assert.equal(c.recurredFrom, null);
    await assert.rejects(createCase(db, w.account, { violationIds: [w.violations[a][0]] }, null), /already in a case/);
    await assert.rejects(addViolations(db, w.account, c.id, [w.violations[b][0]], null), /seller/);
    await addViolations(db, w.account, c.id, [w.violations[a][1]], null);

    const det = await caseDetail(db, c.id);
    assert.equal(det!.state, 'Open');
    assert.equal(det!.violations.length, 2);
    assert.equal(det!.seller, 'Case Seller A');
    assert.equal(det!.products, 'CASE-1');
    // Default response due: today + 7 days.
    const due = (await one<{ d: string }>(db, "SELECT to_char(current_date + 7, 'YYYY-MM-DD') AS d")).d;
    assert.equal(det!.response_due, due);
    // Violations stay Open until a notice goes out.
    assert.equal(await statusOf(db, w.violations[a][0]), 'Open');

    const { rows, counts } = await listCases(db, w.account, { open: true });
    assert.deepEqual(rows.map((r) => r.code), ['C-00001']);
    assert.deepEqual(counts, { Open: 1 });
  });
});

test('moving a case: allowed moves only, reasons where needed; Notice sent puts its violations Under notice', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'move');
    const [a] = w.sellers;
    const c = await createCase(db, w.account, { violationIds: [w.violations[a][0]] }, null);

    await assert.rejects(moveCase(db, w.account, c.id, 'Awaiting response', null, null), /cannot move from Open/);
    await assert.rejects(moveCase(db, w.account, c.id, 'Notice sent', null, null), /needs a reason/);
    await assert.rejects(moveCase(db, w.account, c.id, 'Recurred', 'x', null), /cannot move/);
    await moveCase(db, w.account, c.id, 'Notice sent', 'Letter sent by post', null);
    assert.equal(await statusOf(db, w.violations[a][0]), 'Under notice');

    // A violation added later to a case under notice is under notice at once.
    await addViolations(db, w.account, c.id, [w.violations[a][1]], null);
    assert.equal(await statusOf(db, w.violations[a][1]), 'Under notice');

    await moveCase(db, w.account, c.id, 'Awaiting response', null, null);
    await assert.rejects(moveCase(db, w.account, c.id, 'Contested', '  ', null), /needs a reason/);
    await moveCase(db, w.account, c.id, 'Contested', 'Seller says the bundle includes a free mount', null);
    await assert.rejects(moveCase(db, w.account, c.id, 'Resolved', null, null), /needs a reason/);
    await moveCase(db, w.account, c.id, 'Resolved', 'Brand accepted the bundle', null);
    await assert.rejects(moveCase(db, w.account, c.id, 'Escalated', 'x', null), /closed/);
    await assert.rejects(updateCase(db, w.account, c.id, { responseDue: '2026-12-01' }), /closed/);

    const det = await caseDetail(db, c.id);
    assert.deepEqual(det!.events.map((e: { state: string }) => e.state), ['Open', 'Notice sent', 'Awaiting response', 'Contested', 'Resolved']);
    assert.equal(det!.closed, true);
  });
});

test('a seller who offends again within 60 days of a resolved case: the old case is marked Recurred', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'recur');
    const [a] = w.sellers;
    const first = await createCase(db, w.account, { violationIds: [w.violations[a][0]] }, null);
    await moveCase(db, w.account, first.id, 'Resolved', 'Seller fixed the price', null);
    const second = await createCase(db, w.account, { violationIds: [w.violations[a][1]] }, null);
    assert.equal(second.recurredFrom, 'C-00001');
    const old = await caseDetail(db, first.id);
    assert.equal(old!.state, 'Recurred');
    assert.equal(old!.closed, true);
    assert.equal((await caseDetail(db, second.id))!.recurred_from_code, 'C-00001');
  });
});

test('owner must work on the account; the IP flag needs a reason', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'patch');
    const [a] = w.sellers;
    const analyst = (await one<{ id: string }>(db, 'SELECT id FROM app_user WHERE id = $1', [u.analyst.id])).id;
    await db.query("INSERT INTO account_membership (account_id, user_id, role) VALUES ($1, $2, 'Analyst')", [w.account, analyst]);
    await db.query("INSERT INTO account_membership (account_id, user_id, role) VALUES ($1, $2, 'Brand user')", [w.account, u.brand.id]);

    await assert.rejects(createCase(db, w.account, { violationIds: [w.violations[a][0]], owner: u.brand.id }, null), /owner/);
    const c = await createCase(db, w.account, { violationIds: [w.violations[a][0]], owner: analyst, responseDue: '2026-10-20' }, null);
    await assert.rejects(updateCase(db, w.account, c.id, { owner: u.manager.id }), /owner/); // not a member of this scratch account
    await assert.rejects(updateCase(db, w.account, c.id, { ipIssue: true }), /needs a reason/);
    await updateCase(db, w.account, c.id, { ipIssue: true, ipReason: 'Counterfeit packaging reported by the brand', owner: null });
    const det = await caseDetail(db, c.id);
    assert.deepEqual([det!.owner, det!.ip_issue, det!.ip_reason], [null, true, 'Counterfeit packaging reported by the brand']);
  });
});

test('routes: Brand users read cases but cannot open or move them; validation and 404s', async () => {
  const base = `/accounts/${acct}/cases`;
  const list = await call(app, u.brand, 'GET', `${base}?open=true`);
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().total, 0);
  assert.equal((await call(app, u.brand, 'GET', `${base}?state=Bogus`)).statusCode, 400);

  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(app, u.brand, 'POST', base, { violationIds: [missing] })).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', base, { violationIds: [missing] })).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'POST', base, { violationIds: [] })).statusCode, 400);
  assert.equal((await call(app, u.analyst, 'GET', `${base}/${missing}`)).statusCode, 404);
  assert.equal((await call(app, u.brand, 'POST', `${base}/${missing}/state`, { state: 'Escalated', reason: 'x' })).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/${missing}/state`, { state: 'Escalated', reason: 'x' })).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'PATCH', `${base}/${missing}`, {})).statusCode, 400);
  assert.equal((await call(app, u.manager, 'PATCH', `${base}/${missing}`, { responseDue: '2026-11-01' })).statusCode, 404);
});
