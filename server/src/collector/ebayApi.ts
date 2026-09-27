// Optional: eBay Browse API (official). Used when EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are set:
// keyword search (which robots.txt does not allow on the website) and item price / seller.
// The item page is still fetched for evidence.
import { config } from '../lib/config.js';
import { ApiAuthError } from './apiError.js';
import { conditionFrom } from './extract/results.js';
import { emptyExtracted, type DiscoveredItem, type Extracted } from './types.js';

const API = 'https://api.ebay.com';
let token: { value: string; expiresAt: number } | null = null;

export function ebayApiEnabled(): boolean {
  return Boolean(config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET);
}

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetchImpl(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new ApiAuthError('eBay OAuth', res.status);
  if (!res.ok) throw new Error(`eBay OAuth ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function get<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    headers: { authorization: `Bearer ${await accessToken(fetchImpl)}`, 'x-ebay-c-marketplace-id': 'EBAY_US' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new ApiAuthError('eBay Browse API', res.status);
  if (!res.ok) throw new Error(`eBay Browse API ${res.status}`);
  return (await res.json()) as T;
}

interface Summary {
  itemId: string; // "v1|123456789012|0"
  legacyItemId?: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  seller?: { username: string };
  image?: { imageUrl: string };
  buyingOptions?: string[];
}

const legacyId = (s: Summary) => s.legacyItemId ?? s.itemId.split('|')[1] ?? s.itemId;

/** Keyword search, Buy It Now only (an auction bid is not an advertised price), new only when asked. */
export async function ebayApiSearch(
  q: string,
  opts: { newOnly: boolean; limit?: number; offset?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredItem[]> {
  const filter = ['buyingOptions:{FIXED_PRICE}', ...(opts.newOnly ? ['conditionIds:{1000}'] : [])].join(',');
  const params = new URLSearchParams({ q, filter, limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0) });
  const body = await get<{ itemSummaries?: Summary[] }>(`/buy/browse/v1/item_summary/search?${params}`, fetchImpl);
  return (body.itemSummaries ?? []).map((s) => ({
    url: `https://www.ebay.com/itm/${legacyId(s)}`,
    channelSku: legacyId(s),
    title: s.title,
    price: s.price ? Number(s.price.value) : null,
    sellerName: s.seller?.username ?? null,
    imageUrl: s.image?.imageUrl ?? null,
    condition: conditionFrom(s.condition),
    format: s.buyingOptions?.includes('AUCTION') ? 'auction' : 'buy_it_now',
  }));
}

/** Price, seller and condition of one item by its legacy id. */
export async function ebayApiItem(itemId: string, fetchImpl: typeof fetch = fetch): Promise<Extracted> {
  const s = await get<Summary & { estimatedAvailabilities?: { estimatedAvailabilityStatus?: string }[] }>(
    `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`,
    fetchImpl,
  );
  const out = emptyExtracted();
  out.title = s.title;
  out.price = s.price ? Number(s.price.value) : null;
  out.currency = s.price?.currency ?? null;
  out.sellerName = s.seller?.username ?? null;
  out.sellerId = s.seller?.username ?? null;
  out.condition = conditionFrom(s.condition);
  out.imageUrl = s.image?.imageUrl ?? null;
  const st = s.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus;
  out.availability = st === 'IN_STOCK' ? 'in_stock' : st === 'LIMITED_STOCK' ? 'limited' : st === 'OUT_OF_STOCK' ? 'out_of_stock' : 'unknown';
  out.hits = { source: 'ebay-api', format: s.buyingOptions?.includes('AUCTION') ? 'auction' : 'buy_it_now' };
  return out;
}

/** For tests. */
export function resetEbayToken(): void {
  token = null;
}
