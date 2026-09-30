// Phase 2b exit test: pilot SKUs for LG, Apple and Samsung are collected daily from all launch
// sources with evidence, and failures show in Data Health.
//
//   npm run exit:p2b -- --setup   configure through the API as each account's (invited) Account
//                                 manager: the six launch sources subscribed, brand / browse pages
//                                 (seeds/brand-pages.json) as url terms in a "Brand pages" group
//                                 sent to Marketplace and Online Seller sources
//   npm run exit:p2b -- --fire    fire each account's daily sweep now, for the worker (US egress)
//   npm run exit:p2b -- --check [--wait] [--scheduled]
//                                 wait for those runs (optional) and check them; --scheduled checks
//                                 each account's latest scheduled run from render-ohio instead:
//     for every account × launch source
//       1. subscribed, collector live, every job finished (none left queued or running)
//       2. every Included listing was collected: a priced observation (ok / partial / held) or a
//          classified failure; at least one priced observation where the source has listings
//       3. evidence: HTML + screenshot on every priced observation; a sample re-read from S3 hashes
//          to the stored SHA-256 and is under a Governance lock
//       4. failures visible: every failed job has a failure class, a health snapshot exists, and
//          Data Health (API, as an Analyst) shows the source with the same health
//     per run: no failed / blocked observation carries a price; discovery staged listings for
//     the matcher. Daily: a scheduled run from render-ohio in the last 26 hours per account.
//   npm run exit:p2b -- --check --scheduled --scope amazon-lg
//                                 the Amazon.com LG slice (decisions 29–35): LG × Amazon only, the
//                                 "Amazon LG daily monitoring" runs, from render-ohio or github-actions;
//                                 plus the slice's discovery: results pages stored with evidence
//                                 (hash re-checked) and no used / renewed listing staged.
// Writes reports/exit-p2b-<date>.md. Test users are removed at the end.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { SOURCE_CATALOGUE } from '../collector/catalogue.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';
import { syncSourceCatalogue } from '../lib/sourceCatalogue.js';
import { SLICE } from '../lib/amazonSlice.js';
import { verifyEvidence } from '../lib/storage.js';
import { fireSchedule } from '../scheduler/tick.js';

const TEST_DOMAIN = 'exit-p2b.mirethos.invalid';
const ACCOUNTS = ['lg', 'apple', 'samsung'];
const LAUNCH = ['amazon_us', 'walmart_us', 'bestbuy_us', 'ebay_us', 'target_us', 'homedepot_us'];
const SWEEP = 'Daily marketplace sweep';
const GROUP = 'Brand pages';
const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS_FILE = path.resolve(here, '../../reports/exit-p2b-runs.json');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const { values } = parseArgs({
  options: {
    setup: { type: 'boolean', default: false },
    fire: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    wait: { type: 'boolean', default: false },
    scheduled: { type: 'boolean', default: false },
    scope: { type: 'string' },
  },
});

// What --check covers: the whole pilot, or the Amazon LG slice.
const slice = values.scope === 'amazon-lg';
if (values.scope && !slice) throw new Error(`unknown --scope ${values.scope} (use amazon-lg)`);
const SCOPE = slice
  ? { accounts: [SLICE.account], sources: [SLICE.source], schedule: SLICE.monitoring.name, egress: ['render-ohio', 'github-actions'] }
  : { accounts: ACCOUNTS, sources: LAUNCH, schedule: SWEEP, egress: ['render-ohio'] };
const EGRESS = SCOPE.egress.join(' or ');

const checks: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function call(app: FastifyInstance, token: string | null, method: string, url: string, payload?: unknown) {
  return app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as Record<string, unknown> | undefined });
}

