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

/** BullMQ does not close a connection it was handed, so close both (lets CLI scripts exit). */
export async function closeQueue(): Promise<void> {
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
