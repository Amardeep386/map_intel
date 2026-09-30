// Evidence for search / browse results pages (M4): every page a discover job reads is stored as it
// was seen, HTML + screenshot with SHA-256 under S3 Object Lock, a blocked page included, and each
// listing it showed is linked with its position. Append-only (migration 026).
import { randomUUID } from 'node:crypto';
import { withSystem } from '../lib/db.js';
import { putObject, type StoredObject } from '../lib/storage.js';
import { renderScreenshot } from './browser.js';
import { errMessage } from './collect.js';
import type { BlockReason, FailureClass, FetchResult, SourceAdapter } from './types.js';

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
export function resultsEvidenceKey(sourceCode: string, at: Date, id: string, ext: 'html' | 'png'): string {
  const iso = at.toISOString();
  return `evidence/${sourceCode}/results/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${id}.${ext}`;
}

export async function storeResultsPage(
  job: ResultsPageJob,
  adapter: SourceAdapter,
  a: { pageNo: number; url: string; fetched: FetchResult; block: BlockReason; failure: FailureClass | null; items: { url: string; sponsored: boolean }[] },
): Promise<StoredResultsPage> {
  const id = randomUUID();
  const f = a.fetched;
  let html: StoredObject | null = null;
  let shot: StoredObject | null = null;
  const notes: string[] = [];
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
  const lock = html?.lock ?? null;
  const term = job.term_id;
  await withSystem((db) =>
    db.query(
      `INSERT INTO results_page (id, account_id, crawl_run_id, crawl_job_id, source_id, term_id, term_value, page_no, url, final_url, fetched_at,
         method, http_status, block, failure_class, items_found, html_uri, html_sha256, html_bytes, screenshot_uri, screenshot_sha256,
         screenshot_bytes, lock_mode, lock_until)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT value FROM term WHERE id = $6),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id, job.account_id, job.crawl_run_id, job.id, job.source_id, term, a.pageNo, a.url, f.finalUrl, f.fetchedAt,
        f.method, f.status, a.block, a.failure, a.items.length, html?.uri ?? null, html?.sha256 ?? null, html?.bytes ?? null,
        shot?.uri ?? null, shot?.sha256 ?? null, shot?.bytes ?? null, lock?.mode ?? null, lock?.until ?? null,
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
