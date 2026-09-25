// Catalogue routes: products with identifiers, edits, and product / MAP imports with a dry run
// before commit. Runs in a throwaway account.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import ExcelJS from 'exceljs';
import { closeDb } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let acct: string;
let base: string;
const u: Record<string, TestUser> = {};

const csv = (text: string) => Buffer.from(text, 'utf8').toString('base64');

before(async () => {
  await removeTestAccounts(); // leftovers from an interrupted run
  acct = await createTestAccount('catalogue');
  base = `/accounts/${acct}`;
  u.analyst = await createUser('cat-analyst', 'Analyst', acct);
  u.brand = await createUser('cat-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  // Accounts first: MAP rows reference the users who created them.
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('an Analyst adds a SKU with identifiers; the list shows them and the edit is audited', async () => {
  const res = await call(app, u.analyst, 'POST', `${base}/products`, {
    code: 'CAT-1', name: 'Test TV 65', model: 'TV65X', category: 'TV', group: 'OLED 2026', msrp: 1999,
    upc: '036000291452', asin: 'B0TEST0001', alts: ['TV65X.AUS', null, 'TV65X-B'],
  });
  assert.equal(res.statusCode, 201, res.body);
  const p = res.json();
  assert.equal(p.upc, '036000291452');
  assert.deepEqual(p.alts, ['TV65X.AUS', null, 'TV65X-B', null, null, null]);

  const patch = await call(app, u.analyst, 'PATCH', `${base}/products/${p.id}`, { category: 'Television', alts: [null, 'TV65X-2'] });
  assert.equal(patch.statusCode, 200, patch.body);
  assert.deepEqual(patch.json().alts, [null, 'TV65X-2', 'TV65X-B', null, null, null]);
  assert.equal(patch.json().category, 'Television');

  const { events } = (await call(app, u.analyst, 'GET', `${base}/audit?entity=product`)).json();
  const e = events.find((x: { action: string }) => x.action === 'product.updated');
  assert.equal(e.before.category, 'TV');
  assert.equal(e.after.category, 'Television');
  assert.equal((await call(app, u.brand, 'PATCH', `${base}/products/${p.id}`, { name: 'x' })).statusCode, 403);
});

test('product import: the dry run writes nothing; commit writes the plan and records IMP-001', async () => {
  const file = [
    'Item Code,Product Name,MPN,UPC,Alt SKU 1,RRP,Status',
    'CAT-1,Test TV 65,TV65X,,,2099,',
    'CAT-2,Test soundbar,SB9,,SB9.AUS,499,Active',
    'CAT-3,,,,,,',
    'CAT-4,Bad UPC,X4,036000291453,,,',
  ].join('\n');
  const body = { fileName: 'lg-catalogue.csv', content: csv(file) };
  const dry = await call(app, u.analyst, 'POST', `${base}/imports/products`, { ...body, dryRun: true });
  assert.equal(dry.statusCode, 200, dry.body);
  const d = dry.json();
  assert.deepEqual(d.summary, { new: 1, changed: 1, unchanged: 0, errors: 2 });
  assert.equal(d.mapping.code, 0);
  assert.deepEqual(d.changes.find((c: { code: string }) => c.code === 'CAT-1').fields, { msrp: [1999, 2099] });
  assert.equal((await call(app, u.analyst, 'GET', `${base}/products`)).json().length, 1);

  const commit = (await call(app, u.analyst, 'POST', `${base}/imports/products`, { ...body, dryRun: false })).json();
  assert.equal(commit.importCode, 'IMP-001');
  const products = (await call(app, u.analyst, 'GET', `${base}/products`)).json();
  assert.equal(products.length, 2);
  assert.equal(products.find((p: { code: string }) => p.code === 'CAT-2').alts[0], 'SB9.AUS');
  assert.equal(products.find((p: { code: string }) => p.code === 'CAT-1').msrp, 2099);
  const imports = (await call(app, u.analyst, 'GET', `${base}/imports`)).json();
  assert.equal(imports[0].code, 'IMP-001');
  assert.equal((await call(app, u.brand, 'POST', `${base}/imports/products`, body)).statusCode, 403);
});

test('an XLSX file with a column mapping chosen by the user', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.addRow(['Ref', 'Label', 'Part']);
  ws.addRow(['CAT-5', 'Test monitor', 'MON27']);
  const content = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  const res = await call(app, u.analyst, 'POST', `${base}/imports/products`, {
    fileName: 'x.xlsx', content, mapping: { code: 0, name: 1, model: 2 }, dryRun: false,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().summary.new, 1);
});

test('MAP import: a new version closes the one in force; history is kept and shown per product', async () => {
  const first = { fileName: 'map-sep.csv', content: csv('SKU,MAP,Start\nCAT-1,1799,2026-09-01\nCAT-2,449,09/01/2026\nNOPE-1,10,2026-09-01\n') };
  const dry = (await call(app, u.analyst, 'POST', `${base}/imports/map`, { ...first, dryRun: true })).json();
  assert.deepEqual(dry.summary, { newVersions: 2, unchanged: 0, unknownSkus: 1, errors: 0 });
  assert.equal((await call(app, u.analyst, 'POST', `${base}/imports/map`, { ...first, dryRun: false })).statusCode, 200);

  const second = { fileName: 'map-oct.csv', content: csv('SKU,MAP,Start\nCAT-1,1699,2026-10-01\nCAT-2,449,2026-10-01\nCAT-1,1,2026-08-01\n') };
  const d2 = (await call(app, u.analyst, 'POST', `${base}/imports/map`, { ...second, dryRun: true })).json();
  assert.equal(d2.summary.newVersions, 1);
  assert.equal(d2.summary.unchanged, 1);
  assert.equal(d2.summary.errors, 1); // CAT-1 twice in the file
  const second2 = { fileName: 'map-oct.csv', content: csv('SKU,MAP,Start\nCAT-1,1699,2026-10-01\n') };
  assert.equal((await call(app, u.analyst, 'POST', `${base}/imports/map`, { ...second2, dryRun: false })).statusCode, 200);

  const cat1 = (await call(app, u.analyst, 'GET', `${base}/products`)).json().find((p: { code: string }) => p.code === 'CAT-1');
  const detail = (await call(app, u.analyst, 'GET', `${base}/products/${cat1.id}`)).json();
  assert.deepEqual(detail.mapHistory.map((m: { amount: number; version: number }) => [m.version, m.amount]), [[2, 1699], [1, 1799]]);
  assert.ok(detail.mapHistory[1].to, 'the September version is closed');
  assert.equal(detail.mapHistory[0].to, null);
  assert.match(detail.mapHistory[0].importCode, /^IMP-\d{3}$/);
});

test('retired products are hidden unless asked for', async () => {
  const p = (await call(app, u.analyst, 'GET', `${base}/products`)).json().find((x: { code: string }) => x.code === 'CAT-5');
  await call(app, u.analyst, 'PATCH', `${base}/products/${p.id}`, { status: 'Retired' });
  const codes = (await call(app, u.analyst, 'GET', `${base}/products`)).json().map((x: { code: string }) => x.code);
  assert.ok(!codes.includes('CAT-5'));
  const all = (await call(app, u.analyst, 'GET', `${base}/products?retired=1`)).json().map((x: { code: string }) => x.code);
  assert.ok(all.includes('CAT-5'));
});
