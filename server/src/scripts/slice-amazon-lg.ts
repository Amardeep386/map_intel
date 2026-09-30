// Configures the Amazon.com LG Sandbox slice (decisions 29–35, src/lib/amazonSlice.ts):
//   1. LG's Amazon.com subscription: active, 2 search pages, new only, buy box only;
//   2. term group "Amazon LG slice": a model-number and a name term for 10 LG SKUs, Marketplace = Amazon only;
//   3. "Brand SKUs" (and any other group) no longer searches Amazon;
//   4. schedules "Amazon LG discovery" (discovery only, manual) and "Amazon LG daily monitoring"
//      (monitoring only, 09:00 Asia/Kolkata, Included listings).
// Everything goes through the API as the seed admin, so it is audited like a user's change. Safe to re-run.
//
//   npm run slice:amazon-lg             # dry run: shows what would change
//   npm run slice:amazon-lg -- --commit
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { pickSliceSkus, SLICE, sliceTerms, type SliceProduct } from '../lib/amazonSlice.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const commit = process.argv.includes('--commit');
const say = (msg: string) => console.log(`${commit ? '' : '[dry run] '}${msg}`);

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
    const acct = accounts.find((a) => a.slug === SLICE.account);
    if (!acct) throw new Error(`account ${SLICE.account} is missing`);
    console.log(`\n=== ${acct.name}`);
    await configure(app, token, `/accounts/${acct.id}`);
  } finally {
    await app.close();
    await closeQueue();
    await closeDb();
  }
}

