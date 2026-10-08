// Learning loop (Phase 4 · M7): weekly QA sample of automatic decisions, verdicts that correct the
// listing and become labels, precision per band, and the routes.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, type Db } from '../../src/lib/db.js';
import { drawSample, listSamples, qaStats, reviewSample } from '../../src/lib/qa.js';
import { closeQueue } from '../../src/lib/queue.js';
import { one, scratch } from './enforcement-world.js';
import { call, createTestAccount, createUser, expectRefused, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
const u: Record<string, TestUser> = {};

before(async () => {
  await removeTestAccounts();
  acct = await createTestAccount('qa');
  u.analyst = await createUser('qa-analyst', 'Analyst', acct);
  u.brand = await createUser('qa-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const now = new Date('2026-10-08T12:00:00Z'); // week of Oct 5: samples decisions made Sep 28 – Oct 4
const person = { type: 'user' as const, id: '00000000-0000-4000-8000-0000000000aa', label: 'qa@test' };

/** A scratch account with `inc` automatic includes and `exc` rule excludes made last week, plus one made this week. */
async function decisions(db: Db, inc: number, exc: number, pct = 50): Promise<string> {
  const account = (await one<{ id: string }>(db,
    `INSERT INTO account (slug, name, brand, status, settings) VALUES ($1, $1, 'TestBrand', 'Sandbox', jsonb_build_object('qa_sample_pct', $2::int)) RETURNING id`,
    [`zz-p1-test-qa-${Date.now()}`, pct])).id;
  const source = (await one<{ id: string }>(db, "SELECT id FROM source WHERE code = 'walmart_us'")).id;
  const product = (await one<{ id: string }>(db,
    "INSERT INTO product (account_id, product_code, name, brand, category) VALUES ($1, 'QA-1', 'Test TV', 'TestBrand', 'TV') RETURNING id", [account])).id;
  const add = async (i: number, state: string, by: string, confidence: number, at: string) => {
    const listing = (await one<{ id: string }>(db, 'INSERT INTO listing (source_id, url) VALUES ($1, $2) RETURNING id',
      [source, `https://www.walmart.com/ip/qa-${Date.now()}-${state}-${i}-${at}`])).id;
    const cand = (await one<{ id: string }>(db,
      `INSERT INTO match_candidate (account_id, listing_id, product_id, title, confidence, band, origin) VALUES ($1, $2, $3, 'TV', $4, 'include', 'collector') RETURNING id`,
      [account, listing, product, confidence])).id;
    await db.query(
      'INSERT INTO listing_match (account_id, listing_id, product_id, state, confidence, candidate_id, decided_by, state_since) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [account, listing, product, state, confidence, cand, by, new Date(at)]);
  };
  for (let i = 0; i < inc; i++) await add(i, 'Included', 'auto', 90 + i, '2026-09-30T10:00:00Z');
  for (let i = 0; i < exc; i++) await add(i, 'Excluded', 'rule', 20, '2026-10-01T10:00:00Z');
  await add(99, 'Included', 'auto', 99, '2026-10-06T10:00:00Z'); // this week: next week's sample
  return account;
}

test('the weekly draw: a share of last week’s automatic includes and excludes, once per week', async () => {
  await scratch(async (db) => {
    const account = await decisions(db, 4, 3);
    const r = await drawSample(db, account, now);
    assert.deepEqual(r, { week: '2026-10-05', drawn: 4, included: 2, excluded: 2 }); // 50% of 4; 50% of 3 rounded up
    assert.equal((await drawSample(db, account, now)).drawn, 0);
    const s = await listSamples(db, account, { week: '2026-10-05' });
    assert.equal(s.length, 4);
    assert.ok(s.every((x) => x.matcher_version === 'm1'));
    await expectRefused(db, "UPDATE qa_sample SET week = week + 7 WHERE id = $1", [s[0].id]);
    await expectRefused(db, 'DELETE FROM qa_sample WHERE id = $1', [s[0].id]);
  });
});

test('verdicts: wrong needs a note and corrects the listing (a label); a verdict is given once; precision per band', async () => {
  await scratch(async (db) => {
    const account = await decisions(db, 2, 2, 100);
    await drawSample(db, account, now);
    const s = await listSamples(db, account, {});
    const inc = s.filter((x) => x.state === 'Included');
    const exc = s.filter((x) => x.state === 'Excluded');
    assert.deepEqual([inc.length, exc.length], [2, 2]);

    await assert.rejects(reviewSample(db, account, inc[0].id, 'wrong', null, person), /say what was wrong/);
    const w = await reviewSample(db, account, inc[0].id, 'wrong', 'Different model: 15 inch, not 16', person);
    assert.equal(w.corrected, 'Excluded');
    const m = await one<{ state: string; reason: string; decided_by: string }>(db, 'SELECT state, reason, decided_by FROM listing_match WHERE listing_id = $1', [inc[0].listing_id]);
    assert.deepEqual([m.state, m.reason, m.decided_by], ['Excluded', 'QA: Different model: 15 inch, not 16', 'user']);
    const label = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM listing_state_event WHERE listing_id = $1 AND is_label', [inc[0].listing_id]);
    assert.equal(label.n, 1);
    await reviewSample(db, account, inc[1].id, 'correct', null, person);
    await assert.rejects(reviewSample(db, account, inc[1].id, 'wrong', 'changed my mind', person), /already marked/);

    const back = await reviewSample(db, account, exc[0].id, 'wrong', 'It is the right TV', person);
    assert.equal(back.corrected, 'Staged');
    await reviewSample(db, account, exc[1].id, 'correct', null, person);

    const st = await qaStats(db, account);
    assert.deepEqual([st.included.reviewed, st.included.correct, st.included.precision], [2, 1, 50]);
    assert.deepEqual([st.excluded.reviewed, st.excluded.precision], [2, 50]);
    assert.deepEqual(st.bands.map((b) => [b.state, b.band, b.reviewed]).sort(), [['Excluded', 'Rule / suppression', 2], ['Included', '90–94', 2]]);
  });
});

test('routes: Analysts see and review the sample; Brand users do not see Mapping Center', async () => {
  const base = `/accounts/${acct}/mapping/qa`;
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(app, u.brand, 'GET', base)).statusCode, 403);
  const list = await call(app, u.analyst, 'GET', `${base}?open=true`);
  assert.equal(list.statusCode, 200, list.body);
  const stats = await call(app, u.analyst, 'GET', `${base}/stats`);
  assert.equal(stats.statusCode, 200, stats.body);
  assert.equal(stats.json().included.precision, null);
  const draw = await call(app, u.analyst, 'POST', `${base}/draw`, {});
  assert.equal(draw.statusCode, 200, draw.body);
  assert.equal(draw.json().drawn, 0); // nothing automatic last week in a fresh account
  assert.equal((await call(app, u.analyst, 'POST', `${base}/${missing}/review`, { verdict: 'maybe' })).statusCode, 400);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/${missing}/review`, { verdict: 'correct' })).statusCode, 404);
});
