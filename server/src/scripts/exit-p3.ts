// Phase 3 exit test: a weekly report and a monthly trend deck are generated with a working evidence
// link on every violation row, without Excel.
//
//   npm run exit:p3 -- --scope lg-slice
//
// Runs on the LG Sandbox's real data (decision 40: P3 is built on the LG slice; the three-brand run
// is the go-live gate). Works through the API as invited LG users (Account manager, Analyst, Brand
// user); the PDF and delivery steps run as the reports runner does. SFTP goes to an in-process
// server (no brand SFTP target yet). Checks:
//   1. rules: publishing without a dry run is refused; after a dry run it publishes (LG's draft is
//      discarded after the dry run so its live rules stay as they are; publishing is proven in a
//      throwaway account)
//   2. judging is idempotent (a second judge adds no verdicts)
//   3. weekly Listing MAP Report: PDF + CSV stored with their SHA-256; every violation row's
//      evidence link opens (200), names that violation, and the latest proof re-hashes to its stored
//      SHA-256; hosted link (from the logged email) opens the same rows
//   4. monthly trend deck: PDF + hosted link; every violation row's link opens
//   5. links refused: unknown (404), expired (410), revoked (410), a report link used as evidence (403);
//      a Brand user cannot create links
//   6. SFTP: PDF + CSV arrive with the stored SHA-256, host key pinned
//   7. email logged for the report run; no provider pretends to send
//   8. alerts: a second evaluation raises nothing new; the inbox shows them
//   9. data-quality note on a run when a source is degraded (in a rolled-back transaction)
//  10. no Excel: report files are PDF and CSV only
// Writes reports/exit-p3-<date>.md. Test users and the test SFTP credential are removed at the end.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { closeBrowser, renderPdf } from '../collector/browser.js';
import { evaluateAlerts } from '../lib/alerts.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, pool, withSystem } from '../lib/db.js';
import { createLink } from '../lib/evidenceLinks.js';
import { judgeAccount } from '../lib/judge.js';
import { closeQueue } from '../lib/queue.js';
import { completeRun, runHtml } from '../lib/reportRunner.js';
import { buildSnapshot } from '../lib/reports.js';
import { fingerprint } from '../lib/sftp.js';
import { getObjectBytes } from '../lib/storage.js';
import { startSftp } from '../lib/sftpTestServer.js';

const TEST_DOMAIN = 'exit-p3.mirethos.invalid';
const here = path.dirname(fileURLToPath(import.meta.url));
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const { values } = parseArgs({ options: { scope: { type: 'string' } } });
if (values.scope !== 'lg-slice') throw new Error('usage: npm run exit:p3 -- --scope lg-slice (the three-brand run comes with the collection push)');

