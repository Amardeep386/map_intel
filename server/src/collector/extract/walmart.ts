import type { BlockReason, DiscoveredItem, Extracted, ResultsPage } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, cleanText, genericBlock, normalizeAvailability, parsePrice } from './common.js';
import { conditionFrom, walkJson, withPage } from './results.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function nextData(html: string): Json | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Json;
  } catch {
    return null;
  }
}

export function extractWalmart(html: string): Extracted {
  const out = emptyExtracted();
  const data = nextData(html);
  const product: Json | undefined =
    data?.props?.pageProps?.initialData?.data?.product ?? data?.props?.pageProps?.initialData?.product;

  if (product) {
    out.hits.source = '__NEXT_DATA__.product';
    out.title = cleanText(product.name);
    const priceInfo: Json = product.priceInfo ?? {};
    out.price = parsePrice(priceInfo.currentPrice?.price ?? priceInfo.currentPrice?.priceString);
    if (out.price !== null) out.hits.price = 'priceInfo.currentPrice';
    out.listPrice = parsePrice(priceInfo.wasPrice?.price ?? priceInfo.listPrice?.price ?? priceInfo.strikethroughPrice?.price);
    out.currency = priceInfo.currentPrice?.currencyUnit ?? (out.price !== null ? 'USD' : null);
    const a = normalizeAvailability(product.availabilityStatus ?? product.availabilityStatusV2?.value);
    out.availability = a.availability;
    out.qty = a.qty;
    if (a.availability !== 'unknown') out.hits.availability = 'availabilityStatus';
    out.sellerName = cleanText(product.sellerDisplayName ?? product.sellerName, 120);
    out.sellerId = product.sellerId ? String(product.sellerId) : null;
    if (out.sellerName) out.hits.seller = 'sellerDisplayName';
    const fulfillment = product.fulfillmentType ?? product.fulfillmentLabel?.[0]?.message;
    out.fulfilledBy = cleanText(typeof fulfillment === 'string' ? fulfillment : null, 120);
    const badge = product.badges?.flags?.[0]?.text ?? priceInfo.savings?.savingsAmount?.priceString;
    if (badge) out.promoText = cleanText(String(badge), 200);
    out.imageUrl = product.imageInfo?.thumbnailUrl ?? product.imageInfo?.allImages?.[0]?.url ?? null;
    out.condition = conditionFrom(product.conditionV2?.name ?? product.conditionName ?? null) ?? (product.name ? 'new' : null);
    // Other sellers' offers load in the browser, not in this JSON: record that they exist.
    if (typeof product.additionalOfferCount === 'number') out.hits.otherOffers = String(product.additionalOfferCount);
  }

  // Walmart also prints "Sold and shipped by X" in the HTML; use it when the JSON has no seller.
  if (!out.sellerName) {
    const m = html.match(/Sold (?:and shipped )?by\s*(?:<[^>]+>\s*)*([^<]{2,80})</i);
    if (m) {
      out.sellerName = cleanText(m[1], 120);
      out.hits.seller = 'html:Sold by';
    }
  }

  return applyJsonLd(html, out);
}

export function detectWalmartBlock(html: string, status: number): BlockReason {
  // A page carrying the product JSON is a real product page, whatever else its head mentions.
  if (status < 400 && /"priceInfo"/.test(html) && /__NEXT_DATA__/.test(html)) return null;
  if (/Robot or human\?|px-captcha|\/blocked\?url=/i.test(html.slice(0, 50_000)) && !/__NEXT_DATA__/.test(html)) return 'captcha';
  return genericBlock(html, status);
}

export const walmartProductUrl = (itemId: string) => `https://www.walmart.com/ip/${itemId}`;

/**
 * Brand, browse and category pages: every product object in __NEXT_DATA__ (brand pages and
 * browse grids use different layouts; both carry usItemId + canonicalUrl). Sponsored cards are
 * kept (they are listings too) and marked.
 */
export function extractWalmartResults(html: string, url: string): ResultsPage {
  const data = nextData(html);
  const byId = new Map<string, DiscoveredItem>();
  walkJson(data, (o) => {
    const id = o.usItemId;
    const canonical = o.canonicalUrl;
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof canonical !== 'string' || !canonical.startsWith('/ip/')) return;
    const key = String(id);
    if (byId.has(key)) return;
    const price = o.price as Json | undefined;
    const priceInfo = o.priceInfo as Json | undefined;
    byId.set(key, {
      url: walmartProductUrl(key),
      channelSku: key,
      title: cleanText(typeof o.name === 'string' ? o.name : null),
      price: parsePrice(price?.price ?? priceInfo?.linePrice ?? (priceInfo?.currentPrice as Json | undefined)?.price),
      sellerName: cleanText(typeof o.sellerName === 'string' ? o.sellerName : null, 120),
      imageUrl: ((o.imageInfo as Json | undefined)?.thumbnailUrl as string | undefined) ?? (typeof o.image === 'string' ? o.image : null),
      condition: conditionFrom(((o.conditionV2 as Json | undefined)?.name as string | undefined) ?? null),
      format: o.isSponsoredFlag === true ? 'sponsored' : null,
    });
  });
  const items = [...byId.values()];
  const page = Number(new URL(url).searchParams.get('page') ?? '1') || 1;
  return { items, nextUrl: items.length >= 10 ? withPage(url, page + 1) : null, recognized: data !== null };
}
