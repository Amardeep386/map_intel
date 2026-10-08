import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CostGroup } from '../src/lib/cost.js';
import { SOURCE_CATALOGUE, optionsSchema } from '../src/collector/catalogue.js';
import { adapters } from '../src/collector/sources.js';
import { nextRun } from '../src/lib/schedules.js';
import { dueSlot } from '../src/scheduler/due.js';
import { expandFiring, queuePriority, type ExpandInput, type ExpandSource, type FiringSchedule } from '../src/scheduler/expand.js';

const at = (s: string) => new Date(s);

test('dueSlot: the latest slot, once, and not when too old', () => {
  const daily = '0 6 * * *';
  assert.deepEqual(dueSlot(daily, 'America/New_York', at('2026-09-27T12:00:00Z'), null), at('2026-09-27T10:00:00Z')); // 06:00 EDT
  assert.equal(dueSlot(daily, 'America/New_York', at('2026-09-27T12:00:00Z'), at('2026-09-27T10:00:00Z')), null);
  assert.deepEqual(dueSlot(daily, 'UTC', at('2026-09-27T06:00:00Z'), at('2026-09-26T06:00:00Z')), at('2026-09-27T06:00:00Z'));
  assert.equal(dueSlot('0 6 1 1 *', 'UTC', at('2026-09-27T06:00:00Z'), null), null); // last slot in January: too old
  assert.equal(dueSlot('not a cron', 'UTC', at('2026-09-27T06:00:00Z'), null), null);
});

const src = (code: string, subscribed = true, options: Record<string, unknown> = {}): ExpandSource => {
  const d = SOURCE_CATALOGUE.find((s) => s.code === code)!;
  return { id: `id-${code}`, code, family: d.family.code, category: d.category, collectorStatus: d.collectorStatus, schema: optionsSchema(d), subscription: subscribed ? { active: true, options } : null };
};
const daily: FiringSchedule = { id: 's-daily', name: 'Daily sweep', selector: {}, priority: 10, active: true, cadence: '0 6 * * *', timezone: 'UTC', listingScope: 'Included and Staged', listingStatus: 'Active only', takedownStatus: 'All' };
const all: CostGroup['cells'] = { Marketplace: { mode: 'All', sourceIds: [] }, 'Online Seller': { mode: 'All', sourceIds: [] } };

function input(over: Partial<ExpandInput> = {}): ExpandInput {
  return {
    firing: daily,
    schedules: [daily],
    sources: [src('amazon_us'), src('walmart_us', true, { search_pages: 1 }), src('target_us'), src('bestbuy_us', false)],
    groups: [{ id: 'g-names', cells: all }, { id: 'g-urls', cells: all }],
    terms: [
      { id: 't-kw', groupId: 'g-names', type: 'keyword', value: 'LG C4 65' },
      { id: 't-asin', groupId: 'g-names', type: 'identifier', value: 'B0CVS4CYYF' },
      { id: 't-target-page', groupId: 'g-urls', type: 'url', value: 'https://www.target.com/b/lg-electronics/-/N-4y41g' },
    ],
    listings: [
      { id: 'l-inc', sourceId: 'id-amazon_us', url: 'https://www.amazon.com/dp/B0CVS4CYYF', state: 'Included' },
      { id: 'l-staged', sourceId: 'id-walmart_us', url: 'https://www.walmart.com/ip/1', state: 'Staged' },
      { id: 'l-excl', sourceId: 'id-walmart_us', url: 'https://www.walmart.com/ip/2', state: 'Excluded' },
      { id: 'l-bb', sourceId: 'id-bestbuy_us', url: 'https://www.bestbuy.com/site/1234567.p', state: 'Included' },
    ],
    budget: 1000,
    adapters,
    ...over,
  };
}

const describe = (jobs: ReturnType<typeof expandFiring>) => jobs.map((j) => `${j.kind}:${j.sourceCode}:${j.listingId ?? j.termId}:${j.mode ?? '-'}:${j.cost}:${j.skipReason ?? 'run'}`);

test('expand: listings first, then terms per source; robots-disallowed search is recorded; duplicates collapse', () => {
  assert.deepEqual(describe(expandFiring(input())), [
    'collect:amazon_us:l-inc:-:1:run',
    'collect:walmart_us:l-staged:-:1:run',
    // keyword: Amazon searches (2 pages by default); Walmart and Target cannot search (robots)
    'discover:amazon_us:t-kw:search:2:run',
    'discover:walmart_us:t-kw:-:0:not_executable',
    'discover:target_us:t-kw:-:0:not_executable',
    // the ASIN's product page is already a collect job (same URL): collapsed; elsewhere an ASIN is not work
    'discover:target_us:t-target-page:browse:1:run',
  ]);
});

test('expand: the budget skips what does not fit, and smaller later jobs still use what is left', () => {
  const jobs = expandFiring(input({ budget: 3 }));
  assert.deepEqual(jobs.filter((j) => j.skipReason === 'budget').map((j) => `${j.kind}:${j.sourceCode}`), ['discover:amazon_us']); // 2 pages do not fit in the 1 request left; Target's 1 does
  assert.equal(jobs.filter((j) => !j.skipReason).reduce((n, j) => n + j.cost, 0), 3);
});

test('expand: a more specific schedule takes its work away from the daily sweep', () => {
  const amazonHourly: FiringSchedule = { ...daily, id: 's-amz', name: 'Amazon hourly', selector: { sources: ['amazon_us'] }, cadence: '0 * * * *', priority: 20 };
  const schedules = [daily, amazonHourly];
  const dailyJobs = expandFiring(input({ schedules }));
  assert.ok(dailyJobs.every((j) => j.sourceCode !== 'amazon_us'));
  const hourlyJobs = expandFiring(input({ firing: amazonHourly, schedules }));
  assert.deepEqual([...new Set(hourlyJobs.map((j) => j.sourceCode))], ['amazon_us']);
});

