// Notices, templates and the communications log (Phase 4 · M3): a letter filled from the case's
// violations with secure evidence links, frozen once submitted, brand approval before it goes out,
// "sent" = logged, Under notice, contests, template versions, and the routes.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { caseDetail, createCase } from '../../src/lib/cases.js';
import { closeDb, type Db } from '../../src/lib/db.js';
import {
  cancelNotice, createTemplate, decideNotice, draftNotice, editNotice, fill, listCommunications, listTemplates, logCommunication,
  noticeDetail, noticeText, sendNotice, submitNotice, unfilled, updateTemplate,
} from '../../src/lib/notices.js';
import { closeQueue } from '../../src/lib/queue.js';
import { one, scratch, world, type World } from './enforcement-world.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
const u: Record<string, TestUser> = {};

before(async () => {
  await removeTestAccounts();
  acct = await createTestAccount('notices');
  u.manager = await createUser('notice-manager', 'Account manager', acct);
  u.analyst = await createUser('notice-analyst', 'Analyst', acct);
  u.brand = await createUser('notice-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

const template = async (db: Db, account: string, code: string) =>
  (await one<{ id: string }>(db, 'SELECT id FROM notice_template WHERE account_id = $1 AND code = $2', [account, code])).id;
const statusOf = async (db: Db, violationId: string) => (await one<{ status: string }>(db, 'SELECT status FROM violation_current WHERE id = $1', [violationId])).status;

/** A case for seller A's two violations, with an email contact for notices. */
async function caseFor(db: Db, w: World) {
  const [a] = w.sellers;
  await db.query("INSERT INTO seller_contact (account_id, seller_id, kind, value, label) VALUES ($1, $2, 'email', 'other@seller.invalid', 'Sales')", [w.account, a]);
  await db.query("INSERT INTO seller_contact (account_id, seller_id, kind, value, label) VALUES ($1, $2, 'email', 'compliance@seller.invalid', 'Notices')", [w.account, a]);
  return createCase(db, w.account, { violationIds: w.violations[a], responseDue: '2026-10-20' }, null);
}

test('placeholders: filled when known, left in place (and reported) when not', () => {
  assert.equal(fill('Hi {{seller}}, {{ brand }} {{nope}}', { seller: 'S', brand: 'LG' }), 'Hi S, LG {{nope}}');
  assert.deepEqual(unfilled('a {{x}} b {{ y }} {{x}}'), ['x', 'y']);
});

test('a drafted letter lists every active violation with prices and a secure evidence link; recipients from the seller’s contacts', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'draft');
    const c = await caseFor(db, w);
    const r = await draftNotice(db, w.account, c.id, { templateId: await template(db, w.account, 'T-1') }, null);
    assert.equal(r.code, 'N-00001');
    const n = await noticeDetail(db, r.id);
    assert.equal(n!.status, 'Draft');
    assert.equal(n!.needs_approval, true);
    assert.deepEqual(n!.recipients, ['compliance@seller.invalid', 'other@seller.invalid']); // "Notices" first
    assert.equal(n!.subject, 'Advertised prices below the TestBrand Minimum Advertised Price policy');
    assert.deepEqual(unfilled(n!.body), []);
    assert.match(n!.body, /To: Case Seller A \(Walmart/);
    assert.match(n!.body, /2 listing\(s\)/);
    assert.match(n!.body, /Advertised \$700\.00 vs MAP \$1,000\.00 \(30\.0% below\)/);
    assert.match(n!.body, /Oct 20, 2026/);
    assert.equal(n!.evidence.length, 2);
    for (const e of n!.evidence) assert.ok(n!.body.includes(e.url), 'each evidence link is in the letter');
    const links = (await db.query("SELECT created_via, scope FROM evidence_link WHERE id = ANY($1::uuid[])", [n!.evidence.map((e: { linkId: string }) => e.linkId)])).rows;
    assert.deepEqual(links.map((l) => [l.created_via, l.scope]), [['notice', 'violation:view'], ['notice', 'violation:view']]);
    assert.match(noticeText({ ...n!, recipients: n!.recipients }), /^To: compliance@seller\.invalid, other@seller\.invalid\r\nSubject: /);
  });
});

