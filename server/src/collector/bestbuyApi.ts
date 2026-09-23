// Optional: Best Buy Products API (https://developer.bestbuy.com). Used for price and stock when
// BESTBUY_API_KEY is set; the product page is still fetched for evidence.
import { config } from '../lib/config.js';
import type { Extracted } from './types.js';
import { emptyExtracted } from './types.js';

interface BbProduct {
  sku: number;
  name: string;
  salePrice: number | null;
  regularPrice: number | null;
  onlineAvailability: boolean;
  orderable: string | null;
  modelNumber: string | null;
  marketplace?: boolean | null;
  sellerId?: string | null;
}

export function bestBuyApiEnabled(): boolean {
  return Boolean(config.BESTBUY_API_KEY);
}

export async function bestBuyApiLookup(opts: { sku?: string | null; model?: string | null }): Promise<Extracted | null> {
  if (!config.BESTBUY_API_KEY) return null;
  const filter = opts.sku ? `sku=${encodeURIComponent(opts.sku)}` : opts.model ? `modelNumber=${encodeURIComponent(opts.model)}` : null;
  if (!filter) return null;
  const show = 'sku,name,salePrice,regularPrice,onlineAvailability,orderable,modelNumber,marketplace,sellerId';
  const url = `https://api.bestbuy.com/v1/products(${filter})?apiKey=${config.BESTBUY_API_KEY}&show=${show}&format=json&pageSize=5`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Best Buy API ${res.status}`);
  const body = (await res.json()) as { products?: BbProduct[] };
  const p = body.products?.[0];
  if (!p) return null;
  const out = emptyExtracted();
  out.title = p.name;
  out.price = p.salePrice ?? null;
  out.listPrice = p.regularPrice ?? null;
  out.currency = 'USD';
  out.availability = p.onlineAvailability ? 'in_stock' : p.orderable === 'PreOrder' ? 'preorder' : 'out_of_stock';
  out.sellerName = p.marketplace ? `Marketplace seller ${p.sellerId ?? ''}`.trim() : 'Best Buy';
  out.sellerId = p.sellerId ?? null;
  out.hits = { source: 'bestbuy-api', sku: String(p.sku) };
  return out;
}
