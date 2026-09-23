import { config } from '../lib/config.js';
import { withSystem } from '../lib/db.js';
import { collectQueue } from '../lib/queue.js';

export interface RunScope {
  account?: string; // account slug, e.g. "lg"
  source?: string; // source code, e.g. "amazon_us"
  product?: string; // product code, e.g. "LG-P01"
  limit?: number;
}

export async function selectListings(scope: RunScope): Promise<string[]> {
  return withSystem(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT l.id
         FROM listing l
         JOIN source s ON s.id = l.source_id AND s.active
         JOIN product p ON p.id = l.product_id AND p.status = 'Active'
         JOIN account a ON a.id = p.account_id
        WHERE l.state = 'Included'
          AND ($1::text IS NULL OR a.slug = $1)
          AND ($2::text IS NULL OR s.code = $2)
          AND ($3::text IS NULL OR p.product_code = $3)
        ORDER BY a.slug, p.product_code, s.code
        LIMIT $4`,
      [scope.account ?? null, scope.source ?? null, scope.product ?? null, scope.limit ?? 10_000],
    );
    return rows.map((r) => r.id);
  });
}

export async function createCrawlRun(scope: RunScope, jobs: number, trigger: 'manual' | 'schedule' = 'manual'): Promise<string> {
  return withSystem(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO crawl_run (trigger, scope, egress_label, status, jobs_total)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [trigger, JSON.stringify(scope), config.COLLECT_EGRESS_LABEL, jobs === 0 ? 'finished' : 'running', jobs],
    );
    return rows[0].id;
  });
}

/** Create a crawl run and put one job per listing on the Redis queue for the worker. */
export async function enqueueRun(scope: RunScope, trigger: 'manual' | 'schedule' = 'manual'): Promise<{ crawlRunId: string; jobs: number }> {
  const listingIds = await selectListings(scope);
  const crawlRunId = await createCrawlRun(scope, listingIds.length, trigger);
  const queue = collectQueue();
  await queue.addBulk(
    listingIds.map((listingId) => ({
      name: 'collect-listing',
      data: { listingId, crawlRunId },
      opts: { jobId: `${crawlRunId}:${listingId}` },
    })),
  );
  return { crawlRunId, jobs: listingIds.length };
}
