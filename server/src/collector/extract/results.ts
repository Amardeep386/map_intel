// Search / browse results pages. Listings are found by their product-URL pattern (robust to card
// layout changes); titles, prices and images are taken from the card when they can be read.
// Results prices are hints for the matcher only: an observation always comes from the product page.
import * as cheerio from 'cheerio';
import type { Condition, DiscoveredItem, ResultsPage } from '../types.js';
import { cleanText, parsePrice } from './common.js';

type Json = Record<string, unknown>;

/** The JSON in <script id="__NEXT_DATA__"> (Walmart, Target), or null. */
export function nextData(html: string): Json | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Json;
  } catch {
    return null;
  }
}

/** Visit every object in a JSON tree. */
export function walkJson(node: unknown, visit: (o: Json) => void): void {
  if (Array.isArray(node)) for (const n of node) walkJson(n, visit);
  else if (node && typeof node === 'object') {
    visit(node as Json);
    for (const v of Object.values(node as Json)) walkJson(v, visit);
  }
}

/** The same URL with ?page=n (or the source's own page parameter). */
export function withPage(url: string, page: number, param = 'page'): string {
  const u = new URL(url);
  if (page <= 1) u.searchParams.delete(param);
  else u.searchParams.set(param, String(page));
  return u.href;
}

export function conditionFrom(text: string | null | undefined): Condition | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/open[ -]?box/.test(t)) return 'open_box';
  if (/refurb|renewed|restored|remanufactured/.test(t)) return 'refurbished';
  if (/pre-?owned|used/.test(t)) return 'used';
  if (/\bnew\b|brand new/.test(t)) return 'new';
  return null;
}

export interface HarvestOptions {
  /** Matches a product link; the first group that matched is the retailer's id for the product. */
  pattern: RegExp;
  /** Canonical product URL from the id (drops tracking parameters and slugs). */
  canonical: (id: string, href: string) => string;
  /** Selector of the element that holds one result card, to read title / price / image from. */
  card?: string;
}

/**
 * Every distinct product link on a results page, in page order, with what the card around it says.
 * `recognized` is false when the page has none of the expected links and no "no results" wording.
 */
export function harvestResults(html: string, pageUrl: string, o: HarvestOptions): ResultsPage {
  const $ = cheerio.load(html);
  const byId = new Map<string, DiscoveredItem>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    let abs: string;
    try {
      abs = new URL(href, pageUrl).href;
    } catch {
      return;
    }
    const m = abs.match(o.pattern);
    const id = m?.slice(1).find(Boolean);
    if (!id) return;
    const card = o.card ? $(el).closest(o.card) : $(el).parent();
    const title = cleanText($(el).attr('title') ?? $(el).attr('aria-label') ?? $(el).text()) ?? cleanText(card.find('img[alt]').first().attr('alt'));
    const existing = byId.get(id);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      return;
    }
    const cardText = card.text().replace(/\s+/g, ' ');
    byId.set(id, {
      url: o.canonical(id, abs),
      channelSku: id,
      title,
      price: parsePrice(cardText.match(/\$\s?\d[\d,]*(?:\.\d{2})?/)?.[0]),
      sellerName: null,
      imageUrl: card.find('img[src^="http"]').first().attr('src') ?? null,
      condition: conditionFrom(title),
      format: /sponsored/i.test(cardText) ? 'sponsored' : null,
    });
  });
  const items = [...byId.values()];
  const noResults = /no results|0 results|did not match any|we couldn.t find|no items found/i.test(html);
  return { items, nextUrl: null, recognized: items.length > 0 || noResults };
}
