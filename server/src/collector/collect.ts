// Collect one listing's product page: robots.txt → official API (if keyed) → HTTP → headless if
// needed → extract → validate → normalise → evidence → one append-only observation.
import { randomUUID } from 'node:crypto';
import { config } from '../lib/config.js';
import { withSystem, type Db } from '../lib/db.js';
import { resolveSeller } from '../lib/sellers.js';
import { putObject, type StoredObject } from '../lib/storage.js';
import { pickReference, promoType, validatePrice, type Validation } from '../lib/validate.js';
import { ApiAuthError } from './apiError.js';
import { bestBuyApiEnabled, bestBuyApiLookup } from './bestbuyApi.js';
import { browserFetch, renderScreenshot } from './browser.js';
import { ebayApiEnabled, ebayApiItem } from './ebayApi.js';
import { modelMatches } from './extract/common.js';
import type { AttemptFacts } from './failure.js';
import { httpFetch } from './http.js';
import { decideOutcome, type ObservationStatus } from './outcome.js';
import { robotsCheck } from './robots.js';
import { adapterFor } from './sources.js';
import type { BlockReason, Extracted, FailureClass, FetchResult } from './types.js';

export type { ObservationStatus } from './outcome.js';

export interface CollectContext {
  crawlRunId: string | null;
  jobId?: string | null;
  /** The account the job runs for: its product for this listing gives MAP / MSRP. */
  accountId?: string | null;
  /** Subscription options for the source (use_api, ...). */
  options?: Record<string, unknown>;
  /** Re-reading a held observation: its price. */
  recheckOf?: { observationId: string; price: number } | null;
  /** Skip plain HTTP (retry after a block, or a browser-first source). */
  forceBrowser?: boolean;
}

export interface CollectOutcome {
  listingId: string;
  observationId: string;
  source: string;
  productCode: string | null;
  status: ObservationStatus;
  failureClass: FailureClass | null;
  retryable: boolean;
  held: string[];
  price: number | null;
  seller: string | null;
  availability: string;
  method: 'http' | 'browser' | 'api' | null;
  requests: number;
  evidence: { html?: string; screenshot?: string } | null;
  error: string | null;
}

interface ListingRow {
  id: string;
  url: string;
  channel_sku: string | null;
  source_id: string;
  source_code: string;
  seller_id: string | null;
  product_code: string | null;
  model_number: string | null;
  msrp: string | null;
  map: string | null;
}

