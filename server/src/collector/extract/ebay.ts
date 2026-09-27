// eBay item pages (/itm/<id>) and browse pages (/b/...). Search (/sch/) is disallowed by robots.txt.
// Written against schema.org JSON-LD and eBay's stable markers; verify on real US pages.
import type { BlockReason, Extracted, ResultsPage } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, cleanText, findJsonLdProducts, genericBlock } from './common.js';
import { conditionFrom, harvestResults, withPage } from './results.js';

export const ebayItemUrl = (id: string) => `https://www.ebay.com/itm/${id}`;

export function extractEbay(html: string): Extracted {
  const out = applyJsonLd(html, emptyExtracted());
  const product = findJsonLdProducts(html)[0];
  const offer = (Array.isArray(product?.offers) ? product.offers[0] : product?.offers) as Record<string, unknown> | undefined;
  if (typeof offer?.itemCondition === 'string') {
    out.condition = conditionFrom(offer.itemCondition.split('/').pop()?.replace(/Condition$/, ''));
    out.hits.condition = 'jsonld.itemCondition';
  }
  const image = product?.image;
  out.imageUrl = typeof image === 'string' ? image : Array.isArray(image) && typeof image[0] === 'string' ? image[0] : null;
  // Seller: the store / user link in the seller card.
  if (!out.sellerName) {
    const m = html.match(/href="https:\/\/www\.ebay\.com\/(?:str|usr)\/([^"?/]+)[^"]*"/i);
    if (m) {
      out.sellerName = cleanText(decodeURIComponent(m[1]), 120);
      out.sellerId = out.sellerName;
      out.hits.seller = 'html:str|usr link';
    }
  }
  // Auctions show a bid price, not an advertised price: keep it, marked, so rules can skip it.
  if (/"bidCount"|place bid|"AUCTION"/i.test(html) && !/buy it now/i.test(html)) out.hits.format = 'auction';
  else out.hits.format = 'buy_it_now';
  if (out.price !== null && !out.currency) out.currency = 'USD';
  return out;
}

export function extractEbayResults(html: string, url: string): ResultsPage {
  const page = harvestResults(html, url, { pattern: /ebay\.com\/itm\/(?:[^/?#]+\/)?(\d{9,14})/, canonical: (id) => ebayItemUrl(id), card: 'li' });
  const n = Number(new URL(url).searchParams.get('_pgn') ?? '1') || 1;
  return { ...page, nextUrl: page.items.length >= 20 ? withPage(url, n + 1, '_pgn') : null };
}

export function detectEbayBlock(html: string, status: number): BlockReason {
  if (/Pardon Our Interruption|splashui\/challenge|captcha/i.test(html.slice(0, 30_000)) && !/"@type"\s*:\s*"Product"/.test(html)) return 'captcha';
  return genericBlock(html, status);
}
