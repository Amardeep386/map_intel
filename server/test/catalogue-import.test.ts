// Catalogue import: file reading, column mapping, value checks and the dry-run diff.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import {
  extractRows, guessMapping, parseDate, parseMoney, planMap, planProducts, readTable, validGtin,
  type ExistingProduct, type MapVersion,
} from '../src/lib/catalogueImport.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

test('headers map to fields by synonym, whatever their case or punctuation', () => {
  const m = guessMapping('products', ['Item Code', 'Product Name', 'MPN', 'UPC', 'Alt SKU 2', 'RRP', 'Notes']);
  assert.equal(m.code, 0);
  assert.equal(m.name, 1);
  assert.equal(m.model, 2);
  assert.equal(m.upc, 3);
  assert.equal(m.alt2, 4);
  assert.equal(m.msrp, 5);
  assert.equal(m.ean, null);
});

test('CSV and XLSX files read into the same table', async () => {
  const csv = await readTable('c.csv', b64('SKU,Name\nLG-1,"TV, 65"""\n'));
  assert.deepEqual(csv, [['SKU', 'Name'], ['LG-1', 'TV, 65"']]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['SKU', 'MAP', 'Start']);
  ws.addRow(['LG-1', 1299.5, new Date(Date.UTC(2026, 9, 1))]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  assert.deepEqual(await readTable('m.xlsx', buf.toString('base64')), [['SKU', 'MAP', 'Start'], ['LG-1', '1299.5', '2026-10-01']]);
  await assert.rejects(readTable('old.xls', ''), /xlsx/);
  // An unquoted inch mark is part of the text, not the start of a quoted field.
  assert.deepEqual(await readTable('i.csv', b64('SKU,Name\nLG-2,LG 65" TV\nLG-3,LG 55" TV\n')), [['SKU', 'Name'], ['LG-2', 'LG 65" TV'], ['LG-3', 'LG 55" TV']]);
});

test('money, dates and GTIN check digits', () => {
  assert.equal(parseMoney('$1,299.00'), 1299);
  assert.equal(parseMoney('USD 49.999'), 50);
  assert.equal(parseMoney(''), null);
  assert.ok(Number.isNaN(parseMoney('call us')));
  assert.equal(parseDate('2026-10-01'), '2026-10-01');
  assert.equal(parseDate('10/01/2026'), '2026-10-01');
  assert.equal(parseDate('46296'), '2026-10-01');
  assert.equal(parseDate('2026-02-30'), 'invalid');
  assert.equal(parseDate(''), null);
  assert.ok(validGtin('036000291452'));
  assert.equal(validGtin('036000291453'), false);
});

test('rows missing a required field are problems, and an unmapped required field stops the import', () => {
  const table = [['SKU', 'Name'], ['LG-1', 'TV'], ['', 'no code'], ['LG-2', '']];
  const r = extractRows('products', table, guessMapping('products', table[0]));
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.problems, [{ line: 3, reason: 'SKU (product code) is empty' }]);
  const none = extractRows('map', [['SKU']], guessMapping('map', ['SKU']));
  assert.match(none.problems[0].reason, /MAP, Effective from/);
});

const existing: ExistingProduct[] = [
  { id: 'p1', code: 'LG-P01', name: 'LG 65 C6', model: 'OLED65C6PUA', category: 'TV', group: null, msrp: 2999, status: 'Active', identifiers: { asin: ['B0GRK5D3RW'] } },
];

test('product diff: new, changed fields only, unchanged, and blanks never clear', () => {
  const rows = [
    { line: 2, values: { code: 'lg-p01', name: 'LG 65 C6', model: '', category: 'TV', group: 'OLED 2026', msrp: '2,999', upc: '036000291452', asin: 'b0grk5d3rw' } },
    { line: 3, values: { code: 'LG-P99', name: 'New soundbar', model: 'S99', msrp: '499' } },
    { line: 4, values: { code: 'LG-P01X', name: 'Same as before', model: '' } },
  ].map((r) => ({ ...r, values: { ...Object.fromEntries(['category', 'group', 'msrp', 'upc', 'ean', 'asin', 'status'].map((k) => [k, ''])), ...r.values } }));
  const plan = planProducts(rows as never, [...existing, { ...existing[0], id: 'p2', code: 'LG-P01X', name: 'Same as before', model: null, category: null, msrp: null, identifiers: {} }], new Map());
  assert.equal(plan.problems.length, 0);
  assert.equal(plan.unchanged, 1);
  const changed = plan.changes.find((c) => c.kind === 'changed')!;
  assert.deepEqual(Object.keys(changed.fields).sort(), ['group', 'upc']);
  const added = plan.changes.find((c) => c.kind === 'new')!;
  assert.deepEqual(added.fields.msrp, [null, 499]);
});

test('product rows with bad values or identifiers owned by another SKU are errors', () => {
  const blank = Object.fromEntries(['name', 'model', 'category', 'group', 'msrp', 'upc', 'ean', 'asin', 'status'].map((k) => [k, '']));
  const rows = [
    { line: 2, values: { ...blank, code: 'LG-P50', name: 'x', upc: '036000291453' } },
    { line: 3, values: { ...blank, code: 'LG-P51', name: 'x', asin: 'B0GRK5D3RW' } },
    { line: 4, values: { ...blank, code: 'LG-P52' } },
    { line: 5, values: { ...blank, code: 'LG-P53', name: 'x', status: 'Gone' } },
  ];
  const plan = planProducts(rows, existing, new Map([['ASIN:B0GRK5D3RW', 'LG-P01']]));
  assert.equal(plan.changes.length, 0);
  assert.deepEqual(plan.problems.map((p) => p.line), [2, 3, 4, 5]);
  assert.match(plan.problems[1].reason, /already belongs to LG-P01/);
});

test('MAP plan: a later version closes the one in force; earlier or overlapping dates are refused', () => {
  const products = new Map([['lg-p01', 'p1'], ['lg-p02', 'p2']]);
  const versions: MapVersion[] = [
    { id: 'm1', productId: 'p1', region: null, amount: 1500, from: '2026-01-15', to: null },
    { id: 'm2', productId: 'p2', region: null, amount: 900, from: '2026-01-01', to: '2026-06-01' },
  ];
  const row = (line: number, code: string, amount: string, from: string, extra: Record<string, string> = {}) =>
    ({ line, values: { code, amount, from, to: '', region: '', note: '', ...extra } });
  const plan = planMap(
    [
      row(2, 'LG-P01', '1,399', '2026-10-01'),
      row(3, 'LG-P01', '1400', '2026-11-01', { region: 'CA' }),
      row(4, 'LG-P02', '850', '2026-03-01'),
      row(5, 'LG-P03', '10', '2026-10-01'),
      row(6, 'LG-P01', '1500', '2026-12-01', { region: 'ca' }),
    ],
    products,
    versions,
  );
  assert.equal(plan.changes.length, 2);
  assert.deepEqual(plan.changes[0].closes, { id: 'm1', amount: 1500, from: '2026-01-15' });
  assert.equal(plan.changes[1].region, 'CA');
  assert.deepEqual(plan.unknown.map((p) => p.line), [5]);
  assert.deepEqual(plan.problems.map((p) => p.line), [4, 6]);

  const same = planMap([row(2, 'LG-P01', '1500', '2026-10-01')], products, versions);
  assert.equal(same.unchanged, 1);
  const early = planMap([row(2, 'LG-P01', '1400', '2026-01-01')], products, versions);
  assert.match(early.problems[0].reason, /must start after/);
});
