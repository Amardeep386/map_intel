// Report periods, parameters, CSV and HTML (no database).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthPeriod, parseParams, periodFor, periodForRun, snapshotCsv, snapshotHtml, zonedMidnight, type Snapshot } from '../src/lib/reports.js';

const NY = 'America/New_York';

test('zonedMidnight follows the timezone, across a DST change', () => {
  assert.equal(zonedMidnight(2026, 10, 6, NY).toISOString(), '2026-10-06T04:00:00.000Z'); // EDT
  assert.equal(zonedMidnight(2026, 11, 2, NY).toISOString(), '2026-11-02T05:00:00.000Z'); // EST (DST ended Nov 1)
  assert.equal(zonedMidnight(2026, 10, 6, 'Asia/Kolkata').toISOString(), '2026-10-05T18:30:00.000Z');
});

test('previous_week is Monday to Monday in the account timezone', () => {
  const now = new Date('2026-10-07T15:00:00Z'); // Wednesday Oct 7 in New York
  const p = periodFor('previous_week', now, NY);
  assert.equal(p.from.toISOString(), '2026-09-28T04:00:00.000Z');
  assert.equal(p.to.toISOString(), '2026-10-05T04:00:00.000Z');
  // On a Monday morning the previous week is the one that just ended.
  const monday = periodFor('previous_week', new Date('2026-10-05T12:00:00Z'), NY);
  assert.equal(monday.to.toISOString(), '2026-10-05T04:00:00.000Z');
});

test('last_7_days ends at the end of today; previous_month and a named month', () => {
  const now = new Date('2026-10-07T15:00:00Z');
  const p = periodFor('last_7_days', now, NY);
  assert.equal(p.to.toISOString(), '2026-10-08T04:00:00.000Z');
  assert.equal(p.from.toISOString(), '2026-10-01T04:00:00.000Z');
  const m = periodFor('previous_month', now, NY);
  assert.deepEqual([m.from.toISOString(), m.to.toISOString(), m.label], ['2026-09-01T04:00:00.000Z', '2026-10-01T04:00:00.000Z', 'September 2026']);
  const jan = periodForRun('monthly_trend', { month: 'previous' }, new Date('2027-01-10T12:00:00Z'), NY);
  assert.equal(jan.label, 'December 2026');
  assert.equal(monthPeriod(2026, 2, 'UTC').to.toISOString(), '2026-03-01T00:00:00.000Z');
});

test('parameters: defaults filled, unknown keys and bad values refused', () => {
  assert.deepEqual(parseParams('listing_map', {}), { timeframe: 'previous_week', statuses: ['Open', 'Needs review', 'Under notice', 'Resolved'], rowCap: 1000 });
  assert.deepEqual(parseParams('monthly_trend', { month: '2026-09' }), { month: '2026-09', splitByClass: true });
  assert.throws(() => parseParams('listing_map', { timeframe: 'yesterday' }));
  assert.throws(() => parseParams('listing_map', { sql: 'DROP TABLE x' }));
  assert.throws(() => parseParams('seller_detail', {}));
  assert.throws(() => parseParams('monthly_trend', { month: '2026-13' }));
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  template: { code: 'listing_map', name: 'Listing MAP Report', version: 1 },
  run: { id: 'r1', code: 'RPT-0001', name: 'Weekly <MAP> report' },
  account: { name: 'LG', brand: 'LG', timezone: NY },
  period: { from: '2026-09-28T04:00:00Z', to: '2026-10-05T04:00:00Z', label: 'Sep 28 – Oct 04, 2026' },
  generatedAt: '2026-10-06T12:00:00Z',
  ruleSet: [{ code: 'R-00', version: 1, name: 'x' }, { code: 'R-01', version: 2, name: 'y' }],
  quality: { note: null, coverage: 100, degradedDays: [] },
  summary: { violations: 2, open: 1, severe: 1, sellers: 2, compliance: 80, pricesJudged: 10 },
  rows: [
    { code: 'V-00001', sku: 'A1', product: 'Laptop, "16 inch"', seller: 'Beach Camera', sellerClass: 'Unknown', source: 'Walmart.com', map: 2099, price: 1499.99, depthPct: 28.5, depthAbs: 599.01, severity: 'Severe', status: 'Open', firstSeen: '2026-10-02T00:00:00Z', lastSeen: '2026-10-04T00:00:00Z', observations: 3, listingUrl: 'https://w/1', evidenceUrl: 'https://portal/evidence/tok1' },
    { code: 'V-00002', sku: 'B2', product: '<script>x</script>', seller: 'S2', sellerClass: 'Unauthorised', source: 'eBay', map: 629, price: 605, depthPct: 3.8, depthAbs: 24, severity: 'Minor', status: 'Resolved', firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-01T00:00:00Z', observations: 1, listingUrl: null, evidenceUrl: 'https://portal/evidence/tok2' },
  ],
  truncated: false,
  params: {},
  ...over,
});

test('CSV: one row per violation, quoted where needed, an evidence link on every row', () => {
  const lines = snapshotCsv(snap()).trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].endsWith('Listing URL,Evidence link'));
  assert.ok(lines[1].includes('"Laptop, ""16 inch"""'));
  assert.ok(lines[1].endsWith('https://portal/evidence/tok1'));
  assert.ok(lines[2].endsWith('https://portal/evidence/tok2'));
});

test('HTML: escaped, one evidence link per row, rule set shown, data-quality banner only when needed', () => {
  const h = snapshotHtml(snap());
  assert.ok(!h.includes('<script>x</script>'));
  assert.ok(h.includes('Weekly &lt;MAP&gt; report'));
  assert.equal((h.match(/href="https:\/\/portal\/evidence\//g) ?? []).length, 2);
  assert.ok(h.includes('R-00 v1, R-01 v2'));
  assert.ok(!h.includes('class="banner"'));
  const bad = snapshotHtml(snap({ quality: { note: 'Data quality: eBay degraded (timeout).', coverage: 80, degradedDays: [{ day: '2026-10-02', sources: ['eBay'] }] } }));
  assert.ok(bad.includes('class="banner"'));
  assert.ok(bad.includes('eBay degraded (timeout).'));
});

test('monthly trend HTML: landscape, trend chart with degraded days shaded', () => {
  const h = snapshotHtml(snap({
    template: { code: 'monthly_trend', name: 'Monthly Trend', version: 1 },
    summary: { compliance: 90, compliancePrev: 85, pricesJudged: 40, opened: 3, resolved: 2, medianTtcHours: 50 },
    trend: [{ day: '2026-09-01', authorised: 0, unauthorised: 2 }, { day: '2026-09-02', authorised: 1, unauthorised: 1 }],
    weekly: [{ label: 'Sep 01', compliance: 90 }], severity: [{ name: 'Severe', value: 2 }], topSellers: [],
    quality: { note: null, coverage: 100, degradedDays: [{ day: '2026-09-02', sources: ['eBay'] }] },
    params: { splitByClass: true },
  }));
  assert.ok(h.includes('size: A4 landscape'));
  assert.ok(h.includes('fill="#fcd34d"'));
  assert.ok(h.includes('+5 pts vs previous month'));
  assert.ok(h.includes('2.1 days'));
});
