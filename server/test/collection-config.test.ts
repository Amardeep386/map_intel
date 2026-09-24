// Collection configuration logic: options, cost estimate, term generation and import, schedules.
// No database.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOURCE_CATALOGUE, optionsSchema } from '../src/collector/catalogue.js';
import { estimate, type CostGroup, type CostSource } from '../src/lib/cost.js';
import { nextRun, resolveSchedule, type ScheduleDef } from '../src/lib/schedules.js';
import { resolveOptions, termCost } from '../src/lib/sourceOptions.js';
import { parseCsv, parseTermImport, planGeneratedTerms, renderTemplate, splitExisting, unknownTokens, type CatalogueProduct } from '../src/lib/terms.js';

const amazon = SOURCE_CATALOGUE.find((s) => s.code === 'amazon_us')!;
const amazonSchema = optionsSchema(amazon);

test('catalogue: every source declares a cost for every term type, and cost options exist', () => {
  for (const s of SOURCE_CATALOGUE) {
    for (const c of Object.values(s.costs)) {
      if (typeof c === 'string') assert.ok(s.options.some((o) => o.key === c && o.type === 'integer'), `${s.code}: ${c}`);
    }
  }
  assert.equal(SOURCE_CATALOGUE.filter((s) => s.collectorStatus === 'live').length, 3);
});

test('options: defaults fill in, overrides validate, unknown keys are refused', () => {
  const ok = resolveOptions(amazonSchema, { search_pages: 4, new_only: false });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values.search_pages, 4);
  assert.equal(ok.values.buy_box_only, true);
  assert.equal(ok.values.new_only, false);
  assert.equal(resolveOptions(amazonSchema, { search_pages: 9 }).errors.length, 1);
  assert.equal(resolveOptions(amazonSchema, { search_pages: '2' }).errors.length, 1);
  assert.match(resolveOptions(amazonSchema, { colour: true }).errors[0], /not an option/);
});

test('term cost: keyword follows search pages, identifier and url cost 1', () => {
  const values = resolveOptions(amazonSchema, { search_pages: 3 }).values;
  assert.equal(termCost(amazonSchema, values, 'keyword'), 3);
  assert.equal(termCost(amazonSchema, values, 'identifier'), 1);
  assert.equal(termCost(amazonSchema, values, 'url'), 1);
  assert.equal(termCost(amazonSchema, values, 'seller'), 3);
});

const src = (code: string, subscribed: boolean, options: Record<string, unknown> = {}): CostSource => {
  const d = SOURCE_CATALOGUE.find((s) => s.code === code)!;
  return { id: code, code, category: d.category, collectorStatus: d.collectorStatus, schema: optionsSchema(d), subscription: subscribed ? { active: true, options } : null };
};

test('estimate: All / Some / None, only subscribed sources, planned sources flagged', () => {
  const sources = [src('amazon_us', true), src('walmart_us', true, { search_pages: 1 }), src('ebay_us', true), src('bestbuy_us', false)];
  const groups: CostGroup[] = [
    { id: 'g1', name: 'Names', termCounts: { keyword: 10 }, cells: { Marketplace: { mode: 'All', sourceIds: [] }, 'Online Seller': { mode: 'All', sourceIds: [] } } },
    { id: 'g2', name: 'IDs', termCounts: { identifier: 20 }, cells: { Marketplace: { mode: 'Some', sourceIds: ['amazon_us'] } } },
    { id: 'g3', name: 'Off', termCounts: { keyword: 50 }, cells: { Marketplace: { mode: 'None', sourceIds: [] } } },
  ];
  const e = estimate(groups, sources, 100);
  // g1: amazon 10×2 + walmart 10×1 + ebay 10×3 = 60 (Best Buy not subscribed); g2: amazon 20×1
  assert.deepEqual(e.groups.map((g) => g.requests), [60, 20, 0]);
  assert.equal(e.groups[0].plannedRequests, 30);
  assert.deepEqual(e.groups[0].sources, ['amazon_us', 'ebay_us', 'walmart_us']);
  assert.equal(e.total, 80);
  assert.equal(e.overBudget, false);
  assert.equal(estimate(groups, sources, 50).overBudget, true);
});

