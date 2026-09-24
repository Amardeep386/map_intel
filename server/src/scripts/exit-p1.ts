// Phase 1 exit test: each pilot account (LG, Apple, Samsung) is fully configured through the API —
// sources subscribed, terms generated at catalogue scale, matrix within budget, schedules — by an
// invited Account manager, without Excel or a shared drive. Also checks that a Brand user cannot
// change configuration and that accounts cannot see each other's.
//
//   npm run exit:p1
//
// The configuration it creates is kept (it is the pilot accounts' real starting setup). The
// throwaway users it invites are removed at the end; their actions stay in the audit log.
// Safe to run again: existing terms are skipped, subscriptions and matrix cells are re-applied.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';

const TEST_DOMAIN = 'exit-p1.mirethos.invalid';
const PILOTS = ['lg', 'apple', 'samsung'];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const checks: { account: string; check: string; ok: boolean; detail: string }[] = [];
const check = (account: string, name: string, ok: boolean, detail = '') => {
  checks.push({ account, check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${account.padEnd(8)} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();
  try {
    const admin = await withSystem(async (db) => {
      const { rows } = await db.query<{ id: string; email: string }>(
        `SELECT id, email FROM app_user WHERE lower(email) = lower($1) AND platform_role = 'admin'`,
        [config.SEED_ADMIN_EMAIL ?? ''],
      );
      if (!rows[0]) throw new Error('the seed admin (SEED_ADMIN_EMAIL) was not found; run db:seed first');
      return rows[0];
    });
    const adminToken = await signToken({ sub: admin.id, email: admin.email, role: 'admin' });
    const accounts = (await call(app, adminToken, 'GET', '/accounts')).json() as Json[];

    const managers: Record<string, string> = {};
    for (const slug of PILOTS) {
      const acct = accounts.find((a) => a.slug === slug);
      if (!acct) throw new Error(`pilot account ${slug} is missing`);
      managers[slug] = await configure(app, adminToken, acct);
    }
    await isolation(app, adminToken, accounts, managers);
  } finally {
    await cleanup(app);
    await app.close();
    await closeQueue();
    await closeDb();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}

function call(app: FastifyInstance, token: string | null, method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as Record<string, unknown> | undefined,
  });
}

/** Admin invites a throwaway user; the user accepts through the public endpoint. Returns their token. */
async function invite(app: FastifyInstance, adminToken: string, acct: Json, label: string, role: string): Promise<string> {
  const email = `${label}-${acct.slug}@${TEST_DOMAIN}`;
  const res = await call(app, adminToken, 'POST', `/accounts/${acct.id}/users/invite`, { email, name: `Exit test ${label}`, role });
  if (res.statusCode !== 201) throw new Error(`invite ${email}: ${res.statusCode} ${res.body}`);
  const token = new URL(res.json().inviteUrl).searchParams.get('invite');
  const accepted = await call(app, null, 'POST', '/auth/accept-invite', { token, password: `exit-test-${crypto.randomUUID()}` });
  if (accepted.statusCode !== 200) throw new Error(`accept ${email}: ${accepted.statusCode} ${accepted.body}`);
  return accepted.json().token;
}

async function configure(app: FastifyInstance, adminToken: string, acct: Json): Promise<string> {
  const a = acct.slug as string;
  const base = `/accounts/${acct.id}`;
  const mgr = await invite(app, adminToken, acct, 'manager', 'Account manager');
  check(a, 'Account manager invited and signed in through the invite link', true);

  // 1. Sources: the three live retailers plus eBay (collector planned for Phase 2b).
  const subs: [string, Json][] = [
    ['amazon_us', { buy_box_only: true, new_only: true, search_pages: 2 }],
    ['walmart_us', { all_sellers: true, new_only: true, search_pages: 2 }],
    ['bestbuy_us', { use_api: true, search_pages: 1 }],
    ['ebay_us', { new_only: true, buy_it_now_only: true, search_pages: 2 }],
  ];
  for (const [code, options] of subs) {
    const r = await call(app, mgr, 'PUT', `${base}/subscriptions/${code}`, { active: true, options });
    if (r.statusCode !== 200) check(a, `subscribe ${code}`, false, `${r.statusCode} ${r.body}`);
  }
  const subView = (await call(app, mgr, 'GET', `${base}/subscriptions`)).json();
  const subscribed = subView.sources.filter((s: Json) => s.subscription?.active).map((s: Json) => s.code);
  check(a, 'sources subscribed with collector options', subs.every(([c]) => subscribed.includes(c)), subscribed.join(', '));

  // 2. Terms at catalogue scale: a keyword per active SKU, identifier terms, and a brand term by import.
  const products = ((await call(app, mgr, 'GET', `${base}/products`)).json() as Json[]).filter((p) => p.status === 'Active');
  const names = await generate(app, mgr, base, { group: 'F26: Brand + Product Name', template: '{Brand} {Product Name}', identifierTypes: [] });
  const ids = await generate(app, mgr, base, { group: 'Identifiers (MPN / ASIN)', template: null, identifierTypes: ['MPN', 'ASIN'] });
  check(a, 'generated from catalogue with a dry run first', names.dry && ids.dry, `${products.length} active SKUs; names +${names.created}, identifiers +${ids.created}`);
  const csv = `type,value,product_code,group\nbrand,${acct.brand},,Brand terms\n`;
  const dryImport = (await call(app, mgr, 'POST', `${base}/terms/import`, { csv, dryRun: true })).json();
  const imported = (await call(app, mgr, 'POST', `${base}/terms/import`, { csv, dryRun: false, batchLabel: 'Exit test import' })).json();
  check(a, 'bulk import with a dry run first', dryImport.dryRun === true && dryImport.problems.length === 0 && imported.dryRun === false, `+${imported.created}`);

  const terms = (await call(app, mgr, 'GET', `${base}/terms?limit=500`)).json();
  const keywordsFor = new Set(terms.terms.filter((t: Json) => t.type === 'keyword' && t.productCode).map((t: Json) => t.productCode));
  const idTerms = terms.terms.filter((t: Json) => t.type === 'identifier').length;
  check(
    a,
    'every active SKU has a keyword term, plus identifier terms',
    products.every((p) => keywordsFor.has(p.code)) && idTerms >= products.length,
    `${terms.total} terms (${idTerms} identifiers) for ${products.length} SKUs`,
  );

  // 3. Matrix: names on marketplaces and retailers, identifiers on Amazon + retailers, brand on marketplaces.
  const groups = (await call(app, mgr, 'GET', `${base}/term-groups`)).json() as Json[];
  const gid = (name: string) => groups.find((g) => g.name === name)?.id;
  const cells: [string | undefined, string, Json][] = [
    [gid('F26: Brand + Product Name'), 'Marketplace', { mode: 'All' }],
    [gid('F26: Brand + Product Name'), 'Online Seller', { mode: 'All' }],
    [gid('Identifiers (MPN / ASIN)'), 'Marketplace', { mode: 'Some', sourceCodes: ['amazon_us'] }],
    [gid('Identifiers (MPN / ASIN)'), 'Online Seller', { mode: 'All' }],
    [gid('Brand terms'), 'Marketplace', { mode: 'All' }],
  ];
  let matrix: Json = {};
  for (const [g, cat, body] of cells) {
    const r = await call(app, mgr, 'PUT', `${base}/matrix/${g}/${encodeURIComponent(cat)}`, body);
    if (r.statusCode !== 200) check(a, `matrix ${cat}`, false, `${r.statusCode} ${r.body}`);
    else matrix = r.json();
  }
  check(a, 'subscription matrix set; estimate within budget', matrix.total > 0 && !matrix.overBudget, `${matrix.total} of ${matrix.budget} requests / cycle`);

  // 4. Schedules: the seeded daily sweep plus a faster re-check for listings under notice.
  const sched = await call(app, mgr, 'POST', `${base}/schedules`, {
    name: 'Under-notice re-check',
    cadence: '0 */6 * * *',
    timezone: 'UTC',
    priority: 20,
    listingScope: 'Included only',
    takedownStatus: 'Under notice',
  });
  const schedules = (await call(app, mgr, 'GET', `${base}/schedules`)).json() as Json[];
  check(
    a,
    'named schedules with next run',
    (sched.statusCode === 201 || sched.statusCode === 409) && schedules.length >= 2 && schedules.every((s) => !s.active || s.nextRun),
    schedules.map((s) => s.name).join(', '),
  );
  const resolved = (await call(app, mgr, 'GET', `${base}/schedules/resolve?source=amazon_us`)).json();
  check(a, 'a schedule resolves for Amazon work', !!resolved.schedule, resolved.schedule?.name ?? 'none');

  // 5. Every change is in the audit log, by the manager.
  const me = (await call(app, mgr, 'GET', '/auth/me')).json();
  const { events } = (await call(app, mgr, 'GET', `${base}/audit?limit=200&actor=${encodeURIComponent(me.email)}`)).json();
  const actions = new Set(events.map((e: Json) => e.action));
  const wanted = ['subscription.updated', 'terms.generated', 'terms.imported', 'matrix.updated', 'schedule.created'];
  const missing = wanted.filter((w) => !actions.has(w) && !(w === 'subscription.updated' && actions.has('subscription.created')));
  const schedOk = actions.has('schedule.created') || sched.statusCode === 409;
  check(a, 'audit log has every change by the manager', missing.filter((m) => m !== 'schedule.created' || !schedOk).length === 0, `${events.length} events`);

  return mgr;
}

async function generate(app: FastifyInstance, token: string, base: string, body: Json): Promise<{ dry: boolean; created: number }> {
  const dry = (await call(app, token, 'POST', `${base}/terms/generate`, { ...body, dryRun: true })).json();
  const done = (await call(app, token, 'POST', `${base}/terms/generate`, { ...body, dryRun: false })).json();
  return { dry: dry.dryRun === true && dry.products > 0, created: done.created ?? 0 };
}

async function isolation(app: FastifyInstance, adminToken: string, accounts: Json[], managers: Record<string, string>): Promise<void> {
  const lg = accounts.find((a) => a.slug === 'lg')!;
  const apple = accounts.find((a) => a.slug === 'apple')!;
  const brand = await invite(app, adminToken, lg, 'brand', 'Brand user');
  const denied = await Promise.all([
    call(app, brand, 'PUT', `/accounts/${lg.id}/subscriptions/amazon_us`, { active: false }),
    call(app, brand, 'GET', `/accounts/${lg.id}/terms`),
    call(app, brand, 'PATCH', `/accounts/${lg.id}/settings`, { name: 'x' }),
    call(app, brand, 'GET', `/accounts/${lg.id}/audit`),
  ]);
  check('lg', 'Brand user cannot change or read configuration', denied.every((r) => r.statusCode === 403), denied.map((r) => r.statusCode).join(','));
  const readOk = await call(app, brand, 'GET', `/accounts/${lg.id}/products`);
  check('lg', 'Brand user can read the catalogue', readOk.statusCode === 200);
  const cross = await Promise.all([
    call(app, managers.lg, 'GET', `/accounts/${apple.id}/matrix`),
    call(app, managers.lg, 'GET', `/accounts/${apple.id}/terms`),
    call(app, managers.lg, 'PUT', `/accounts/${apple.id}/subscriptions/amazon_us`, { active: false }),
  ]);
  check('lg', "LG's manager cannot see or change Apple", cross.every((r) => r.statusCode === 403), cross.map((r) => r.statusCode).join(','));
}

/** Remove the throwaway users through the API (audited), then delete them. */
async function cleanup(app: FastifyInstance): Promise<void> {
  const users = await withSystem(async (db) =>
    (
      await db.query<{ user_id: string; account_id: string }>(
        `SELECT m.user_id, m.account_id FROM account_membership m JOIN app_user u ON u.id = m.user_id WHERE u.email LIKE $1`,
        [`%@${TEST_DOMAIN}`],
      )
    ).rows,
  );
  const admin = await withSystem(
    async (db) => (await db.query<{ id: string; email: string }>(`SELECT id, email FROM app_user WHERE lower(email) = lower($1)`, [config.SEED_ADMIN_EMAIL ?? ''])).rows[0],
  );
  if (admin) {
    const token = await signToken({ sub: admin.id, email: admin.email, role: 'admin' });
    for (const u of users) await call(app, token, 'DELETE', `/accounts/${u.account_id}/users/${u.user_id}`);
  }
  await withSystem((db) => db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_DOMAIN}`]));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