test('brand approval: frozen once submitted, no send before approval, rejection needs a note; sending logs it and puts violations Under notice', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'approve');
    const [a] = w.sellers;
    const c = await caseFor(db, w);
    const first = await draftNotice(db, w.account, c.id, { templateId: await template(db, w.account, 'T-1') }, null);
    await editNotice(db, first.id, { body: 'Short letter with a {{typo}}' });
    await assert.rejects(submitNotice(db, first.id), /fill in \{\{typo\}\}/);
    await editNotice(db, first.id, { body: 'Short letter.' });
    await assert.rejects(sendNotice(db, w.account, first.id, 'email', null), /needs brand approval/);
    await submitNotice(db, first.id);
    await assert.rejects(editNotice(db, first.id, { body: 'Changed after submit' }), /only a draft/);
    await assert.rejects(decideNotice(db, first.id, false, null, null), /needs a note/);
    await decideNotice(db, first.id, false, 'Too harsh for an authorised reseller', null);
    assert.equal((await noticeDetail(db, first.id))!.status, 'Rejected');
    await assert.rejects(sendNotice(db, w.account, first.id, 'email', null), /Rejected/);

    const second = await draftNotice(db, w.account, c.id, { templateId: await template(db, w.account, 'T-2') }, null);
    await submitNotice(db, second.id);
    await decideNotice(db, second.id, true, null, null);
    assert.equal(await statusOf(db, w.violations[a][0]), 'Open');
    const sent = await sendNotice(db, w.account, second.id, 'email', null);
    assert.deepEqual([sent.logged, sent.underNotice], [true, 2]);

    const n = await noticeDetail(db, second.id);
    assert.deepEqual([n!.status, n!.delivery, n!.provider], ['Sent', 'logged', 'log']);
    for (const v of w.violations[a]) assert.equal(await statusOf(db, v), 'Under notice');
    const det = await caseDetail(db, c.id);
    assert.equal(det!.state, 'Notice sent');
    const log = await listCommunications(db, w.account, { caseId: c.id });
    assert.deepEqual(log.map((m) => [m.direction, m.kind, m.notice_code]), [['outbound', 'notice', 'N-00002']]);
    await assert.rejects(cancelNotice(db, second.id), /Sent/);
  });
});

test('without brand approval a draft is sent directly; another channel needs no email address; a contest moves the case to Contested', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'direct');
    const [, b] = w.sellers;
    await db.query(`UPDATE account SET settings = settings || '{"brand_approval_required": false}' WHERE id = $1`, [w.account]);
    const c = await createCase(db, w.account, { violationIds: w.violations[b] }, null); // seller B has no contacts
    const n = await draftNotice(db, w.account, c.id, { templateId: await template(db, w.account, 'T-1') }, null);
    assert.deepEqual((await noticeDetail(db, n.id))!.recipients, []);
    await assert.rejects(submitNotice(db, n.id), /does not need brand approval/);
    await assert.rejects(sendNotice(db, w.account, n.id, 'email', null), /email address/);
    const sent = await sendNotice(db, w.account, n.id, 'marketplace message', null);
    assert.equal(sent.logged, false);

    await logCommunication(db, w.account, c.id, { kind: 'response', summary: 'Seller says they will fix it Monday' }, null);
    assert.equal((await caseDetail(db, c.id))!.state, 'Notice sent');
    const r = await logCommunication(db, w.account, c.id, { kind: 'contest', channel: 'marketplace message', summary: 'Seller says the price includes a used item' }, null);
    assert.equal(r.moved, 'Contested');
    const det = await caseDetail(db, c.id);
    assert.equal(det!.state, 'Contested');
    const log = await listCommunications(db, w.account, { caseId: c.id });
    assert.deepEqual(log.map((m) => m.kind), ['contest', 'response', 'notice']);
  });
});

