// Optional: eBay Browse API (official). Used when EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are set:
// keyword search (which robots.txt does not allow on the website) and item price / seller.
// The API response is stored as evidence (decision 36); the item page is still tried for a screenshot.
import { config } from '../lib/config.js';
import { ApiAuthError } from './apiError.js';
import { conditionFrom } from './extract/results.js';
import { emptyExtracted, type ApiRead, type DiscoveredItem, type Extracted, type ResultsPage } from './types.js';

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

/** One Browse API call; the raw body is kept, because it is the evidence (decision 36). */
async function getRaw(pathOrUrl: string, fetchImpl: typeof fetch): Promise<{ status: number; body: string; fetchedAt: Date }> {
  const res = await fetchImpl(pathOrUrl.startsWith('https://') ? pathOrUrl : `${API}${pathOrUrl}`, {
    headers: { authorization: `Bearer ${await accessToken(fetchImpl)}`, 'x-ebay-c-marketplace-id': 'EBAY_US' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new ApiAuthError('eBay Browse API', res.status);
  if (!res.ok) throw new Error(`eBay Browse API ${res.status}`);
  return { status: res.status, body: await res.text(), fetchedAt: new Date() };
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

const PAGE_SIZE = 50;

/** The Browse API search for a query, Buy It Now only (an auction bid is not an advertised price). */
export function ebayApiSearchUrl(q: string, page = 1, opts: { newOnly?: boolean } = {}): string {
  const filter = ['buyingOptions:{FIXED_PRICE}', ...(opts.newOnly ? ['conditionIds:{1000}'] : [])].join(',');
  const params = new URLSearchParams({ q, filter, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  return `${API}/buy/browse/v1/item_summary/search?${params}`;
}

export function isEbayApiUrl(url: string): boolean {
  return url.startsWith(`${API}/buy/browse/`);
}

function toItem(s: Summary): DiscoveredItem {
  return {
    url: `https://www.ebay.com/itm/${legacyId(s)}`,
    channelSku: legacyId(s),
    title: s.title,
    price: s.price ? Number(s.price.value) : null,
    sellerName: s.seller?.username ?? null,
    imageUrl: s.image?.imageUrl ?? null,
    condition: conditionFrom(s.condition),
    format: s.buyingOptions?.includes('AUCTION') ? 'auction' : 'buy_it_now',
  };
}

/** A search response as a results page. A body without `total` is not a search response. */
export function parseEbaySearch(body: string): ResultsPage {
  let json: { total?: number; next?: string; itemSummaries?: Summary[] };
  try {
    json = JSON.parse(body);
  } catch {
    return { items: [], nextUrl: null, recognized: false };
  }
  return { items: (json.itemSummaries ?? []).map(toItem), nextUrl: json.next ?? null, recognized: typeof json.total === 'number' };
}

/** One search results page read through the API (discovery). */
export async function ebayApiReadResults(url: string, fetchImpl: typeof fetch = fetch): Promise<ApiRead & { page: ResultsPage }> {
  const raw = await getRaw(url, fetchImpl);
  return { ...raw, url, page: parseEbaySearch(raw.body) };
}

/** Keyword search, Buy It Now only, new only when asked. */
export async function ebayApiSearch(
  q: string,
  opts: { newOnly: boolean; page?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredItem[]> {
  return (await ebayApiReadResults(ebayApiSearchUrl(q, opts.page ?? 1, opts), fetchImpl)).page.items;
}

/** Price, seller and condition of one item by its legacy id, with the raw response (the evidence). */
export async function ebayApiItem(itemId: string, fetchImpl: typeof fetch = fetch): Promise<Extracted & { api: ApiRead }> {
  const url = `${API}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`;
  const raw = await getRaw(url, fetchImpl);
  const s = JSON.parse(raw.body) as Summary & { estimatedAvailabilities?: { estimatedAvailabilityStatus?: string }[] };
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
  return { ...out, api: { ...raw, url } };
}

/** For tests. */
export function resetEbayToken(): void {
  token = null;
}
