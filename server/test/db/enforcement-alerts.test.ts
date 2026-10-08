// Enforcement alerts (Phase 4 · M8): notice waiting for approval, response overdue, re-offence and
// case resolved, each raised once.   npm run test:db
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { evaluateAlerts } from '../../src/lib/alerts.js';
import { createCase } from '../../src/lib/cases.js';
import { closeDb, type Db } from '../../src/lib/db.js';
import { judgeAccount } from '../../src/lib/judge.js';
import { decideNotice, draftNotice, logCommunication, sendNotice, submitNotice } from '../../src/lib/notices.js';
import { one, scratch, world } from './enforcement-world.js';

after(async () => {
  await closeDb();
});

const titles = async (db: Db, account: string, code: string) =>
  (await db.query<{ title: string }>(
    'SELECT e.title FROM alert_event e JOIN alert_rule r ON r.id = e.alert_rule_id WHERE e.account_id = $1 AND r.code = $2 ORDER BY e.created_at', [account, code])).rows.map((r) => r.title);

test('every account has the four enforcement alert rules', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'alert-rules');
    const codes = (await db.query<{ code: string; trigger: string }>('SELECT code, trigger FROM alert_rule WHERE account_id = $1 ORDER BY code', [w.account])).rows;
    assert.deepEqual(codes.map((c) => c.code), ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07']);
  });
});

test('approval waiting, response overdue, case resolved and re-offence: each once', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'alerts');
    const [a] = w.sellers;
    const [v1, v2] = w.violations[a];
    const c = await createCase(db, w.account, { violationIds: [v1], responseDue: '2026-10-03' }, null);
    const t = (await one<{ id: string }>(db, "SELECT id FROM notice_template WHERE account_id = $1 AND code = 'T-1'", [w.account])).id;
    const n = await draftNotice(db, w.account, c.id, { templateId: t }, null);
    await submitNotice(db, n.id);

    await evaluateAlerts(db, w.account);
    assert.deepEqual(await titles(db, w.account, 'A-04'), ['Notice N-00001 for Case Seller A waits for brand approval']);
    await evaluateAlerts(db, w.account);
    assert.equal((await titles(db, w.account, 'A-04')).length, 1, 'once per notice');

    // Approved and sent; the response date (Oct 3) has passed and the seller has not replied.
    await decideNotice(db, n.id, true, null, null);
    await sendNotice(db, w.account, n.id, 'letter', null);
    await evaluateAlerts(db, w.account);
    const overdue = await titles(db, w.account, 'A-05');
    assert.equal(overdue.length, 1);
    assert.match(overdue[0], /^C-00001: Case Seller A has not responded \(due Oct 3, 2026\)$/);

    // A reply stops it; a new response date that also passes alerts again.
    await logCommunication(db, w.account, c.id, { kind: 'response', summary: 'Will fix' }, null);
    await db.query("UPDATE enforcement_case SET response_due = '2026-10-04' WHERE id = $1", [c.id]);
    await evaluateAlerts(db, w.account);
    assert.equal((await titles(db, w.account, 'A-05')).length, 1);

    // The re-check sees the fix: the case resolves and A-07 says so.
    const l1 = (await one<{ listing_id: string }>(db, 'SELECT listing_id FROM violation WHERE id = $1', [v1])).listing_id;
    await db.query("INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES (now() - interval '1 hour', $1, 'ok', 1000, 'USD', $2)", [l1, a]);
    await judgeAccount(db, w.account, { trigger: 'test' });
    await evaluateAlerts(db, w.account);
    const resolved = await titles(db, w.account, 'A-07');
    assert.deepEqual(resolved, ['C-00001 resolved: Case Seller A']);

    // The seller breaks MAP again on the same listing after the case was resolved: A-06.
    // (v2 opened before the resolution, so it is not a re-offence.)
    await db.query("INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES (now() + interval '1 minute', $1, 'ok', 650, 'USD', $2)", [l1, a]);
    await judgeAccount(db, w.account, { trigger: 'test' });
    await evaluateAlerts(db, w.account);
    const re = await titles(db, w.account, 'A-06');
    assert.equal(re.length, 1);
    assert.match(re[0], /^Case Seller A re-offended: V-\d{5} after C-00001$/);
    const linked = await one<{ case_id: string; violation_id: string }>(db,
      "SELECT e.case_id, e.violation_id FROM alert_event e JOIN alert_rule r ON r.id = e.alert_rule_id WHERE e.account_id = $1 AND r.code = 'A-06'", [w.account]);
    assert.equal(linked.case_id, c.id);
    assert.notEqual(linked.violation_id, v2);
    await evaluateAlerts(db, w.account);
    assert.equal((await titles(db, w.account, 'A-06')).length, 1, 'once per violation');
  });
});
