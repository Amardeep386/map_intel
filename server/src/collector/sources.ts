import { detectAmazonBlock, extractAmazon } from './extract/amazon.js';
import { detectBestBuyBlock, extractBestBuy } from './extract/bestbuy.js';
import { detectWalmartBlock, extractWalmart } from './extract/walmart.js';
import type { SourceAdapter } from './types.js';

export const adapters: Record<string, SourceAdapter> = {
  amazon_us: {
    code: 'amazon_us',
    host: 'www.amazon.com',
    extract: (html) => extractAmazon(html),
    detectBlock: detectAmazonBlock,
    // Ask for US English / USD. (Delivery location still follows the requester's IP.)
    cookies: [
      { name: 'i18n-prefs', value: 'USD', domain: '.amazon.com' },
      { name: 'lc-main', value: 'en_US', domain: '.amazon.com' },
    ],
  },
  bestbuy_us: {
    code: 'bestbuy_us',
    host: 'www.bestbuy.com',
    extract: (html) => extractBestBuy(html),
    detectBlock: detectBestBuyBlock,
    // Skip the "choose a country" splash shown to non-US visitors.
    cookies: [{ name: 'intl_splash', value: 'false', domain: '.bestbuy.com' }],
  },
  walmart_us: {
    code: 'walmart_us',
    host: 'www.walmart.com',
    extract: (html) => extractWalmart(html),
    detectBlock: detectWalmartBlock,
  },
};

export function adapterFor(sourceCode: string): SourceAdapter {
  const a = adapters[sourceCode];
  if (!a) throw new Error(`no collector for source ${sourceCode}`);
  return a;
}

/** ASIN / Best Buy SKU / Walmart item id from a product URL (null if not present). */
export function channelSkuFromUrl(sourceCode: string, url: string): string | null {
  switch (sourceCode) {
    case 'amazon_us':
      return url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ?? null;
    case 'bestbuy_us':
      return url.match(/\/sku\/(\d{6,})/)?.[1] ?? url.match(/[?&]skuId=(\d{6,})/)?.[1] ?? url.match(/\/(\d{7})\.p/)?.[1] ?? null;
    case 'walmart_us':
      return url.match(/\/ip\/(?:[^/]+\/)?(\d{5,})/)?.[1] ?? null;
    default:
      return null;
  }
}
