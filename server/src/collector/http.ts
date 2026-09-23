import { config } from '../lib/config.js';
import type { FetchResult, SourceAdapter } from './types.js';

// One request at a time per retailer host, with a minimum gap plus random jitter.
const nextSlot = new Map<string, number>();

export async function politeWait(host: string): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  const gap = config.COLLECT_MIN_DELAY_MS + Math.floor(Math.random() * config.COLLECT_JITTER_MS);
  nextSlot.set(host, slot + gap);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
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
  await politeWait(adapter.host);
  const fetchedAt = new Date();
  const res = await fetch(url, {
    headers: browserLikeHeaders(adapter),
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  return { method: 'http', status: res.status, finalUrl: res.url || url, html, fetchedAt };
}
