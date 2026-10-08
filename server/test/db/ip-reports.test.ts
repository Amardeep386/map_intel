// IP track (Phase 4 · M5): reports only on IP cases and on the case's own marketplace, a filed
// report needs its reference, outcomes and withdrawals need notes, and the evidence pack.
//   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { createCase, updateCase } from '../../src/lib/cases.js';
import { closeDb } from '../../src/lib/db.js';
import { closeReport, createReport, evidencePack, fileReport, listReports, reportDetail } from '../../src/lib/ipReports.js';
import { closeQueue } from '../../src/lib/queue.js';
import { scratch, world } from './enforcement-world.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
const u: Record<string, TestUser> = {};

before(async () => {
  await removeTestAccounts();
  acct = await createTestAccount('ip-reports');
  u.analyst = await createUser('ip-analyst', 'Analyst', acct);
  u.brand = await createUser('ip-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const claim = { channel: 'walmart_brand_portal' as const, ipBasis: 'counterfeit' as const, reason: 'Box shows a serial number LG never issued' };

test('a pricing case is never filed as IP; the channel must be the case’s marketplace', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'ip-guard');
    const [a] = w.sellers;
    const c = await createCase(db, w.account, { violationIds: w.violations[a] }, null);
    await assert.rejects(createReport(db, w.account, c.id, claim, null), /pricing case/);
    await updateCase(db, w.account, c.id, { ipIssue: true, ipReason: 'LG flagged counterfeit units from this seller' });
    await assert.rejects(createReport(db, w.account, c.id, { ...claim, channel: 'ebay_vero' }, null), /only covers listings on that marketplace/);
    const r = await createReport(db, w.account, c.id, claim, null);
    assert.equal(r.code, 'IP-00001');
    const d = await reportDetail(db, r.id);
    assert.deepEqual([d!.status, d!.channel_label, d!.basis_label, d!.case_code], ['Draft', 'Walmart Brand Portal', 'Counterfeit', 'C-00001']);
    // Once a case has reports it stays an IP issue.
    await assert.rejects(updateCase(db, w.account, c.id, { ipIssue: false }), /stays an IP issue/);
  });
});

test('filing needs the marketplace reference; outcomes follow filing; withdrawals and rejections need a note', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'ip-flow');
    const [a] = w.sellers;
    const c = await createCase(db, w.account, { violationIds: w.violations[a] }, null);
    await updateCase(db, w.account, c.id, { ipIssue: true, ipReason: 'Brand images copied' });
    const r = await createReport(db, w.account, c.id, { ...claim, ipBasis: 'copyright', reason: 'Listing uses LG product photos' }, null);
    await assert.rejects(closeReport(db, r.id, 'Accepted', null), /Draft: it cannot become Accepted/);
    await assert.rejects(fileReport(db, r.id, '  ', null, null), /reference/);
    await fileReport(db, r.id, 'WBP-2026-1182', '2026-10-08T10:00:00Z', null);
    await assert.rejects(fileReport(db, r.id, 'again', null, null), /Filed/);
    await assert.rejects(closeReport(db, r.id, 'Rejected', null), /needs a note/);
    await closeReport(db, r.id, 'Accepted', null);
    const d = await reportDetail(db, r.id);
    assert.deepEqual([d!.status, d!.reference, new Date(d!.filed_at).toISOString()], ['Accepted', 'WBP-2026-1182', '2026-10-08T10:00:00.000Z']);

    const r2 = await createReport(db, w.account, c.id, claim, null);
    await assert.rejects(closeReport(db, r2.id, 'Withdrawn', ''), /needs a note/);
    await closeReport(db, r2.id, 'Withdrawn', 'Brand decided not to pursue');
    assert.deepEqual((await listReports(db, w.account, { caseId: c.id })).map((x) => [x.code, x.status]), [['IP-00002', 'Withdrawn'], ['IP-00001', 'Accepted']]);
  });
});

test('the evidence pack lists the claim and each listing with its record hash and a fresh secure link', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'ip-pack');
    const [a] = w.sellers;
    const c = await createCase(db, w.account, { violationIds: w.violations[a] }, null);
    await updateCase(db, w.account, c.id, { ipIssue: true, ipReason: 'Counterfeit' });
    const r = await createReport(db, w.account, c.id, claim, null);
    const pack = await evidencePack(db, w.account, r.id, null);
    assert.equal(pack.code, 'IP-00001');
    assert.match(pack.text, /^EVIDENCE PACK IP-00001 — TestBrand\r\nChannel: Walmart Brand Portal\r\nBasis: Counterfeit\r\nClaim: Box shows/);
    assert.match(pack.text, /Seller: Case Seller A \(Walmart/);
    assert.equal(pack.text.match(/Record SHA-256: [0-9a-f]{64}/g)?.length, 2);
    assert.equal(pack.text.match(/Listing: https:\/\/www\.walmart\.com\/ip\/case-ip-pack-/g)?.length, 2);
    const links = (await db.query("SELECT count(*)::int AS n FROM evidence_link WHERE account_id = $1 AND created_via = 'ip_report'", [w.account])).rows[0].n;
    assert.equal(links, 2);
  });
});

test('routes: Brand users read IP reports but cannot draft, file or download packs; validation and 404s', async () => {
  const base = `/accounts/${acct}`;
  const missing = '00000000-0000-4000-8000-000000000000';
  const list = await call(app, u.brand, 'GET', `${base}/ip-reports`);
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(list.json(), []);
  assert.equal((await call(app, u.brand, 'POST', `${base}/cases/${missing}/ip-reports`, claim)).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/cases/${missing}/ip-reports`, { ...claim, channel: 'tiktok' })).statusCode, 400);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/cases/${missing}/ip-reports`, claim)).statusCode, 404);
  assert.equal((await call(app, u.brand, 'GET', `${base}/ip-reports/${missing}/pack`)).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'GET', `${base}/ip-reports/${missing}/pack`)).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/ip-reports/${missing}/file`, { reference: 'X-1' })).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/ip-reports/${missing}/outcome`, { status: 'Filed' })).statusCode, 400);
});
