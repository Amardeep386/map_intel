import * as cheerio from 'cheerio';
import type { BlockReason, Extracted } from '../types.js';
import { emptyExtracted } from '../types.js';
import { applyJsonLd, cleanText, genericBlock, normalizeAvailability, parsePrice } from './common.js';

type $ = cheerio.CheerioAPI;

function firstText($: $, selectors: string[]): { text: string; selector: string } | null {
  for (const sel of selectors) {
    const t = $(sel).first().text().replace(/\s+/g, ' ').trim();
    if (t) return { text: t, selector: sel };
  }
  return null;
}

const PRICE_SELECTORS = [
  '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
  '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
  '#apex_offerDisplay_desktop .a-price:not(.a-text-price) .a-offscreen',
  '#price_inside_buybox',
  '#newBuyBoxPrice',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#tp_price_block_total_price_ww .a-offscreen',
];

const LIST_PRICE_SELECTORS = [
  '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
  '#corePrice_feature_div .a-text-price[data-a-strike="true"] .a-offscreen',
  '.a-price.a-text-price[data-a-strike="true"] .a-offscreen',
  '#listPrice',
];

const SELLER_SELECTORS = [
  '#sellerProfileTriggerId',
  '#merchantInfoFeature_feature_div .offer-display-feature-text-message',
  '#tabular-buybox .tabular-buybox-container [tabular-attribute-name="Sold by"] .tabular-buybox-text',
  '#merchant-info a:first-of-type',
];

const SHIPS_FROM_SELECTORS = [
  '#fulfillerInfoFeature_feature_div .offer-display-feature-text-message',
  '#tabular-buybox .tabular-buybox-container [tabular-attribute-name="Ships from"] .tabular-buybox-text',
];

export function extractAmazon(html: string): Extracted {
  const out = emptyExtracted();
  const $ = cheerio.load(html);

  out.title = cleanText($('#productTitle').first().text());
  if (out.title) out.hits.title = '#productTitle';

  const price = firstText($, PRICE_SELECTORS);
  if (price) {
    out.price = parsePrice(price.text);
    out.currency = price.text.includes('$') ? 'USD' : null;
    out.hits.price = price.selector;
  }
  const list = firstText($, LIST_PRICE_SELECTORS);
  if (list) {
    out.listPrice = parsePrice(list.text);
    out.hits.listPrice = list.selector;
  }

  const avail = firstText($, ['#availability', '#outOfStock', '#availabilityInsideBuyBox_feature_div']);
  if (avail) {
    const a = normalizeAvailability(avail.text);
    out.availability = a.availability;
    out.qty = a.qty;
    out.hits.availability = avail.selector;
  } else if ($('#add-to-cart-button').length) {
    out.availability = 'in_stock';
    out.hits.availability = '#add-to-cart-button';
  }

  const seller = firstText($, SELLER_SELECTORS);
  if (seller) {
    out.sellerName = cleanText(seller.text, 120);
    out.hits.seller = seller.selector;
  }
  const sellerHref = $('#sellerProfileTriggerId').attr('href') ?? $('#merchant-info a').attr('href') ?? '';
  const sellerId = sellerHref.match(/[?&]seller=([A-Z0-9]+)/);
  if (sellerId) out.sellerId = sellerId[1];

  const shipsFrom = firstText($, SHIPS_FROM_SELECTORS);
  if (shipsFrom) out.fulfilledBy = cleanText(shipsFrom.text, 120);

  const coupon = firstText($, ['#promoPriceBlockMessage_feature_div', '#couponBadgeRegularVpc', '#vpcButton', '.couponLabelText']);
  if (coupon && /coupon|save|off/i.test(coupon.text)) out.couponText = cleanText(coupon.text, 200);

  const deal = firstText($, ['#dealBadge_feature_div', '#dealBadgeSupportingText', '.savingsPercentage']);
  if (deal) out.promoText = cleanText(deal.text, 200);

  // When the buy box has no winner Amazon shows "See All Buying Options": no advertised price.
  if (out.price === null && /see all buying options/i.test($('#buybox-see-all-buying-choices, #buybox').text())) {
    out.hits.note = 'no buy box winner (See All Buying Options)';
  }

  return applyJsonLd(html, out);
}

export function detectAmazonBlock(html: string, status: number): BlockReason {
  if (/action="\/errors\/validateCaptcha"/i.test(html) || /<title[^>]*>\s*(Robot Check|Amazon\.com)\s*<\/title>/i.test(html) && !/id="productTitle"/.test(html))
    return 'captcha';
  if (status === 503 && /api-services-support@amazon\.com|sorry! something went wrong/i.test(html)) return 'access_denied';
  // Outside the US Amazon may hide the buy box: "This item cannot be shipped to your selected delivery location."
  if (/cannot be shipped to your selected delivery location/i.test(html)) return 'geo_interstitial';
  return genericBlock(html, status);
}