async function adminToken(): Promise<string> {
  const admin = await withSystem(
    async (db) =>
      (await db.query<{ id: string; email: string }>(`SELECT id, email FROM app_user WHERE lower(email) = lower($1) AND platform_role = 'admin'`, [config.SEED_ADMIN_EMAIL ?? ''])).rows[0],
  );
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
  const users = await withSystem(
    async (db) =>
      (
        await db.query<{ user_id: string; account_id: string }>(
          'SELECT m.user_id, m.account_id FROM account_membership m JOIN app_user u ON u.id = m.user_id WHERE u.email LIKE $1',
          [`%@${TEST_DOMAIN}`],
        )
      ).rows,
  );
  for (const u of users) await call(app, admin, 'DELETE', `/accounts/${u.account_id}/users/${u.user_id}`);
  await withSystem((db) => db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_DOMAIN}`]));
}

async function accountsBySlug(app: FastifyInstance, admin: string): Promise<Map<string, Json>> {
  const list = (await call(app, admin, 'GET', '/accounts')).json() as Json[];
  return new Map(list.filter((a) => ACCOUNTS.includes(a.slug)).map((a) => [a.slug, a]));
}

// ---------------------------------------------------------------------------
async function setup(app: FastifyInstance, admin: string): Promise<void> {
  await withSystem((db) => syncSourceCatalogue(db));
  const pages = JSON.parse(await readFile(path.resolve(here, '../../seeds/brand-pages.json'), 'utf8')) as Record<string, Record<string, string[]>>;
  for (const [slug, acct] of await accountsBySlug(app, admin)) {
    const manager = await invite(app, admin, acct.id, `manager-${slug}`, 'Account manager');
    for (const code of LAUNCH) {
      const res = await call(app, manager, 'PUT', `/accounts/${acct.id}/subscriptions/${code}`, { active: true });
      if (res.statusCode !== 200) throw new Error(`subscribe ${slug} ${code}: ${res.statusCode} ${res.body}`);
    }
    const groups = (await call(app, manager, 'GET', `/accounts/${acct.id}/term-groups`)).json() as Json[];
    let group = groups.find((g) => String(g.name).toLowerCase() === GROUP.toLowerCase());
    if (!group) {
      const res = await call(app, manager, 'POST', `/accounts/${acct.id}/term-groups`, { name: GROUP, description: 'Brand / browse pages where search is not allowed (robots.txt)' });
      if (res.statusCode !== 201) throw new Error(`group ${slug}: ${res.statusCode} ${res.body}`);
      group = res.json();
    }
    let added = 0;
    for (const url of Object.values(pages[slug] ?? {}).flat()) {
      const res = await call(app, manager, 'POST', `/accounts/${acct.id}/terms`, { type: 'url', value: url, groupId: group!.id });
      if (res.statusCode === 201) added++;
      else if (res.statusCode !== 409) throw new Error(`term ${slug} ${url}: ${res.statusCode} ${res.body}`);
    }
    for (const category of ['Marketplace', 'Online Seller']) {
      const res = await call(app, manager, 'PUT', `/accounts/${acct.id}/matrix/${group!.id}/${encodeURIComponent(category)}`, { mode: 'All' });
      if (res.statusCode !== 200) throw new Error(`matrix ${slug} ${category}: ${res.statusCode} ${res.body}`);
    }
    console.log(`${slug}: 6 launch sources subscribed; ${GROUP}: ${added} url terms added; matrix All for Marketplace + Online Seller`);
  }
}

// ---------------------------------------------------------------------------
async function fire(): Promise<void> {
  const runs: Record<string, string> = {};
  for (const slug of ACCOUNTS) {
    const scheduleId = await withSystem(
      async (db) =>
        (await db.query<{ id: string }>('SELECT s.id FROM schedule s JOIN account a ON a.id = s.account_id WHERE a.slug = $1 AND s.name = $2', [slug, SWEEP])).rows[0]?.id,
    );
    if (!scheduleId) throw new Error(`${slug}: no "${SWEEP}" schedule`);
    const r = await fireSchedule(scheduleId, new Date(), 'manual');
    if (!r) throw new Error(`${slug}: this slot already has a run`);
    runs[slug] = r.crawlRunId;
    console.log(`${slug}: run ${r.crawlRunId} — ${r.queued} jobs queued for the worker, skipped ${JSON.stringify(r.skipped)}`);
  }
  await mkdir(path.dirname(RUNS_FILE), { recursive: true });
  await writeFile(RUNS_FILE, JSON.stringify({ firedAt: new Date().toISOString(), runs }, null, 2));
  console.log(`\nruns saved to ${path.relative(process.cwd(), RUNS_FILE)}; the worker in Ohio collects them. Then: npm run exit:p2b -- --check --wait`);
}

// ---------------------------------------------------------------------------
interface SourceResult {
  account: string;
  source: string;
  expected: number;
  priced: number;
  failed: number;
  missing: number;
  evidenceGaps: number;
  discovered: number;
  health: string;
  mainFailure: string | null;
  ok: boolean;
  note: string;
}

async function waitForRuns(runs: Record<string, string>, maxMinutes = 240): Promise<void> {
  const until = Date.now() + maxMinutes * 60_000;
  for (;;) {
    const open = await withSystem(
      async (db) =>
        (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM crawl_run WHERE id = ANY($1::uuid[]) AND status NOT IN ('finished', 'failed')`, [Object.values(runs)])).rows[0].n,
    );
    if (!open) return;
    if (Date.now() > until) throw new Error(`${open} runs still open after ${maxMinutes} minutes`);
    const left = await withSystem(
      async (db) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM crawl_job WHERE crawl_run_id = ANY($1::uuid[]) AND status IN ('queued', 'running')`, [Object.values(runs)])).rows[0].n,
    );
    console.log(`${new Date().toISOString().slice(11, 19)}  ${open} runs open, ${left} jobs left`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

async function checkRuns(app: FastifyInstance, admin: string): Promise<SourceResult[]> {
  const runs: Record<string, string> = values.scheduled
    ? Object.fromEntries(
        await withSystem(async (db) =>
          (
            await db.query<{ slug: string; id: string }>(
              `SELECT DISTINCT ON (a.slug) a.slug, r.id FROM crawl_run r JOIN account a ON a.id = r.account_id JOIN schedule s ON s.id = r.schedule_id
                WHERE a.slug = ANY($1) AND r.trigger = 'schedule' AND r.egress_label = ANY($3) AND s.name = $2
                ORDER BY a.slug, r.started_at DESC`,
              [SCOPE.accounts, SCOPE.schedule, SCOPE.egress],
            )
          ).rows.map((r) => [r.slug, r.id]),
        ),
      )
    : (JSON.parse(await readFile(RUNS_FILE, 'utf8')) as { runs: Record<string, string> }).runs;
  for (const slug of SCOPE.accounts) if (!runs[slug]) throw new Error(`${slug}: no run to check${values.scheduled ? ` (no scheduled ${EGRESS} run of "${SCOPE.schedule}" yet)` : ''}`);
  console.log(`checking runs: ${JSON.stringify(runs)}`);
  if (values.wait) await waitForRuns(runs);
  const accounts = await accountsBySlug(app, admin);
  const results: SourceResult[] = [];

  for (const slug of SCOPE.accounts) {
    const acct = accounts.get(slug)!;
    const runId = runs[slug];
    const analyst = await invite(app, admin, acct.id, `analyst-${slug}`, 'Analyst');
    const health = (await call(app, analyst, 'GET', `/accounts/${acct.id}/health`)).json() as Json;

    const run = await withSystem(async (db) => (await db.query<Json>('SELECT status, egress_label, jobs_total, jobs_done FROM crawl_run WHERE id = $1', [runId])).rows[0]);
    check(`${slug}: run finished`, run?.status === 'finished', `${run?.jobs_done}/${run?.jobs_total} jobs, egress ${run?.egress_label}`);

    const leaked = await withSystem(
      async (db) =>
        (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM observation WHERE crawl_run_id = $1 AND status IN ('blocked', 'failed', 'not_found', 'skipped_robots') AND advertised_price IS NOT NULL`, [runId])).rows[0].n,
    );
    check(`${slug}: no failed or blocked observation carries a price`, leaked === 0, `${leaked} found`);

    const daily = await withSystem(
      async (db) =>
        (
          await db.query<{ started_at: Date }>(
            `SELECT started_at FROM crawl_run WHERE account_id = $1 AND trigger = 'schedule' AND egress_label = ANY($2) AND started_at > now() - interval '26 hours'
              ORDER BY started_at DESC LIMIT 1`,
            [acct.id, SCOPE.egress],
          )
        ).rows[0],
    );
    check(`${slug}: scheduled daily run from ${EGRESS} in the last 26 h`, Boolean(daily), daily ? daily.started_at.toISOString() : 'none yet');
    if (slice) await checkSliceDiscovery(acct.id);

    for (const code of SCOPE.sources) {
      const declared = SOURCE_CATALOGUE.find((s) => s.code === code)!;
      const stats = await withSystem(async (db) => {
        const src = (await db.query<{ id: string; collector_status: string }>('SELECT id, collector_status FROM source WHERE code = $1', [code])).rows[0];
        const sub = (await db.query('SELECT 1 FROM account_source WHERE account_id = $1 AND source_id = $2 AND active', [acct.id, src.id])).rowCount;
        const jobs = (
          await db.query<{ status: string; failure_class: string | null; kind: string; found: number | null }>(
            'SELECT status, failure_class, kind, found FROM crawl_job WHERE crawl_run_id = $1 AND source_id = $2',
            [runId, src.id],
          )
        ).rows;
        const listings = (
          await db.query<{ listing_id: string; priced: boolean; failure: string | null; evidence_complete: boolean }>(
            `SELECT m.listing_id,
                    bool_or(o.status IN ('ok', 'partial', 'held')) AS priced,
                    max(j.failure_class) AS failure,
                    bool_and(o.status NOT IN ('ok', 'partial', 'held') OR (e.html_uri IS NOT NULL AND e.screenshot_uri IS NOT NULL)) AS evidence_complete
               FROM listing_match m JOIN listing l ON l.id = m.listing_id
               LEFT JOIN crawl_job j ON j.listing_id = m.listing_id AND j.crawl_run_id = $3 AND j.status IN ('done', 'failed')
               LEFT JOIN observation o ON o.id = j.observation_id
               LEFT JOIN evidence e ON e.observation_id = o.id
              WHERE m.account_id = $1 AND l.source_id = $2 AND m.state = 'Included' AND l.origin <> 'synthetic'
              GROUP BY m.listing_id`,
            [acct.id, src.id, runId],
          )
        ).rows;
        const sample = (
          await db.query<{ html_uri: string; html_sha256: string; screenshot_uri: string | null; screenshot_sha256: string | null }>(
            `SELECT e.html_uri, e.html_sha256, e.screenshot_uri, e.screenshot_sha256
               FROM crawl_job j JOIN observation o ON o.id = j.observation_id JOIN evidence e ON e.observation_id = o.id
              WHERE j.crawl_run_id = $1 AND j.source_id = $2 AND o.status IN ('ok', 'partial', 'held')
              ORDER BY md5(e.id::text) LIMIT 2`,
            [runId, src.id],
          )
        ).rows;
        const staged = (
          await db.query<{ n: number }>(
            `SELECT count(DISTINCT d.listing_id)::int AS n FROM listing_discovery d JOIN listing l ON l.id = d.listing_id JOIN crawl_run r ON r.id = $3
              WHERE d.account_id = $1 AND l.source_id = $2 AND d.last_found_at >= r.started_at`,
            [acct.id, src.id, runId],
          )
        ).rows[0].n;
        const snapshot = (await db.query<{ health: string }>('SELECT health FROM source_health_snapshot WHERE crawl_run_id = $1 AND source_id = $2', [runId, src.id])).rows[0];
        return { live: src.collector_status === 'live', sub: Boolean(sub), jobs, listings, sample, staged, snapshot };
      });

      const unfinished = stats.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
      const unclassified = stats.jobs.filter((j) => j.status === 'failed' && !j.failure_class).length;
      const expected = stats.listings.length;
      const priced = stats.listings.filter((l) => l.priced).length;
      const failed = stats.listings.filter((l) => !l.priced && l.failure).length;
      const missing = expected - priced - failed;
      const evidenceGaps = stats.listings.filter((l) => l.priced && !l.evidence_complete).length;

      let verified = 0;
      let verifyNote = '';
      for (const s of stats.sample) {
        const h = await verifyEvidence(s.html_uri, s.html_sha256);
        const p = s.screenshot_uri && s.screenshot_sha256 ? await verifyEvidence(s.screenshot_uri, s.screenshot_sha256) : null;
        if (h.ok && p?.ok && h.mode === 'GOVERNANCE' && p.mode === 'GOVERNANCE') verified++;
        else verifyNote = `hash ${h.ok && p?.ok ? 'ok' : 'MISMATCH'}, lock ${h.mode ?? 'none'}`;
      }
      const api = (health.sources as Json[]).find((s) => s.code === code);
      const visible = Boolean(stats.snapshot) && api?.health === stats.snapshot?.health;

      const collected = expected > 0 ? missing === 0 && priced > 0 : stats.jobs.length > 0 && unfinished === 0;
      const evidenceOk = evidenceGaps === 0 && verified === stats.sample.length;
      const ok = stats.live && stats.sub && unfinished === 0 && unclassified === 0 && collected && evidenceOk && visible;
      const notes = [
        !stats.live && 'collector not live',
        !stats.sub && 'not subscribed',
        unfinished && `${unfinished} jobs unfinished`,
        unclassified && `${unclassified} failures without a class`,
        expected > 0 && priced === 0 && 'no priced observation',
        missing > 0 && `${missing} listings not attempted`,
        evidenceGaps && `${evidenceGaps} priced without full evidence`,
        verifyNote,
        !visible && 'not visible in Data Health',
        expected === 0 && `no included listings${stats.staged ? ` (${stats.staged} discovered, staged)` : ' (not carried / none found)'}`,
      ].filter(Boolean) as string[];
      results.push({
        account: slug,
        source: declared.displayName,
        expected,
        priced,
        failed,
        missing,
        evidenceGaps,
        discovered: stats.staged,
        health: api?.health ?? '—',
        mainFailure: api?.mainFailure ?? null,
        ok,
        note: notes.join('; '),
      });
      check(`${slug} × ${declared.displayName}: collected with evidence, failures visible`, ok, `${priced}/${expected} priced, ${failed} classified failures, health ${api?.health ?? '—'}${notes.length ? `; ${notes.join('; ')}` : ''}`);
    }
  }
  return results;
}

