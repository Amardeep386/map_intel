// Run one crawl_job (called by the source workers). The crawl_job row is the ledger: status,
// attempts, failure class, requests. Transient failures (timeout, network, blocked) are retried
// by BullMQ, the retry going through the browser; everything else finishes the job.
import { config } from '../lib/config.js';
import { withSystem, type Db } from '../lib/db.js';
import { ApiAuthError } from './apiError.js';
import { loadMatchContext, stageCandidate, upsertListing } from '../lib/mapping.js';
import { browserFetch } from './browser.js';
import { collectListing, errMessage, type CollectOutcome } from './collect.js';
import { classifyFailure, isRetryable } from './failure.js';
import { httpFetch } from './http.js';
import { robotsCheck } from './robots.js';
import { linkResultsListings, storeResultsPage, type StoredResultsPage } from './resultsEvidence.js';
import { recordRunProgress } from './runs.js';
import { stopSourceIfBlocked } from './stopOnBlock.js';
import { adapterFor, channelSkuFromUrl } from './sources.js';
import type { ApiRead, BlockReason, DiscoveredItem, FailureClass, FetchResult, ResultsPage, SourceAdapter } from './types.js';

export interface JobRow {
  id: string;
  crawl_run_id: string;
  account_id: string;
  source_id: string;
  source_code: string;
  kind: 'discover' | 'collect' | 'recheck';
  term_id: string | null;
  term_type: string | null;
  term_product_id: string | null;
  listing_id: string | null;
  url: string | null;
  priority: number;
  options: Record<string, unknown>;
  schema_costs: Record<string, unknown> | null;
}

export interface JobResult {
  status: 'done' | 'failed';
  failureClass: FailureClass | null;
  retryable: boolean;
  requests: number;
  found: number | null;
  observationId: string | null;
  method: string | null;
  error: string | null;
}

/** Thrown to make BullMQ retry the job later. */
export class RetryLater extends Error {}

async function loadJob(db: Db, id: string): Promise<JobRow | undefined> {
  const { rows } = await db.query<JobRow>(
    `SELECT j.id, j.crawl_run_id, j.account_id, j.source_id, s.code AS source_code, j.kind, j.term_id, t.type AS term_type,
            t.product_id AS term_product_id, j.listing_id, j.url, j.priority, coalesce(a.options, '{}') AS options,
            s.options_schema->'costs' AS schema_costs
       FROM crawl_job j
       JOIN source s ON s.id = j.source_id
       LEFT JOIN term t ON t.id = j.term_id
       LEFT JOIN account_source a ON a.account_id = j.account_id AND a.source_id = j.source_id
      WHERE j.id = $1`,
    [id],
  );
  return rows[0];
}

