// Configures the LG Sandbox slice (decisions 29–38, src/lib/lgSlice.ts), route D:
//   1. subscriptions: Walmart and eBay active with the slice options; Amazon.com paused;
//   2. term group "LG slice" (was "Amazon LG slice"): a model-number and a name term for 10 LG SKUs,
//      Marketplace = eBay only; group "LG slice Walmart pages": Walmart's LG browse page, Walmart only;
//   3. schedules "LG slice discovery" (discovery only, manual) and "LG slice daily monitoring"
//      (monitoring only, 09:00 Asia/Kolkata, Included listings); the Amazon slice schedules are
//      renamed to these (or switched off when both exist).
// Everything goes through the API as the seed admin, so it is audited like a user's change. Safe to re-run.
//
//   npm run slice:lg             # dry run: shows what would change
//   npm run slice:lg -- --commit
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { pickSliceSkus, SLICE, sliceTerms, type SliceProduct } from '../lib/lgSlice.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = (method: string, url: string, payload?: unknown) => Promise<Json>;

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
    await configure((method, url, payload) => ok(app, token, method, `/accounts/${acct.id}${url}`, payload));
  } finally {
    await app.close();
    await closeQueue();
    await closeDb();
  }
}

async function configure(call: Call): Promise<void> {
  // 1. Subscriptions.
  const subs = (await call('GET', '/subscriptions')).sources as Json[];
  for (const code of [...SLICE.sources, ...SLICE.paused]) {
    const src = subs.find((s) => s.code === code);
    if (!src) throw new Error(`${code} is not in the source catalogue`);
    const active = SLICE.sources.includes(code);
    const want = SLICE.options[code] ?? {};
    // Stored as explicit overrides, so a later change of the source's defaults does not move the slice.
    const changed = Boolean(src.subscription?.active) !== active || Object.entries(want).some(([k, v]) => src.subscription?.overrides?.[k] !== v);
    say(`subscription ${src.name}: ${!changed ? 'already set' : active ? `set active, ${JSON.stringify(want)}` : 'pause (route D: manual evidence)'}`);
    if (commit && changed) await call('PUT', `/subscriptions/${code}`, { active, options: { ...(src.subscription?.overrides ?? {}), ...want } });
  }

  // 2. SKUs and terms.
  const products = ((await call('GET', '/products')) as unknown as Json[]).map(
    (p): SliceProduct => ({ code: p.code, name: p.name, model: p.model, category: p.category, modelFamily: p.modelFamily, status: p.status }),
  );
  const skus = pickSliceSkus(products);
  console.log(`SKUs (${skus.length}):`);
  for (const p of skus) console.log(`  ${p.code.padEnd(18)} ${(p.category ?? '').padEnd(16)} ${p.modelFamily ?? ''}`);

  const groups = (await call('GET', '/term-groups')) as unknown as Json[];
  const named = (n: string) => groups.find((g) => g.name.toLowerCase() === n.toLowerCase());
  let group = named(SLICE.group.name);
  const former = named(SLICE.group.formerName);
  if (!group && former) {
    say(`term group "${former.name}" → rename to "${SLICE.group.name}"`);
    if (commit) await call('PATCH', `/term-groups/${former.id}`, { name: SLICE.group.name, description: SLICE.group.description });
    group = { ...former, name: SLICE.group.name };
  } else {
    say(`term group "${SLICE.group.name}": ${group ? 'exists' : 'create'}`);
    if (commit && !group) group = await call('POST', '/term-groups', { name: SLICE.group.name, description: SLICE.group.description });
  }
  await syncTerms(call, group, sliceTerms(skus));

  let pagesGroup = named(SLICE.pagesGroup.name);
  say(`term group "${SLICE.pagesGroup.name}": ${pagesGroup ? 'exists' : 'create'}`);
  if (commit && !pagesGroup) pagesGroup = await call('POST', '/term-groups', { name: SLICE.pagesGroup.name, description: SLICE.pagesGroup.description });
  await syncTerms(call, pagesGroup, SLICE.pagesGroup.urls.map((value) => ({ type: 'url', value })));

  // 3. Matrix: each slice group covers its own sources only, in the Marketplace category.
  const matrix = await call('GET', '/matrix');
  const cellsFor: [Json | undefined, string[]][] = [
    [group, SLICE.group.sources],
    [pagesGroup, SLICE.pagesGroup.sources],
  ];
  for (const [g, sources] of cellsFor) {
    if (!g) continue;
    const cells = (matrix.groups as Json[]).find((x) => x.id === g.id)?.cells ?? {};
    for (const cat of matrix.categories as string[]) {
      const want = cat === 'Marketplace' ? { mode: 'Some', sourceCodes: sources } : { mode: 'None', sourceCodes: [] };
      const cell = cells[cat] ?? { mode: 'None', sourceCodes: [] };
      const sorted = (xs: string[]) => JSON.stringify([...xs].sort());
      if (cell.mode === want.mode && sorted(cell.sourceCodes ?? []) === sorted(want.sourceCodes)) continue;
      say(`group "${g.name}": ${cat} → ${want.mode}${want.sourceCodes.length ? ` (${want.sourceCodes.join(', ')})` : ''}`);
      if (commit) await call('PUT', `/matrix/${g.id}/${encodeURIComponent(cat)}`, want);
    }
  }

  // 4. Schedules: the Amazon slice schedules become the LG slice schedules.
  const schedules = (await call('GET', '/schedules')) as unknown as Json[];
  const byName = (n: string) => schedules.find((s) => s.name.toLowerCase() === n.toLowerCase());
  const groupIds = [group?.id, pagesGroup?.id].filter(Boolean);
  const defs = [
    { ...SLICE.discovery, selector: { sources: SLICE.sources, ...(groupIds.length ? { termGroups: groupIds } : {}) } },
    { ...SLICE.monitoring, selector: { sources: SLICE.sources } },
  ];
  for (const d of defs) {
    const body = { name: d.name, cadence: d.cadence, timezone: d.timezone, kind: d.kind, priority: SLICE.priority, selector: d.selector, listingScope: 'Included only', listingStatus: 'Active only', takedownStatus: 'All', active: true };
    const existing = byName(d.name);
    const old = byName(d.formerName);
    if (existing && old?.active) {
      say(`schedule "${old.name}": switch off (route D)`);
      if (commit) await call('PATCH', `/schedules/${old.id}`, { active: false });
    }
    const target = existing ?? old;
    const keys = ['name', 'cadence', 'timezone', 'kind', 'priority', 'listingScope', 'listingStatus', 'takedownStatus', 'active'] as const;
    const same = target && keys.every((k) => target[k] === body[k]) && JSON.stringify(target.selector) === JSON.stringify(body.selector);
    const what = !target ? 'create' : same ? 'already set' : target === old ? `update (was "${old.name}")` : 'update';
    say(`schedule "${d.name}": ${what} (${d.kind}, ${d.cadence} ${d.timezone}, ${SLICE.sources.join(' + ')}, priority ${SLICE.priority})`);
    if (!commit || same) continue;
    if (target) await call('PATCH', `/schedules/${target.id}`, body);
    else await call('POST', '/schedules', body);
  }

  const est = (await call('GET', '/subscriptions')).estimate;
  console.log(`projected requests / cycle: ${est.total} of ${est.budget}${est.overBudget ? ' — OVER BUDGET' : ''}`);
}

