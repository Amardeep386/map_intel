// Loads the demo catalogue (server/seeds/demo-catalogue.json, made from
// docs/MAP_Intel_Demo_Catalogue_LG_Apple_Samsung.xlsx) into the LG, Apple and Samsung sandboxes:
//   1. adds the merchants on the brands' lists to the shared source catalogue;
//   2. renames a placeholder SKU whose model number is a SKU in the file to that SKU (its listings,
//      prices and evidence carry over), and retires every other SKU not in the file (history, listings' evidence and MAP rows stay), with its
//      included listings and its product terms, so it is no longer collected;
//   3. imports columns A–J of each "<Brand> Product Summary" sheet as a product import;
//   4. imports the MAP column as a MAP file (in force from mapEffectiveFrom);
//   5. subscribes each brand to its Track = Y merchants with their merchant-list details and pauses
//      subscriptions to merchants not tracked;
//   6. generates a "{Brand} {SKU}" keyword term per new SKU in the "Brand SKUs" group (see reset-terms.ts).
// Everything except step 1 goes through the API as the seed admin, so it is audited like a user's
// change. Safe to run again: unchanged rows are skipped.
//
//   npm run catalogue:demo             # dry run: shows what would change
//   npm run catalogue:demo -- --commit
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { recordAudit, type AuditActor } from '../lib/audit.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';
import { syncSourceCatalogue } from '../lib/sourceCatalogue.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface DemoProduct {
  name: string;
  sku: string;
  map: number;
  brand: string;
  category: string | null;
  modelFamily: string | null;
  configuration: string | null;
  colour: string | null;
  internalId: string | null;
  status: string;
}

interface DemoMerchant {
  no: number;
  track: boolean;
  name: string;
  source: string;
  website: string;
  channelType: string | null;
  sellerModel: string | null;
  authorisation: string | null;
  priority: string | null;
  checkFrequency: string | null;
  collectionMethod: string | null;
  notes: string | null;
  categories: string[];
}

interface DemoFile {
  mapEffectiveFrom: string;
  accounts: Record<string, { brand: string; products: DemoProduct[]; merchants: DemoMerchant[] }>;
}

const SHEET = 'MAP_Intel_Demo_Catalogue_LG_Apple_Samsung.xlsx';
const seedPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../seeds/demo-catalogue.json');
const commit = process.argv.includes('--commit');

/** The sheet's statuses the portal does not have: "Check listing" (specs to confirm) is loaded as Paused. */
export const productStatus = (s: string) => (['Active', 'Paused', 'Retired'].includes(s) ? s : 'Paused');

