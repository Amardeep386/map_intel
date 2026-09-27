import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const COLLECT_QUEUE = 'collect';

export interface CollectJob {
  listingId: string;
  crawlRunId: string;
}

// BullMQ needs maxRetriesPerRequest: null on its connections. Upstash URLs start with rediss://
// and work as-is (TLS is picked up from the scheme).
export function redisConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

let queue: Queue<CollectJob> | null = null;
let queueConnection: Redis | null = null;

export function collectQueue(): Queue<CollectJob> {
  if (!queue) {
    queueConnection = redisConnection();
    queue = new Queue<CollectJob>(COLLECT_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 86_400, count: 5_000 },
        removeOnFail: { age: 30 * 86_400 },
      },
    });
  }
  return queue;
}

// ---------------------------------------------------------------------------
// Phase 2b: one queue per source, so each source has its own rate limit and a slow or blocked
// retailer never holds up the others. A job carries only its crawl_job id; the row is the truth.
// ---------------------------------------------------------------------------
export interface CrawlJobData {
  crawlJobId: string;
}

export const sourceQueueName = (sourceCode: string) => `collect-${sourceCode}`;
export const SCHEDULER_QUEUE = 'scheduler';

/** Retries: 3 attempts, 5 then 10 minutes apart. The processor decides what is worth retrying. */
export const CRAWL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5 * 60_000 },
  removeOnComplete: { age: 3 * 86_400, count: 2_000 },
  removeOnFail: { age: 14 * 86_400 },
} as const;

const sourceQueues = new Map<string, Queue<CrawlJobData>>();
let sharedConnection: Redis | null = null;

export function sourceQueue(sourceCode: string): Queue<CrawlJobData> {
  let q = sourceQueues.get(sourceCode);
  if (!q) {
    sharedConnection ??= redisConnection();
    q = new Queue<CrawlJobData>(sourceQueueName(sourceCode), { connection: sharedConnection, defaultJobOptions: CRAWL_JOB_OPTIONS });
    sourceQueues.set(sourceCode, q);
  }
  return q;
}

/** BullMQ does not close a connection it was handed, so close both (lets CLI scripts exit). */
export async function closeQueue(): Promise<void> {
  for (const q of sourceQueues.values()) await q.close();
  sourceQueues.clear();
  await sharedConnection?.quit().catch(() => undefined);
  sharedConnection = null;
  await queue?.close();
  await queueConnection?.quit().catch(() => undefined);
  queue = null;
  queueConnection = null;
}

export async function redisHealthy(): Promise<boolean> {
  const r = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
  try {
    await r.connect();
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    r.disconnect();
  }
}
