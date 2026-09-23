// Collector worker: takes collect-listing jobs from the Redis queue and runs them.
// Politeness is enforced per retailer host inside the collector (one request at a time, with delay).
import { Worker } from 'bullmq';
import { closeBrowser } from '../collector/browser.js';
import { collectListing } from '../collector/collect.js';
import { closeDb, withSystem } from '../lib/db.js';
import { COLLECT_QUEUE, redisConnection, type CollectJob } from '../lib/queue.js';

const worker = new Worker<CollectJob>(
  COLLECT_QUEUE,
  async (job) => {
    const outcome = await collectListing(job.data.listingId, job.data.crawlRunId);
    console.log(
      `[collect] ${outcome.productCode ?? '?'} ${outcome.source} -> ${outcome.status}` +
        (outcome.price !== null ? ` $${outcome.price}` : '') +
        (outcome.seller ? ` (${outcome.seller})` : ''),
    );
    return outcome;
  },
  // Three sources, each throttled per host, so three jobs can usefully run at once.
  { connection: redisConnection(), concurrency: 3 },
);

worker.on('failed', async (job, err) => {
  console.error(`[collect] job ${job?.id} failed: ${err.message}`);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await withSystem((db) =>
      db.query(
        `UPDATE crawl_run SET jobs_done = jobs_done + 1,
           stats = jsonb_set(stats, '{error}', to_jsonb(coalesce((stats->>'error')::int, 0) + 1)),
           status = CASE WHEN jobs_done + 1 >= jobs_total THEN 'finished' ELSE status END,
           finished_at = CASE WHEN jobs_done + 1 >= jobs_total THEN now() ELSE finished_at END
         WHERE id = $1`,
        [job.data.crawlRunId],
      ),
    ).catch(() => undefined);
  }
});

console.log('[worker] collector worker started');

async function shutdown(): Promise<void> {
  console.log('[worker] shutting down');
  await worker.close();
  await closeBrowser();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