async function configure(app: FastifyInstance, token: string, base: string): Promise<void> {
  const call = (method: string, url: string, payload?: unknown) => ok(app, token, method, `${base}${url}`, payload);

  // 1. Subscription.
  const subs = (await call('GET', '/subscriptions')).sources as Json[];
  const amazon = subs.find((s) => s.code === SLICE.source);
  if (!amazon) throw new Error(`${SLICE.source} is not in the source catalogue`);
  const overrides = { ...(amazon.subscription?.overrides ?? {}), ...SLICE.options };
  // Stored as explicit overrides, so a later change of the source's defaults does not move the slice.
  const subChanged = !amazon.subscription?.active || Object.entries(SLICE.options).some(([k, v]) => amazon.subscription?.overrides?.[k] !== v);
  say(`subscription ${amazon.name}: ${subChanged ? `set active, ${JSON.stringify(SLICE.options)}` : 'already set'}`);
  if (commit && subChanged) await call('PUT', `/subscriptions/${SLICE.source}`, { active: true, options: overrides });

  // 2. SKUs and terms.
  const products = ((await call('GET', '/products')) as unknown as Json[]).map(
    (p): SliceProduct => ({ code: p.code, name: p.name, model: p.model, category: p.category, modelFamily: p.modelFamily, status: p.status }),
  );
  const skus = pickSliceSkus(products);
  console.log(`SKUs (${skus.length}):`);
  for (const p of skus) console.log(`  ${p.code.padEnd(18)} ${(p.category ?? '').padEnd(16)} ${p.modelFamily ?? ''}`);

  let group = ((await call('GET', '/term-groups')) as unknown as Json[]).find((g) => g.name.toLowerCase() === SLICE.group.toLowerCase());
  say(`term group "${SLICE.group}": ${group ? 'exists' : 'create'}`);
  if (commit && !group) {
    group = await call('POST', '/term-groups', { name: SLICE.group, description: 'Amazon.com slice: model number and name of 10 LG SKUs (decision 29).' });
  }
  const current: Json[] = group ? (await call('GET', `/terms?group=${group.id}&limit=500`)).terms : [];
  const wanted = sliceTerms(skus);
  const key = (t: Json) => `${t.type}|${String(t.value).toLowerCase()}`;
  const have = new Map(current.map((t) => [key(t), t]));
  const toAdd = wanted.filter((t) => !have.has(key(t)));
  const toActivate = wanted.map((t) => have.get(key(t))).filter((t): t is Json => Boolean(t && !t.active));
  const wantedKeys = new Set(wanted.map(key));
  const toDeactivate = current.filter((t) => t.active && !wantedKeys.has(key(t)));
  say(`terms: +${toAdd.length} new, ${toActivate.length} re-activated, ${toDeactivate.length} deactivated, ${wanted.length - toAdd.length - toActivate.length} unchanged`);
  for (const t of toAdd.slice(0, 4)) console.log(`  + ${t.type} "${t.value}"`);
  if (commit && group) {
    for (const t of toAdd) await call('POST', '/terms', { type: t.type, value: t.value, groupId: group.id, productCode: t.productCode });
    for (const t of toActivate) await call('PATCH', `/terms/${t.id}`, { active: true });
    for (const t of toDeactivate) await call('PATCH', `/terms/${t.id}`, { active: false });
  }

  // 3. Matrix: the slice group searches Amazon only; no other group searches Amazon.
  const matrix = await call('GET', '/matrix');
  const marketplace = ((matrix.sources.Marketplace ?? []) as Json[]).map((s) => s.code as string);
  for (const g of matrix.groups as Json[]) {
    if (group && g.id === group.id) continue;
    const cell = g.cells.Marketplace ?? { mode: 'None', sourceCodes: [] };
    const hasAmazon = cell.mode === 'All' || (cell.mode === 'Some' && cell.sourceCodes.includes(SLICE.source));
    if (!hasAmazon) continue;
    const rest = (cell.mode === 'All' ? marketplace : cell.sourceCodes).filter((c: string) => c !== SLICE.source);
    say(`group "${g.name}": Marketplace ${cell.mode} → ${rest.length ? `Some (${rest.join(', ')})` : 'None'}`);
    if (commit) await call('PUT', `/matrix/${g.id}/Marketplace`, rest.length ? { mode: 'Some', sourceCodes: rest } : { mode: 'None' });
  }
  const sliceCells = group ? (matrix.groups as Json[]).find((g) => g.id === group!.id)?.cells ?? {} : {};
  for (const cat of matrix.categories as string[]) {
    const want = cat === 'Marketplace' ? { mode: 'Some', sourceCodes: [SLICE.source] } : { mode: 'None', sourceCodes: [] };
    const cell = sliceCells[cat] ?? { mode: 'None', sourceCodes: [] };
    if (cell.mode === want.mode && JSON.stringify(cell.sourceCodes ?? []) === JSON.stringify(want.sourceCodes)) continue;
    say(`group "${SLICE.group}": ${cat} → ${want.mode}${want.sourceCodes.length ? ` (${want.sourceCodes.join(', ')})` : ''}`);
    if (commit && group) await call('PUT', `/matrix/${group.id}/${encodeURIComponent(cat)}`, want);
  }

  // 4. Schedules.
  const schedules = (await call('GET', '/schedules')) as unknown as Json[];
  const defs = [
    { ...SLICE.discovery, selector: { sources: [SLICE.source], ...(group ? { termGroups: [group.id] } : {}) }, listingScope: 'Included only' },
    { ...SLICE.monitoring, selector: { sources: [SLICE.source] }, listingScope: 'Included only' },
  ];
  for (const d of defs) {
    const body = { name: d.name, cadence: d.cadence, timezone: d.timezone, kind: d.kind, priority: SLICE.priority, selector: d.selector, listingScope: d.listingScope, listingStatus: 'Active only', takedownStatus: 'All', active: true };
    const existing = schedules.find((s) => s.name.toLowerCase() === d.name.toLowerCase());
    const same = existing && (['cadence', 'timezone', 'kind', 'priority', 'listingScope', 'listingStatus', 'takedownStatus', 'active'] as const).every((k) => existing[k] === body[k]) && JSON.stringify(existing.selector) === JSON.stringify(body.selector);
    say(`schedule "${d.name}": ${!existing ? 'create' : same ? 'already set' : 'update'} (${d.kind}, ${d.cadence} ${d.timezone}, priority ${SLICE.priority})`);
    if (!commit || same) continue;
    if (existing) await call('PATCH', `/schedules/${existing.id}`, body);
    else await call('POST', '/schedules', body);
  }

  const est = (await call('GET', '/subscriptions')).estimate;
  console.log(`projected requests / cycle: ${est.total} of ${est.budget}${est.overBudget ? ' — OVER BUDGET' : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