test('expand: an under-notice re-check with a higher priority takes nothing from the daily sweep', () => {
  // The pilot accounts' real setup (P1): empty selector, priority 20 vs the sweep's 10.
  const notice: FiringSchedule = { ...daily, id: 's-notice', name: 'Under-notice re-check', cadence: '0 */6 * * *', priority: 20, listingScope: 'Included only', takedownStatus: 'Under notice' };
  const schedules = [daily, notice];
  assert.deepEqual(describe(expandFiring(input({ schedules }))), describe(expandFiring(input())));
  assert.deepEqual(expandFiring(input({ firing: notice, schedules })), []);
});

test('expand: listing scope and under-notice schedules', () => {
  const inclOnly = expandFiring(input({ firing: { ...daily, listingScope: 'Included only' } }));
  assert.deepEqual(inclOnly.filter((j) => j.kind === 'collect').map((j) => j.listingId), ['l-inc']);
  const notice = expandFiring(input({ firing: { ...daily, takedownStatus: 'Under notice' } }));
  assert.equal(notice.filter((j) => j.kind === 'collect').length, 0);
});

test('expand: the under-notice re-check collects only Included listings under notice, no discovery; the sweep still collects them', () => {
  const notice: FiringSchedule = { ...daily, id: 's-notice', name: 'Under-notice re-check', cadence: '0 */6 * * *', priority: 20, listingScope: 'Included only', takedownStatus: 'Under notice' };
  const schedules = [daily, notice];
  const listings = [
    { id: 'l-inc', sourceId: 'id-amazon_us', url: 'https://www.amazon.com/dp/B0CVS4CYYF', state: 'Included' as const, underNotice: true },
    { id: 'l-inc2', sourceId: 'id-walmart_us', url: 'https://www.walmart.com/ip/3', state: 'Included' as const, underNotice: false },
    { id: 'l-staged', sourceId: 'id-walmart_us', url: 'https://www.walmart.com/ip/1', state: 'Staged' as const, underNotice: true },
  ];
  assert.deepEqual(describe(expandFiring(input({ firing: notice, schedules, listings }))), ['collect:amazon_us:l-inc:-:1:run']);
  const sweep = expandFiring(input({ schedules, listings }));
  assert.deepEqual(sweep.filter((j) => j.kind === 'collect').map((j) => j.listingId), ['l-inc', 'l-inc2', 'l-staged']);
  const quiet = expandFiring(input({ firing: { ...daily, takedownStatus: 'Not under notice' }, schedules: [{ ...daily, takedownStatus: 'Not under notice' }], listings }));
  assert.deepEqual(quiet.filter((j) => j.kind === 'collect').map((j) => j.listingId), ['l-inc2']);
});

test('expand: monitoring-only and discovery-only schedules split one source between them', () => {
  // The Amazon LG slice: daily monitoring of Amazon listings, discovery of one group by hand.
  const monitor: FiringSchedule = { ...daily, id: 's-mon', name: 'Amazon monitoring', selector: { sources: ['amazon_us'] }, priority: 40, kind: 'monitoring', listingScope: 'Included only', cadence: '0 9 * * *', timezone: 'Asia/Kolkata' };
  const discover: FiringSchedule = { ...daily, id: 's-disc', name: 'Amazon discovery', selector: { sources: ['amazon_us'], termGroups: ['g-names'] }, priority: 40, kind: 'discovery', cadence: 'manual' };
  const schedules = [daily, monitor, discover];
  assert.deepEqual(describe(expandFiring(input({ firing: monitor, schedules }))), ['collect:amazon_us:l-inc:-:1:run']);
  // No collect job for the ASIN's page here, so the identifier is discovered through its product page.
  assert.deepEqual(describe(expandFiring(input({ firing: discover, schedules }))), ['discover:amazon_us:t-kw:search:2:run', 'discover:amazon_us:t-asin:product:1:run']);
  // The daily sweep keeps everything else and nothing on Amazon.
  const rest = expandFiring(input({ schedules }));
  assert.ok(rest.every((j) => j.sourceCode !== 'amazon_us'));
  assert.ok(rest.some((j) => j.kind === 'collect' && j.sourceCode === 'walmart_us'));
});

test('expand: a monitoring-only schedule with nothing else competing still never discovers', () => {
  const monitor: FiringSchedule = { ...daily, kind: 'monitoring' };
  assert.ok(expandFiring(input({ firing: monitor, schedules: [monitor] })).every((j) => j.kind === 'collect'));
  const discover: FiringSchedule = { ...daily, kind: 'discovery' };
  assert.ok(expandFiring(input({ firing: discover, schedules: [discover] })).every((j) => j.kind === 'discover'));
});

test('manual schedules: never due, no next run, timezone still checked', () => {
  assert.equal(dueSlot('manual', 'UTC', at('2026-09-27T06:00:00Z'), null), null);
  assert.deepEqual(nextRun('manual', 'Asia/Kolkata'), { next: null });
  assert.ok('error' in nextRun('manual', 'Mars/Base'));
  assert.ok('error' in nextRun('every day', 'UTC'));
});

test('queue priority: rechecks first, higher schedule priority sooner, collect before discover', () => {
  assert.equal(queuePriority(10, 'recheck'), 1);
  assert.ok(queuePriority(90, 'collect') < queuePriority(10, 'collect'));
  assert.ok(queuePriority(10, 'collect') < queuePriority(10, 'discover'));
});
