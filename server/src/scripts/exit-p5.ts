// Phase 5 exit test: onboarding a new brand is a guided flow, not a wiki page or a call.
//
//   npm run exit:p5
//
// Decision 43: P5 is built on the LG slice; this test needs no collected data. Through the API only,
// as the portal does it:
//   A. A Mirethos administrator creates a new brand ("Exit P5 Audio"); its own people are invited and
//      work the seven onboarding steps with the normal screens' calls: catalogue and MAP imports
//      (dry run first), an authorised seller, a source with terms generated from the catalogue, the
//      matrix and a schedule, a weekly report. Go-live is refused until every step is done, then the
//      brand's Administrator takes it live and the baseline crawl fires once. Its audit chain holds.
//   B. The rest of P5 on that brand: the crawl budget forecasts it; an internal ticket; a rule-set
//      replay; a read-only API key and a CSV export; multi-factor sign-in required for the account.
// Everything is removed at the end (account, test users, the seller it created). Writes
// reports/exit-p5-<date>.md.
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { hashPassword, signToken } from '../lib/auth.js';
import { closeDb, withSystem } from '../lib/db.js';
import { stepAt, totp } from '../lib/mfa.js';
import { closeQueue } from '../lib/queue.js';
import { closeRateLimiter } from '../lib/rateLimit.js';
import { fireBaselines } from '../scheduler/tick.js';

const TEST_DOMAIN = 'exit-p5.mirethos.invalid';
const SLUG = 'zz-exit-p5-audio';
const here = path.dirname(fileURLToPath(import.meta.url));
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const checks: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function call(app: FastifyInstance, token: string | null, method: string, url: string, payload?: unknown) {
  return app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as Record<string, unknown> | undefined });
}
async function ok(app: FastifyInstance, token: string | null, method: string, url: string, payload?: unknown, status = [200, 201, 202, 204]): Promise<Json> {
  const r = await call(app, token, method, url, payload);
  if (!status.includes(r.statusCode)) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
  return r.body ? r.json() : {};
}
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n')).toString('base64');
const doneSteps = (s: Json) => (s.steps as Json[]).filter((x) => x.done).map((x) => x.key);

async function invite(app: FastifyInstance, admin: string, accountId: string, label: string, role: string): Promise<{ token: string; email: string; id: string }> {
  const email = `${label}@${TEST_DOMAIN}`;
  const res = await ok(app, admin, 'POST', `/accounts/${accountId}/users/invite`, { email, name: `Exit P5 ${label}`, role });
  const inviteToken = new URL(res.inviteUrl).searchParams.get('invite');
  const accepted = await ok(app, null, 'POST', '/auth/accept-invite', { token: inviteToken, password: `exit-test-${crypto.randomUUID()}` });
  return { token: accepted.token, email, id: accepted.user.id };
}

