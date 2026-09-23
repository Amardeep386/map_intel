export type Availability = 'in_stock' | 'limited' | 'out_of_stock' | 'preorder' | 'unknown';

/** What an extractor read from one product page. Anything it could not read is null. */
export interface Extracted {
  title: string | null;
  price: number | null; // advertised (what a shopper pays now, before coupons)
  listPrice: number | null; // strike-through / "was" / list price if shown
  currency: string | null;
  availability: Availability;
  qty: number | null; // e.g. "Only 3 left"
  sellerName: string | null;
  sellerId: string | null;
  fulfilledBy: string | null;
  promoText: string | null;
  couponText: string | null;
  /** Which rules produced the values, for debugging extractor drift. */
  hits: Record<string, string>;
}

export function emptyExtracted(): Extracted {
  return {
    title: null,
    price: null,
    listPrice: null,
    currency: null,
    availability: 'unknown',
    qty: null,
    sellerName: null,
    sellerId: null,
    fulfilledBy: null,
    promoText: null,
    couponText: null,
    hits: {},
  };
}

export type BlockReason = 'captcha' | 'access_denied' | 'rate_limited' | 'geo_interstitial' | null;

export interface FetchResult {
  method: 'http' | 'browser';
  status: number;
  finalUrl: string;
  html: string;
  /** Present when the page was loaded in a browser (live screenshot of what was seen). */
  screenshot?: Buffer;
  fetchedAt: Date;
}

export interface SourceAdapter {
  code: string;
  host: string;
  /** Parse the product page. Must never throw on unexpected HTML; return nulls instead. */
  extract(html: string, url: string): Extracted;
  /** Detect bot walls / interstitials so we do not record them as prices. */
  detectBlock(html: string, status: number): BlockReason;
  /** Cookies that make the page render as a US shopper would see it (e.g. skip country splash). */
  cookies?: { name: string; value: string; domain: string }[];
}