/** Make a group's active terms exactly `wanted` (add, re-activate, deactivate the rest). */
async function syncTerms(call: Call, group: Json | undefined, wanted: { type: string; value: string; productCode?: string }[]): Promise<void> {
  const current: Json[] = group?.id ? (await call('GET', `/terms?group=${group.id}&limit=500`)).terms : [];
  const key = (t: Json) => `${t.type}|${String(t.value).toLowerCase()}`;
  const have = new Map(current.map((t) => [key(t), t]));
  const toAdd = wanted.filter((t) => !have.has(key(t)));
  const toActivate = wanted.map((t) => have.get(key(t))).filter((t): t is Json => Boolean(t && !t.active));
  const wantedKeys = new Set(wanted.map(key));
  const toDeactivate = current.filter((t) => t.active && !wantedKeys.has(key(t)));
  say(`  terms: +${toAdd.length} new, ${toActivate.length} re-activated, ${toDeactivate.length} deactivated, ${wanted.length - toAdd.length - toActivate.length} unchanged`);
  for (const t of toAdd.slice(0, 4)) console.log(`    + ${t.type} "${t.value}"`);
  if (!commit || !group?.id) return;
  for (const t of toAdd) await call('POST', '/terms', { type: t.type, value: t.value, groupId: group.id, ...(t.productCode ? { productCode: t.productCode } : {}) });
  for (const t of toActivate) await call('PATCH', `/terms/${t.id}`, { active: true });
  for (const t of toDeactivate) await call('PATCH', `/terms/${t.id}`, { active: false });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
