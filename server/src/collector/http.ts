import { Redis } from 'ioredis';
import { ProxyAgent, type Dispatcher } from 'undici';
import { config } from '../lib/config.js';
import type { FetchResult, SourceAdapter } from './types.js';

// Politeness: one request at a time per retailer host, with a minimum gap plus random jitter.
// The next free slot per host lives in Redis, so every worker process, the CLI and the API's
// egress probe share it. If Redis is unreachable the slot is kept in memory (this process only).

/**
 * Claim a request slot: the host's next slot is max(now, stored); the one after it is that + gap.
 * Returns [the claimed slot, the new stored value]. Pure, so the Lua script below can mirror it.
 */
export function claimSlot(stored: number | null, now: number, gap: number): [number, number] {
  const slot = Math.max(now, stored ?? 0);
  return [slot, slot + gap];
}

const CLAIM_LUA = `
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local slot = tonumber(redis.call('GET', KEYS[1]) or '0')
if slot < now then slot = now end
redis.call('SET', KEYS[1], slot + gap, 'PX', (slot + gap - now) + 60000)
return slot`;

const memorySlots = new Map<string, number>();
let redis: Redis | null = null;

function slotRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: false, lazyConnect: true });
    // No Redis (a GitHub Actions runner): claim() falls back to memory; keep the log quiet.
    redis.on('error', () => undefined);
  }
  return redis;
}

async function claim(host: string, now: number, gap: number): Promise<number> {
  try {
    const r = slotRedis();
    if (r.status === 'wait') await r.connect();
    return Number(await r.eval(CLAIM_LUA, 1, `polite:${host}`, now, gap));
  } catch {
    const [slot, next] = claimSlot(memorySlots.get(host) ?? null, now, gap);
    memorySlots.set(host, next);
    return slot;
  }
}

/** The gap before a host's next request: the adapter's own pace, else the global one. */
export function paceGap(pace: SourceAdapter['pace'], random: number = Math.random()): number {
  const min = pace?.minDelayMs ?? config.COLLECT_MIN_DELAY_MS;
  const jitter = pace?.jitterMs ?? config.COLLECT_JITTER_MS;
  return min + Math.floor(random * jitter);
}

export async function politeWait(adapter: Pick<SourceAdapter, 'host' | 'pace'>): Promise<void> {
  const now = Date.now();
  const gap = paceGap(adapter.pace);
  const slot = await claim(adapter.host, now, gap);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export async function closePoliteness(): Promise<void> {
  const r = redis;
  redis = null;
  if (r && r.status !== 'end' && r.status !== 'wait') await r.quit().catch(() => undefined);
}

// Optional US proxy for every collector request (and the browser, see browser.ts).
let proxyAgent: Dispatcher | null = null;
export function proxyDispatcher(): Dispatcher | undefined {
  if (!config.COLLECT_HTTPS_PROXY) return undefined;
  proxyAgent ??= new ProxyAgent(config.COLLECT_HTTPS_PROXY);
  return proxyAgent;
}

export function browserLikeHeaders(adapter: SourceAdapter): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': config.COLLECT_USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'upgrade-insecure-requests': '1',
  };
  if (adapter.cookies?.length) headers.cookie = adapter.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return headers;
}

export async function httpFetch(url: string, adapter: SourceAdapter): Promise<FetchResult> {
  await politeWait(adapter);
  const fetchedAt = new Date();
  const res = await fetch(url, {
    headers: browserLikeHeaders(adapter),
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    // Node's fetch is undici underneath and accepts a dispatcher (the proxy).
    ...({ dispatcher: proxyDispatcher() } as object),
  });
  const html = await res.text();
  return { method: 'http', status: res.status, finalUrl: res.url || url, html, fetchedAt };
}
