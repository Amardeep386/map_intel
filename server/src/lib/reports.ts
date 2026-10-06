// Reports (Phase 3): typed template parameters, report periods in the account's timezone, the
// frozen snapshot a run is made from (every violation row carries its own expiring evidence link),
// and the CSV / HTML renderings. The PDF is the HTML printed by a browser (lib/reportRunner.ts).
import { z } from 'zod';
import { dataQuality, degradedDays } from './dataQuality.js';
import type { Db } from './db.js';
import { createLink } from './evidenceLinks.js';
import { compliance, dailyTrend, medianTimeToCompliance, topSellers } from './overview.js';
import { listViolations, STATUSES, toCsv } from './violations.js';

const DAY = 86_400_000;
export const REPORT_LINK_DAYS = 90;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
const TIMEFRAMES = ['previous_week', 'last_7_days', 'last_30_days', 'previous_month'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const PARAMS = {
  listing_map: z.object({
    timeframe: z.enum(TIMEFRAMES).default('previous_week'),
    statuses: z.array(z.enum(STATUSES as [string, ...string[]])).min(1).default(['Open', 'Needs review', 'Under notice', 'Resolved']),
    rowCap: z.number().int().min(1).max(5000).default(1000),
  }).strict(),
  monthly_trend: z.object({
    month: z.union([z.literal('previous'), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).default('previous'),
    splitByClass: z.boolean().default(true),
  }).strict(),
  seller_detail: z.object({
    sellerIds: z.array(z.string().uuid()).min(1).max(50),
    timeframe: z.enum(TIMEFRAMES).default('last_30_days'),
  }).strict(),
} as const;
export type TemplateCode = keyof typeof PARAMS;
export const isTemplateCode = (c: string): c is TemplateCode => c in PARAMS;

export function parseParams(code: TemplateCode, raw: unknown) {
  return PARAMS[code].parse(raw ?? {});
}

// ---------------------------------------------------------------------------
// Periods (half-open, in the account's timezone)
// ---------------------------------------------------------------------------
function tzOffset(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime();
}

/** Midnight of a local calendar date in `tz`, as an instant. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz); // settle across a DST change
  return new Date(t);
}

function localDate(at: Date, tz: string): { y: number; m: number; d: number; dow: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export interface Period { from: Date; to: Date; label: string }

export function periodFor(timeframe: Timeframe, now: Date, tz: string): Period {
  const today = localDate(now, tz);
  const mid = (x: { y: number; m: number; d: number }) => zonedMidnight(x.y, x.m, x.d, tz);
  const fmt = (a: Date, b: Date) => `${fmtDay(a, tz)} – ${fmtDay(new Date(b.getTime() - 1), tz)}`;
  switch (timeframe) {
    case 'previous_week': { // Monday to Monday
      const thisMonday = addDays(today.y, today.m, today.d, -((today.dow + 6) % 7));
      const from = mid(addDays(thisMonday.y, thisMonday.m, thisMonday.d, -7));
      const to = mid(thisMonday);
      return { from, to, label: `Week of ${fmt(from, to)}` };
    }
    case 'last_7_days':
    case 'last_30_days': {
      const n = timeframe === 'last_7_days' ? 7 : 30;
      const to = mid(addDays(today.y, today.m, today.d, 1));
      const from = mid(addDays(today.y, today.m, today.d, 1 - n));
      return { from, to, label: `Last ${n} days, ${fmt(from, to)}` };
    }
    case 'previous_month': {
      const first = { y: today.y, m: today.m, d: 1 };
      const prev = today.m === 1 ? { y: today.y - 1, m: 12, d: 1 } : { y: today.y, m: today.m - 1, d: 1 };
      return monthPeriod(prev.y, prev.m, tz, mid(first));
    }
  }
}

export function monthPeriod(y: number, m: number, tz: string, to?: Date): Period {
  const from = zonedMidnight(y, m, 1, tz);
  const end = to ?? (m === 12 ? zonedMidnight(y + 1, 1, 1, tz) : zonedMidnight(y, m + 1, 1, tz));
  return { from, to: end, label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

export function periodForRun(code: TemplateCode, params: Record<string, unknown>, now: Date, tz: string): Period {
  if (code === 'monthly_trend') {
    const month = String(params.month ?? 'previous');
    if (month === 'previous') {
      const t = localDate(now, tz);
      return t.m === 1 ? monthPeriod(t.y - 1, 12, tz) : monthPeriod(t.y, t.m - 1, tz);
    }
    const [y, m] = month.split('-').map(Number);
    return monthPeriod(y, m, tz);
  }
  return periodFor((params.timeframe as Timeframe) ?? 'previous_week', now, tz);
}

export const fmtDay = (d: Date, tz = 'UTC') => d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: tz });

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
export interface ReportRow {
  code: string; sku: string; product: string; seller: string; sellerClass: string; source: string;
  map: number; price: number; depthPct: number; depthAbs: number; severity: string; status: string;
  firstSeen: string; lastSeen: string; observations: number; listingUrl: string | null; evidenceUrl: string;
}

export interface Snapshot {
  template: { code: TemplateCode; name: string; version: number };
  run: { id: string; code: string; name: string };
  account: { name: string; brand: string; timezone: string };
  period: { from: string; to: string; label: string };
  generatedAt: string;
  ruleSet: { code: string; version: number; name: string }[];
  quality: { note: string | null; coverage: number | null; degradedDays: { day: string; sources: string[] }[] };
  summary: Record<string, number | string | null>;
  rows: ReportRow[];
  truncated: boolean;
  trend?: { day: string; authorised: number; unauthorised: number }[];
  weekly?: { label: string; compliance: number | null }[];
  severity?: { name: string; value: number }[];
  topSellers?: { seller: string; source: string; violations: number; active: number; avg_depth: number; class: string }[];
  sellers?: { seller: string; source: string; violations: number; avgDepth: number | null }[];
  params: Record<string, unknown>;
}

export async function ruleSetAt(db: Db, accountId: string, at: Date) {
  return (await db.query<{ code: string; version: number; name: string }>(
    `SELECT r.code, rv.version, r.name FROM rule_version rv JOIN rule r ON r.id = rv.rule_id
      WHERE rv.account_id = $1 AND rv.status IN ('Published', 'Closed') AND rv.valid_from <= $2 AND (rv.valid_to IS NULL OR $2 < rv.valid_to)
      ORDER BY rv.priority, r.code`,
    [accountId, at],
  )).rows;
}

interface RunCtx { runId: string; runCode: string; name: string; accountId: string; template: { code: TemplateCode; name: string; version: number }; params: Record<string, unknown>; period: Period; now: Date }

/** Violation rows of a period, each with a fresh evidence link tied to this run. */
async function violationRows(db: Db, c: RunCtx, f: { statuses?: string[]; sellerIds?: string[]; cap: number }): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const all = [];
  for (const sellerId of f.sellerIds ?? [undefined]) {
    const r = await listViolations(db, c.accountId, { from: c.period.from, to: c.period.to, status: f.statuses, sellerId, limit: f.cap + 1 });
    all.push(...r.rows);
  }
  const truncated = all.length > f.cap;
  const rows: ReportRow[] = [];
  for (const v of all.slice(0, f.cap)) {
    const link = await createLink(db, { accountId: c.accountId, scope: 'violation:view', violationId: v.id, reportRunId: c.runId, via: 'report', days: REPORT_LINK_DAYS, now: c.now });
    rows.push({
      code: v.code, sku: v.sku, product: v.product, seller: v.seller, sellerClass: v.class_at_capture, source: v.source,
      map: v.last_map, price: v.last_price, depthPct: v.last_depth_pct, depthAbs: v.last_depth_abs, severity: v.severity, status: v.status,
      firstSeen: new Date(v.opened_at).toISOString(), lastSeen: new Date(v.last_seen).toISOString(), observations: v.observations,
      listingUrl: v.url, evidenceUrl: link.url,
    });
  }
  return { rows, truncated };
}

export async function buildSnapshot(db: Db, c: RunCtx): Promise<Snapshot> {
  const acc = (await db.query<{ name: string; brand: string; timezone: string }>('SELECT name, brand, timezone FROM account WHERE id = $1', [c.accountId])).rows[0];
  const { from, to } = c.period;
  const quality = await dataQuality(db, c.accountId, c.now);
  const days = await degradedDays(db, c.accountId, from, to);
  // Today's source health, or else the degraded days inside the period: either way the run says so.
  const qualityNote = quality.note ?? (days.length
    ? `Data quality: collection was degraded on ${days.length} day${days.length === 1 ? '' : 's'} in this period (${[...new Set(days.flatMap((d) => d.sources))].join(', ')}). Violations on those days may be undercounted.`
    : null);
  const base = {
    template: c.template, run: { id: c.runId, code: c.runCode, name: c.name },
    account: acc, period: { from: from.toISOString(), to: to.toISOString(), label: c.period.label }, generatedAt: c.now.toISOString(),
    ruleSet: await ruleSetAt(db, c.accountId, to.getTime() > c.now.getTime() ? c.now : new Date(to.getTime() - 1)),
    quality: { note: qualityNote, coverage: quality.coverage, degradedDays: days },
    params: c.params,
  };
  const comp = await compliance(db, c.accountId, from, to);
  const count = (rows: ReportRow[], f: (r: ReportRow) => boolean) => rows.filter(f).length;

  if (c.template.code === 'listing_map') {
    const p = c.params as z.infer<typeof PARAMS.listing_map>;
    const { rows, truncated } = await violationRows(db, c, { statuses: p.statuses, cap: p.rowCap });
    return {
      ...base, rows, truncated,
      summary: {
        violations: rows.length, severe: count(rows, (r) => r.severity === 'Severe'), standard: count(rows, (r) => r.severity === 'Standard'),
        minor: count(rows, (r) => r.severity === 'Minor'), open: count(rows, (r) => ['Open', 'Needs review', 'Under notice'].includes(r.status)),
        resolved: count(rows, (r) => r.status === 'Resolved'), sellers: new Set(rows.map((r) => r.seller)).size,
        compliance: comp.pct, pricesJudged: comp.judged,
      },
    };
  }

  if (c.template.code === 'seller_detail') {
    const p = c.params as z.infer<typeof PARAMS.seller_detail>;
    const { rows, truncated } = await violationRows(db, c, { sellerIds: p.sellerIds, cap: 2000 });
    const by = new Map<string, ReportRow[]>();
    for (const r of rows) by.set(`${r.seller}|${r.source}`, [...(by.get(`${r.seller}|${r.source}`) ?? []), r]);
    return {
      ...base, rows, truncated,
      sellers: [...by.entries()].map(([k, rs]) => ({
        seller: k.split('|')[0], source: k.split('|')[1], violations: rs.length,
        avgDepth: rs.length ? Math.round((rs.reduce((n, r) => n + r.depthPct, 0) / rs.length) * 10) / 10 : null,
      })),
      summary: { violations: rows.length, sellers: by.size, open: count(rows, (r) => ['Open', 'Needs review', 'Under notice'].includes(r.status)) },
    };
  }

  // monthly_trend
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  const compPrev = await compliance(db, c.accountId, prevFrom, from);
  const ttc = await medianTimeToCompliance(db, c.accountId, from, to);
  const weekly = [];
  const until = new Date(Math.min(to.getTime(), c.now.getTime())); // a month still running stops at today
  for (let t = from.getTime(); t < until.getTime(); t += 7 * DAY) {
    const end = new Date(Math.min(t + 7 * DAY, until.getTime()));
    weekly.push({ label: fmtDay(new Date(t), acc.timezone).slice(0, 6), compliance: (await compliance(db, c.accountId, new Date(t), end)).pct });
  }
  const severity = (await db.query<{ severity: string; n: number }>(
    `SELECT severity, count(*)::int AS n FROM violation_current
      WHERE account_id = $1 AND opened_at < $3 AND (closed_at IS NULL OR closed_at >= $2) GROUP BY 1`,
    [c.accountId, from, to],
  )).rows;
  const opened = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM violation WHERE account_id = $1 AND opened_at >= $2 AND opened_at < $3', [c.accountId, from, to])).rows[0].n;
  const { rows, truncated } = await violationRows(db, c, { cap: 50 });
  return {
    ...base, rows, truncated,
    trend: await dailyTrend(db, c.accountId, from, until),
    weekly,
    severity: ['Minor', 'Standard', 'Severe'].map((s) => ({ name: s, value: severity.find((x) => x.severity === s)?.n ?? 0 })),
    topSellers: await topSellers(db, c.accountId, from, to, 8),
    summary: {
      compliance: comp.pct, compliancePrev: compPrev.pct, pricesJudged: comp.judged, opened, resolved: ttc.resolved,
      medianTtcHours: ttc.hours, violationsInPeriod: rows.length,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export function snapshotCsv(s: Snapshot): string {
  return toCsv(
    ['Violation', 'SKU', 'Product', 'Seller', 'Seller class', 'Source', 'MAP', 'Advertised', 'Below MAP %', 'Below MAP $', 'Severity', 'Status', 'First seen', 'Last seen', 'Observations', 'Listing URL', 'Evidence link'],
    s.rows.map((r) => [r.code, r.sku, r.product, r.seller, r.sellerClass, r.source, r.map, r.price, r.depthPct, r.depthAbs, r.severity, r.status, r.firstSeen, r.lastSeen, r.observations, r.listingUrl, r.evidenceUrl]),
  );
}

// ---------------------------------------------------------------------------
// HTML (printed to PDF, and shown on the hosted page)
// ---------------------------------------------------------------------------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
const pct = (n: unknown) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
const SEV = { Minor: '#64748B', Standard: '#d97706', Severe: '#dc2626' } as Record<string, string>;

function kpi(label: string, value: string, sub = '') {
  return `<div class="kpi"><div class="kl">${esc(label)}</div><div class="kv">${esc(value)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ''}</div>`;
}

function trendSvg(trend: NonNullable<Snapshot['trend']>, degraded: Set<string>, split: boolean): string {
  const W = 760, H = 200, L = 32, B = 22, T = 10;
  const n = Math.max(trend.length, 1);
  const max = Math.max(1, ...trend.map((d) => (split ? Math.max(d.authorised, d.unauthorised) : d.authorised + d.unauthorised)));
  const x = (i: number) => L + (i * (W - L - 8)) / Math.max(n - 1, 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const step = (W - L - 8) / Math.max(n - 1, 1);
  const shade = trend.map((d, i) => (degraded.has(d.day) ? `<rect x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}" fill="#fcd34d" opacity="0.35"/>` : '')).join('');
  const line = (vals: number[], color: string) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
  const ticks = [0, Math.ceil(max / 2), max].map((v) => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text><line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#e7ddd3"/>`).join('');
  const labels = trend.map((d, i) => (i % Math.ceil(n / 8) === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${esc(d.day.slice(5))}</text>` : '')).join('');
  const series = split
    ? line(trend.map((d) => d.unauthorised), '#dc2626') + line(trend.map((d) => d.authorised), '#A65E44')
    : line(trend.map((d) => d.authorised + d.unauthorised), '#A65E44');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Listings below MAP per day">${shade}${ticks}${series}${labels}</svg>`;
}

function barsSvg(items: { name: string; value: number }[]): string {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<svg viewBox="0 0 320 ${items.length * 26}" width="100%">${items.map((it, i) =>
    `<text x="0" y="${i * 26 + 16}" class="ax">${esc(it.name)}</text><rect x="70" y="${i * 26 + 5}" width="${(230 * it.value) / max}" height="14" rx="3" fill="${SEV[it.name] ?? '#A65E44'}"/><text x="${76 + (230 * it.value) / max}" y="${i * 26 + 16}" class="ax">${it.value}</text>`).join('')}</svg>`;
}

function rowsTable(rows: ReportRow[]): string {
  if (!rows.length) return '<p class="muted">No violations in this period.</p>';
  return `<table><thead><tr><th>Violation</th><th>SKU / Product</th><th>Seller</th><th>Class</th><th>MAP</th><th>Advertised</th><th>Gap</th><th>Severity</th><th>Status</th><th>First seen</th><th>Evidence</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td class="b">${esc(r.code)}</td><td><div class="b">${esc(r.product)}</div><div class="muted">${esc(r.sku)}</div></td><td>${esc(r.seller)}<div class="muted">${esc(r.source)}</div></td><td>${esc(r.sellerClass)}</td><td>${money(r.map)}</td><td>${money(r.price)}</td><td class="red">−${pct(r.depthPct)}</td><td><span class="pill" style="color:${SEV[r.severity] ?? '#333'}">${esc(r.severity)}</span></td><td>${esc(r.status)}</td><td style="white-space:nowrap">${esc(r.firstSeen.slice(0, 10))}</td><td><a href="${esc(r.evidenceUrl)}">Evidence</a></td></tr>`).join('')}</tbody></table>`;
}

export function snapshotHtml(s: Snapshot): string {
  const tz = s.account.timezone;
  const ttc = (h: unknown) => (h === null || h === undefined ? '—' : Number(h) < 48 ? `${Math.round(Number(h))} h` : `${(Number(h) / 24).toFixed(1)} days`);
  const sm = s.summary;
  const landscape = s.template.code === 'monthly_trend';
  let body = '';
  if (s.template.code === 'listing_map') {
    body = `<div class="kpis">${kpi('Violations', String(sm.violations))}${kpi('Open', String(sm.open))}${kpi('Severe', String(sm.severe))}${kpi('Sellers', String(sm.sellers))}${kpi('MAP compliance', pct(sm.compliance), `${sm.pricesJudged} prices judged`)}</div>
      <h2>Violations</h2>${rowsTable(s.rows)}`;
  } else if (s.template.code === 'seller_detail') {
    body = `<div class="kpis">${(s.sellers ?? []).map((x) => kpi(`${x.seller} (${x.source})`, String(x.violations), `avg depth ${pct(x.avgDepth)}`)).join('')}</div><h2>Violations</h2>${rowsTable(s.rows)}`;
  } else {
    const degraded = new Set(s.quality.degradedDays.map((d) => d.day));
    const delta = sm.compliance !== null && sm.compliancePrev !== null ? Math.round((Number(sm.compliance) - Number(sm.compliancePrev)) * 10) / 10 : null;
    body = `<div class="kpis">${kpi('MAP compliance', pct(sm.compliance), delta === null ? `${sm.pricesJudged} prices judged` : `${delta >= 0 ? '+' : ''}${delta} pts vs previous month`)}${kpi('New violations', String(sm.opened))}${kpi('Resolved', String(sm.resolved))}${kpi('Median time to compliance', ttc(sm.medianTtcHours))}${kpi('Coverage', pct(s.quality.coverage), 'latest cycle')}</div>
      <div class="grid"><div class="card wide"><h3>Listings below MAP per day${s.params.splitByClass === false ? '' : ' — unauthorised vs MAP Authorised'}</h3>${trendSvg(s.trend ?? [], degraded, s.params.splitByClass !== false)}
        <div class="legend">${s.params.splitByClass === false ? '' : '<span><i style="background:#dc2626"></i>Unauthorised / unknown</span><span><i style="background:#A65E44"></i>MAP Authorised</span>'}<span><i style="background:#fcd34d"></i>Degraded collection</span></div></div>
      <div class="card"><h3>Severity</h3>${barsSvg(s.severity ?? [])}<h3 style="margin-top:12px">Weekly compliance</h3><table class="mini">${(s.weekly ?? []).map((w) => `<tr><td>${esc(w.label)}</td><td>${pct(w.compliance)}</td></tr>`).join('')}</table></div></div>
      <h2>Top violating sellers</h2><table><thead><tr><th>Seller</th><th>Source</th><th>Class</th><th>Violations</th><th>Open</th><th>Avg depth</th></tr></thead><tbody>${(s.topSellers ?? []).map((t) => `<tr><td class="b">${esc(t.seller)}</td><td>${esc(t.source)}</td><td>${esc(t.class)}</td><td>${t.violations}</td><td>${t.active}</td><td>${pct(t.avg_depth)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">None</td></tr>'}</tbody></table>
      <h2 class="break">Violations in ${esc(s.period.label)}${s.truncated ? ' (deepest 50)' : ''}</h2>${rowsTable(s.rows)}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base target="_blank"><title>${esc(s.run.name)} — ${esc(s.period.label)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
  html { background: #FBF7F2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #3C2F2F; background: #FBF7F2; margin: 0; padding: 14mm 12mm; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #A65E44; padding-bottom: 8px; margin-bottom: 12px; }
  .brand { font-weight: 700; letter-spacing: .06em; font-size: 10px; color: #A65E44; }
  h1 { font-size: 18px; margin: 2px 0 0; } h2 { font-size: 13px; margin: 16px 0 6px; } h3 { font-size: 11px; margin: 0 0 6px; }
  .meta { text-align: right; color: #6B5A4F; font-size: 10px; line-height: 1.5; }
  .banner { background: #FEF3C7; border: 1px solid #FCD34D; color: #92400E; border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; }
  .kpis { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0 4px; }
  .kpi { background: #fff; border: 1px solid #E7DDD3; border-radius: 8px; padding: 8px 10px; min-width: 120px; flex: 1; }
  .kl { color: #6B5A4F; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; } .kv { font-size: 17px; font-weight: 700; margin-top: 2px; } .ks { color: #6B5A4F; font-size: 9px; }
  .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; margin-top: 8px; } .card { background: #fff; border: 1px solid #E7DDD3; border-radius: 8px; padding: 10px; }
  table { width: 100%; border-collapse: collapse; background: #fff; } th { text-align: left; font-size: 9px; text-transform: uppercase; color: #6B5A4F; border-bottom: 1px solid #E7DDD3; padding: 5px; }
  td { border-bottom: 1px solid #F1EAE2; padding: 5px; vertical-align: top; } tr { page-break-inside: avoid; }
  table.mini td { padding: 3px 5px; }
  .b { font-weight: 600; } .muted { color: #6B5A4F; font-size: 9px; } .red { color: #dc2626; font-weight: 600; } .pill { font-weight: 700; }
  a { color: #A65E44; } .ax { font-size: 10px; fill: #6B5A4F; }
  .legend { display: flex; gap: 14px; justify-content: center; color: #6B5A4F; font-size: 9px; margin-top: 4px; } .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  footer { margin-top: 14px; color: #6B5A4F; font-size: 9px; border-top: 1px solid #E7DDD3; padding-top: 6px; line-height: 1.5; }
  .break { page-break-before: always; }
</style></head><body>
<header><div><div class="brand">MIRETHOS · MAP INTEL</div><h1>${esc(s.run.name)}</h1><div>${esc(s.account.name)} · ${esc(s.period.label)}</div></div>
<div class="meta">${esc(s.run.code)} · ${esc(s.template.name)} v${s.template.version}<br>Generated ${esc(fmtDay(new Date(s.generatedAt), tz))} ${esc(new Date(s.generatedAt).toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' }))}<br>Rule set: ${esc(s.ruleSet.map((r) => `${r.code} v${r.version}`).join(', ') || '—')}</div></header>
${s.quality.note ? `<div class="banner"><b>Data quality:</b> ${esc(s.quality.note.replace(/^Data quality: /, ''))}${s.quality.degradedDays.length && !s.quality.note.includes('in this period') ? ` Collection was also degraded on ${s.quality.degradedDays.length} day(s) in this period.` : ''}</div>` : ''}
${body}
<footer>Each violation is judged against the MAP in force on each observation date. Evidence links open a view-only record of the captured page and its SHA-256, valid ${REPORT_LINK_DAYS} days from generation. ${s.truncated ? 'Rows were capped; the CSV has the same rows. ' : ''}This report documents observed advertised prices; it is not a legal determination.</footer>
</body></html>`;
}