const csvCell = (v: string | number | null) => {
  const t = v === null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const toCsv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const base64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function call(app: FastifyInstance, token: string, method: string, url: string, payload?: unknown) {
  return app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` }, payload: payload as Json | undefined });
}

async function ok(app: FastifyInstance, token: string, method: string, url: string, payload?: unknown): Promise<Json> {
  const res = await call(app, token, method, url, payload);
  if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json();
}

async function main(): Promise<void> {
  const demo = JSON.parse(await readFile(seedPath, 'utf8')) as DemoFile;
  console.log(commit ? 'COMMIT: writing changes' : 'DRY RUN: nothing is written (add -- --commit to write)');

  if (commit) {
    const ids = await withSystem((db) => syncSourceCatalogue(db));
    console.log(`source catalogue synced: ${ids.size} sources`);
  }

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
    const actor: AuditActor = { type: 'user', id: admin.id, label: admin.email };
    const accounts = (await ok(app, token, 'GET', '/accounts')) as unknown as Json[];

    for (const [slug, data] of Object.entries(demo.accounts)) {
      const acct = accounts.find((a) => a.slug === slug);
      if (!acct) throw new Error(`account ${slug} is missing`);
      console.log(`\n=== ${acct.name} (${data.products.length} SKUs, ${data.merchants.filter((m) => m.track).length}/${data.merchants.length} merchants tracked)`);
      await loadAccount(app, token, acct.id, actor, data, demo.mapEffectiveFrom);
    }
  } finally {
    await app.close();
    await closeQueue();
    await closeDb();
  }
}

async function loadAccount(
  app: FastifyInstance, token: string, accountId: string, actor: AuditActor, data: DemoFile['accounts'][string], mapFrom: string,
) {
  const base = `/accounts/${accountId}`;
  const codes = new Set(data.products.map((p) => p.sku.toLowerCase()));

  // 2a. A placeholder whose model number is one of the file's SKUs is the same product: it takes the
  // SKU (product codes have no API, so this is a direct update, audited as the admin). The product
  // import below then fills in its columns A–J.
  let current = (await ok(app, token, 'GET', `${base}/products?retired=1`)) as unknown as Json[];
  const renames = current.filter((p) => p.model && codes.has(String(p.model).toLowerCase()) && String(p.code).toLowerCase() !== String(p.model).toLowerCase());
  console.log(`convert: ${renames.length} SKUs are in the file under their model number${renames.length ? ` (${renames.map((p) => `${p.code} -> ${p.model}`).join(', ')})` : ''}`);
  if (commit && renames.length) {
    await withSystem(async (db) => {
      for (const p of renames) {
        const sku = data.products.find((d) => d.sku.toLowerCase() === String(p.model).toLowerCase())!.sku;
        await db.query(`UPDATE product SET product_code = $3, status = 'Active' WHERE id = $1 AND account_id = $2`, [p.id, accountId, sku]);
        await recordAudit(db, {
          accountId, actor, action: 'product.updated', entityType: 'product', entityId: p.id,
          summary: `Renamed SKU ${p.code} to ${sku} (demo catalogue: same model number)`,
          before: { code: p.code, status: p.status }, after: { code: sku, status: 'Active' },
        });
      }
    });
    current = (await ok(app, token, 'GET', `${base}/products?retired=1`)) as unknown as Json[];
  }
  const converted = new Set(renames.map((p) => p.id));

  // 2b. Retire what is not in the file.
  const old = current.filter((p) => p.status !== 'Retired' && !converted.has(p.id) && !codes.has(String(p.code).toLowerCase()));
  console.log(`retire: ${old.length} SKUs not in the file${old.length ? ` (${old.map((p) => p.code).join(', ')})` : ''}`);
  if (commit && old.length) {
    const oldCodes = new Set(old.map((p) => p.code));
    let listings = 0;
    for (const p of old) {
      const detail = await ok(app, token, 'GET', `${base}/products/${p.id}`);
      const ids = (detail.includedListings as Json[]).map((l) => l.id);
      if (ids.length) {
        const r = await ok(app, token, 'POST', `${base}/mapping/decisions`, { listingIds: ids, action: 'retire', note: 'SKU replaced by the demo catalogue' });
        listings += r.updated ?? ids.length;
      }
      await ok(app, token, 'PATCH', `${base}/products/${p.id}`, { status: 'Retired' });
    }
    const terms: Json[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await ok(app, token, 'GET', `${base}/terms?active=true&limit=500&offset=${offset}`);
      terms.push(...(page.terms as Json[]));
      if (terms.length >= page.total || !page.terms.length) break;
    }
    const stale = terms.filter((t) => t.active && t.productCode && oldCodes.has(t.productCode));
    for (const t of stale) await ok(app, token, 'PATCH', `${base}/terms/${t.id}`, { active: false });
    console.log(`  retired ${old.length} SKUs, ${listings} included listings, switched off ${stale.length} product terms`);
  }

  // 3. Products: columns A–J (the SKU is also the model / MPN).
  const header = ['Product Name', 'SKU', 'MAP Price (USD)', 'Brand', 'Category', 'Model Family', 'Configuration', 'Colour', 'Internal ID', 'Status'];
  const rows = data.products.map((p) => [p.name, p.sku, p.map, p.brand, p.category, p.modelFamily, p.configuration, p.colour, p.internalId, productStatus(p.status)]);
  const fileName = `${SHEET} - ${data.brand} Product Summary.csv`;
  const products = await ok(app, token, 'POST', `${base}/imports/products`, {
    fileName, content: base64(toCsv([header, ...rows])), mapping: { model: 1 }, dryRun: !commit,
  });
  console.log(`products: ${JSON.stringify(products.summary)}${products.importCode ? ` as ${products.importCode}` : ''}`);
  for (const p of products.problems as Json[]) console.log(`  line ${p.line}: ${p.reason}`);

  // 4. MAP, in force from the sheet's verification date.
  const mapCsv = toCsv([['SKU', 'MAP', 'Effective from', 'Note'], ...data.products.map((p) => [p.sku, p.map, mapFrom, 'Demo catalogue MAP'])]);
  if (commit) {
    const map = await ok(app, token, 'POST', `${base}/imports/map`, { fileName: `${SHEET} - ${data.brand} MAP.csv`, content: base64(mapCsv), dryRun: false });
    console.log(`MAP: ${JSON.stringify(map.summary)}${map.importCode ? ` as ${map.importCode}` : ''}`);
    for (const p of [...(map.problems as Json[]), ...(map.unknown as Json[])]) console.log(`  line ${p.line}: ${p.reason}`);
  } else {
    console.log(`MAP: ${data.products.length} versions from ${mapFrom} (checked on commit, after the SKUs exist)`);
  }

  // 5. Subscriptions: Track = Y merchants on, with their details; every other active one paused.
  const subs = (await ok(app, token, 'GET', `${base}/subscriptions`)).sources as Json[];
  const tracked = new Map(data.merchants.filter((m) => m.track).map((m) => [m.source, m]));
  for (const m of tracked.values()) {
    if (!subs.some((s) => s.code === m.source) && commit) throw new Error(`source ${m.source} (${m.name}) is not in the catalogue`);
  }
  const profile = (m: DemoMerchant) =>
    Object.fromEntries(
      Object.entries({
        channelType: m.channelType, sellerModel: m.sellerModel, authorisation: m.authorisation, priority: m.priority,
        checkFrequency: m.checkFrequency, collectionMethod: m.collectionMethod, notes: m.notes, categories: m.categories,
      }).filter(([, v]) => v !== null),
    );
  const pause = subs.filter((s) => s.subscription?.active && !tracked.has(s.code)).map((s) => s.code);
  console.log(`merchants: subscribe ${[...tracked.values()].map((m) => m.name).join(', ')}; pause ${pause.join(', ') || 'none'}`);
  if (commit) {
    for (const m of tracked.values()) await ok(app, token, 'PUT', `${base}/subscriptions/${m.source}`, { active: true, profile: profile(m) });
    for (const code of pause) await ok(app, token, 'PUT', `${base}/subscriptions/${code}`, { active: false });
  }

  // 6. Terms for the new SKUs, in the single "Brand SKUs" group (its matrix cells are set by reset-terms.ts).
  if (commit) {
    const r = await ok(app, token, 'POST', `${base}/terms/generate`, { group: 'Brand SKUs', template: '{Brand} {Code}', identifierTypes: [], dryRun: false });
    console.log(`terms "Brand SKUs": +${r.created} (${r.alreadyExist} already there)`);
    const est = (await ok(app, token, 'GET', `${base}/subscriptions`)).estimate;
    console.log(`projected requests / cycle: ${est.total} of ${est.budget}${est.overBudget ? ' — OVER BUDGET' : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