async function cleanup(): Promise<void> {
  await withSystem(async (db) => {
    const sellers = (await db.query<{ id: string }>("SELECT id FROM seller WHERE name LIKE 'Exit P5 %'")).rows.map((r) => r.id);
    await db.query('DELETE FROM account WHERE slug = $1', [SLUG]);
    if (sellers.length) await db.query('DELETE FROM seller WHERE id = ANY($1::uuid[])', [sellers]);
    await db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_DOMAIN}`]);
    // Test runs use up ticket numbers: start real tickets at T-00001 while there are none.
    if (Number((await db.query('SELECT count(*) FROM ticket')).rows[0].count) === 0) await db.query("SELECT setval('ticket_seq', 1, false)");
  });
}

async function main(): Promise<void> {
  const started = new Date();
  await cleanup();
  const app = await buildApp();
  await app.ready();
  const lines: string[] = [];
  try {
    // A Mirethos administrator (temporary), signed in with MFA.
    const opsEmail = `ops@${TEST_DOMAIN}`;
    const opsId = await withSystem(async (db) => (await db.query<{ id: string }>(
      "INSERT INTO app_user (email, full_name, password_hash, platform_role) VALUES ($1, 'Exit P5 Ops', $2, 'admin') RETURNING id",
      [opsEmail, await hashPassword(crypto.randomUUID())])).rows[0].id);
    const ops = await signToken({ sub: opsId, email: opsEmail, role: 'admin', mfa: true });

    // ------------------------------------------------------------------ A. guided onboarding
    const created = await ok(app, ops, 'POST', '/accounts', {
      name: 'Exit P5 Audio', brand: 'ExitAudio', slug: SLUG, regions: ['US'], currency: 'USD', timezone: 'America/New_York',
      accentLight: '#1f6feb', contractFrom: '2026-10-01', contractTo: '2027-09-30',
    });
    const acct = created.id as string;
    const base = `/accounts/${acct}`;
    check('A1 A Mirethos administrator creates the brand: Onboarding, default rules and alerts in place, only "Rules" done',
      created.status === 'Onboarding' && JSON.stringify(doneSteps(created)) === '["rules"]', `${created.slug}, steps done: ${doneSteps(created).join(', ')}`);

    const early = await call(app, ops, 'POST', `${base}/onboarding/go-live`);
    check('A2 Going live is refused while steps are missing, with what is missing', early.statusCode === 409 && /Catalogue: Products imported/.test(early.json().error));

    // Account: the brand's own people.
    const brandAdmin = await invite(app, ops, acct, 'brand-admin', 'Administrator');
    const brandUser = await invite(app, brandAdmin.token, acct, 'brand-user', 'Brand user');
    let s = await ok(app, brandAdmin.token, 'GET', `${base}/onboarding`);
    const acc = (s.steps as Json[]).find((x) => x.key === 'account')!;
    check('A3 Account: the brand\'s Administrator invites its people; the step is done with no advice left',
      acc.done && (acc.checks as Json[]).every((c) => c.ok), `${(acc.checks as Json[]).map((c) => `${c.key} ${c.ok ? 'ok' : 'open'}`).join(', ')}`);

    // Catalogue: import with a dry run first.
    const catalogue = csv([['SKU', 'Product name', 'Model', 'Category', 'UPC', 'MSRP'],
      ['EXA-100', 'ExitAudio Soundbar 100', 'SB100', 'Soundbar', '000000000109', '399'],
      ['EXA-200', 'ExitAudio Soundbar 200', 'SB200', 'Soundbar', '000000000208', '599'],
      ['EXA-300', 'ExitAudio Subwoofer 300', 'SW300', 'Subwoofer', '000000000307', '299']]);
    const dry = await ok(app, brandAdmin.token, 'POST', `${base}/imports/products`, { fileName: 'exitaudio-catalogue.csv', content: catalogue, dryRun: true });
    const before = (await ok(app, brandAdmin.token, 'GET', `${base}/products`)).length;
    const imp = await ok(app, brandAdmin.token, 'POST', `${base}/imports/products`, { fileName: 'exitaudio-catalogue.csv', content: catalogue, dryRun: false });
    check('A4 Catalogue: the import shows its diff first (nothing saved), then saves 3 products with identifiers',
      dry.summary.new === 3 && before === 0 && imp.summary.new === 3, `dry run ${JSON.stringify(dry.summary)}${dry.problems?.length ? ` ${JSON.stringify(dry.problems.slice(0, 2))}` : ""}`);

    const map = csv([['SKU', 'MAP', 'Effective from'], ['EXA-100', '349', '2026-10-01'], ['EXA-200', '529', '2026-10-01'], ['EXA-300', '249', '2026-10-01']]);
    const mapDry = await ok(app, brandAdmin.token, 'POST', `${base}/imports/map`, { fileName: 'exitaudio-map.csv', content: map, dryRun: true });
    await ok(app, brandAdmin.token, 'POST', `${base}/imports/map`, { fileName: 'exitaudio-map.csv', content: map, dryRun: false });
    s = await ok(app, brandAdmin.token, 'GET', `${base}/onboarding`);
    check('A5 MAP: imported with effective dates (dry run first); every product has a MAP in force',
      doneSteps(s).includes('catalogue') && doneSteps(s).includes('map'), `dry run ${JSON.stringify(mapDry.summary ?? {})}`);

    // Sellers: the brand's authorised reseller.
    await ok(app, brandAdmin.token, 'POST', `${base}/sellers`, { source: 'walmart_us', name: 'Exit P5 Authorised Audio', class: 'MAP Authorised', note: 'On the authorised list' });
    s = await ok(app, brandAdmin.token, 'GET', `${base}/onboarding`);
    check('A6 Sellers: an authorised reseller classified', doneSteps(s).includes('sellers'));

    // Sources & terms: subscribe, generate terms from the catalogue, matrix, schedule.
    await ok(app, brandAdmin.token, 'PUT', `${base}/subscriptions/walmart_us`, { active: true });
    const gen = await ok(app, brandAdmin.token, 'POST', `${base}/terms/generate`, { dryRun: false, group: 'ExitAudio SKUs', template: '{Brand} {Product Name}', identifierTypes: ['MPN', 'UPC'] });
    const group = ((await ok(app, brandAdmin.token, 'GET', `${base}/term-groups`)) as Json[]).find((g) => g.name === 'ExitAudio SKUs');
    await ok(app, brandAdmin.token, 'PUT', `${base}/matrix/${group!.id}/Marketplace`, { mode: 'All' });
    await ok(app, brandAdmin.token, 'POST', `${base}/schedules`, { name: 'Daily sweep', cadence: '0 6 * * *', timezone: 'America/New_York' });
    // Walmart cannot be searched by keyword (robots.txt): the step says so, and stays open.
    s = await ok(app, brandAdmin.token, 'GET', `${base}/onboarding`);
    const noWork = ((s.steps as Json[]).find((x) => x.key === 'sources')!.checks as Json[]).find((c) => c.key === 'work')!;
    check('A7a Keyword terms alone plan nothing on Walmart: the step stays open and says to add brand or category pages',
      !noWork.ok && /brand or category page URLs/.test(noWork.detail), noWork.detail);
    // So the brand adds its Walmart brand page, as a real Walmart onboarding does.
    await ok(app, brandAdmin.token, 'POST', `${base}/terms`, { type: 'url', value: 'https://www.walmart.com/browse/electronics/exitaudio/3944_77622', groupId: group!.id });
    s = await ok(app, brandAdmin.token, 'GET', `${base}/onboarding`);
    const src = (s.steps as Json[]).find((x) => x.key === 'sources')!;
    check('A7 Sources & terms: Walmart subscribed, terms generated from the catalogue, matrix set, a daily schedule; request estimate within budget',
      src.done && (src.checks as Json[]).find((c) => c.key === 'budget')!.ok, `${(src.checks as Json[]).map((c) => `${c.key}${c.detail ? ` (${c.detail})` : ''}`).join(', ')}; generated ${JSON.stringify(gen.summary ?? gen.created ?? '')}`);

    // Reports & alerts.
    await ok(app, brandAdmin.token, 'POST', `${base}/reports/definitions`, {
      name: 'Weekly MAP report', templateCode: 'listing_map', cadence: '0 8 * * 1', timezone: 'America/New_York', recipients: [`pricing@${TEST_DOMAIN}`],
    });
    s = await ok(app, brandAdmin.token, 'GET', `${base}/onboarding`);
    check('A8 Reports & alerts: a weekly report with recipients; every step is done, ready to go live',
      s.ready === true && doneSteps(s).length === 7, `steps done: ${doneSteps(s).join(', ')}`);

    const live = await ok(app, brandAdmin.token, 'POST', `${base}/onboarding/go-live`);
    const again = await call(app, brandAdmin.token, 'POST', `${base}/onboarding/go-live`);
    const fired = (await fireBaselines(new Date(), { enqueue: false })).filter((r) => r.accountId === acct);
    const jobs = await withSystem(async (db) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM crawl_job WHERE account_id = $1 AND status = 'queued'", [acct])).rows[0].n);
    const firedAgain = (await fireBaselines(new Date(), { enqueue: false })).filter((r) => r.accountId === acct);
    check('A9 The brand\'s Administrator takes it live: Active, baseline crawl fired once with work for Walmart; going live twice is refused',
      live.status === 'Active' && again.statusCode === 409 && fired.length === 1 && jobs > 0 && firedAgain.length === 0, `${jobs} jobs queued in the baseline run`);

    const verify = await ok(app, brandAdmin.token, 'GET', `${base}/audit/verify`);
    const actions = await withSystem(async (db) => (await db.query<{ action: string }>('SELECT DISTINCT action FROM audit_event WHERE account_id = $1', [acct])).rows.map((r) => r.action));
    const wanted = ['account.created', 'invite.accepted', 'account.went_live'];
    check('A10 Every step is in the account\'s audit log, and its hash chain holds',
      verify.ok && wanted.every((a) => actions.includes(a)), `${verify.checked} events, chain intact; ${actions.length} kinds of change`);

    // ------------------------------------------------------------------ B. the rest of P5 on this brand
    const budget = await ok(app, ops, 'GET', '/platform/crawl-budget?days=1');
    const mine = (budget.accounts as Json[]).find((a) => a.id === acct);
    check('B1 Crawl budget: the new brand is forecast and counted (it is live)', !!mine && mine.counted && mine.forecast > 0, `${mine?.forecast} requests a day`);

    const t = await ok(app, ops, 'POST', '/platform/tickets', { title: 'Exit P5 Audio: confirm the authorised reseller list with the brand', kind: 'onboarding', accountId: acct, priority: 'Normal' });
    const tDone = await ok(app, ops, 'PATCH', `/platform/tickets/${t.id}`, { status: 'Resolved', note: 'Confirmed on the onboarding call notes.' });
    const brandSeesTickets = await call(app, brandAdmin.token, 'GET', '/platform/tickets');
    check('B2 Internal ticket: opened and resolved by Mirethos with its history; the brand cannot see tickets',
      tDone.status === 'Resolved' && tDone.events.length === 3 && brandSeesTickets.statusCode === 403, t.code);

    const rp = await ok(app, ops, 'POST', '/platform/replays', { accountIds: [acct], from: '2026-09-01', to: '2026-11-01' });
    let batch: Json | undefined;
    for (let i = 0; i < 30; i++) {
      batch = ((await ok(app, ops, 'GET', '/platform/replays')) as Json[]).find((b) => b.batchId === rp.batchId);
      if (batch?.runs.every((r: Json) => r.status === 'done' || r.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('B3 Replay: a rule-set replay of the brand runs in the background to the end', batch?.runs[0]?.status === 'done', `${batch?.runs[0]?.summary?.observations ?? '?'} observations`);

    const key = await ok(app, brandAdmin.token, 'POST', `${base}/api-keys`, { name: 'ExitAudio BI', expiresInDays: 90 });
    const v1 = await ok(app, key.key, 'GET', '/v1/products?limit=2');
    const v1b = await ok(app, key.key, 'GET', `/v1/products?limit=2&cursor=${v1.next_cursor}`);
    const exported = await call(app, brandUser.token, 'GET', `${base}/exports/products?format=csv`);
    await ok(app, brandAdmin.token, 'DELETE', `${base}/api-keys/${key.id}`);
    const revoked = await call(app, key.key, 'GET', '/v1');
    check('B4 Data out: a read-only API key pages the catalogue (2 + 1), a Brand user downloads it as CSV; the revoked key stops',
      v1.data.length === 2 && v1b.data.length === 1 && v1b.next_cursor === null && exported.statusCode === 200 && exported.body.trim().split('\r\n').length === 4 && revoked.statusCode === 401);

    // MFA: the Administrator turns it on, then requires it for everyone.
    const enrol = await ok(app, brandAdmin.token, 'POST', '/auth/mfa/enrol');
    const confirmed = await ok(app, brandAdmin.token, 'POST', '/auth/mfa/enrol/confirm', { code: totp(enrol.secret, stepAt(new Date())) });
    const required = await ok(app, confirmed.token, 'PATCH', `${base}/settings`, { settings: { mfaRequired: true } });
    const userRefused = await call(app, brandUser.token, 'GET', `${base}/violations?limit=1`);
    const userLogin = await ok(app, null, 'POST', '/auth/login', { email: brandUser.email, password: 'wrong-password-on-purpose' }, [401]);
    check('B5 Multi-factor sign-in: the Administrator turns it on and requires it; a session without it no longer opens the account',
      confirmed.recoveryCodes.length === 10 && required.settings.mfaRequired === true && userRefused.statusCode === 403 && /multi-factor/.test(userRefused.json().error),
      `${userLogin.error ? 'wrong passwords still refused' : ''}`);

    const gov = await ok(app, ops, 'GET', '/platform/governance');
    const chain = (gov.chains as Json[]).find((c) => c.accountId === acct);
    check('B6 Governance: the brand\'s audit chain is intact after all of the above', chain?.ok === true, `${chain?.checked} events`);

    lines.push('', '## Notes', '',
      '- The brand was created, onboarded and taken live entirely through the API calls the portal screens make; no data was typed into the database.',
      '- Removed at the end: the account (its products, MAP, terms, schedule, report, runs, keys, ticket and audit events go with it), the test users and the seller it created.',
      '- Collection itself is not part of this test: the baseline run was planned and queued but not executed (no worker; the daily LG run stays on GitHub Actions).');
  } finally {
    await cleanup();
    await app.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  const day = started.toISOString().slice(0, 10);
  const out = path.resolve(here, `../../reports/exit-p5-${day}.md`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, [
    `# Phase 5 exit test — ${day}`,
    '',
    'Exit test (docs/plan.md): onboarding a new brand is a guided flow, not a wiki page or a call.',
    `Decision 43: built on the LG slice; this test creates its own brand and removes it. Run ${started.toISOString()}.`,
    '',
    `**Result: ${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}**`,
    '',
    ...checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ` — ${c.detail}` : ''}`),
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
    await closeRateLimiter();
    await closeDb();
  });