const checks: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

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
  await withSystem(async (db) => {
    await db.query("DELETE FROM account WHERE slug LIKE 'zz-exit-p3-%'");
    await db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_DOMAIN}`]);
  });
}

/** Print and deliver a run the way the reports runner does. */
async function finish(runId: string) {
  const html = await withSystem((db) => runHtml(db, runId));
  const pdf = await renderPdf(html);
  return withSystem((db) => completeRun(db, runId, pdf));
}

/** Every evidence link in a run's rows: opens, names its violation, latest proof re-hashes. */
async function checkRowLinks(app: FastifyInstance, label: string, rows: Json[]): Promise<void> {
  let ok = 0;
  const bad: string[] = [];
  for (const r of rows) {
    const token = String(r.evidenceUrl).split('/evidence/')[1];
    const res = await call(app, null, 'GET', `/e/${token}`);
    const j = res.statusCode === 200 ? res.json() : null;
    if (j && j.record === r.code && j.verification?.ok === true) ok++;
    else bad.push(`${r.code}: ${res.statusCode} ${j ? `record ${j.record}, hash ${j.verification?.ok}` : res.body.slice(0, 80)}`);
  }
  check(`${label}: an evidence link on every violation row opens its violation, proof hash verified`, rows.length > 0 && ok === rows.length,
    `${ok}/${rows.length} rows${bad.length ? `; ${bad.join('; ')}` : ''}`);
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();
  const admin = await adminToken();
  const sftpPassword = `drop-${crypto.randomUUID()}`;
  const sftp = await startSftp('lgdrop', sftpPassword, fingerprint);
  const started = new Date();
  const lines: string[] = [];
  try {
    const lg = await withSystem(async (db) => (await db.query<{ id: string; timezone: string }>("SELECT id, timezone FROM account WHERE slug = 'lg'")).rows[0]);
    const base = `/accounts/${lg.id}`;
    const manager = await invite(app, admin, lg.id, 'manager-lg', 'Account manager');
    const analyst = await invite(app, admin, lg.id, 'analyst-lg', 'Analyst');
    const brand = await invite(app, admin, lg.id, 'brand-lg', 'Brand user');

    // 1. Rules -----------------------------------------------------------------------------------
    const rules = (await call(app, analyst, 'GET', `${base}/rules`)).json() as Json[];
    const r01 = rules.find((r) => r.code === 'R-01')!;
    const live = r01.published;
    const draft = { scope: live.scope, condition: live.condition, verdict: live.verdict, severity: live.severity, priority: live.priority, note: 'Exit test draft (discarded)' };
    await call(app, manager, 'DELETE', `${base}/rules/${r01.id}/draft`);
    const saved = await call(app, manager, 'PUT', `${base}/rules/${r01.id}/draft`, draft);
    const refused = await call(app, manager, 'POST', `${base}/rules/${r01.id}/draft/publish`, {});
    const dry = await call(app, manager, 'POST', `${base}/rules/${r01.id}/draft/dry-run`, { from: '2026-09-01', to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
    const dr = dry.json().result ?? {};
    await call(app, manager, 'DELETE', `${base}/rules/${r01.id}/draft`);
    check('LG R-01: publishing a draft without a dry run is refused', saved.statusCode === 200 && refused.statusCode === 409, `draft ${saved.statusCode}, publish ${refused.statusCode}: ${refused.json().error}`);
    check('LG R-01: dry run of an unchanged draft shows no blast radius (draft discarded; live rules unchanged)', dry.statusCode === 200 && dr.newlyViolating === 0 && dr.noLongerViolating === 0,
      `${dr.observations} prices, ${dr.violationsLive} violating live, ${dr.violationsCandidate} with the draft`);
    // Publishing after a dry run, in a throwaway account.
    const zz = await withSystem(async (db) => (await db.query<{ id: string }>(
      "INSERT INTO account (slug, name, brand, status) VALUES ('zz-exit-p3-rules', 'Exit test rules', 'TestBrand', 'Sandbox') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id")).rows[0].id);
    const zzManager = await invite(app, admin, zz, 'manager-zz', 'Account manager');
    const zr01 = ((await call(app, zzManager, 'GET', `/accounts/${zz}/rules`)).json() as Json[]).find((r) => r.code === 'R-01')!;
    await call(app, zzManager, 'PUT', `/accounts/${zz}/rules/${zr01.id}/draft`, { condition: { type: 'below_map', tolerancePct: 1 }, verdict: 'violation' });
    const zRefused = await call(app, zzManager, 'POST', `/accounts/${zz}/rules/${zr01.id}/draft/publish`, {});
    await call(app, zzManager, 'POST', `/accounts/${zz}/rules/${zr01.id}/draft/dry-run`, { from: '2026-09-01', to: '2026-11-01' });
    const zPub = await call(app, zzManager, 'POST', `/accounts/${zz}/rules/${zr01.id}/draft/publish`, {});
    const zVersions = ((await call(app, zzManager, 'GET', `/accounts/${zz}/rules/${zr01.id}`)).json().versions as Json[]).map((v) => `v${v.version} ${v.status}`);
    check('Rule publish after a dry run: v2 published, v1 closed (not deleted)', zRefused.statusCode === 409 && zPub.statusCode === 200 && zVersions.join(', ') === 'v2 Published, v1 Closed', zVersions.join(', '));

    // 2. Judging idempotent ----------------------------------------------------------------------
    const j1 = await withSystem((db) => judgeAccount(db, lg.id, { trigger: 'cli' }));
    const j2 = await withSystem((db) => judgeAccount(db, lg.id, { trigger: 'cli' }));
    const totals = await withSystem(async (db) => (await db.query<{ verdicts: number; violations: number }>(
      'SELECT (SELECT count(*)::int FROM verdict WHERE account_id = $1) AS verdicts, (SELECT count(*)::int FROM violation WHERE account_id = $1) AS violations', [lg.id])).rows[0]);
    check('Judging is idempotent: a second judge adds no verdicts', j2.verdicts === 0 && j2.opened === 0, `first pass ${j1.verdicts} new, second ${j2.verdicts}; LG holds ${totals.verdicts} verdicts, ${totals.violations} violations`);

    // 6 (setup). SFTP credential + pinned host key -----------------------------------------------
    const cred = await call(app, manager, 'POST', `${base}/credentials`, { kind: 'sftp', label: `Exit test SFTP ${Date.now()}`, username: 'lgdrop', secret: sftpPassword });
    if (cred.statusCode !== 201 && cred.statusCode !== 200) throw new Error(`credential: ${cred.statusCode} ${cred.body}`);
    const credentialId = cred.json().id;
    const target = { credentialId, host: '127.0.0.1', port: sftp.port, folder: '/brand/lg' };
    const t1 = (await call(app, manager, 'POST', `${base}/reports/sftp-test`, target)).json();
    const t2 = (await call(app, manager, 'POST', `${base}/reports/sftp-test`, { ...target, hostKey: t1.hostKey })).json();
    check('SFTP: an unknown server key is refused and shown for confirmation; once pinned the test write succeeds',
      !t1.ok && t1.hostKey === sftp.hostKeyFingerprint && t2.ok === true, `${t1.message} → ${t2.message}`);

    // 3. Weekly report ---------------------------------------------------------------------------
    const def = await call(app, manager, 'POST', `${base}/reports/definitions`, {
      name: `Exit test weekly MAP report ${started.toISOString().slice(0, 16)}`, templateCode: 'listing_map', params: { timeframe: 'last_30_days' },
      cadence: 'manual', recipients: [`map-room@${TEST_DOMAIN}`], visibility: 'Brand users',
      destinations: { email: true, hosted: true, sftp: { ...target, hostKey: t1.hostKey } },
    });
    if (def.statusCode !== 200) throw new Error(`definition: ${def.statusCode} ${def.body}`);
    const weeklyRun = await call(app, manager, 'POST', `${base}/reports/definitions/${def.json().id}/run`, {});
    if (weeklyRun.statusCode !== 200) throw new Error(`run now: ${weeklyRun.statusCode} ${weeklyRun.body}`);
    const weeklyId = weeklyRun.json().id;
    const wDeliveries = await finish(weeklyId);
    const weekly = await withSystem(async (db) => (await db.query('SELECT * FROM report_run WHERE id = $1', [weeklyId])).rows[0]);
    const wFiles = weekly.files as Json[];
    const stored: string[] = [];
    for (const f of wFiles) {
      const b = await getObjectBytes(f.key);
      stored.push(`${f.kind} ${b.length} B ${sha(b) === f.sha256 ? 'hash ok' : 'HASH MISMATCH'}${f.kind === 'pdf' ? (b.subarray(0, 5).toString() === '%PDF-' ? ', is a PDF' : ', NOT A PDF') : ''}`);
    }
    check(`Weekly report ${weekly.seq ? `RPT-${String(weekly.seq).padStart(4, '0')}` : ''}: generated with PDF + CSV stored by SHA-256`,
      weekly.status === 'done' && wFiles.length === 2 && stored.every((s) => !s.includes('MISMATCH') && !s.includes('NOT A')), `${weekly.rows} violation rows; ${stored.join('; ')}`);
    const csvRows = (await getObjectBytes(wFiles.find((f) => f.kind === 'csv')!.key)).toString('utf8').trim().split('\r\n').length - 1;
    check('Weekly report: the CSV has the same rows, each with an evidence link', csvRows === weekly.rows && weekly.snapshot.rows.every((r: Json) => /\/evidence\/[A-Za-z0-9_-]{43}$/.test(r.evidenceUrl)), `${csvRows} CSV rows`);
    await checkRowLinks(app, 'Weekly report', weekly.snapshot.rows);
    check('Weekly report: rule set and data-quality note stored with the run', Array.isArray(weekly.rule_set) && weekly.rule_set.length > 0,
      `rules ${weekly.rule_set.map((r: Json) => `${r.code} v${r.version}`).join(', ')}; data quality: ${weekly.quality_note ?? 'all subscribed sources healthy'}`);

    // 7. Email logged + hosted link from it
    const mail = await withSystem(async (db) => (await db.query('SELECT status, provider, recipients, body FROM notification WHERE report_run_id = $1', [weeklyId])).rows);
    check('Email for the run is logged (no provider configured; nothing claims to be sent)', mail.length === 1 && mail[0].status === 'logged' && mail[0].provider === 'log', `to ${mail[0]?.recipients?.join(', ')}`);
    const hostedToken = /\/report\/([A-Za-z0-9_-]{43})/.exec(mail[0]?.body ?? '')?.[1];
    const hosted = hostedToken ? await call(app, null, 'GET', `/r/${hostedToken}`) : null;
    const hj = hosted?.statusCode === 200 ? hosted.json() : null;
    check('Weekly report: the hosted link opens the report with every evidence link and the files',
      !!hj && weekly.snapshot.rows.every((r: Json) => hj.html.includes(r.evidenceUrl)) && hj.files.length === 2, hosted ? `${hosted.statusCode}, ${hj?.files?.length ?? 0} files` : 'no link in the email');

    // 6. SFTP delivery
    const sftpD = wDeliveries.deliveries.find((d) => d.channel === 'sftp');
    const arrived = wFiles.map((f) => { const b = sftp.files.get(`/brand/lg/${f.fileName}`); return b && sha(b) === f.sha256; });
    check('SFTP delivery: PDF and CSV arrived with their stored SHA-256', sftpD?.status === 'delivered' && arrived.every(Boolean), `${sftpD?.status}; ${wFiles.map((f) => f.fileName).join(', ')}`);

    // 4. Monthly trend deck ----------------------------------------------------------------------
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: lg.timezone, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const deckRun = await call(app, manager, 'POST', `${base}/reports/runs`, { templateCode: 'monthly_trend', params: { month }, name: `Exit test monthly trend deck ${month}` });
    if (deckRun.statusCode !== 200) throw new Error(`deck: ${deckRun.statusCode} ${deckRun.body}`);
    const deckId = deckRun.json().id;
    await finish(deckId);
    const deck = await withSystem(async (db) => (await db.query('SELECT * FROM report_run WHERE id = $1', [deckId])).rows[0]);
    const pdf = (deck.files as Json[]).find((f) => f.kind === 'pdf');
    const pdfBytes = pdf ? await getObjectBytes(pdf.key) : Buffer.alloc(0);
    check(`Monthly trend deck (${month}): PDF generated and stored by SHA-256`, deck.status === 'done' && !!pdf && sha(pdfBytes) === pdf.sha256 && pdfBytes.subarray(0, 5).toString() === '%PDF-',
      `${pdfBytes.length} B; compliance ${deck.snapshot.summary.compliance}%, ${deck.snapshot.summary.opened} new violations, ${deck.snapshot.trend.length} days charted`);
    await checkRowLinks(app, 'Monthly trend deck', deck.snapshot.rows);
    const deckLink = await call(app, manager, 'POST', `${base}/reports/runs/${deckId}/link`, {});
    const deckHosted = await call(app, null, 'GET', `/r/${deckLink.json().url.split('/report/')[1]}`);
    check('Monthly trend deck: hosted link opens', deckHosted.statusCode === 200 && deckHosted.json().html.includes('Listings below MAP per day'), `${deckHosted.statusCode}`);

    // 5. Links refused ---------------------------------------------------------------------------
    const v = weekly.snapshot.rows[0];
    const vid = await withSystem(async (db) => (await db.query<{ id: string }>('SELECT id FROM violation WHERE account_id = $1 AND seq = $2', [lg.id, Number(v.code.slice(2))])).rows[0].id);
    const expired = await withSystem((db) => createLink(db, { accountId: lg.id, scope: 'violation:view', violationId: vid, via: 'test', days: 1, now: new Date(Date.now() - 3 * 86_400_000) }));
    const revoked = await withSystem(async (db) => {
      const l = await createLink(db, { accountId: lg.id, scope: 'violation:view', violationId: vid, via: 'test', days: 1 });
      await db.query('UPDATE evidence_link SET revoked_at = now() WHERE id = $1', [l.id]);
      return l;
    });
    const codes = [
      (await call(app, null, 'GET', '/e/this-token-was-never-issued-by-map-intel')).statusCode,
      (await call(app, null, 'GET', `/e/${expired.token}`)).statusCode,
      (await call(app, null, 'GET', `/e/${revoked.token}`)).statusCode,
      (await call(app, null, 'GET', `/e/${hostedToken}`)).statusCode,
      (await call(app, brand, 'POST', `${base}/violations/${vid}/links`, {})).statusCode,
    ];
    check('Links refused: unknown 404, expired 410, revoked 410, report link as evidence 403; Brand user cannot create links (403)',
      codes.join(',') === '404,410,410,403,403', codes.join(', '));
    const brandRuns = (await call(app, brand, 'GET', `${base}/reports/runs`)).json() as Json[];
    const brandViol = await call(app, brand, 'GET', `${base}/violations`);
    check('Brand user reads violations and the reports shared with brand users only', brandViol.statusCode === 200 && brandRuns.some((r) => r.id === weeklyId) && !brandRuns.some((r) => r.id === deckId),
      `${brandViol.json().total} violations; ${brandRuns.length} shared runs`);

    // 8. Alerts ----------------------------------------------------------------------------------
    const a1 = await withSystem((db) => evaluateAlerts(db, lg.id));
    const a2 = await withSystem((db) => evaluateAlerts(db, lg.id));
    const inbox = (await call(app, analyst, 'GET', `${base}/alerts/events`)).json();
    check('Alerts are deduplicated: a second evaluation raises nothing new; the inbox shows them', a2.raised === 0 && inbox.events.length > 0,
      `${a1.raised} new now, ${a2.raised} on re-run; inbox ${inbox.events.length} (${inbox.unread} unread)`);

    // 9. Data-quality note when degraded (rolled back) -------------------------------------------
    const note = await (async () => {
      const db = await pool().connect();
      try {
        await db.query("BEGIN; SELECT set_config('app.role', 'system', true)");
        const src = (await db.query<{ source_id: string }>("SELECT a.source_id FROM account_source a JOIN source s ON s.id = a.source_id WHERE a.account_id = $1 AND a.active AND s.code = 'walmart_us'", [lg.id])).rows[0];
        const run = (await db.query<{ id: string }>("INSERT INTO crawl_run (trigger, account_id, status, jobs_total, jobs_done) VALUES ('schedule', $1, 'finished', 1, 1) RETURNING id", [lg.id])).rows[0].id;
        await db.query("INSERT INTO source_health_snapshot (account_id, source_id, crawl_run_id, jobs_planned, jobs_executed, health, main_failure) VALUES ($1, $2, $3, 1, 1, 'Degraded', 'timeout')", [lg.id, src.source_id, run]);
        const s = await buildSnapshot(db, {
          runId: weeklyId, runCode: 'RPT-TEST', name: 'degraded check', accountId: lg.id, template: { code: 'listing_map', name: 'Listing MAP Report', version: 1 },
          params: { timeframe: 'last_7_days', statuses: ['Open'], rowCap: 5 }, period: { from: new Date(Date.now() - 7 * 86_400_000), to: new Date(), label: 'x' }, now: new Date(),
        });
        return s.quality.note;
      } finally {
        await db.query('ROLLBACK').catch(() => undefined);
        db.release();
      }
    })();
    check('Data-quality note on a run when a source is degraded', !!note && note.includes('Walmart.com degraded'), note ?? 'no note');

    // 10. No Excel -------------------------------------------------------------------------------
    const kinds = [...wFiles, ...(deck.files as Json[])].map((f) => f.fileName.split('.').pop());
    check('No Excel: every report file is PDF or CSV', kinds.every((k) => k === 'pdf' || k === 'csv'), kinds.join(', '));

    await call(app, manager, 'PATCH', `${base}/reports/definitions/${def.json().id}`, { active: false });
    await call(app, manager, 'DELETE', `${base}/credentials/${credentialId}`);
    lines.push(`- Weekly report run: RPT-${String(weekly.seq).padStart(4, '0')} (${weeklyId}); monthly deck: RPT-${String(deck.seq).padStart(4, '0')} (${deckId}). Both stay in LG's repository as evidence of this test (their links were built with PORTAL_URL=${config.PORTAL_URL}).`);
  } finally {
    await sftp.close();
    await cleanup(app, admin);
    await app.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  const day = started.toISOString().slice(0, 10);
  const out = path.resolve(here, `../../reports/exit-p3-${day}.md`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, [
    `# Phase 3 exit test — LG slice — ${day}`,
    '',
    `Exit test (docs/plan.md): a weekly report and a monthly trend deck are generated with a working evidence link on every violation row, no Excel.`,
    `Scope: LG Sandbox (Walmart + eBay, decision 40). Run ${started.toISOString()} from ${process.env.COLLECT_EGRESS_LABEL ?? 'this PC'}.`,
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
    await closeBrowser();
    await closeQueue();
    await closeDb();
  });
