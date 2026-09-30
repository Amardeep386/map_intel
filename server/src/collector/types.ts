export type Condition = 'new' | 'used' | 'refurbished' | 'open_box';

/** Why a fetch or extraction did not produce a price (source health, retries). */
export const FAILURE_CLASSES = ['blocked', 'layout_changed', 'timeout', 'empty', 'auth', 'robots', 'network', 'not_found'] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

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
  condition: Condition | null;
  imageUrl: string | null;
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
    condition: null,
    imageUrl: null,
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

/** One listing seen on a search or browse results page (discovery). */
export interface DiscoveredItem {
  url: string; // canonical product (or offer) URL
  channelSku: string | null;
  title: string | null;
  price: number | null;
  sellerName: string | null;
  imageUrl: string | null;
  condition: Condition | null;
  format: string | null; // e.g. auction, buy_it_now, sponsored
}

export interface ResultsPage {
  items: DiscoveredItem[];
  /** Next results page, when the page links one (already absolute). */
  nextUrl: string | null;
  /** False when the page did not have the results structure at all (layout changed, not "no results"). */
  recognized: boolean;
}

/** One seller's offer on a product page (all-sellers capture). Rank 1 is the buy box / main offer. */
export interface Offer {
  url: string; // canonical offer URL: its own listing
  sellerName: string | null;
  sellerId: string | null;
  price: number | null;
  listPrice: number | null;
  currency: string | null;
  condition: Condition | null;
  availability: Availability;
  fulfilledBy: string | null;
  rank: number;
}

export interface SourceAdapter {
  code: string;
  host: string;
  /** Search results URL for a query, when the source has search and robots.txt allows it. */
  searchUrl?(query: string, page: number): string;
  /** A product page URL from the source's own id (ASIN, item id, SKU). */
  productUrl?(channelSku: string): string;
  /** True for product pages; false for search / browse pages on the same host. */
  isProductUrl?(url: string): boolean;
  /** Read a search or browse results page. Must never throw. */
  extractResults?(html: string, url: string): ResultsPage;
  /** Every seller's offer on a product page (beyond the main one). Must never throw. */
  extractOffers?(html: string, url: string): Offer[];
  /**
   * Go straight to the browser (product and results pages): the page never shows a price without
   * JavaScript, or the screenshot must be the live page (Amazon, decision 32).
   */
  browserFirst?: boolean;
  /** Pace for this host, instead of COLLECT_MIN_DELAY_MS / COLLECT_JITTER_MS. */
  pace?: { minDelayMs: number; jitterMs: number };
  /**
   * Before the screenshot, scroll down to the first of these elements in a few steps and back
   * to the top, as a shopper would look at the offer (and lazy parts of the page load).
   */
  scrollTo?: string[];
  /** A blocked page is final: never re-read through the browser (decision 34). */
  noRetryOnBlock?: boolean;
  /** Parse the product page. Must never throw on unexpected HTML; return nulls instead. */
  extract(html: string, url: string): Extracted;
  /** Detect bot walls / interstitials so we do not record them as prices. */
  detectBlock(html: string, status: number): BlockReason;
  /** Cookies that make the page render as a US shopper would see it (e.g. skip country splash). */
  cookies?: { name: string; value: string; domain: string }[];
}
