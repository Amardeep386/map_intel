// Phase 4 exit test: a violation goes detected → notice sent → resolved and re-verified, without a
// spreadsheet.
//
//   npm run exit:p4 -- --scope lg-slice
//
// Decision 42: P4 is built on the LG slice. Two parts:
//   A. The whole flow in a throwaway copy (one transaction, rolled back at the end, so no
//      observation or letter is left behind): judged violations → case → notice from a template with
//      secure evidence links → brand approval (no send before it, letter frozen) → logged as sent →
//      Under notice and picked up by the re-check scheduler → a still-low re-check keeps the case
//      open → a compliant re-check resolves it with the observation as proof → alerts once each →
//      a re-offence alerts and the new case marks the old one Recurred → seller risk; a pricing case
//      is never filed as IP.
//   B. LG's real data through the API: a real case on V-00002 (certrbtech) opened by the Mirethos
//      admin (kept: it stays open until the seller fixes the price; no letter is drafted or sent —
//      that is the user's step after the legal review of the wording); a Brand user sees it but
//      cannot open cases, an Analyst cannot approve; nothing is under notice yet so the 6-hourly
//      re-check skips; alerts stay deduplicated; migrations 036–040 applied.
// Writes reports/exit-p4-<date>.md. Test users are removed at the end.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { evaluateAlerts } from '../lib/alerts.js';
import { signToken } from '../lib/auth.js';
import { caseDetail, createCase, moveCase } from '../lib/cases.js';
import { config } from '../lib/config.js';
import { closeDb, pool, withSystem, type Db } from '../lib/db.js';
import { openLink } from '../lib/evidenceLinks.js';
import { createReport } from '../lib/ipReports.js';
import { judgeAccount } from '../lib/judge.js';
import { decideNotice, draftNotice, editNotice, listCommunications, noticeDetail, noticeText, sendNotice, submitNotice, unfilled } from '../lib/notices.js';
import { closeQueue } from '../lib/queue.js';
import { sellerStats } from '../lib/sellerRisk.js';
import { loadAccountWork } from '../scheduler/tick.js';

const TEST_DOMAIN = 'exit-p4.mirethos.invalid';
const here = path.dirname(fileURLToPath(import.meta.url));
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const { values } = parseArgs({ options: { scope: { type: 'string' } } });
if (values.scope !== 'lg-slice') throw new Error('usage: npm run exit:p4 -- --scope lg-slice (the three-brand run comes with the collection push)');

const checks: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const refused = async (p: Promise<unknown>, pattern: RegExp): Promise<boolean> => p.then(() => false, (e: Error) => pattern.test(e.message));

function call(app: FastifyInstance, token: string | null, method: string, url: string, payload?: unknown) {
  return app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as Record<string, unknown> | undefined });
}

async function adminToken(): Promise<string> {
  const admin = await withSystem(async (db) =>
    (await db.query<{ id: string; email: string }>(`SELECT id, email FROM app_user WHERE lower(email) = lower($1) AND platform_role = 'admin'`, [config.SEED_ADMIN_EMAIL ?? ''])).rows[0]);
  if (!admin) throw new Error('the seed admin (SEED_ADMIN_EMAIL) was not found');
  return signToken({ sub: admin.id, email: admin.email, role: 'admin' });
}

async function invite(app: FastifyInstance, admin: string, accountId: string, label: string, role: string): Promise<string> {
  const email = `${label}@${TEST_DOMAIN}`;
  const res = await call(app, admin, 'POST', `/accounts/${accountId}/users/invite`, { email, name: `Exit test ${label}`, role });
  if (res.statusCode !== 201) throw new Error(`invite ${email}: ${res.statusCode} ${res.body}`);
  const token = new URL(res.json().inviteUrl).searchParams.get('invite');
  const accepted = await call(app, null, 'POST', '/auth/accept-invite', { token, password: `exit-test-${crypto.randomUUID()}` });
  if (accepted.statusCode !== 200) throw new Error(`accept ${email}: ${accepted.statusCode} ${accepted.body}`);
  return accepted.json().token;
}

