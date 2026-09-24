// A small fixed-window limiter in Redis, shared by every API process (the P0 limiter lived in
// memory per process). If Redis is unreachable it falls back to memory rather than locking
// everyone out or letting everything through.
import { Redis } from 'ioredis';
import { config } from './config.js';

let redis: Redis | null = null;
const memory = new Map<string, { count: number; until: number }>();

function client(): Redis {
  redis ??= new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: false, lazyConnect: true });
  return redis;
}

export interface Limit {
  /** Attempts allowed per window. */
  max: number;
  windowSeconds: number;
}

/** True while `key` has used up its attempts in the current window. */
export async function isLimited(key: string, limit: Limit): Promise<boolean> {
  try {
    const r = client();
    if (r.status === 'wait') await r.connect();
    const n = Number((await r.get(`rl:${key}`)) ?? 0);
    return n >= limit.max;
  } catch {
    const m = memory.get(key);
    return !!m && m.until > Date.now() && m.count >= limit.max;
  }
}

/** Count one failed attempt against `key`. */
export async function hit(key: string, limit: Limit): Promise<void> {
  try {
    const r = client();
    if (r.status === 'wait') await r.connect();
    const n = await r.incr(`rl:${key}`);
    if (n === 1) await r.expire(`rl:${key}`, limit.windowSeconds);
  } catch {
    const m = memory.get(key);
    const live = m && m.until > Date.now() ? m : { count: 0, until: Date.now() + limit.windowSeconds * 1000 };
    memory.set(key, { count: live.count + 1, until: live.until });
  }
}

/** Forget `key` (e.g. after a successful sign-in). */
export async function reset(key: string): Promise<void> {
  memory.delete(key);
  try {
    const r = client();
    if (r.status === 'wait') await r.connect();
    await r.del(`rl:${key}`);
  } catch {
    // memory already cleared
  }
}

export async function closeRateLimiter(): Promise<void> {
  const r = redis;
  redis = null;
  if (r && r.status !== 'end' && r.status !== 'wait') await r.quit().catch(() => undefined);
}
