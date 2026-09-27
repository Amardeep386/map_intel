// Target product pages (/p/<slug>/-/A-<tcin>) and brand pages (/b/...). Search (/s) is disallowed.
// Prices render client-side, so Target goes to the headless browser first. Written against
// JSON-LD and Target's price markers; verify on real US pages.
import type { BlockReason, Extracted, ResultsPage } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, cleanText, genericBlock, parsePrice } from './common.js';
import { harvestResults } from './results.js';

export const targetProductUrl = (tcin: string) => `https://www.target.com/p/-/A-${tcin}`;

export function extractTarget(html: string): Extracted {
  const out = emptyExtracted();
  // Rendered price element, then the preloaded product JSON.
  const shown = html.match(/data-test="product-price"[^>]*>\s*(?:<[^>]+>\s*)*\$?([\d,]+\.\d{2})/i);
  if (shown) {
    out.price = parsePrice(shown[1]);
    out.hits.price = 'data-test=product-price';
  }
  if (out.price === null) {
    const m = html.match(/\?"current_retail\?"\s*:\s*([\d.]+)/);
    if (m) {
      out.price = parsePrice(m[1]);
      out.hits.price = 'current_retail';
    }
  }
  const reg = html.match(/\?"reg_retail\?"\s*:\s*([\d.]+)/);
  if (reg) out.listPrice = parsePrice(reg[1]);
  const title = html.match(/<h1[^>]*data-test="product-title"[^>]*>([\s\S]*?)<\/h1>/i);
  if (title) out.title = cleanText(title[1].replace(/<[^>]+>/g, ''));
  // Target Plus partners: "Sold & shipped by X". Otherwise Target sells it.
  const partner = html.match(/Sold (?:&amp;|&|and) shipped by\s*(?:<[^>]+>\s*)*([^<]{2,80})</i);
  out.sellerName = partner ? cleanText(partner[1], 120) : out.price !== null ? 'Target' : null;
  if (out.sellerName) out.hits.seller = partner ? 'html:Sold & shipped by' : 'default:Target';
  applyJsonLd(html, out);
  if (out.price !== null && !out.currency) out.currency = 'USD';
  if (out.price !== null && !out.condition) out.condition = 'new';
  return out;
}

export function extractTargetResults(html: string, url: string): ResultsPage {
  return harvestResults(html, url, { pattern: /target\.com\/p\/[^?#]*?\/-\/A-(\d{6,10})/, canonical: (id) => targetProductUrl(id), card: 'div[data-test]' });
}

export function detectTargetBlock(html: string, status: number): BlockReason {
  return genericBlock(html, status);
}
