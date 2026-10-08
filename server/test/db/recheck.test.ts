// Re-check under notice (Phase 4 · M4): the scheduler sees which listings are under notice, and the
// judge resolves a case only when a re-check sees a compliant price.   npm run test:db
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { caseDetail, createCase, moveCase } from '../../src/lib/cases.js';
import { closeDb, type Db } from '../../src/lib/db.js';
import { judgeAccount } from '../../src/lib/judge.js';
import { decideListings } from '../../src/lib/mapping.js';
import { loadAccountWork } from '../../src/scheduler/tick.js';
import { at, one, scratch, world } from './enforcement-world.js';

after(async () => {
  await closeDb();
});

/** Observe the listing of a violation again at `price`. */
async function reobserve(db: Db, violationId: string, when: string, price: number): Promise<void> {
  const v = await one<{ listing_id: string; seller_id: string }>(db, 'SELECT listing_id, seller_id FROM violation WHERE id = $1', [violationId]);
  await db.query(
    "INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES ($1, $2, 'ok', $3, 'USD', $4)",
    [at(when), v.listing_id, price, v.seller_id]);
}

test('the scheduler marks listings under notice once a notice has gone out in their case', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'sched');
    const [a] = w.sellers;
    const c = await createCase(db, w.account, { violationIds: [w.violations[a][0]] }, null);
    const underNotice = async () => (await loadAccountWork(db, w.account)).listings.filter((l) => l.underNotice).length;
    assert.equal(await underNotice(), 0); // a case alone is not a notice
    await moveCase(db, w.account, c.id, 'Notice sent', 'Letter sent by post', null);
    assert.equal(await underNotice(), 1);
  });
});

test('a case resolves when every violation has ended and a re-check saw a compliant price; not on a still-low price', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'resolve');
    const [a] = w.sellers;
    const [v1, v2] = w.violations[a];
    const c = await createCase(db, w.account, { violationIds: [v1, v2] }, null);
    await moveCase(db, w.account, c.id, 'Notice sent', 'Letter sent by post', null);

    // First re-check: one listing fixed, the other still below MAP.
    await reobserve(db, v1, '10-03T06:00:00', 1000);
    await reobserve(db, v2, '10-03T06:00:00', 690);
    let r = await judgeAccount(db, w.account, { trigger: 'test' });
    assert.equal(r.casesResolved, 0);
    assert.equal((await caseDetail(db, c.id))!.state, 'Notice sent');

    // Second re-check: both compliant.
    await reobserve(db, v2, '10-03T12:00:00', 1049);
    r = await judgeAccount(db, w.account, { trigger: 'test' });
    assert.equal(r.casesResolved, 1);
    const det = await caseDetail(db, c.id);
    assert.equal(det!.state, 'Resolved');
    assert.equal(det!.closed, true);
    const last = det!.events.at(-1);
    assert.equal(last.actor, 'System');
    assert.equal(last.reason, 'Re-checked: compliant price seen');
    assert.equal(new Date(last.observed_at).toISOString(), at('10-03T12:00:00').toISOString()); // the proof is the latest compliant observation

    // Judging again changes nothing.
    assert.equal((await judgeAccount(db, w.account, { trigger: 'test' })).casesResolved, 0);
  });
});

test('a case whose violations ended without a compliant price (the listing excluded) waits for a person', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'excluded');
    const [, b] = w.sellers;
    const [v] = w.violations[b];
    const c = await createCase(db, w.account, { violationIds: [v] }, null);
    const listing = (await one<{ listing_id: string }>(db, 'SELECT listing_id FROM violation WHERE id = $1', [v])).listing_id;
    await decideListings(db, w.account, { listingIds: [listing], action: 'exclude', reason: 'Wrong product' }, { type: 'system', id: null, label: 'test' });
    assert.equal((await judgeAccount(db, w.account, { trigger: 'test' })).casesResolved, 0);
    assert.equal((await caseDetail(db, c.id))!.state, 'Open');
    await moveCase(db, w.account, c.id, 'Resolved', 'Listing was the wrong product', null);
    assert.equal((await caseDetail(db, c.id))!.state, 'Resolved');
  });
});