/** The slice's discovery run: results pages stored with evidence (a sample re-hashed), nothing used staged. */
async function checkSliceDiscovery(accountId: string): Promise<void> {
  const d = await withSystem(async (db) => {
    const run = (
      await db.query<{ id: string; status: string; stopped: Record<string, unknown> }>(
        `SELECT r.id, r.status, r.stopped FROM crawl_run r JOIN schedule s ON s.id = r.schedule_id
          WHERE r.account_id = $1 AND s.name = $2 ORDER BY r.started_at DESC LIMIT 1`,
        [accountId, SLICE.discovery.name],
      )
    ).rows[0];
    if (!run) return null;
    const pages = (
      await db.query<{ n: number; blocked: number; with_evidence: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE block IS NOT NULL)::int AS blocked,
                count(*) FILTER (WHERE html_sha256 IS NOT NULL AND screenshot_sha256 IS NOT NULL)::int AS with_evidence
           FROM results_page WHERE crawl_run_id = $1`,
        [run.id],
      )
    ).rows[0];
    const sample = (
      await db.query<{ html_uri: string; html_sha256: string; screenshot_uri: string; screenshot_sha256: string }>(
        `SELECT html_uri, html_sha256, screenshot_uri, screenshot_sha256 FROM results_page
          WHERE crawl_run_id = $1 AND html_uri IS NOT NULL AND screenshot_uri IS NOT NULL ORDER BY md5(id::text) LIMIT 2`,
        [run.id],
      )
    ).rows;
    const used = (
      await db.query<{ n: number }>(
        `SELECT count(DISTINCT c.listing_id)::int AS n FROM match_candidate c
          WHERE c.account_id = $1 AND c.condition IN ('used', 'refurbished', 'open_box')
            AND c.created_at >= (SELECT started_at FROM crawl_run WHERE id = $2)`,
        [accountId, run.id],
      )
    ).rows[0].n;
    return { run, pages, sample, used };
  });
  check('lg: Amazon LG discovery has run', Boolean(d), d ? `run ${d.run.id} ${d.run.status}` : 'never fired');
  if (!d) return;
  check('lg: discovery run finished', d.run.status === 'finished', d.run.status);
  const stopped = Object.keys(d.run.stopped ?? {}).length ? `; stopped ${JSON.stringify(d.run.stopped)}` : '';
  check(
    'lg: every results page read has HTML + screenshot evidence',
    d.pages.n > 0 && d.pages.with_evidence === d.pages.n,
    `${d.pages.with_evidence}/${d.pages.n} pages (${d.pages.blocked} blocked)${stopped}`,
  );
  let ok = 0;
  for (const s of d.sample) {
    const h = await verifyEvidence(s.html_uri, s.html_sha256);
    const p = await verifyEvidence(s.screenshot_uri, s.screenshot_sha256);
    if (h.ok && p.ok && h.mode === 'GOVERNANCE' && p.mode === 'GOVERNANCE') ok++;
  }
  check('lg: results page evidence re-hashes to its SHA-256 under a Governance lock', d.sample.length > 0 && ok === d.sample.length, `${ok}/${d.sample.length} sampled`);
  check('lg: no used / renewed / refurbished / open-box listing staged by discovery', d.used === 0, `${d.used} found`);
}

async function writeReport(results: SourceResult[]): Promise<string> {
  const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = path.resolve(here, `../../reports/exit-p2b-${slice ? 'amazon-lg-' : ''}${date}.md`);
  const passed = checks.filter((c) => c.ok).length;
  const lines = [
    `# Phase 2b exit test${slice ? ' (scope: Amazon.com LG slice)' : ''} — ${new Date().toISOString()}`,
    '',
    `**${passed}/${checks.length} checks passed.**`,
    '',
    '| Account | Source | Health | Included | Priced | Classified failures | Not attempted | Discovered | Main failure | Result |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.account} | ${r.source} | ${r.health} | ${r.expected} | ${r.priced} | ${r.failed} | ${r.missing} | ${r.discovered} | ${r.mainFailure ?? '—'} | ${r.ok ? 'PASS' : `FAIL: ${r.note}`} |`),
    '',
    '## All checks',
    '',
    ...checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ` — ${c.detail}` : ''}`),
  ];
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();
  const admin = await adminToken();
  try {
    if (values.setup) await setup(app, admin);
    else if (values.fire) await fire();
    else if (values.check) {
      const results = await checkRuns(app, admin);
      const file = await writeReport(results);
      const passed = checks.filter((c) => c.ok).length;
      console.log(`\n${passed}/${checks.length} checks passed — report: ${path.relative(process.cwd(), file)}`);
      if (passed !== checks.length) process.exitCode = 1;
    } else console.log('usage: npm run exit:p2b -- --setup | --fire | --check [--wait]');
  } finally {
    await cleanup(app, admin);
    await app.close();
    await closeQueue();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
