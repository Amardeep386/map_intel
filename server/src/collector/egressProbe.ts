// Egress probe: can this machine's IP reach each retailer as a US shopper would?
// HTTP only (no browser), stores nothing, respects robots.txt and the per-host delay.
// Used by `npm run egress:probe` (local) and POST /admin/egress-probe (on the Render API in Ohio).
import { config } from '../lib/config.js';
import type { Db } from '../lib/db.js';
import { browserLikeHeaders, politeWait } from './http.js';
import { robotsCheck } from './robots.js';
import { adapters } from './sources.js';
import type { SourceAdapter } from './types.js';

/** Brand / browse pages allowed by robots.txt (found in the retailers' sitemaps), for sources with no seeded listings yet. */
export const PROBE_PAGES: Record<string, string[]> = {
  ebay_us: ['https://www.ebay.com/b/LG-TVs/11071/bn_1851207'],
  target_us: ['https://www.target.com/b/lg-electronics/-/N-4y41g'],
  homedepot_us: ['https://www.homedepot.com/b/Appliances/LG/N-5yc1vZbv1wZ8qk'],
};

export const PROBE_HOSTS: Record<string, string> = {
  amazon_us: 'www.amazon.com',
  walmart_us: 'www.walmart.com',
  bestbuy_us: 'www.bestbuy.com',
  ebay_us: 'www.ebay.com',
  target_us: 'www.target.com',
  homedepot_us: 'www.homedepot.com',
};

export interface ProbeResult {
  source: string;
  url: string;
  robots: 'allowed' | 'disallowed';
  status: number | null;
  ms: number | null;
  bytes: number | null;
  block: string | null;
  price: number | null;
  error: string | null;
}

export interface ProbeReport {
  egressLabel: string;
  egressIp: string | null;
  at: string;
  results: ProbeResult[];
}

// Generic bot-wall markers for sources whose adapter is not built yet.
export function genericBlock(html: string, status: number): string | null {
  if (status === 429) return 'rate_limited';
  if (/px-captcha|perimeterx|captcha-delivery|g-recaptcha|hcaptcha|robot or human|are you a robot|verify you are a human/i.test(html)) return 'captcha';
  if (status === 403 || /access denied|request unsuccessful|errors\.edgesuite\.net|pardon our interruption/i.test(html)) return 'access_denied';
  return null;
}

async function egressIp(): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10_000) });
    return ((await res.json()) as { ip?: string }).ip ?? null;
  } catch {
    return null;
  }
}

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 200);
}

async function probeOne(source: string, url: string): Promise<ProbeResult> {
  const adapter: SourceAdapter = adapters[source] ?? { code: source, host: new URL(url).host, extract: () => ({}) as never, detectBlock: () => null };
  const base: ProbeResult = { source, url, robots: 'allowed', status: null, ms: null, bytes: null, block: null, price: null, error: null };
  const robots = await robotsCheck(url, config.COLLECT_USER_AGENT);
  if (!robots.allowed) return { ...base, robots: 'disallowed', error: robots.reason };
  await politeWait(adapter.host);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: browserLikeHeaders(adapter), redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text();
    const known = adapters[source];
    // A known adapter decides alone: Walmart, for one, loads its bot-check script on every normal page.
    const block = known ? known.detectBlock(html, res.status) : genericBlock(html, res.status);
    const price = known ? known.extract(html, res.url || url).price : null;
    return { ...base, status: res.status, ms: Date.now() - started, bytes: html.length, block, price };
  } catch (err) {
    return { ...base, ms: Date.now() - started, error: errMessage(err) };
  }
}

/**
 * Probe each source: `perSource` known listing URLs (from the database) or the fixed brand pages.
 * Sources are probed in parallel; requests to one host stay one at a time with the polite delay.
 */
export async function runEgressProbe(listingUrls: Record<string, string[]>, perSource = 3): Promise<ProbeReport> {
  const plan = Object.keys(PROBE_HOSTS).map((source) => ({
    source,
    urls: (listingUrls[source]?.length ? listingUrls[source] : (PROBE_PAGES[source] ?? [])).slice(0, perSource),
  }));
  const [ip, perSourceResults] = await Promise.all([
    egressIp(),
    Promise.all(
      plan.map(async ({ source, urls }) => {
        const out: ProbeResult[] = [];
        for (const url of urls) out.push(await probeOne(source, url));
        return out;
      }),
    ),
  ]);
  return { egressLabel: config.COLLECT_EGRESS_LABEL, egressIp: ip, at: new Date().toISOString(), results: perSourceResults.flat() };
}

/** One line per source: "amazon_us  2/3 ok  1 captcha". */
export function summarizeProbe(report: ProbeReport): string[] {
  const bySource = new Map<string, ProbeResult[]>();
  for (const r of report.results) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  return [...bySource].map(([source, rs]) => {
    const ok = rs.filter((r) => r.status !== null && r.status < 400 && !r.block).length;
    const issues = rs
      .filter((r) => !(r.status !== null && r.status < 400 && !r.block))
      .map((r) => (r.robots === 'disallowed' ? 'robots' : (r.block ?? (r.error ? 'error' : `http ${r.status}`))));
    const priced = rs.filter((r) => r.price !== null).length;
    return `${source.padEnd(13)} ${ok}/${rs.length} ok${priced ? `, ${priced} priced` : ''}${issues.length ? `  (${issues.join(', ')})` : ''}`;
  });
}

/** A few included listing URLs per source, spread over products (listing is shared, readable by the API role). */
export async function probeListingUrls(db: Db, perSource: number): Promise<Record<string, string[]>> {
  const { rows } = await db.query<{ code: string; url: string }>(
    `SELECT code, url FROM (
       SELECT s.code, l.url, row_number() OVER (PARTITION BY s.code ORDER BY md5(l.id::text)) AS n
         FROM listing l JOIN source s ON s.id = l.source_id
        WHERE l.state = 'Included') x
      WHERE n <= $1`,
    [perSource],
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.code] ??= []).push(r.url);
  return out;
}
