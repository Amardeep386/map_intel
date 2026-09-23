import type { Availability, BlockReason, Extracted } from '../types.js';

/** "$1,299.99" -> 1299.99 ; "1299" -> 1299 ; returns null for anything else. */
export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const value = Number.parseFloat(`${m[1].replace(/,/g, '')}.${m[2] ?? '0'}`);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

export function currencyFrom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  if (raw.includes('$')) return 'USD';
  return null;
}

export function normalizeAvailability(raw: unknown): { availability: Availability; qty: number | null } {
  if (raw === null || raw === undefined) return { availability: 'unknown', qty: null };
  const t = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return { availability: 'unknown', qty: null };
  const only = t.match(/only (\d+) left/);
  if (only) return { availability: 'limited', qty: Number.parseInt(only[1], 10) };
  if (/(pre-?order|preorder)/.test(t)) return { availability: 'preorder', qty: null };
  if (/(out ?of ?stock|outofstock|sold ?out|soldout|currently unavailable|unavailable|discontinued|not available|coming soon)/.test(t))
    return { availability: 'out_of_stock', qty: null };
  if (/(limited|low ?stock|limitedavailability)/.test(t)) return { availability: 'limited', qty: null };
  if (/(in ?stock|instock|in_stock|available|add to cart|ships|pickup today)/.test(t)) return { availability: 'in_stock', qty: null };
  return { availability: 'unknown', qty: null };
}

export function cleanText(raw: string | null | undefined, max = 300): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

/** Normalised model-number match: "MFHP4LL/A" matches "mfhp4lla" anywhere in the page text. */
export function modelMatches(html: string, model: string | null | undefined): boolean | null {
  if (!model) return null;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const needle = norm(model);
  if (needle.length < 4) return null;
  // Also accept the base model without a region suffix (e.g. OLED65C6PUA -> OLED65C6P, MFHP4LL/A -> MFHP4)
  const base = norm(model.split(/[/.]/)[0]);
  const hay = norm(html);
  return hay.includes(needle) || (base.length >= 6 && hay.includes(base));
}

// ---------------------------------------------------------------------------
// JSON-LD (schema.org Product / Offer) — used by all three retailers to some degree
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try {
      out.push(JSON.parse(body));
    } catch {
      // Some sites put several objects or trailing commas in one block; skip what we cannot parse.
    }
  }
  return out;
}

function walk(node: unknown, visit: (o: Json) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') {
    visit(node as Json);
    const o = node as Json;
    if (o['@graph']) walk(o['@graph'], visit);
  }
}

function hasType(o: Json, t: string): boolean {
  const type = o['@type'];
  return type === t || (Array.isArray(type) && type.includes(t));
}

export function findJsonLdProducts(html: string): Json[] {
  const products: Json[] = [];
  for (const block of jsonLdBlocks(html)) walk(block, (o) => hasType(o, 'Product') && products.push(o));
  return products;
}

/** Fill any empty fields of `into` from the first schema.org Product on the page. */
export function applyJsonLd(html: string, into: Extracted): Extracted {
  const product = findJsonLdProducts(html)[0];
  if (!product) return into;
  into.hits.jsonld = 'Product';
  if (!into.title && typeof product.name === 'string') into.title = cleanText(product.name);

  const offersRaw = product.offers;
  const offers: Json[] = Array.isArray(offersRaw) ? (offersRaw as Json[]) : offersRaw ? [offersRaw as Json] : [];
  const offer = offers[0];
  if (offer) {
    const price = parsePrice(offer.price ?? offer.lowPrice ?? (offer.priceSpecification as Json | undefined)?.price);
    if (into.price === null && price !== null) {
      into.price = price;
      into.hits.price = into.hits.price ?? 'jsonld.offers.price';
    }
    if (!into.currency && typeof offer.priceCurrency === 'string') into.currency = offer.priceCurrency;
    if (into.availability === 'unknown' && offer.availability) {
      const a = normalizeAvailability(String(offer.availability).split('/').pop());
      into.availability = a.availability;
      into.hits.availability = into.hits.availability ?? 'jsonld.offers.availability';
    }
    const seller = offer.seller as Json | undefined;
    if (!into.sellerName && seller && typeof seller.name === 'string') {
      into.sellerName = cleanText(seller.name);
      into.hits.seller = into.hits.seller ?? 'jsonld.offers.seller';
    }
  }
  return into;
}

/** Generic bot-wall detection shared by all retailers. */
export function genericBlock(html: string, status: number): BlockReason {
  if (status === 429) return 'rate_limited';
  const head = html.slice(0, 20_000).toLowerCase();
  if (/captcha|robot check|are you a robot|robot or human|px-captcha|verify you are human/.test(head)) return 'captcha';
  if (status === 403 || /access denied|pardon our interruption|request blocked/.test(head)) return 'access_denied';
  return null;
}
