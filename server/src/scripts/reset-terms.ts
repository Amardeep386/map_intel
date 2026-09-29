// Resets the terms of the LG, Apple and Samsung sandboxes to one term group:
//   1. deletes every term group, with its terms, matrix cells and term-yield history;
//   2. creates "Brand SKUs": one keyword term "{Brand} {SKU}" per active SKU in Product Summary;
//   3. sets the group to All in every source category of the subscription matrix.
// Everything goes through the API as the seed admin, so it is audited like a user's change.
//
//   npm run terms:reset             # dry run: shows what would change
//   npm run terms:reset -- --commit
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ACCOUNTS = ['lg', 'apple', 'samsung'];
const GROUP = 'Brand SKUs';
const TEMPLATE = '{Brand} {Code}';
const commit = process.argv.includes('--commit');

async function ok(app: FastifyInstance, token: string, method: string, url: string, payload?: unknown): Promise<Json> {
  const res = await app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` }, payload: payload as Json | undefined });
  if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.statusCode === 204 ? {} : res.json();
}

async function main(): Promise<void> {
  console.log(commit ? 'COMMIT: writing changes' : 'DRY RUN: nothing is written (add -- --commit to write)');
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
    const token = await signToken({ sub: admin.id, email: admin.email, role: 'admin' });
    const accounts = (await ok(app, token, 'GET', '/accounts')) as unknown as Json[];
    for (const slug of ACCOUNTS) {
      const acct = accounts.find((a) => a.slug === slug);
      if (!acct) throw new Error(`account ${slug} is missing`);
      console.log(`\n=== ${acct.name}`);
      await resetAccount(app, token, `/accounts/${acct.id}`);
    }
  } finally {
    await app.close();
    await closeQueue();
    await closeDb();
  }
}

async function resetAccount(app: FastifyInstance, token: string, base: string) {
  const groups = (await ok(app, token, 'GET', `${base}/term-groups`)) as unknown as Json[];
  console.log(`delete: ${groups.length} term groups, ${groups.reduce((n, g) => n + g.terms, 0)} terms`);
  for (const g of groups) console.log(`  - ${g.name} (${g.terms} terms)`);

  // Schedules scoped to particular groups or terms would match nothing afterwards.
  const schedules = (await ok(app, token, 'GET', `${base}/schedules`)) as unknown as Json[];
  for (const s of schedules.filter((x) => x.selector?.termGroups?.length || x.selector?.terms?.length)) {
    console.log(`  ! schedule "${s.name}" is scoped to term groups or terms; it will need re-scoping`);
  }

  const products = (await ok(app, token, 'GET', `${base}/products`)) as unknown as Json[];
  const skipped = products.filter((p) => p.status !== 'Active');
  console.log(`create "${GROUP}": ${products.length - skipped.length} active SKUs${skipped.length ? ` (${skipped.length} paused SKUs left out: ${skipped.map((p) => p.code).join(', ')})` : ''}`);
  if (!commit) return;

  for (const g of groups) await ok(app, token, 'DELETE', `${base}/term-groups/${g.id}`);
  const r = await ok(app, token, 'POST', `${base}/terms/generate`, { group: GROUP, template: TEMPLATE, identifierTypes: [], dryRun: false });
  console.log(`terms "${GROUP}": +${r.created}, e.g. ${r.sample.slice(0, 3).map((t: Json) => `"${t.value}"`).join(', ')}`);
  const matrix = await ok(app, token, 'GET', `${base}/matrix`);
  for (const cat of matrix.categories as string[]) {
    await ok(app, token, 'PUT', `${base}/matrix/${r.groupId}/${encodeURIComponent(cat)}`, { mode: 'All' });
  }
  const est = (await ok(app, token, 'GET', `${base}/subscriptions`)).estimate;
  console.log(`matrix: All in ${matrix.categories.join(', ')}; projected requests / cycle: ${est.total} of ${est.budget}${est.overBudget ? ' — OVER BUDGET' : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