function datePath(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

// One line per error: drop ANSI colour codes and Playwright's multi-line "Call log:" tail.
export function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\n\s*Call log:/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadListing(db: Db, listingId: string, accountId: string | null): Promise<ListingRow | undefined> {
  // The product comes from the account's mapping decision (P2a), else the P0 seed link.
  const { rows } = await db.query<ListingRow>(
    `SELECT l.id, l.url, l.channel_sku, l.source_id, s.code AS source_code, l.seller_id,
            p.product_code, p.model_number, p.standard_price AS msrp,
            (SELECT mp.amount FROM map_price mp
              WHERE mp.product_id = p.id AND (mp.region IS NULL OR mp.region = 'US')
                AND mp.effective_from <= now() AND (mp.effective_to IS NULL OR mp.effective_to > now())
              ORDER BY mp.effective_from DESC LIMIT 1) AS map
       FROM listing l
       JOIN source s ON s.id = l.source_id
       LEFT JOIN listing_match m ON m.listing_id = l.id AND m.account_id = $2
       LEFT JOIN product p ON p.id = coalesce(m.product_id, l.product_id)
      WHERE l.id = $1`,
    [listingId, accountId],
  );
  return rows[0];
}

async function priceHistory(db: Db, listingId: string): Promise<{ price: number; at: Date }[]> {
  const { rows } = await db.query<{ price: string; at: Date }>(
    `SELECT advertised_price AS price, observed_at AS at FROM observation
      WHERE listing_id = $1 AND status IN ('ok', 'partial') AND advertised_price IS NOT NULL
        AND observed_at > now() - interval '60 days'
      ORDER BY observed_at DESC LIMIT 10`,
    [listingId],
  );
  return rows.map((r) => ({ price: Number(r.price), at: r.at }));
}

async function apiLookup(listing: ListingRow, options: Record<string, unknown>): Promise<Extracted | null> {
  if (listing.source_code === 'bestbuy_us' && bestBuyApiEnabled() && options.use_api !== false)
    return bestBuyApiLookup({ sku: listing.channel_sku, model: listing.model_number });
  if (listing.source_code === 'ebay_us' && ebayApiEnabled() && listing.channel_sku) return ebayApiItem(listing.channel_sku);
  return null;
}

export async function collectListing(listingId: string, ctx: CollectContext): Promise<CollectOutcome> {
  const accountId = ctx.accountId ?? null;
  const [listing, history] = await withSystem(async (db) => [await loadListing(db, listingId, accountId), await priceHistory(db, listingId)] as const);
  if (!listing) throw new Error(`listing ${listingId} not found`);

  const adapter = adapterFor(listing.source_code);
  const observationId = randomUUID();
  const notes: string[] = [];
  let requests = 0;

  // 1. robots.txt
  if (config.COLLECT_RESPECT_ROBOTS) {
    const robots = await robotsCheck(listing.url, config.COLLECT_USER_AGENT);
    if (!robots.allowed) {
      const decision = decideOutcome({ kind: 'product', robotsDisallowed: true }, null, null);
      return persist({ listing, ctx, observationId, decision, validation: null, extracted: null, fetch: null, method: null, requests, error: robots.reason, evidence: null });
    }
  }

  // 2. Official API when keyed. Its values win for price / stock / seller; the page is still the evidence.
  let apiData: Extracted | null = null;
  let authFailed = false;
  try {
    apiData = await apiLookup(listing, ctx.options ?? {});
    if (apiData) requests += 1;
  } catch (err) {
    authFailed = err instanceof ApiAuthError;
    notes.push(`api: ${errMessage(err)}`);
  }

  // 3. HTTP first (unless the source only shows prices with JavaScript, or HTTP was just blocked)
  let fetched: FetchResult | null = null;
  let extracted: Extracted | null = null;
  let block: BlockReason = null;
  let fetchError: string | null = null;
  const useBrowserFirst = ctx.forceBrowser || adapter.browserFirst;
  if (!useBrowserFirst) {
    try {
      fetched = await httpFetch(listing.url, adapter);
      requests += 1;
      block = adapter.detectBlock(fetched.html, fetched.status);
      extracted = adapter.extract(fetched.html, fetched.finalUrl);
    } catch (err) {
      fetchError = errMessage(err);
      notes.push(`http: ${fetchError}`);
    }
  }

  // 4. Headless browser only when the plain request did not give a usable page.
  const httpGood = fetched && !block && extracted?.price != null && fetched.status < 400;
  const gone = fetched && (fetched.status === 404 || fetched.status === 410);
  if (!httpGood && !gone && config.COLLECT_BROWSER_FALLBACK) {
    if (fetched) notes.push(`http gave ${fetched.status}${block ? ` (${block})` : ''}${extracted?.price == null ? ', no price' : ''}; trying browser`);
    try {
      const b = await browserFetch(listing.url, adapter);
      requests += 1;
      const bBlock = adapter.detectBlock(b.html, b.status);
      const bExtracted = adapter.extract(b.html, b.finalUrl);
      // Keep the browser result unless HTTP had a price the browser lacks.
      if (!extracted || extracted.price === null || block || bExtracted.price !== null) {
        fetched = b;
        extracted = bExtracted;
        block = bBlock;
        fetchError = null;
      }
    } catch (err) {
      const msg = errMessage(err);
      notes.push(`browser: ${msg}`);
      if (!fetched) fetchError = msg;
    }
  }

  let method: 'http' | 'browser' | 'api' | null = fetched?.method ?? null;
  if (apiData && apiData.price !== null && !block) {
    extracted = { ...apiData, title: apiData.title ?? extracted?.title ?? null, imageUrl: apiData.imageUrl ?? extracted?.imageUrl ?? null, hits: { ...apiData.hits, page: fetched?.method ?? 'none' } };
    method = 'api';
  }

  // 5. Validate, then decide.
  const refs = pickReference(listing.map ? Number(listing.map) : null, listing.msrp ? Number(listing.msrp) : null, history.map((h) => h.price));
  const validation =
    extracted && extracted.price !== null
      ? validatePrice({
          price: extracted.price,
          currency: extracted.currency,
          expectedCurrency: 'USD',
          reference: refs,
          lastAccepted: history[0] ?? null,
          observedAt: fetched?.fetchedAt ?? new Date(),
          recheckOf: ctx.recheckOf ? { price: ctx.recheckOf.price } : null,
        })
      : null;
  const facts: AttemptFacts = {
    kind: 'product',
    authFailed: authFailed && !fetched,
    fetchError: fetched ? null : fetchError,
    httpStatus: method === 'api' ? 200 : (fetched?.status ?? null),
    block: method === 'api' ? null : block,
    price: extracted?.price ?? null,
    title: extracted?.title ?? null,
    availability: extracted?.availability,
  };
  const decision = decideOutcome(facts, extracted, validation);
  if (block) notes.push(`blocked: ${block}`);
  if (validation?.verdict === 'hold') notes.push(`held: ${validation.held.join(', ')}`);

  // 6. Evidence: exactly the HTML we parsed; a screenshot when the page carried a price.
  let evidence: PersistArgs['evidence'] = null;
  if (fetched) {
    const base = `evidence/${listing.source_code}/${datePath(fetched.fetchedAt)}/${observationId}`;
    try {
      const htmlObj = await putObject(`${base}.html`, Buffer.from(fetched.html, 'utf8'), 'text/html; charset=utf-8');
      let shotObj: StoredObject | null = null;
      if (decision.stored.price !== null || fetched.screenshot) {
        let shot = fetched.screenshot ?? null;
        if (!shot) {
          try {
            shot = await renderScreenshot(fetched.html, fetched.finalUrl, adapter);
          } catch (err) {
            notes.push(`screenshot: ${errMessage(err)}`);
          }
        }
        if (shot) shotObj = await putObject(`${base}.png`, shot, 'image/png');
      }
      const evidenceMethod = `${method === 'api' ? 'api+' : ''}${fetched.method === 'browser' ? 'browser' : 'http+render'}`;
      evidence = { html: htmlObj, screenshot: shotObj, method: evidenceMethod, capturedAt: new Date() };
    } catch (err) {
      notes.push(`evidence upload failed: ${errMessage(err)}`);
    }
  }
  // A price without its evidence is not publishable: keep it, but as partial at best.
  if (decision.status === 'ok' && (!evidence || !evidence.screenshot)) decision.status = 'partial';

  return persist({
    listing,
    ctx,
    observationId,
    decision,
    validation,
    extracted,
    fetch: fetched,
    method,
    requests,
    error: notes.length ? notes.join(' | ') : null,
    evidence,
  });
}

interface PersistArgs {
  listing: ListingRow;
  ctx: CollectContext;
  observationId: string;
  decision: ReturnType<typeof decideOutcome>;
  validation: Validation | null;
  extracted: Extracted | null;
  fetch: FetchResult | null;
  method: 'http' | 'browser' | 'api' | null;
  requests: number;
  error: string | null;
  evidence: { html: StoredObject; screenshot: StoredObject | null; method: string; capturedAt: Date } | null;
}

async function persist(a: PersistArgs): Promise<CollectOutcome> {
  const priced = a.decision.stored.price !== null;
  // Descriptive fields are kept only from a real page; nothing is read from a block page.
  const x = a.decision.failureClass === 'blocked' || a.decision.failureClass === 'robots' ? null : a.extracted;
  const modelMatch = a.fetch && !a.decision.failureClass ? modelMatches(a.fetch.html, a.listing.model_number) : null;
  const observedAt = a.fetch?.fetchedAt ?? new Date();
  const validation = a.validation
    ? { checks: a.validation.checks, held: a.validation.held, reference: a.validation.reference, promo: priced && x ? promoType(x) : null, recheckOf: a.ctx.recheckOf?.observationId ?? null }
    : {};

  await withSystem(async (db) => {
    const sellerId = x?.sellerName ? await resolveSeller(db, a.listing.source_id, x.sellerName, x.sellerId) : null;
    await db.query(
      `INSERT INTO observation (id, observed_at, listing_id, crawl_run_id, crawl_job_id, status, failure_class, advertised_price, list_price,
         currency, availability, qty, seller_name_raw, seller_id_raw, seller_id, fulfilled_by_raw, promo_text, coupon_text, title_raw,
         condition, offer_rank, model_match, fetch_method, http_status, final_url, error, extract, validation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        a.observationId,
        observedAt,
        a.listing.id,
        a.ctx.crawlRunId,
        a.ctx.jobId ?? null,
        a.decision.status,
        a.decision.failureClass,
        a.decision.stored.price,
        a.decision.stored.listPrice,
        a.decision.stored.currency,
        x?.availability ?? 'unknown',
        x?.qty ?? null,
        x?.sellerName ?? null,
        x?.sellerId ?? null,
        sellerId,
        x?.fulfilledBy ?? null,
        priced ? (x?.promoText ?? null) : null,
        priced ? (x?.couponText ?? null) : null,
        x?.title ?? null,
        x?.condition ?? null,
        priced ? 1 : null,
        modelMatch,
        a.method,
        a.fetch?.status ?? null,
        a.fetch?.finalUrl ?? null,
        a.error,
        JSON.stringify(a.extracted?.hits ?? {}),
        JSON.stringify(validation),
      ],
    );

    if (a.evidence) {
      const lock = a.evidence.html.lock;
      await db.query(
        `INSERT INTO evidence (observation_id, observed_at, screenshot_uri, screenshot_sha256, screenshot_bytes,
           html_uri, html_sha256, html_bytes, method, captured_at, lock_mode, lock_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          a.observationId,
          observedAt,
          a.evidence.screenshot?.uri ?? null,
          a.evidence.screenshot?.sha256 ?? null,
          a.evidence.screenshot?.bytes ?? null,
          a.evidence.html.uri,
          a.evidence.html.sha256,
          a.evidence.html.bytes,
          a.evidence.method,
          a.evidence.capturedAt,
          lock?.mode ?? null,
          lock?.until ?? null,
        ],
      );
    }

    if (priced) {
      await db.query(
        `UPDATE listing SET last_seen = $2, first_seen = coalesce(first_seen, $2), title = coalesce($3, title),
                image_url = coalesce(image_url, $4), seller_id = coalesce(seller_id, $5)
          WHERE id = $1`,
        [a.listing.id, observedAt, x?.title ?? null, x?.imageUrl ?? null, sellerId],
      );
    }
  });

  return {
    listingId: a.listing.id,
    observationId: a.observationId,
    source: a.listing.source_code,
    productCode: a.listing.product_code,
    status: a.decision.status,
    failureClass: a.decision.failureClass,
    retryable: a.decision.retryable,
    held: a.validation?.held ?? [],
    price: a.decision.stored.price,
    seller: x?.sellerName ?? null,
    availability: x?.availability ?? 'unknown',
    method: a.method,
    requests: a.requests,
    evidence: a.evidence ? { html: a.evidence.html.uri, screenshot: a.evidence.screenshot?.uri } : null,
    error: a.error,
  };
}

