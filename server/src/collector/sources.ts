import { amazonProductUrl, detectAmazonBlock, extractAmazon, extractAmazonResults } from './extract/amazon.js';
import { bestBuyProductUrl, bestBuySearchUrl, detectBestBuyBlock, extractBestBuy, extractBestBuyResults } from './extract/bestbuy.js';
import { detectEbayBlock, ebayItemUrl, extractEbay, extractEbayResults } from './extract/ebay.js';
import { detectHomeDepotBlock, extractHomeDepot, extractHomeDepotResults, homeDepotProductUrl } from './extract/homedepot.js';
import { withPage } from './extract/results.js';
import { detectTargetBlock, extractTarget, extractTargetResults, targetProductUrl } from './extract/target.js';
import { detectWalmartBlock, extractWalmart, extractWalmartResults, walmartProductUrl } from './extract/walmart.js';
import type { SourceAdapter } from './types.js';

// Search is declared only where robots.txt allows it (checked 27 Sep 2026): Amazon /s and Best Buy
// searchpage.jsp. Walmart /search, eBay /sch, Target /s and Home Depot /s are disallowed, so those
// sources discover through brand / browse pages (url terms). robots.txt is still checked per request.
export const adapters: Record<string, SourceAdapter> = {
  amazon_us: {
    code: 'amazon_us',
    host: 'www.amazon.com',
    extract: (html) => extractAmazon(html),
    detectBlock: detectAmazonBlock,
    searchUrl: (q, page) => withPage(`https://www.amazon.com/s?k=${encodeURIComponent(q)}`, page),
    productUrl: amazonProductUrl,
    isProductUrl: (u) => /\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(u),
    extractResults: extractAmazonResults,
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
    searchUrl: bestBuySearchUrl,
    productUrl: bestBuyProductUrl,
    isProductUrl: (u) => /\/\d{7}\.p|\/sku\/\d{7}/.test(u),
    extractResults: extractBestBuyResults,
    // Skip the "choose a country" splash shown to non-US visitors.
    cookies: [{ name: 'intl_splash', value: 'false', domain: '.bestbuy.com' }],
  },
  walmart_us: {
    code: 'walmart_us',
    host: 'www.walmart.com',
    extract: (html) => extractWalmart(html),
    detectBlock: detectWalmartBlock,
    productUrl: walmartProductUrl,
    isProductUrl: (u) => /\/ip\/(?!seller-offers)/.test(u),
    extractResults: extractWalmartResults,
  },
  ebay_us: {
    code: 'ebay_us',
    host: 'www.ebay.com',
    extract: (html) => extractEbay(html),
    detectBlock: detectEbayBlock,
    productUrl: ebayItemUrl,
    isProductUrl: (u) => /\/itm\/(?:[^/?#]+\/)?\d{9,14}/.test(u),
    extractResults: extractEbayResults,
  },
  target_us: {
    code: 'target_us',
    host: 'www.target.com',
    extract: (html) => extractTarget(html),
    detectBlock: detectTargetBlock,
    productUrl: targetProductUrl,
    isProductUrl: (u) => /\/p\/.*A-\d{6,10}/.test(u),
    extractResults: extractTargetResults,
    browserFirst: true,
  },
  homedepot_us: {
    code: 'homedepot_us',
    host: 'www.homedepot.com',
    extract: (html) => extractHomeDepot(html),
    detectBlock: detectHomeDepotBlock,
    productUrl: homeDepotProductUrl,
    isProductUrl: (u) => /\/p\/(?:[^?#]*\/)?\d{9}(?:[?#/]|$)/.test(u),
    extractResults: extractHomeDepotResults,
  },
};

export function adapterFor(sourceCode: string): SourceAdapter {
  const a = adapters[sourceCode];
  if (!a) throw new Error(`no collector for source ${sourceCode}`);
  return a;
}

/** The retailer's own id from a product URL (null if not present). */
export function channelSkuFromUrl(sourceCode: string, url: string): string | null {
  switch (sourceCode) {
    case 'amazon_us':
      return url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ?? null;
    case 'bestbuy_us':
      return url.match(/\/sku\/(\d{6,})/)?.[1] ?? url.match(/[?&]skuId=(\d{6,})/)?.[1] ?? url.match(/\/(\d{7})\.p/)?.[1] ?? null;
    case 'walmart_us':
      return url.match(/\/ip\/(?:[^/]+\/)?(\d{5,})/)?.[1] ?? null;
    case 'ebay_us':
      return url.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,14})/)?.[1] ?? null;
    case 'target_us':
      return url.match(/A-(\d{6,10})/)?.[1] ?? null;
    case 'homedepot_us':
      return url.match(/\/p\/(?:[^?#]*\/)?(\d{9})(?:[?#/]|$)/)?.[1] ?? null;
    default:
      return null;
  }
}
