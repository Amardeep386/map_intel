// What one term means on one source: a search page, a brand/browse page, a product page, or
// nothing. Pure (no I/O); robots.txt is still checked when the job runs.
import type { SourceAdapter } from './types.js';

export type TermType = 'keyword' | 'brand' | 'identifier' | 'url' | 'seller';

export type TermPlan =
  | { kind: 'search'; url: string; query: string }
  | { kind: 'browse'; url: string }
  | { kind: 'product'; url: string }
  /** Recorded on the run as a skipped job (visible in Data Health). */
  | { kind: 'skip'; reason: 'not_executable' | 'no_collector' }
  /** The term belongs to another source (a URL or retailer id elsewhere): not work for this one. */
  | { kind: 'ignore' };

const ASIN = /^B0[A-Z0-9]{8}$/i;

/** A retailer's own id for a product on `source`, recognisable from its shape. */
export function channelSkuFor(source: string, value: string): string | null {
  const v = value.trim();
  if (source === 'amazon_us') return ASIN.test(v) ? v.toUpperCase() : null;
  return null;
}

/** Ids that clearly belong to one source (an ASIN is never a Walmart id or a model number). */
function foreignId(source: string, value: string): boolean {
  return source !== 'amazon_us' && ASIN.test(value.trim());
}

function sameHost(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return strip(a) === strip(b);
}

export function planTerm(adapter: SourceAdapter | undefined, source: string, term: { type: TermType; value: string }): TermPlan {
  if (term.type === 'url') {
    let url: URL;
    try {
      url = new URL(term.value);
    } catch {
      return { kind: 'ignore' };
    }
    if (!adapter) return { kind: 'ignore' };
    if (!sameHost(url.host, adapter.host)) return { kind: 'ignore' };
    return adapter.isProductUrl?.(url.href) ? { kind: 'product', url: url.href } : { kind: 'browse', url: url.href };
  }
  if (!adapter) return { kind: 'skip', reason: 'no_collector' };
  if (term.type === 'identifier') {
    if (foreignId(source, term.value)) return { kind: 'ignore' };
    const sku = channelSkuFor(source, term.value);
    if (sku && adapter.productUrl) return { kind: 'product', url: adapter.productUrl(sku) };
  }
  if (term.type === 'seller') return { kind: 'skip', reason: 'not_executable' };
  if (!adapter.searchUrl) return { kind: 'skip', reason: 'not_executable' };
  return { kind: 'search', url: adapter.searchUrl(term.value, 1), query: term.value };
}
