// Egress probe: can this machine's IP reach each retailer as a US shopper would?
// HTTP by default; with `browser`, browser-first sources (Amazon) are also read the way the
// collector reads them. Stores nothing, respects robots.txt and the per-host delay.
// Used by `npm run egress:probe` (local) and POST /admin/egress-probe (on the Render API in Ohio).
import { config } from '../lib/config.js';
import type { Db } from '../lib/db.js';
import { browserFetch } from './browser.js';
import { genericBlock } from './extract/common.js';
import { browserLikeHeaders, politeWait, proxyDispatcher } from './http.js';
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

/** A search page per searchable source: discovery reads these, so they are probed too (browser mode). */
export const PROBE_SEARCHES: Record<string, string> = {
  amazon_us: 'LG gram laptop',
};

export interface ProbeResult {
  source: string;
  url: string;
  method?: 'http' | 'browser';
  /** Items read from a results page. */
  items?: number | null;
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
  await politeWait(adapter);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: browserLikeHeaders(adapter), redirect: 'follow', signal: AbortSignal.timeout(30_000), ...({ dispatcher: proxyDispatcher() } as object) });
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

/** The collector's own browser read (browser-first sources). */
async function probeBrowser(source: string, url: string): Promise<ProbeResult> {
  const adapter = adapters[source];
  const base: ProbeResult = { source, url, method: 'browser', robots: 'allowed', status: null, ms: null, bytes: null, block: null, price: null, items: null, error: null };
  const robots = await robotsCheck(url, config.COLLECT_USER_AGENT);
  if (!robots.allowed) return { ...base, robots: 'disallowed', error: robots.reason };
  const started = Date.now();
  try {
    const f = await browserFetch(url, adapter);
    const block = adapter.detectBlock(f.html, f.status);
    const product = adapter.isProductUrl?.(url) ?? true;
    return {
      ...base,
      status: f.status,
      ms: Date.now() - started,
      bytes: f.html.length,
      block,
      price: !block && product ? adapter.extract(f.html, f.finalUrl).price : null,
      items: !block && !product ? (adapter.extractResults?.(f.html, f.finalUrl).items.length ?? null) : null,
    };
  } catch (err) {
    return { ...base, ms: Date.now() - started, error: errMessage(err) };
  }
}

export interface ProbeOptions {
  /** Also read browser-first sources through the browser, plus one search page each. */
  browser?: boolean;
  /** Only these sources. */
  sources?: string[];
}

/**
 * Probe each source: `perSource` known listing URLs (from the database) or the fixed brand pages.
 * Sources are probed in parallel; requests to one host stay one at a time with the polite delay.
 */
export async function runEgressProbe(listingUrls: Record<string, string[]>, perSource = 3, opts: ProbeOptions = {}): Promise<ProbeReport> {
  const plan = Object.keys(PROBE_HOSTS)
    .filter((source) => !opts.sources?.length || opts.sources.includes(source))
    .map((source) => ({
      source,
      urls: (listingUrls[source]?.length ? listingUrls[source] : (PROBE_PAGES[source] ?? [])).slice(0, perSource),
    }));
  const [ip, perSourceResults] = await Promise.all([
    egressIp(),
    Promise.all(
      plan.map(async ({ source, urls }) => {
        const out: ProbeResult[] = [];
        for (const url of urls) out.push({ ...(await probeOne(source, url)), method: 'http' });
        const adapter = adapters[source];
        if (opts.browser && adapter?.browserFirst) {
          for (const url of urls) out.push(await probeBrowser(source, url));
          const q = PROBE_SEARCHES[source];
          if (q && adapter.searchUrl) out.push(await probeBrowser(source, adapter.searchUrl(q, 1)));
        }
        return out;
      }),
    ),
  ]);
  return { egressLabel: config.COLLECT_EGRESS_LABEL, egressIp: ip, at: new Date().toISOString(), results: perSourceResults.flat() };
}

/** One line per source: "amazon_us  2/3 ok  1 captcha". */
export function summarizeProbe(report: ProbeReport): string[] {
  const bySource = new Map<string, ProbeResult[]>();
  for (const r of report.results) {
    const key = r.method === 'browser' ? `${r.source} (browser)` : r.source;
    bySource.set(key, [...(bySource.get(key) ?? []), r]);
  }
  return [...bySource].map(([source, rs]) => {
    const ok = rs.filter((r) => r.status !== null && r.status < 400 && !r.block).length;
    const issues = rs
      .filter((r) => !(r.status !== null && r.status < 400 && !r.block))
      .map((r) => (r.robots === 'disallowed' ? 'robots' : (r.block ?? (r.error ? 'error' : `http ${r.status}`))));
    const priced = rs.filter((r) => r.price !== null).length;
    const results = rs.filter((r) => (r.items ?? 0) > 0).length;
    return `${source.padEnd(13)} ${ok}/${rs.length} ok${priced ? `, ${priced} priced` : ''}${results ? `, ${results} results page${results > 1 ? 's' : ''} read` : ''}${issues.length ? `  (${issues.join(', ')})` : ''}`;
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
