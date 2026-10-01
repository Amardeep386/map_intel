// Evidence for search / browse results pages (M4): every page a discover job reads is stored as it
// was seen, HTML + screenshot with SHA-256 under S3 Object Lock, a blocked page included, and each
// listing it showed is linked with its position. Append-only (migration 026). A page read through an
// official API (eBay Browse search) is stored as the JSON response instead (decision 36, migration 028).
import { randomUUID } from 'node:crypto';
import { withSystem } from '../lib/db.js';
import { putObject, type StoredObject } from '../lib/storage.js';
import { renderScreenshot } from './browser.js';
import { errMessage } from './collect.js';
import type { ApiRead, BlockReason, FailureClass, FetchResult, SourceAdapter } from './types.js';

export interface ResultsPageJob {
  id: string;
  crawl_run_id: string;
  account_id: string;
  source_id: string;
  source_code: string;
  term_id: string | null;
}

export interface StoredResultsPage {
  id: string;
  pageNo: number;
  /** Listing URLs in page order, with whether the card was sponsored. */
  items: { url: string; sponsored: boolean }[];
  error: string | null;
}

/** evidence/<source>/results/yyyy/mm/dd/<id>.<ext> */
export function resultsEvidenceKey(sourceCode: string, at: Date, id: string, ext: 'html' | 'png' | 'json'): string {
  const iso = at.toISOString();
  return `evidence/${sourceCode}/results/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${id}.${ext}`;
}

export async function storeResultsPage(
  job: ResultsPageJob,
  adapter: SourceAdapter,
  a: { pageNo: number; url: string; fetched: FetchResult | null; api?: ApiRead | null; block: BlockReason; failure: FailureClass | null; items: { url: string; sponsored: boolean }[] },
): Promise<StoredResultsPage> {
  const id = randomUUID();
  const notes: string[] = [];
  let html: StoredObject | null = null;
  let shot: StoredObject | null = null;
  let api: StoredObject | null = null;
  const f = a.fetched;
  const at = f?.fetchedAt ?? a.api?.fetchedAt ?? new Date();
  if (a.api) {
    try {
      api = await putObject(resultsEvidenceKey(job.source_code, at, id, 'json'), Buffer.from(a.api.body, 'utf8'), 'application/json; charset=utf-8');
    } catch (err) {
      notes.push(`evidence upload failed: ${errMessage(err)}`);
    }
  }
  if (f) {
    try {
      html = await putObject(resultsEvidenceKey(job.source_code, f.fetchedAt, id, 'html'), Buffer.from(f.html, 'utf8'), 'text/html; charset=utf-8');
      // A browser read has the live screenshot; an HTTP read is rendered from the stored HTML (JS off).
      let png = f.screenshot ?? null;
      if (!png) {
        try {
          png = await renderScreenshot(f.html, f.finalUrl, adapter);
        } catch (err) {
          notes.push(`screenshot: ${errMessage(err)}`);
        }
      }
      if (png) shot = await putObject(resultsEvidenceKey(job.source_code, f.fetchedAt, id, 'png'), png, 'image/png');
    } catch (err) {
      notes.push(`evidence upload failed: ${errMessage(err)}`);
    }
  }
  const lock = html?.lock ?? api?.lock ?? null;
  const term = job.term_id;
  await withSystem((db) =>
    db.query(
      `INSERT INTO results_page (id, account_id, crawl_run_id, crawl_job_id, source_id, term_id, term_value, page_no, url, final_url, fetched_at,
         method, http_status, block, failure_class, items_found, html_uri, html_sha256, html_bytes, screenshot_uri, screenshot_sha256,
         screenshot_bytes, lock_mode, lock_until, api_uri, api_sha256, api_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT value FROM term WHERE id = $6),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        id, job.account_id, job.crawl_run_id, job.id, job.source_id, term, a.pageNo, a.url, f?.finalUrl ?? a.url, at,
        f?.method ?? 'api', f?.status ?? a.api?.status ?? null, a.block, a.failure, a.items.length, html?.uri ?? null, html?.sha256 ?? null, html?.bytes ?? null,
        shot?.uri ?? null, shot?.sha256 ?? null, shot?.bytes ?? null, lock?.mode ?? null, lock?.until ?? null,
        api?.uri ?? null, api?.sha256 ?? null, api?.bytes ?? null,
      ],
    ),
  );
  return { id, pageNo: a.pageNo, items: a.items, error: notes.length ? notes.join(' | ') : null };
}

/** Link the listings each stored page showed (only those that became listings: new-only filters the rest). */
export async function linkResultsListings(accountId: string, pages: StoredResultsPage[], listingIdByUrl: Map<string, string>): Promise<number> {
  const rows = pages.flatMap((p) =>
    p.items.flatMap((item, i) => {
      const listingId = listingIdByUrl.get(item.url);
      return listingId ? [{ results_page_id: p.id, listing_id: listingId, position: i + 1, sponsored: item.sponsored }] : [];
    }),
  );
  if (!rows.length) return 0;
  await withSystem((db) =>
    db.query(
      `INSERT INTO results_page_listing (results_page_id, account_id, listing_id, position, sponsored)
       SELECT r.results_page_id, $1, r.listing_id, r.position, r.sponsored
         FROM jsonb_to_recordset($2::jsonb) AS r(results_page_id uuid, listing_id uuid, position int, sponsored boolean)
       ON CONFLICT DO NOTHING`,
      [accountId, JSON.stringify(rows)],
    ),
  );
  return rows.length;
}
