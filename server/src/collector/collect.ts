import { randomUUID } from 'node:crypto';
import { config } from '../lib/config.js';
import { withSystem } from '../lib/db.js';
import { putObject } from '../lib/storage.js';
import { bestBuyApiEnabled, bestBuyApiLookup } from './bestbuyApi.js';
import { browserFetch, renderScreenshot } from './browser.js';
import { modelMatches } from './extract/common.js';
import { httpFetch } from './http.js';
import { robotsCheck } from './robots.js';
import { adapterFor } from './sources.js';
import type { BlockReason, Extracted, FetchResult } from './types.js';

export type ObservationStatus = 'ok' | 'partial' | 'blocked' | 'not_found' | 'failed' | 'skipped_robots';

export interface CollectOutcome {
  listingId: string;
  observationId: string;
  source: string;
  productCode: string | null;
  status: ObservationStatus;
  price: number | null;
  seller: string | null;
  availability: string;
  method: string | null;
  evidence: { html?: string; screenshot?: string } | null;
  error: string | null;
}

interface ListingRow {
  id: string;
  url: string;
  channel_sku: string | null;
  source_code: string;
  product_code: string | null;
  model_number: string | null;
}

function datePath(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

// One line per error: drop ANSI colour codes and Playwright's multi-line "Call log:" tail.
function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\n\s*Call log:/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

export async function collectListing(listingId: string, crawlRunId: string | null): Promise<CollectOutcome> {
  const listing = await withSystem(async (db) => {
    const { rows } = await db.query<ListingRow>(
      `SELECT l.id, l.url, l.channel_sku, s.code AS source_code, p.product_code, p.model_number
         FROM listing l JOIN source s ON s.id = l.source_id LEFT JOIN product p ON p.id = l.product_id
        WHERE l.id = $1`,
      [listingId],
    );
    return rows[0];
  });
  if (!listing) throw new Error(`listing ${listingId} not found`);

  const adapter = adapterFor(listing.source_code);
  const observationId = randomUUID();
  const notes: string[] = [];

  // 1. robots.txt
  const robots = config.COLLECT_RESPECT_ROBOTS ? await robotsCheck(listing.url, config.COLLECT_USER_AGENT) : null;
  if (robots && !robots.allowed) {
    return persist({
      listing,
      observationId,
      crawlRunId,
      status: 'skipped_robots',
      observedAt: new Date(),
      extracted: null,
      fetch: null,
      method: null,
      error: robots.reason,
      evidence: null,
    });
  }

  // 2. Optional official API (Best Buy)
  let apiData: Extracted | null = null;
  if (listing.source_code === 'bestbuy_us' && bestBuyApiEnabled()) {
    try {
      apiData = await bestBuyApiLookup({ sku: listing.channel_sku, model: listing.model_number });
      if (!apiData) notes.push('Best Buy API: no product found');
    } catch (err) {
      notes.push(`Best Buy API failed: ${errMessage(err)}`);
    }
  }

  // 3. HTTP first
  let fetched: FetchResult | null = null;
  let extracted: Extracted | null = null;
  let block: BlockReason = null;
  try {
    fetched = await httpFetch(listing.url, adapter);
    extracted = adapter.extract(fetched.html, fetched.finalUrl);
    block = adapter.detectBlock(fetched.html, fetched.status);
  } catch (err) {
    notes.push(`http: ${errMessage(err)}`);
  }

  const httpGood = fetched && extracted && extracted.price !== null && fetched.status < 400;
  const gone = fetched && (fetched.status === 404 || fetched.status === 410);

  // 4. Headless browser only if the plain request did not give us a usable page
  if (!httpGood && !gone && config.COLLECT_BROWSER_FALLBACK) {
    if (fetched) notes.push(`http gave status ${fetched.status}${block ? ` (${block})` : ''}${extracted?.price == null ? ', no price' : ''}; trying browser`);
    try {
      const b = await browserFetch(listing.url, adapter);
      const bExtracted = adapter.extract(b.html, b.finalUrl);
      const bBlock = adapter.detectBlock(b.html, b.status);
      // Keep the browser result if it is at least as good as what HTTP gave us.
      if (!extracted || extracted.price === null || bExtracted.price !== null) {
        fetched = b;
        extracted = bExtracted;
        block = bBlock;
      }
    } catch (err) {
      notes.push(`browser: ${errMessage(err)}`);
    }
  }

  // API values win for price/stock/seller when present; the page is still the evidence.
  let method: 'http' | 'browser' | 'api' | null = fetched?.method ?? null;
  if (apiData && apiData.price !== null) {
    extracted = { ...apiData, title: apiData.title ?? extracted?.title ?? null, hits: { ...apiData.hits, page: fetched?.method ?? 'none' } };
    method = 'api';
  }

  // 5. Status
  let status: ObservationStatus;
  if (extracted && extracted.price !== null) {
    status = extracted.availability !== 'unknown' && extracted.sellerName ? 'ok' : 'partial';
  } else if (gone) {
    status = 'not_found';
  } else if (block) {
    status = 'blocked';
    notes.push(`blocked: ${block}`);
  } else {
    status = 'failed';
    if (fetched) notes.push('page loaded but no price was found');
  }

  // 6. Evidence: store exactly the HTML we parsed, plus a screenshot of it
  let evidence: PersistArgs['evidence'] = null;
  if (fetched) {
    const day = datePath(fetched.fetchedAt);
    const base = `evidence/${listing.source_code}/${day}/${observationId}`;
    try {
      const htmlObj = await putObject(`${base}.html`, Buffer.from(fetched.html, 'utf8'), 'text/html; charset=utf-8');
      let shot = fetched.screenshot ?? null;
      let evidenceMethod = fetched.method === 'browser' ? 'browser' : 'http+render';
      if (!shot) {
        try {
          shot = await renderScreenshot(fetched.html, fetched.finalUrl, adapter);
        } catch (err) {
          notes.push(`screenshot: ${errMessage(err)}`);
        }
      }
      const shotObj = shot ? await putObject(`${base}.png`, shot, 'image/png') : null;
      if (method === 'api') evidenceMethod = `api+${evidenceMethod}`;
      evidence = { html: htmlObj, screenshot: shotObj, method: evidenceMethod, capturedAt: new Date() };
    } catch (err) {
      notes.push(`evidence upload failed: ${errMessage(err)}`);
      if (status === 'ok') status = 'partial';
    }
  }

  return persist({
    listing,
    observationId,
    crawlRunId,
    status,
    observedAt: fetched?.fetchedAt ?? new Date(),
    extracted,
    fetch: fetched,
    method,
    error: notes.length ? notes.join(' | ') : null,
    evidence,
  });
}

interface PersistArgs {
  listing: ListingRow;
  observationId: string;
  crawlRunId: string | null;
  status: ObservationStatus;
  observedAt: Date;
  extracted: Extracted | null;
  fetch: FetchResult | null;
  method: 'http' | 'browser' | 'api' | null;
  error: string | null;
  evidence: {
    html: Awaited<ReturnType<typeof putObject>>;
    screenshot: Awaited<ReturnType<typeof putObject>> | null;
    method: string;
    capturedAt: Date;
  } | null;
}

async function persist(a: PersistArgs): Promise<CollectOutcome> {
  const x = a.extracted;
  const modelMatch = a.fetch ? modelMatches(a.fetch.html, a.listing.model_number) : null;

  await withSystem(async (db) => {
    await db.query(
      `INSERT INTO observation (id, observed_at, listing_id, crawl_run_id, status, advertised_price, list_price, currency,
         availability, qty, seller_name_raw, seller_id_raw, fulfilled_by_raw, promo_text, coupon_text, title_raw,
         model_match, fetch_method, http_status, final_url, error, extract)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        a.observationId,
        a.observedAt,
        a.listing.id,
        a.crawlRunId,
        a.status,
        x?.price ?? null,
        x?.listPrice ?? null,
        x?.currency ?? (x?.price != null ? 'USD' : null),
        x?.availability ?? 'unknown',
        x?.qty ?? null,
        x?.sellerName ?? null,
        x?.sellerId ?? null,
        x?.fulfilledBy ?? null,
        x?.promoText ?? null,
        x?.couponText ?? null,
        x?.title ?? null,
        modelMatch,
        a.method,
        a.fetch?.status ?? null,
        a.fetch?.finalUrl ?? null,
        a.error,
        JSON.stringify(x?.hits ?? {}),
      ],
    );

    if (a.evidence) {
      await db.query(
        `INSERT INTO evidence (observation_id, observed_at, screenshot_uri, screenshot_sha256, screenshot_bytes,
           html_uri, html_sha256, html_bytes, method, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          a.observationId,
          a.observedAt,
          a.evidence.screenshot?.uri ?? null,
          a.evidence.screenshot?.sha256 ?? null,
          a.evidence.screenshot?.bytes ?? null,
          a.evidence.html.uri,
          a.evidence.html.sha256,
          a.evidence.html.bytes,
          a.evidence.method,
          a.evidence.capturedAt,
        ],
      );
    }

    if (a.status === 'ok' || a.status === 'partial') {
      await db.query(
        `UPDATE listing SET last_seen = $2, first_seen = coalesce(first_seen, $2), title = coalesce($3, title) WHERE id = $1`,
        [a.listing.id, a.observedAt, x?.title ?? null],
      );
    }

    if (a.crawlRunId) {
      await db.query(
        `UPDATE crawl_run
            SET jobs_done = jobs_done + 1,
                stats = jsonb_set(stats, ARRAY[$2::text], to_jsonb(coalesce((stats->>$2)::int, 0) + 1)),
                status = CASE WHEN jobs_done + 1 >= jobs_total THEN 'finished' ELSE status END,
                finished_at = CASE WHEN jobs_done + 1 >= jobs_total THEN now() ELSE finished_at END
          WHERE id = $1`,
        [a.crawlRunId, a.status],
      );
    }
  });

  return {
    listingId: a.listing.id,
    observationId: a.observationId,
    source: a.listing.source_code,
    productCode: a.listing.product_code,
    status: a.status,
    price: x?.price ?? null,
    seller: x?.sellerName ?? null,
    availability: x?.availability ?? 'unknown',
    method: a.method,
    evidence: a.evidence ? { html: a.evidence.html.uri, screenshot: a.evidence.screenshot?.uri } : null,
    error: a.error,
  };
}
