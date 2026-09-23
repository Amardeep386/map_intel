import type { BlockReason, Extracted } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, cleanText, genericBlock, normalizeAvailability, parsePrice } from './common.js';

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
  if (/Robot or human\?|px-captcha|\/blocked\?url=/i.test(html.slice(0, 50_000)) && !/__NEXT_DATA__/.test(html)) return 'captcha';
  return genericBlock(html, status);
}
