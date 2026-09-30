// Stop on block (decision 34): per run and source, after STOP_AFTER_BLOCKED consecutive blocked
// results, the source's remaining queued jobs in the run are cancelled instead of being tried (and
// retried through the browser). The blocked pages themselves are the evidence in Data Health.
import type { Db } from '../lib/db.js';
import type { FailureClass } from './types.js';

export const STOP_AFTER_BLOCKED = 2;

/** Newest first: the finished jobs' failure classes. True when the latest `n` are all blocked. */
export function blockedStreak(recent: (FailureClass | null)[], n: number = STOP_AFTER_BLOCKED): boolean {
  return recent.length >= n && recent.slice(0, n).every((c) => c === 'blocked');
}

/**
 * Called after a job of `sourceId` finished as blocked. Cancels the source's queued jobs in the run
 * when the streak is reached. Returns how many were cancelled (0 = keep going).
 */
export async function stopSourceIfBlocked(db: Db, crawlRunId: string, sourceId: string): Promise<number> {
  const recent = (
    await db.query<{ failure_class: FailureClass | null }>(
      `SELECT failure_class FROM crawl_job
        WHERE crawl_run_id = $1 AND source_id = $2 AND status IN ('done', 'failed')
        ORDER BY finished_at DESC NULLS LAST LIMIT $3`,
      [crawlRunId, sourceId, STOP_AFTER_BLOCKED],
    )
  ).rows.map((r) => r.failure_class);
  if (!blockedStreak(recent)) return 0;
  const { rowCount } = await db.query(
    `UPDATE crawl_job SET status = 'skipped', skip_reason = 'cancelled', failure_class = 'blocked', finished_at = now(),
            error = 'cancelled: ' || $3 || ' blocked results in a row on this source'
      WHERE crawl_run_id = $1 AND source_id = $2 AND status = 'queued'`,
    [crawlRunId, sourceId, String(STOP_AFTER_BLOCKED)],
  );
  const cancelled = rowCount ?? 0;
  await db.query(
    `UPDATE crawl_run SET jobs_total = jobs_total - $3,
            stopped = stopped || jsonb_build_object((SELECT code FROM source WHERE id = $2),
              jsonb_build_object('reason', 'blocked', 'after', $4::int, 'cancelled', $3::int, 'at', now()))
      WHERE id = $1`,
    [crawlRunId, sourceId, cancelled, STOP_AFTER_BLOCKED],
  );
  return cancelled;
}
