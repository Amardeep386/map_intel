// Mapping lifecycle as the API role: stage -> auto / rule / review; human decisions stick and
// become labels; scoped exclusions become suppressions that catch other listings; retire and
// revoke. Throwaway account; test listings and sellers are removed afterwards.   npm run test:db
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDb, withSystem, withTenant, type Db } from '../../src/lib/db.js';
import { applyRules, decideListings, loadMatchContext, retireListings, revokeSuppression, stageCandidate, upsertListing, type Actor } from '../../src/lib/mapping.js';
import { createTestAccount, createUser, removeTestAccounts, removeTestUsers, type TestUser } from './helpers.js';

const HOST = 'https://p2a-test.example/';
let acct: string;
let amazon: string;
let analyst: TestUser;
let actor: Actor;

const cleanup = () =>
  withSystem(async (db) => {
    await db.query('DELETE FROM listing WHERE url LIKE $1', [`${HOST}%`]);
    await db.query("DELETE FROM seller WHERE name ILIKE 'ZZ Map%'");
  });

before(async () => {
  await removeTestAccounts();
  await cleanup();
  acct = await createTestAccount('mapping');
  analyst = await createUser('map-analyst', 'Analyst', acct);
  actor = { type: 'user', id: analyst.id, label: analyst.email };
  await withTenant(acct, async (db) => {
    amazon = (await db.query<{ id: string }>("SELECT id FROM source WHERE code = 'amazon_us'")).rows[0].id;
    const p = (
      await db.query<{ id: string }>(
        `INSERT INTO product (account_id, product_code, name, brand, model_number, standard_price) VALUES ($1, 'MAP-65', 'TestBrand 65" Z9 OLED TV', 'TestBrand', 'Z9OLED65X', 2000) RETURNING id`,
        [acct],
      )
    ).rows[0].id;
    await db.query(`INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, 'ASIN', 'B0ZZTEST01')`, [acct, p]);
  });
});

after(async () => {
  await removeTestAccounts();
  await cleanup();
  await removeTestUsers();
  await closeDb();
});

async function stage(db: Db, path: string, title: string, price: number, seller: string, extra: { condition?: string } = {}) {
  const l = await upsertListing(db, { sourceId: amazon, url: `${HOST}${path}`, title, sellerName: seller, origin: 'import' });
  const ctx = await loadMatchContext(db, acct);
  const r = await stageCandidate(db, ctx, {
    listingId: l.listingId, sourceId: amazon, sellerId: l.sellerId, url: `${HOST}${path}`, title, price, channelSku: null,
    sellerName: seller, condition: extra.condition ?? null, format: null, imageUrl: null, origin: 'import',
  });
  return { ...r, listingId: l.listingId };
}

test('clean ASIN listing is auto-included; refurbished is excluded by rule; a title-only match waits for review', () =>
  withTenant(acct, async (db) => {
    const clean = await stage(db, 'dp/B0ZZTEST01', 'TestBrand 65" Z9 OLED TV', 1999, 'ZZ Map Seller A');
    assert.equal(clean.state, 'Included');
    const refurb = await stage(db, 'dp/B0ZZTEST01?refurb', 'TestBrand 65" Z9 OLED TV (Renewed)', 1500, 'ZZ Map Seller A');
    assert.equal(refurb.state, 'Excluded');
    assert.equal(refurb.decidedBy, 'rule');
    const review = await stage(db, 'item/abc', 'TestBrand 65 inch Z9 OLED television', 1700, 'ZZ Map Seller B');
    assert.equal(review.state, 'Staged');
    const signals = (await db.query('SELECT signal, score FROM match_signal WHERE candidate_id = $1 ORDER BY signal', [review.candidateId])).rows;
    assert.equal(signals.length, 6);
    const events = (await db.query('SELECT count(*)::int AS n FROM listing_state_event WHERE listing_id = $1', [review.listingId])).rows[0].n;
    assert.equal(events, 1);
  }));