async function cleanup(app: FastifyInstance, admin: string): Promise<void> {
  const users = await withSystem(async (db) => (await db.query<{ user_id: string; account_id: string }>(
    'SELECT m.user_id, m.account_id FROM account_membership m JOIN app_user u ON u.id = m.user_id WHERE u.email LIKE $1', [`%@${TEST_DOMAIN}`])).rows);
  for (const u of users) await call(app, admin, 'DELETE', `/accounts/${u.account_id}/users/${u.user_id}`);
  await withSystem((db) => db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_DOMAIN}`]));
}

const one = async <T = Json>(db: Db, sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as T;
const alertTitles = async (db: Db, account: string, code: string) =>
  (await db.query<{ title: string }>('SELECT e.title FROM alert_event e JOIN alert_rule r ON r.id = e.alert_rule_id WHERE e.account_id = $1 AND r.code = $2', [account, code])).rows.map((r) => r.title);

/** Part A: the whole flow in a throwaway account, inside one transaction that is rolled back. */
async function partA(lines: string[]): Promise<void> {
  const db = await pool().connect();
  try {
    await db.query("BEGIN; SELECT set_config('app.role', 'system', true)");
    const account = (await one<{ id: string }>(db,
      "INSERT INTO account (slug, name, brand, status) VALUES ($1, 'Exit P4 copy', 'LG', 'Sandbox') RETURNING id", [`zz-exit-p4-${Date.now()}`])).id;
    const source = (await one<{ id: string }>(db, "SELECT id FROM source WHERE code = 'walmart_us'")).id;
    const product = (await one<{ id: string }>(db,
      "INSERT INTO product (account_id, product_code, name, brand, category) VALUES ($1, '16Z90TL-TEST', 'LG gram 16 (exit test copy)', 'LG', 'Laptop') RETURNING id", [account])).id;
    await db.query("INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1999, now() - interval '30 days')", [account, product]);
    const seller = (await one<{ id: string }>(db, 'INSERT INTO seller (source_id, name, name_key) VALUES ($1, $2, $3) RETURNING id', [source, 'Exit Test Seller', `exit test seller ${Date.now()}`])).id;
    await db.query("INSERT INTO seller_contact (account_id, seller_id, kind, value, label) VALUES ($1, $2, 'email', 'compliance@exit-test.invalid', 'Notices')", [account, seller]);
    const listings: string[] = [];
    for (const n of [1, 2]) {
      const l = (await one<{ id: string }>(db, 'INSERT INTO listing (source_id, url, seller_id) VALUES ($1, $2, $3) RETURNING id',
        [source, `https://www.walmart.com/ip/exit-p4-${Date.now()}-${n}`, seller])).id;
      await db.query("INSERT INTO listing_match (account_id, listing_id, product_id, state, decided_by) VALUES ($1, $2, $3, 'Included', 'user')", [account, l, product]);
      listings.push(l);
    }
    const observe = (l: string, ago: string, price: number) => db.query(
      // clock_timestamp, not now(): inside one transaction now() stays at its start.
      `INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES (clock_timestamp() - $2::interval, $1, 'ok', $3, 'USD', $4)`, [l, ago, price, seller]);

    // 1. Detected.
    await observe(listings[0], '3 days', 1499.99);
    await observe(listings[1], '3 days', 1599);
    await judgeAccount(db, account, { trigger: 'test' });
    const vs = (await db.query<{ id: string; status: string }>('SELECT id, status FROM violation_current WHERE account_id = $1 ORDER BY seq', [account])).rows;
    check('A1 Detected: the judge opens a violation for each listing below MAP', vs.length === 2 && vs.every((v) => v.status === 'Open'), vs.map((v) => v.status).join(', '));

    // 2. Case.
    const c = await createCase(db, account, { violationIds: vs.map((v) => v.id) }, null);
    const det = await caseDetail(db, c.id);
    check('A2 Case opened for the seller’s violations, response due in 7 days; violations still Open', det?.state === 'Open' && det.violations.length === 2 && det.violations.every((v: Json) => v.status === 'Open'),
      `${c.code}, due ${det?.response_due}`);
    check('A3 A pricing case is never filed as an IP report', await refused(createReport(db, account, c.id, { channel: 'walmart_brand_portal', ipBasis: 'trademark', reason: 'x' }, null), /pricing case/));

    // 3. Notice.
    const t1 = (await one<{ id: string }>(db, "SELECT id FROM notice_template WHERE account_id = $1 AND code = 'T-1'", [account])).id;
    const nd = await draftNotice(db, account, c.id, { templateId: t1 }, null);
    let n = await noticeDetail(db, nd.id);
    const tokens = (n!.evidence as Json[]).map((e) => e.url.split('/evidence/')[1]);
    const opened = await Promise.all(tokens.map((t) => openLink(db, t)));
    check('A4 Notice drafted from T-1: every placeholder filled, recipients from the seller’s contact, a working secure evidence link per violation',
      unfilled(`${n!.subject}\n${n!.body}`).length === 0 && n!.recipients[0] === 'compliance@exit-test.invalid' && opened.length === 2 && opened.every((o) => o?.state === 'open')
        && tokens.every((t) => n!.body.includes(t)),
      `${nd.code}: ${n!.recipients.join(', ')}; links ${opened.map((o) => o?.state).join(', ')}`);

    // 4. Brand approval.
    const noSendYet = await refused(sendNotice(db, account, nd.id, 'email', null), /needs brand approval/);
    await submitNotice(db, nd.id);
    const frozen = await refused(editNotice(db, nd.id, { body: 'changed after review' }), /only a draft/);
    await evaluateAlerts(db, account);
    const a04 = await alertTitles(db, account, 'A-04');
    await evaluateAlerts(db, account);
    check('A5 Brand approval: no send before it, the letter is frozen once submitted, the approval alert is raised once',
      noSendYet && frozen && a04.length === 1 && (await alertTitles(db, account, 'A-04')).length === 1, a04[0] ?? 'no alert');
    await decideNotice(db, nd.id, true, null, null);

    // 5. Sent (logged).
    const sent = await sendNotice(db, account, nd.id, 'email', null);
    n = await noticeDetail(db, nd.id);
    const after = await caseDetail(db, c.id);
    const comms = await listCommunications(db, account, { caseId: c.id });
    check('A6 Notice sent: logged by the mailer (no provider claims delivery), in the communications log; case Notice sent; violations Under notice',
      n!.status === 'Sent' && n!.delivery === 'logged' && n!.provider === 'log' && comms.some((m) => m.kind === 'notice' && m.direction === 'outbound')
        && after?.state === 'Notice sent' && after.violations.every((v: Json) => v.status === 'Under notice') && sent.underNotice === 2,
      `${n!.status} (${n!.delivery}); case ${after?.state}; ${sent.underNotice} under notice`);
    const work = await loadAccountWork(db, account);
    const flagged = work.listings.filter((l) => l.underNotice).length;
    check('A7 The 6-hourly re-check sees both listings as under notice', flagged === 2, `${flagged} of ${work.listings.length} listings`);

    // 6. Re-check: one still low, then both compliant.
    await observe(listings[0], '2 days', 1999);
    await observe(listings[1], '2 days', 1649);
    let r = await judgeAccount(db, account, { trigger: 'test' });
    const stillOpen = (await caseDetail(db, c.id))?.state;
    check('A8 A re-check with one listing still below MAP keeps the case open', r.casesResolved === 0 && stillOpen === 'Notice sent', `case ${stillOpen}`);
    await observe(listings[1], '1 day', 2049);
    r = await judgeAccount(db, account, { trigger: 'test' });
    const resolved = await caseDetail(db, c.id);
    const last = resolved?.events.at(-1);
    check('A9 Resolved and re-verified: the compliant re-check resolves the case, with that observation as proof',
      r.casesResolved === 1 && resolved?.state === 'Resolved' && last?.actor === 'System' && !!last?.observed_at && resolved.violations.every((v: Json) => v.status === 'Resolved'),
      `${resolved?.state} by ${last?.actor}: ${last?.reason}; proof observed ${last?.observed_at ? new Date(last.observed_at).toISOString() : '—'}`);
    await evaluateAlerts(db, account);
    check('A10 The case-resolved alert is raised', (await alertTitles(db, account, 'A-07')).length === 1, (await alertTitles(db, account, 'A-07'))[0] ?? '');

    // 7. Without a spreadsheet: everything is in the record.
    const text = noticeText(n as never);
    check('A11 Without a spreadsheet: case history, letter, evidence links, communications and proof are all in MAP Intel',
      resolved!.events.length >= 3 && text.includes(n!.subject) && (n!.evidence as Json[]).length === 2 && comms.length >= 1,
      `${resolved!.events.map((e: Json) => e.state).join(' → ')}; letter ${text.length} chars`);

    // 8. Re-offence.
    await observe(listings[0], '-1 minute', 1399);
    await judgeAccount(db, account, { trigger: 'test' });
    await evaluateAlerts(db, account);
    const a06 = await alertTitles(db, account, 'A-06');
    const fresh = (await db.query<{ id: string }>("SELECT id FROM violation_current WHERE account_id = $1 AND NOT episode_closed", [account])).rows.map((x) => x.id);
    const again = await createCase(db, account, { violationIds: fresh }, null);
    const old = await caseDetail(db, c.id);
    check('A12 Re-offence: alerted once, and the new case marks the resolved one Recurred', a06.length === 1 && again.recurredFrom === c.code && old?.state === 'Recurred',
      `${a06[0] ?? 'no alert'}; ${again.code} recurred from ${again.recurredFrom}`);
    await moveCase(db, account, again.id, 'Escalated', 'Second breach within 60 days', null);
    const risk = (await sellerStats(db, account, [seller])).get(seller);
    check('A13 Seller risk reflects the history (violations, a repeat)', !!risk && risk.risk > 0 && risk.repeats >= 1, `risk ${risk?.risk}, ${risk?.violations} violations, ${risk?.repeats} repeat`);
    lines.push(`- Part A ran in one transaction on a throwaway account and was rolled back: nothing from it is stored.`);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
}

