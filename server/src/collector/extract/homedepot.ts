// Home Depot product pages (/p/<slug>/<9-digit id>) and browse pages (/b/...). Search (/s/) is
// disallowed by robots.txt. Home Depot sells first-party. Written against JSON-LD; verify on real US pages.
import type { BlockReason, Extracted, ResultsPage } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, findJsonLdProducts, genericBlock } from './common.js';
import { harvestResults, withPage } from './results.js';

export const homeDepotProductUrl = (id: string) => `https://www.homedepot.com/p/${id}`;

export function extractHomeDepot(html: string): Extracted {
  const out = applyJsonLd(html, emptyExtracted());
  const product = findJsonLdProducts(html)[0];
  const image = product?.image;
  out.imageUrl = typeof image === 'string' ? image : Array.isArray(image) && typeof image[0] === 'string' ? image[0] : null;
  if (out.price !== null) {
    out.sellerName ??= 'The Home Depot';
    out.hits.seller ??= 'default:The Home Depot';
    out.currency ??= 'USD';
    out.condition = 'new';
  }
  return out;
}

export function extractHomeDepotResults(html: string, url: string): ResultsPage {
  const page = harvestResults(html, url, { pattern: /homedepot\.com\/p\/(?:[^?#]*\/)?(\d{9})(?:[?#/]|$)/, canonical: (id) => homeDepotProductUrl(id), card: 'div[data-testid], div[data-component]' });
  // Browse pages page by item offset (Nao=24, 48, ...).
  const offset = Number(new URL(url).searchParams.get('Nao') ?? '0') || 0;
  return { ...page, nextUrl: page.items.length >= 20 ? withPage(url, offset + 24, 'Nao') : null };
}

export function detectHomeDepotBlock(html: string, status: number): BlockReason {
  return genericBlock(html, status);
}
