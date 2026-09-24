import { config } from '../lib/config.js';
import { withSystem, type Db } from '../lib/db.js';
import { collectQueue } from '../lib/queue.js';

export interface RunScope {
  account?: string; // account slug, e.g. "lg"
  source?: string; // source code, e.g. "amazon_us"
  product?: string; // product code, e.g. "LG-P01"
  limit?: number;
}

/** How to reach the database: withSystem for the CLI, withApi when called from an API route. */
export type DbRunner = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export async function selectListings(scope: RunScope, run: DbRunner = withSystem): Promise<string[]> {
  return run(async (db) => {
    // app_select_listings reads across accounts, so it works for the API role too.
    const { rows } = await db.query<{ id: string }>('SELECT id FROM app_select_listings($1, $2, $3, $4)', [
      scope.account ?? null,
      scope.source ?? null,
      scope.product ?? null,
      scope.limit ?? 10_000,
    ]);
    return rows.map((r) => r.id);
  });
}

export async function createCrawlRun(
  scope: RunScope,
  jobs: number,
  trigger: 'manual' | 'schedule' = 'manual',
  run: DbRunner = withSystem,
): Promise<string> {
  return run(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO crawl_run (trigger, scope, egress_label, status, jobs_total)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [trigger, JSON.stringify(scope), config.COLLECT_EGRESS_LABEL, jobs === 0 ? 'finished' : 'running', jobs],
    );
    return rows[0].id;
  });
}

/** Create a crawl run and put one job per listing on the Redis queue for the worker. */
export async function enqueueRun(
  scope: RunScope,
  trigger: 'manual' | 'schedule' = 'manual',
  run: DbRunner = withSystem,
): Promise<{ crawlRunId: string; jobs: number }> {
  const listingIds = await selectListings(scope, run);
  const crawlRunId = await createCrawlRun(scope, listingIds.length, trigger, run);
  const queue = collectQueue();
  try {
    await queue.addBulk(
      listingIds.map((listingId) => ({
        name: 'collect-listing',
        data: { listingId, crawlRunId },
        // BullMQ rejects custom job ids that contain ':'
        opts: { jobId: `${crawlRunId}_${listingId}` },
      })),
    );
  } catch (err) {
    // Don't leave a run stuck in 'running' when nothing was queued.
    await run((db) => db.query(`UPDATE crawl_run SET status = 'failed', finished_at = now() WHERE id = $1`, [crawlRunId])).catch(
      () => undefined,
    );
    throw err;
  }
  return { crawlRunId, jobs: listingIds.length };
}