/** Part B: LG's real data through the API. */
async function partB(app: FastifyInstance, admin: string, lines: string[]): Promise<void> {
  const lg = await withSystem(async (db) => (await db.query<{ id: string }>("SELECT id FROM account WHERE slug = 'lg'")).rows[0]);
  const base = `/accounts/${lg.id}`;
  const migrations = await withSystem(async (db) =>
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name ~ '^0(3[6-9]|40)_' ORDER BY name")).rows.map((m) => m.name));
  check('B1 Migrations 036–040 are applied', migrations.length === 5, migrations.join(', '));

  const v = await withSystem(async (db) => (await db.query<Json>(
    `SELECT v.id, v.status, v.episode_closed, se.name AS seller, cv.case_id FROM violation_current v JOIN seller se ON se.id = v.seller_id
       LEFT JOIN case_violation cv ON cv.violation_id = v.id WHERE v.account_id = $1 AND v.seq = 2`, [lg.id])).rows[0]);
  if (!v) throw new Error('LG V-00002 not found');
  let caseId: string = v.case_id;
  if (!caseId) {
    const res = await call(app, admin, 'POST', `${base}/cases`, { violationIds: [v.id], note: 'P4 exit test: real case on V-00002 (certrbtech); stays open until the seller fixes the price' });
    if (res.statusCode !== 200) throw new Error(`open case: ${res.statusCode} ${res.body}`);
    caseId = res.json().id;
    lines.push(`- Opened the real case ${res.json().code} on V-00002 (${v.seller}) as the Mirethos admin. It stays open: no letter drafted or sent (your step, after the legal review).`);
  } else {
    lines.push('- V-00002 was already in a case; that case was checked instead of opening another.');
  }
  const c = (await call(app, admin, 'GET', `${base}/cases/${caseId}`)).json();
  check('B2 Real case on V-00002 (certrbtech): open, with a response date; the violation is not yet under notice',
    !c.closed && v.seller === 'certrbtech' && !!c.response_due && c.violations.some((x: Json) => x.code === 'V-00002' && x.status !== 'Under notice'),
    `${c.code} ${c.state}, due ${c.response_due}, V-00002 ${c.violations.find((x: Json) => x.code === 'V-00002')?.status}`);

  const brand = await invite(app, admin, lg.id, 'brand', 'Brand user');
  const analyst = await invite(app, admin, lg.id, 'analyst', 'Analyst');
  const seen = await call(app, brand, 'GET', `${base}/cases?open=true`);
  const brandOpen = await call(app, brand, 'POST', `${base}/cases`, { violationIds: [v.id] });
  const analystApprove = await call(app, analyst, 'POST', `${base}/notices/00000000-0000-4000-8000-000000000000/approve`, {});
  check('B3 Permissions: a Brand user sees the case but cannot open cases; an Analyst cannot approve notices',
    seen.statusCode === 200 && seen.json().rows.some((x: Json) => x.id === caseId) && brandOpen.statusCode === 403 && analystApprove.statusCode === 403,
    `brand list ${seen.statusCode}, brand open ${brandOpen.statusCode}, analyst approve ${analystApprove.statusCode}`);

  const pending = await withSystem(async (db) => {
    const n = (await db.query<{ n: number }>(
      `SELECT count(DISTINCT m.listing_id)::int AS n FROM listing_match m JOIN violation_current v ON v.account_id = m.account_id AND v.listing_id = m.listing_id
        WHERE m.account_id = $1 AND m.state = 'Included' AND NOT v.episode_closed AND v.status = 'Under notice'`, [lg.id])).rows[0].n;
    const s = (await db.query<{ active: boolean; cadence: string }>("SELECT active, cadence FROM schedule WHERE account_id = $1 AND takedown_status = 'Under notice'", [lg.id])).rows;
    return { n, s };
  });
  check('B4 The 6-hourly re-check is set up and skips while nothing is under notice', pending.s.some((s) => s.active && s.cadence === '0 */6 * * *') && pending.n === 0,
    `${pending.n} listings under notice; schedule ${pending.s.map((s) => `${s.cadence}${s.active ? '' : ' (off)'}`).join(', ')}`);

  const first = await withSystem((db) => evaluateAlerts(db, lg.id));
  const second = await withSystem((db) => evaluateAlerts(db, lg.id));
  check('B5 LG alerts with the enforcement rules: a second evaluation raises nothing new', second.raised === 0 && Object.keys(second.byRule).length === 7,
    `first pass ${first.raised} new, second ${second.raised}; rules ${Object.keys(second.byRule).join(', ')}`);
}

async function main(): Promise<void> {
  const started = new Date();
  const lines: string[] = [];
  await partA(lines);
  const app = await buildApp();
  await app.ready();
  const admin = await adminToken();
  try {
    await partB(app, admin, lines);
  } finally {
    await cleanup(app, admin);
    await app.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  const day = started.toISOString().slice(0, 10);
  const out = path.resolve(here, `../../reports/exit-p4-${day}.md`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, [
    `# Phase 4 exit test — LG slice — ${day}`,
    '',
    'Exit test (docs/plan.md): a violation goes detected → notice sent → resolved and re-verified without a spreadsheet.',
    `Scope: LG Sandbox (decision 42). Run ${started.toISOString()} from ${process.env.COLLECT_EGRESS_LABEL ?? 'this PC'}.`,
    '',
    `**Result: ${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}**`,
    '',
    ...checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ` — ${c.detail}` : ''}`),
    '',
    ...lines,
  ].join('\n') + '\n');
  console.log(`\n${passed}/${checks.length} checks passed. Report: ${path.relative(process.cwd(), out)}`);
  if (passed !== checks.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
    await closeDb();
  });