test('templates: unknown placeholders refused; an edit raises the version and earlier notices keep their text', async () => {
  await scratch(async (db) => {
    const w = await world(db, 'tpl');
    const c = await caseFor(db, w);
    const t1 = await template(db, w.account, 'T-1');
    const before = await draftNotice(db, w.account, c.id, { templateId: t1 }, null);
    await assert.rejects(updateTemplate(db, t1, { body: 'Dear {{sellerName}}' }, null), /unknown placeholder \{\{sellerName\}\}/);
    await updateTemplate(db, t1, { body: 'Dear {{seller}}, please fix {{violationCount}} listing(s).' }, null);
    const t = (await listTemplates(db, w.account)).find((x) => x.id === t1)!;
    assert.equal(t.version, 2);
    const old = await noticeDetail(db, before.id);
    assert.equal(old!.template_version, 1);
    assert.match(old!.body, /Minimum Advertised Price \(MAP\)/);
    const after = await draftNotice(db, w.account, c.id, { templateId: t1 }, null);
    assert.equal((await noticeDetail(db, after.id))!.body, 'Dear Case Seller A, please fix 2 listing(s).');

    const added = await createTemplate(db, w.account, { name: 'Courtesy note', subject: 'About {{brand}} prices', body: 'Hello {{seller}}' }, null);
    assert.equal(added.code, 'T-4');
    await updateTemplate(db, added.id, { active: false }, null);
    await assert.rejects(draftNotice(db, w.account, c.id, { templateId: added.id }, null), /switched off/);
  });
});

test('routes: only Brand users approve; Analysts draft and send; templates need settings rights; 404s', async () => {
  const base = `/accounts/${acct}`;
  const missing = '00000000-0000-4000-8000-000000000000';
  for (const user of [u.analyst, u.manager]) {
    assert.equal((await call(app, user, 'POST', `${base}/notices/${missing}/approve`, {})).statusCode, 403);
  }
  assert.equal((await call(app, u.brand, 'POST', `${base}/notices/${missing}/approve`, {})).statusCode, 404);
  assert.equal((await call(app, u.brand, 'POST', `${base}/notices/${missing}/send`, {})).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/notices/${missing}/send`, { channel: 'pigeon' })).statusCode, 400);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/notices/${missing}/send`, {})).statusCode, 404);
  assert.equal((await call(app, u.brand, 'POST', `${base}/cases/${missing}/notices`, { templateId: missing })).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/cases/${missing}/notices`, { templateId: missing })).statusCode, 404);
  assert.equal((await call(app, u.analyst, 'GET', `${base}/notices/${missing}/text`)).statusCode, 404);

  const approvals = await call(app, u.brand, 'GET', `${base}/notices?status=Awaiting%20approval`);
  assert.equal(approvals.statusCode, 200, approvals.body);
  assert.deepEqual(approvals.json(), []);
  assert.equal((await call(app, u.brand, 'GET', `${base}/notices?status=Bogus`)).statusCode, 400);

  const templates = await call(app, u.brand, 'GET', `${base}/notice-templates`);
  assert.deepEqual(templates.json().map((t: { code: string }) => t.code), ['T-1', 'T-2', 'T-3']);
  const t1 = templates.json()[0].id;
  assert.equal((await call(app, u.analyst, 'PATCH', `${base}/notice-templates/${t1}`, { name: 'x' })).statusCode, 403);
  const edited = await call(app, u.manager, 'PATCH', `${base}/notice-templates/${t1}`, { usedFor: 'Unauthorised sellers (first offence)' });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().version, 1); // wording unchanged: same version

  assert.equal((await call(app, u.brand, 'GET', `${base}/communications`)).statusCode, 200);
  assert.equal((await call(app, u.brand, 'POST', `${base}/cases/${missing}/communications`, { kind: 'note', summary: 'x' })).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'POST', `${base}/cases/${missing}/communications`, { kind: 'note', summary: 'x' })).statusCode, 404);
});
