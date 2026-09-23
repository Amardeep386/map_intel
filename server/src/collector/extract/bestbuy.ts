import * as cheerio from 'cheerio';
import type { BlockReason, Extracted } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, cleanText, genericBlock, normalizeAvailability, parsePrice } from './common.js';

// Best Buy's product pages carry a schema.org Product in JSON-LD. The DOM selectors below are
// the fallback for when the JSON-LD is missing or has no offer (and cover the marketplace
// "Sold by" line, which JSON-LD does not always include).
export function extractBestBuy(html: string): Extracted {
  const out = applyJsonLd(html, emptyExtracted());
  const $ = cheerio.load(html);

  if (!out.title) {
    out.title = cleanText($('h1').first().text());
    if (out.title) out.hits.title = 'h1';
  }

  if (out.price === null) {
    for (const sel of [
      '[data-testid="customer-price"] span[aria-hidden="true"]',
      '[data-testid="customer-price"] span',
      '.priceView-customer-price span[aria-hidden="true"]',
      '.priceView-customer-price span',
    ]) {
      const p = parsePrice($(sel).first().text());
      if (p !== null) {
        out.price = p;
        out.currency = 'USD';
        out.hits.price = sel;
        break;
      }
    }
  }
  if (out.price === null) {
    const m = html.match(/"customerPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/) ?? html.match(/"currentPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (m) {
      out.price = parsePrice(Number.parseFloat(m[1]));
      out.currency = 'USD';
      out.hits.price = 'inline-json:customerPrice';
    }
  }

  if (out.listPrice === null) {
    const was = $('[data-testid="regular-price"], .pricing-price__regular-price').first().text();
    out.listPrice = parsePrice(was.replace(/was/i, ''));
    if (out.listPrice === null) {
      const m = html.match(/"regularPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
      if (m) out.listPrice = parsePrice(Number.parseFloat(m[1]));
    }
  }

  const button = $('[data-button-state], .add-to-cart-button, button[data-sku-id]').first();
  const buttonState = button.attr('data-button-state') ?? button.text();
  if (buttonState) {
    const a = normalizeAvailability(buttonState.replace(/_/g, ' '));
    if (a.availability !== 'unknown') {
      out.availability = a.availability;
      out.hits.availability = 'add-to-cart button';
    }
  }

  // Marketplace listings say "Sold by <seller>"; Best Buy's own stock does not.
  const soldBy = html.match(/Sold by\s*(?:<[^>]+>\s*)*([^<]{2,80})</i);
  if (soldBy) {
    out.sellerName = cleanText(soldBy[1], 120);
    out.hits.seller = 'html:Sold by';
  }
  if (!out.sellerName && out.price !== null) {
    out.sellerName = 'Best Buy';
    out.hits.seller = 'default:first-party';
  }

  return out;
}

export function detectBestBuyBlock(html: string, status: number): BlockReason {
  // Visitors outside the US get a "Choose a country" splash instead of the product page.
  if (/Choose a country|international\.bestbuy|intl-splash/i.test(html.slice(0, 30_000)) && !/"@type"\s*:\s*"Product"/.test(html))
    return 'geo_interstitial';
  return genericBlock(html, status);
}