test('a human exclusion with seller + product scope becomes a suppression and catches the next listing', () =>
  withTenant(acct, async (db) => {
    const first = await stage(db, 'item/b1', 'TestBrand 65 inch Z9 OLED television', 1600, 'ZZ Map Seller C');
    const second = await stage(db, 'item/b2', 'TestBrand Z9 OLED 65 in. TV', 1650, 'Sold by ZZ Map Seller C, LLC');
    assert.equal(first.state, 'Staged');
    assert.equal(second.state, 'Staged');
    const res = await decideListings(db, acct, { listingIds: [first.listingId], action: 'exclude', reason: 'Wrong variant', scope: 'seller_product' }, actor);
    assert.equal(res.suppression?.code, 'SUP-001');
    assert.equal(res.suppression?.alsoExcluded, 1, 'the other Staged listing of that seller + product is excluded too');
    const m = (await db.query('SELECT state, decided_by FROM listing_match WHERE listing_id = $1', [second.listingId])).rows[0];
    assert.deepEqual(m, { state: 'Excluded', decided_by: 'suppression' });
    const third = await stage(db, 'item/b3', 'TestBrand 65" Z9 OLED', 1700, 'ZZ Map Seller C');
    assert.equal(third.decidedBy, 'suppression');
    const label = (await db.query('SELECT is_label, actor_label, reason, scope FROM listing_state_event WHERE listing_id = $1 ORDER BY created_at DESC LIMIT 1', [first.listingId])).rows[0];
    assert.deepEqual(label, { is_label: true, actor_label: analyst.email, reason: 'Wrong variant', scope: 'seller_product' });

    assert.ok(await revokeSuppression(db, res.suppression!.id, analyst.id));
    const fourth = await stage(db, 'item/b4', 'TestBrand 65" Z9 OLED', 1700, 'ZZ Map Seller C');
    assert.notEqual(fourth.decidedBy, 'suppression');
  }));

test('a person\'s decision stands when the listing is seen again, and raises the next score', () =>
  withTenant(acct, async (db) => {
    const r = await stage(db, 'item/c1', 'TestBrand 65 inch Z9 OLED television', 1700, 'ZZ Map Seller D');
    assert.equal(r.state, 'Staged');
    await decideListings(db, acct, { listingIds: [r.listingId], action: 'include' }, actor);
    const again = await stage(db, 'item/c1', 'TestBrand 65 inch Z9 OLED television', 1650, 'ZZ Map Seller D');
    assert.equal(again.state, 'Included');
    assert.equal(again.decidedBy, 'user');
    assert.ok(again.confidence > r.confidence, 'the prior-decision signal counts the inclusion');

    await decideListings(db, acct, { listingIds: [r.listingId], action: 'exclude', reason: 'Wrong product' }, actor);
    const third = await stage(db, 'item/c1', 'TestBrand 65 inch Z9 OLED television', 1650, 'ZZ Map Seller D');
    assert.equal(third.state, 'Excluded');
  }));

test('restore, retire, apply rules and the input checks', () =>
  withTenant(acct, async (db) => {
    const r = await stage(db, 'item/d1', 'TestBrand 65 inch Z9 OLED television', 1700, 'ZZ Map Seller E');
    await assert.rejects(decideListings(db, acct, { listingIds: [r.listingId], action: 'exclude' }, actor), /reason/);
    await assert.rejects(decideListings(db, acct, { listingIds: [r.listingId], action: 'exclude', reason: 'Wrong product', scope: 'url_pattern', urlPattern: '*.c*' }, actor), /too broad/);
    await decideListings(db, acct, { listingIds: [r.listingId], action: 'retire' }, actor);
    await decideListings(db, acct, { listingIds: [r.listingId], action: 'restore' }, actor);
    assert.equal((await db.query('SELECT state FROM listing_match WHERE listing_id = $1', [r.listingId])).rows[0].state, 'Staged');
    const applied = await applyRules(db, acct);
    assert.ok(applied.checked >= 1);
    assert.equal(await retireListings(db, acct, [r.listingId], 'Absent from 3 crawls'), applied.staged >= 1 ? 1 : 0);
  }));
