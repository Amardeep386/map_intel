// Seller risk and profile figures (Phase 4 · M6) against judged data.   npm run test:db
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createCase, moveCase } from '../../src/lib/cases.js';
import { closeDb } from '../../src/lib/db.js';
import { judgeAccount } from '../../src/lib/judge.js';
import { draftNotice, logCommunication, sendNotice } from '../../src/lib/notices.js';
import { sellerStats } from '../../src/lib/sellerRisk.js';
import { at, one, scratch, world } from './enforcement-world.js';

after(async () => {
  await closeDb();
});

const asOf = at('10-10T00:00:00');

test('risk, depth, repeats, compliance and unanswered notices per seller', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'risk');
    const [a, b] = w.sellers;
    // Seller A: its first listing is fixed, then breaks MAP again (a repeat), and one listing is compliant once.
    const l1 = (await one<{ listing_id: string }>(db, 'SELECT listing_id FROM violation WHERE id = $1', [w.violations[a][0]])).listing_id;
    for (const [when, price] of [['10-03T00:00:00', 1000], ['10-04T00:00:00', 800]] as const) {
      await db.query("INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES ($1, $2, 'ok', $3, 'USD', $4)", [at(when), l1, price, a]);
    }
    await judgeAccount(db, w.account, { trigger: 'test' });

    let stats = await sellerStats(db, w.account, undefined, asOf);
    const sa = stats.get(a)!;
    assert.deepEqual([sa.violations, sa.active, sa.repeats], [3, 2, 1]);
    assert.equal(sa.avgDepthPct, 26.7); // 30, 30, 20
    assert.equal(sa.ttcHours, 24); // Oct 2 → Oct 3
    assert.equal(sa.compliancePct, 25); // 1 of 4 judged observations
    assert.equal(sa.parts.responsiveness, null);
    const sb = stats.get(b)!;
    assert.deepEqual([sb.violations, sb.repeats, sb.avgDepthPct, sb.compliancePct], [2, 0, 30, 0]);
    assert.ok(sa.risk > sb.risk, 'a repeat offender scores higher');

    // Seller B gets a notice and ignores it past the response date: its risk goes up.
    const before = sb.risk;
    const c = await createCase(db, w.account, { violationIds: w.violations[b], responseDue: '2026-10-05' }, null);
    const t = (await one<{ id: string }>(db, "SELECT id FROM notice_template WHERE account_id = $1 AND code = 'T-1'", [w.account])).id;
    await db.query(`UPDATE account SET settings = settings || '{"brand_approval_required": false}' WHERE id = $1`, [w.account]);
    const n = await draftNotice(db, w.account, c.id, { templateId: t }, null);
    await sendNotice(db, w.account, n.id, 'letter', null);
    stats = await sellerStats(db, w.account, [b], asOf);
    assert.deepEqual([stats.get(b)!.noticesSent, stats.get(b)!.noticesDue, stats.get(b)!.unanswered, stats.get(b)!.openCases], [1, 1, 1, 1]);
    assert.ok(stats.get(b)!.risk > before);

    // A reply counts as an answer.
    await logCommunication(db, w.account, c.id, { kind: 'response', summary: 'Will fix tomorrow' }, null);
    assert.equal((await sellerStats(db, w.account, [b], asOf)).get(b)!.unanswered, 0);
    await moveCase(db, w.account, c.id, 'Escalated', 'No fix after reply', null);
  });
});

test('dismissed violations and listings no longer included do not count against a seller', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'risk-excl');
    const [, b] = w.sellers;
    assert.equal((await sellerStats(db, w.account, [b], asOf)).get(b)!.violations, 2);
    const listing = (await one<{ listing_id: string }>(db, 'SELECT listing_id FROM violation WHERE id = $1', [w.violations[b][0]])).listing_id;
    await db.query("UPDATE listing_match SET state = 'Excluded' WHERE account_id = $1 AND listing_id = $2", [w.account, listing]);
    await db.query("INSERT INTO violation_event (account_id, violation_id, status, reason) VALUES ($1, $2, 'Dismissed', 'Bundle with a mount')", [w.account, w.violations[b][1]]);
    const s = (await sellerStats(db, w.account, [b], asOf)).get(b);
    assert.equal(s?.violations ?? 0, 0);
    assert.equal(s?.risk ?? 0, 0);
  });
});