const lg: CatalogueProduct = {
  id: 'p1',
  code: 'LG-P01',
  name: 'LG 65" C6 OLED evo 4K TV (2026)',
  brand: 'LG',
  model: 'OLED65C6PUA',
  category: 'TV',
  identifiers: [
    { type: 'MPN', value: 'OLED65C6PUA' },
    { type: 'ASIN', value: 'B0GRK5D3RW' },
  ],
};

test('templates: tokens fill in, a doubled brand collapses, unknown tokens are reported', () => {
  assert.equal(renderTemplate('{Brand} {Product Name}', lg), 'LG 65" C6 OLED evo 4K TV (2026)');
  assert.equal(renderTemplate('{Brand} {Model}', lg), 'LG OLED65C6PUA');
  assert.equal(renderTemplate('{Code} – {Category}', lg), 'LG-P01 – TV');
  assert.deepEqual(unknownTokens('{Brand} {Colour}'), ['{Colour}']);
});

test('generate: one keyword per product plus chosen identifiers; existing terms are skipped', () => {
  const planned = planGeneratedTerms([lg], { template: '{Brand} {Model}', identifierTypes: ['MPN', 'ASIN'] });
  assert.deepEqual(planned.map((t) => `${t.type}:${t.value}`), ['keyword:LG OLED65C6PUA', 'identifier:OLED65C6PUA', 'identifier:B0GRK5D3RW']);
  const { create, skipped } = splitExisting(planned, [{ type: 'identifier', value: 'oled65c6pua' }]);
  assert.equal(create.length, 2);
  assert.equal(skipped[0].value, 'OLED65C6PUA');
});

test('CSV: quotes, embedded commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('import: valid rows kept, every bad row reported with its line and reason', () => {
  const csv = [
    'Type,Value,Product Code,Group',
    'keyword,LG 65 inch OLED C6,LG-P01,Names',
    'identifier,OLED65C6PUA,LG-P01,',
    'colour,red,,Names',
    'url,www.example.com/x,,Links',
    'keyword,,LG-P02,Names',
    'Keyword,lg 65 INCH oled c6,,Names',
  ].join('\n');
  const { rows, problems } = parseTermImport(csv, 'Imported');
  assert.deepEqual(rows.map((r) => [r.line, r.type, r.group]), [[2, 'keyword', 'Names'], [3, 'identifier', 'Imported']]);
  assert.deepEqual(problems.map((p) => p.line), [4, 5, 6, 7]);
  assert.match(problems[0].reason, /unknown type/);
  assert.match(problems[3].reason, /duplicate/);
  assert.match(parseTermImport('value\nx', 'G').problems[0].reason, /header/);
});

const sched = (id: string, priority: number, selector: ScheduleDef['selector'], active = true): ScheduleDef => ({
  id, name: id, selector, priority, active, cadence: '0 6 * * *', timezone: 'UTC',
});

test('schedules: highest priority wins, then the most specific; inactive ones are ignored', () => {
  const all = [
    sched('daily', 10, { categories: ['Marketplace'] }),
    sched('amazon-fast', 10, { sources: ['amazon_us'] }),
    sched('notice', 20, { termGroups: ['g-offenders'] }),
    sched('off', 99, {}, false),
  ];
  const t = { source: 'amazon_us', category: 'Marketplace', family: 'amazon', termGroup: 'g-names', term: null };
  assert.equal(resolveSchedule(all, t)?.id, 'amazon-fast');
  assert.equal(resolveSchedule(all, { ...t, termGroup: 'g-offenders' })?.id, 'notice');
  assert.equal(resolveSchedule(all, { ...t, source: 'target_us', category: 'Online Seller' }), null);
});

test('next run: valid cron + timezone; bad input gives a readable error', () => {
  const r = nextRun('0 6 * * *', 'UTC', new Date('2026-09-24T07:00:00Z'));
  assert.ok('next' in r);
  assert.equal(r.next.toISOString(), '2026-09-25T06:00:00.000Z');
  const ny = nextRun('0 6 * * *', 'America/New_York', new Date('2026-09-24T07:00:00Z'));
  assert.ok('next' in ny && ny.next.toISOString() === '2026-09-24T10:00:00.000Z');
  assert.match((nextRun('every day', 'UTC') as { error: string }).error, /5-field/);
  assert.match((nextRun('0 6 * * *', 'Mars/Base') as { error: string }).error, /timezone/);
  assert.match((nextRun('99 6 * * *', 'UTC') as { error: string }).error, /invalid cadence/);
});