/** Result pages to read for a discover job: the subscription's search_pages (default from the source). */
function pagesFor(job: JobRow, mode: 'search' | 'browse'): number {
  const n = Number(job.options.search_pages);
  if (Number.isInteger(n) && n > 0) return Math.min(n, 5);
  return mode === 'search' ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface PageRead {
  page: ResultsPage | null;
  failure: FailureClass | null;
  method: 'http' | 'browser' | 'api' | null;
  requests: number;
  error: string | null;
  /** The page as read (kept as evidence), and its block reason. */
  fetched: FetchResult | null;
  block: BlockReason;
  /** Or the official API response (kept as evidence, decision 36). */
  api: ApiRead | null;
}

/** A results page through the source's official API (eBay Browse search); null when `url` is a web page. */
async function readResultsApi(url: string, adapter: SourceAdapter): Promise<PageRead | null> {
  const none = { fetched: null, block: null } as const;
  try {
    const api = await adapter.readResultsApi?.(url);
    if (!api) return null;
    // An API answer of "0 results" is definite (a web page without cards may be a layout change; this is not).
    const noResults = api.page.recognized && api.page.items.length === 0;
    const failure = noResults ? null : classifyFailure({ kind: 'results', fetchError: null, httpStatus: api.status, block: null, items: api.page.items.length, recognized: api.page.recognized });
    return { ...none, page: api.page, failure, method: 'api', requests: 1, error: null, api };
  } catch (err) {
    return { ...none, page: null, failure: err instanceof ApiAuthError ? 'auth' : 'network', method: 'api', requests: 1, error: errMessage(err), api: null };
  }
}

async function readResultsPage(url: string, adapter: SourceAdapter, forceBrowser: boolean): Promise<PageRead> {
  const viaApi = await readResultsApi(url, adapter);
  if (viaApi) return viaApi;
  if (config.COLLECT_RESPECT_ROBOTS) {
    const r = await robotsCheck(url, config.COLLECT_USER_AGENT);
    if (!r.allowed) return { page: null, failure: 'robots', method: null, requests: 0, error: r.reason, fetched: null, block: null, api: null };
  }
  let requests = 0;
  let fetched: FetchResult | null = null;
  let block: BlockReason = null;
  let error: string | null = null;
  let page: ResultsPage | null = null;
  const read = (f: FetchResult) => {
    fetched = f;
    block = adapter.detectBlock(f.html, f.status);
    page = block ? null : (adapter.extractResults?.(f.html, f.finalUrl) ?? null);
  };
  if (!forceBrowser && !adapter.browserFirst) {
    try {
      read(await httpFetch(url, adapter));
      requests += 1;
    } catch (err) {
      error = errMessage(err);
    }
  }
  const usable = (p: ResultsPage | null) => p !== null && p.recognized && p.items.length > 0;
  // A source whose block is final (Amazon) is not re-read through the browser after a block.
  const finalBlock = adapter.noRetryOnBlock && block !== null;
  if (!usable(page) && !finalBlock && config.COLLECT_BROWSER_FALLBACK) {
    try {
      read(await browserFetch(url, adapter));
      requests += 1;
      error = null;
    } catch (err) {
      error = errMessage(err);
    }
  }
  const f = fetched as FetchResult | null;
  const p = page as ResultsPage | null;
  const failure = classifyFailure({
    kind: 'results',
    fetchError: f ? null : error,
    httpStatus: f?.status ?? null,
    block,
    items: p?.items.length ?? 0,
    recognized: p?.recognized ?? false,
  });
  return { page: p, failure, method: f?.method ?? null, requests, error: error ?? (block ? `blocked: ${block}` : null), fetched: f, block, api: null };
}

/** New listings found: shared listing row, the term that found it, the account's matcher. */
async function stageDiscovered(job: JobRow, items: DiscoveredItem[]): Promise<{ toCollect: { id: string; url: string }[]; listingIdByUrl: Map<string, string> }> {
  const listingIdByUrl = new Map<string, string>();
  if (!items.length) return { toCollect: [], listingIdByUrl };
  return withSystem(async (db) => {
    const ctx = await loadMatchContext(db, job.account_id);
    const toCollect: { id: string; url: string }[] = [];
    for (const item of items) {
      const { listingId, sellerId } = await upsertListing(
        db,
        { sourceId: job.source_id, url: item.url, channelSku: item.channelSku, title: item.title, sellerName: item.sellerName, imageUrl: item.imageUrl, origin: 'collector' },
        ctx,
      );
      listingIdByUrl.set(item.url, listingId);
      if (job.term_id) {
        await db.query(
          `INSERT INTO listing_discovery (account_id, term_id, listing_id) VALUES ($1, $2, $3)
           ON CONFLICT (term_id, listing_id) DO UPDATE SET last_found_at = now()`,
          [job.account_id, job.term_id, listingId],
        );
      }
      // Score listings that are new to this account or still waiting for a decision. A decided
      // listing keeps its decision; it is re-collected by the schedule anyway.
      const cur = ctx.current.get(listingId);
      if (cur && cur.state !== 'Staged') continue;
      const r = await stageCandidate(db, ctx, {
        ...item,
        listingId,
        sourceId: job.source_id,
        sellerId,
        origin: 'collector',
        proposedProductId: job.term_product_id,
      });
      if (!cur && (r.state === 'Included' || r.state === 'Staged')) toCollect.push({ id: listingId, url: item.url });
    }
    return { toCollect, listingIdByUrl };
  });
}

/** With new_only (the default), a listing known to be used / renewed / refurbished / open box is not staged. */
export function keepCondition(job: Pick<JobRow, 'options'>, condition: DiscoveredItem['condition']): boolean {
  return job.options.new_only === false || !condition || condition === 'new';
}

async function runDiscover(job: JobRow, forceBrowser: boolean): Promise<JobResult> {
  const adapter = adapterFor(job.source_code);
  if (!job.url) return { status: 'failed', failureClass: 'layout_changed', retryable: false, requests: 0, found: null, observationId: null, method: null, error: 'discover job without a URL' };

  // A product page (an ASIN, a product URL term): one listing; collect it and stage what it shows.
  if (adapter.isProductUrl?.(job.url)) {
    const listingId = await withSystem(async (db) =>
      (await upsertListing(db, { sourceId: job.source_id, url: job.url!, channelSku: channelSkuFromUrl(job.source_code, job.url!), origin: 'collector' })).listingId,
    );
    const outcome = await collectListing(listingId, { crawlRunId: job.crawl_run_id, jobId: job.id, accountId: job.account_id, options: job.options, forceBrowser });
    if (outcome.price !== null || outcome.status === 'held') {
      const obs = await withSystem(async (db) => (await db.query<{ title_raw: string | null; condition: string | null }>('SELECT title_raw, condition FROM observation WHERE id = $1', [outcome.observationId])).rows[0]);
      // Decision 30: a used / renewed / refurbished / open-box listing is never staged.
      if (!keepCondition(job, (obs?.condition as DiscoveredItem['condition']) ?? null)) return fromOutcome(outcome);
      await stageDiscovered(job, [
        { url: job.url, channelSku: channelSkuFromUrl(job.source_code, job.url), title: obs?.title_raw ?? null, price: outcome.price, sellerName: outcome.seller, imageUrl: null, condition: (obs?.condition as DiscoveredItem['condition']) ?? null, format: null },
      ]);
    }
    return fromOutcome(outcome);
  }

  // Search or browse pages.
  const mode = job.term_type === 'url' ? 'browse' : 'search';
  const maxPages = pagesFor(job, mode);
  let url: string | null = job.url;
  let requests = 0;
  let method: string | null = null;
  const items: DiscoveredItem[] = [];
  let failure: FailureClass | null = null;
  let error: string | null = null;
  const pages: StoredResultsPage[] = [];
  const notes: string[] = [];
  for (let p = 1; url && p <= maxPages; p++) {
    const read = await readResultsPage(url, adapter, forceBrowser);
    requests += read.requests;
    method = read.method ?? method;
    // M4: every page read is evidence, a blocked one too.
    if (read.fetched || read.api) {
      const kept = (read.page?.items ?? []).filter((i) => keepCondition(job, i.condition));
      try {
        const stored = await storeResultsPage(job, adapter, {
          pageNo: p,
          url,
          fetched: read.fetched,
          api: read.api,
          block: read.block,
          failure: read.failure,
          items: kept.map((i) => ({ url: i.url, sponsored: i.format === 'sponsored' })),
        });
        pages.push(stored);
        if (stored.error) notes.push(`page ${p}: ${stored.error}`);
      } catch (err) {
        notes.push(`page ${p} evidence: ${errMessage(err)}`);
      }
    }
    if (read.failure) {
      // An empty later page just ends the list; a failure on page 1 is the job's failure.
      if (p === 1 || read.failure !== 'empty') {
        failure = read.failure;
        error = read.error;
      }
      break;
    }
    items.push(...read.page!.items);
    url = read.page!.nextUrl;
  }
  const kept = items.filter((i) => keepCondition(job, i.condition) && !(job.options.buy_it_now_only !== false && i.format === 'auction'));
  const { toCollect, listingIdByUrl } = await stageDiscovered(job, kept);
  await linkResultsListings(job.account_id, pages, listingIdByUrl);
  if (toCollect.length) {
    const { addJobs } = await import('../scheduler/tick.js');
    await addJobs(
      job.crawl_run_id,
      job.account_id,
      job.priority,
      toCollect.map((l) => ({ kind: 'collect', sourceId: job.source_id, sourceCode: job.source_code, termId: null, listingId: l.id, url: l.url, mode: null, pages: 1, cost: 1, priority: job.priority, skipReason: null })),
    );
  }
  const found = kept.length;
  if (failure && items.length) failure = null; // later pages failed, but we have results
  return {
    status: failure ? 'failed' : 'done',
    failureClass: failure,
    retryable: isRetryable(failure),
    requests,
    found,
    observationId: null,
    method,
    error: [error, ...notes].filter(Boolean).join(' | ') || null,
  };
}

function fromOutcome(o: CollectOutcome): JobResult {
  const failed = o.failureClass !== null;
  return {
    status: failed ? 'failed' : 'done',
    failureClass: o.failureClass,
    retryable: o.retryable,
    requests: o.requests,
    found: null,
    observationId: o.observationId,
    method: o.method,
    error: o.error,
  };
}

// ---------------------------------------------------------------------------
// Collect / recheck
// ---------------------------------------------------------------------------

async function runCollect(job: JobRow, forceBrowser: boolean): Promise<JobResult> {
  if (!job.listing_id) return { status: 'failed', failureClass: 'not_found', retryable: false, requests: 0, found: null, observationId: null, method: null, error: 'collect job without a listing' };
  let recheckOf: { observationId: string; price: number } | null = null;
  if (job.kind === 'recheck') {
    const held = await withSystem(async (db) =>
      (
        await db.query<{ id: string; price: string }>(
          `SELECT id, advertised_price AS price FROM observation WHERE listing_id = $1 AND crawl_run_id = $2 AND status = 'held'
            ORDER BY observed_at DESC LIMIT 1`,
          [job.listing_id, job.crawl_run_id],
        )
      ).rows[0],
    );
    if (held) recheckOf = { observationId: held.id, price: Number(held.price) };
  }
  const outcome = await collectListing(job.listing_id, { crawlRunId: job.crawl_run_id, jobId: job.id, accountId: job.account_id, options: job.options, recheckOf, forceBrowser });
  // A held price is read again once, soon, at top priority. A recheck that holds again stays held.
  if (outcome.status === 'held' && job.kind === 'collect') {
    const { addJobs } = await import('../scheduler/tick.js');
    await addJobs(
      job.crawl_run_id,
      job.account_id,
      job.priority,
      [{ kind: 'collect', sourceId: job.source_id, sourceCode: job.source_code, termId: null, listingId: job.listing_id, url: job.url, mode: null, pages: 1, cost: 1, priority: job.priority, skipReason: null }],
      'recheck',
    );
  }
  return fromOutcome(outcome);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run a crawl job. `attempt` is 1-based. Throws RetryLater when the failure is transient and
 * attempts remain (BullMQ schedules the retry); otherwise records the final result.
 */
export async function runCrawlJob(crawlJobId: string, attempt: number, maxAttempts: number): Promise<JobResult> {
  const job = await withSystem(async (db) => {
    const j = await loadJob(db, crawlJobId);
    if (!j) return j;
    // A job cancelled while it waited on the queue (stop on block, --cancel) is not run.
    const { rowCount } = await db.query(
      `UPDATE crawl_job SET status = 'running', attempts = $2, started_at = coalesce(started_at, now()) WHERE id = $1 AND status IN ('queued', 'running')`,
      [crawlJobId, attempt],
    );
    return rowCount ? j : null;
  });
  if (job === undefined) throw new Error(`crawl job ${crawlJobId} not found`);
  if (job === null) return { status: 'done', failureClass: null, retryable: false, requests: 0, found: null, observationId: null, method: null, error: 'cancelled before it ran' };

  const forceBrowser = attempt > 1;
  let result: JobResult;
  try {
    result = job.kind === 'discover' ? await runDiscover(job, forceBrowser) : await runCollect(job, forceBrowser);
  } catch (err) {
    result = { status: 'failed', failureClass: 'network', retryable: true, requests: 0, found: null, observationId: null, method: null, error: errMessage(err) };
  }

  // A source whose block is final (Amazon) is never retried through the browser (decision 34).
  if (result.failureClass === 'blocked' && adapterFor(job.source_code).noRetryOnBlock) result.retryable = false;
  const willRetry = result.retryable && attempt < maxAttempts;
  const finished = await withSystem(async (db) => {
    await db.query(
      `UPDATE crawl_job SET status = $2, failure_class = $3, method = coalesce($4, method), requests = requests + $5, found = coalesce($6, found),
              observation_id = coalesce($7, observation_id), error = $8, finished_at = CASE WHEN $9 THEN NULL ELSE now() END
        WHERE id = $1`,
      [crawlJobId, willRetry ? 'queued' : result.status, result.failureClass, result.method, result.requests, result.found, result.observationId, result.error, willRetry],
    );
    if (willRetry) return false;
    const done = await recordRunProgress(db, job.crawl_run_id, result.failureClass ?? 'ok');
    if (done || result.failureClass !== 'blocked') return done;
    // M5: two blocked results in a row stop the source for this run; the run may be finished now.
    const cancelled = await stopSourceIfBlocked(db, job.crawl_run_id, job.source_id);
    if (!cancelled) return false;
    const { rows } = await db.query<{ finished: boolean }>(
      `UPDATE crawl_run SET status = CASE WHEN jobs_done >= jobs_total THEN 'finished' ELSE status END,
              finished_at = CASE WHEN jobs_done >= jobs_total THEN now() ELSE finished_at END
        WHERE id = $1 RETURNING jobs_done >= jobs_total AS finished`,
      [job.crawl_run_id],
    );
    return rows[0]?.finished ?? false;
  });
  if (finished) await finalizeRun(job.crawl_run_id);
  if (willRetry) throw new RetryLater(`${result.failureClass}: ${result.error ?? ''}`.slice(0, 300));
  return result;
}

/** A run has finished: record source health for its account (M8), then judge its observations (P3). */
export async function finalizeRun(crawlRunId: string): Promise<void> {
  const { recordRunHealth } = await import('../lib/health.js');
  await recordRunHealth(crawlRunId);
  const { judgeAccount } = await import('../lib/judge.js');
  await withSystem(async (db) => {
    const run = (await db.query<{ account_id: string | null }>('SELECT account_id FROM crawl_run WHERE id = $1', [crawlRunId])).rows[0];
    if (run?.account_id) await judgeAccount(db, run.account_id, { trigger: 'crawl', crawlRunId });
  });
}
