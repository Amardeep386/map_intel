// Collector worker (Render, US region): the scheduler tick plus one BullMQ worker per source queue.
// Politeness per retailer host is shared through Redis (collector/http.ts); each source queue also
// has its own limiter, so a slow or blocked retailer never holds up the others.
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { closeBrowser } from '../collector/browser.js';
import { collectListing } from '../collector/collect.js';
import { closePoliteness } from '../collector/http.js';
import { RetryLater, runCrawlJob } from '../collector/jobs.js';
import { recordRunProgress } from '../collector/runs.js';
import { adapters } from '../collector/sources.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { COLLECT_QUEUE, CRAWL_JOB_OPTIONS, SCHEDULER_QUEUE, closeQueue, redisConnection, sourceQueueName, type CollectJob, type CrawlJobData } from '../lib/queue.js';
import { evidenceLockStatus } from '../lib/storage.js';
import { schedulerTick } from '../scheduler/tick.js';

// Fewer Redis commands while idle (Upstash bills per command): poll every 60 s when a queue is
// empty and check for stalled jobs every 5 minutes.
const quiet = { drainDelay: 60, stalledInterval: 5 * 60_000, maxStalledCount: 1 };

async function main(): Promise<void> {
  // Evidence must be write-once in production: refuse to collect without Object Lock.
  const lock = await evidenceLockStatus();
  if (lock.problem) {
    if (config.NODE_ENV === 'production') {
      console.error(`[worker] evidence is not protected: ${lock.problem}. Not starting.`);
      process.exit(1);
    }
    console.warn(`[worker] WARNING evidence is not protected: ${lock.problem} (allowed outside production)`);
  } else {
    console.log(`[worker] evidence lock: bucket enabled, ${lock.retentionDays} days per object${lock.defaultRule ? `, default ${lock.defaultRule}` : ''}`);
  }

  const workers: Worker[] = [];

  // One worker per live source. The limiter spaces job starts; the Redis slot spaces requests.
  for (const code of Object.keys(adapters)) {
    const w = new Worker<CrawlJobData>(
      sourceQueueName(code),
      async (job: Job<CrawlJobData>) => {
        try {
          const r = await runCrawlJob(job.data.crawlJobId, job.attemptsMade + 1, job.opts.attempts ?? CRAWL_JOB_OPTIONS.attempts);
          console.log(`[${code}] ${job.name} ${job.data.crawlJobId.slice(0, 8)} -> ${r.status}${r.failureClass ? ` (${r.failureClass})` : ''}${r.found !== null ? ` found ${r.found}` : ''}`);
          return r;
        } catch (err) {
          if (err instanceof RetryLater) {
            console.log(`[${code}] ${job.name} ${job.data.crawlJobId.slice(0, 8)} -> retry later: ${err.message}`);
            throw err;
          }
          // A bug or a lost row is not fixed by retrying.
          throw new UnrecoverableError((err as Error).message);
        }
      },
      {
        connection: redisConnection(),
        concurrency: config.COLLECT_CONCURRENCY,
        limiter: { max: 1, duration: config.COLLECT_MIN_DELAY_MS },
        ...quiet,
      },
    );
    w.on('failed', (job, err) => {
      if (!(err instanceof RetryLater)) console.error(`[${code}] job ${job?.id} failed: ${err.message}`);
    });
    workers.push(w);
  }

  // The scheduler tick, as a BullMQ job scheduler: one tick per interval across all worker processes.
  const schedulerQueue = new Queue(SCHEDULER_QUEUE, { connection: redisConnection() });
  await schedulerQueue.upsertJobScheduler('scheduler-tick', { every: config.SCHEDULER_TICK_MINUTES * 60_000 }, { name: 'tick', opts: { removeOnComplete: 50, removeOnFail: 50 } });
  workers.push(
    new Worker(
      SCHEDULER_QUEUE,
      async () => {
        const fired = await schedulerTick();
        for (const r of fired)
          console.log(`[scheduler] ${r.schedule}: run ${r.crawlRunId.slice(0, 8)} for ${r.slot.toISOString()} — ${r.queued} jobs queued, skipped ${JSON.stringify(r.skipped)}`);
        return { fired: fired.length };
      },
      { connection: redisConnection(), concurrency: 1, ...quiet },
    ),
  );

  // P0 queue (manual runs queued by the CLI / admin route): kept working.
  workers.push(
    new Worker<CollectJob>(
      COLLECT_QUEUE,
      async (job) => {
        const outcome = await collectListing(job.data.listingId, { crawlRunId: job.data.crawlRunId });
        await withSystem((db) => recordRunProgress(db, job.data.crawlRunId, outcome.status));
        return outcome;
      },
      { connection: redisConnection(), concurrency: 1, ...quiet },
    ),
  );

  console.log(`[worker] collector worker started (egress ${config.COLLECT_EGRESS_LABEL}; sources ${Object.keys(adapters).join(', ')}; tick every ${config.SCHEDULER_TICK_MINUTES} min)`);

  async function shutdown(): Promise<void> {
    console.log('[worker] shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await schedulerQueue.close();
    await closeQueue();
    await closeBrowser();
    await closePoliteness();
    await closeDb();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
