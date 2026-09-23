// Extractor unit tests on small synthetic pages (no network).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAmazon, detectAmazonBlock } from '../src/collector/extract/amazon.js';
import { extractBestBuy, detectBestBuyBlock } from '../src/collector/extract/bestbuy.js';
import { modelMatches, normalizeAvailability, parsePrice } from '../src/collector/extract/common.js';
import { extractWalmart, detectWalmartBlock } from '../src/collector/extract/walmart.js';
import { isAllowed, parseRobots } from '../src/collector/robots.js';
import { channelSkuFromUrl } from '../src/collector/sources.js';

test('parsePrice', () => {
  assert.equal(parsePrice('$1,299.99'), 1299.99);
  assert.equal(parsePrice('USD 249'), 249);
  assert.equal(parsePrice(179.0), 179);
  assert.equal(parsePrice('Currently unavailable'), null);
  assert.equal(parsePrice(0), null);
});

test('normalizeAvailability', () => {
  assert.deepEqual(normalizeAvailability('In Stock'), { availability: 'in_stock', qty: null });
  assert.deepEqual(normalizeAvailability('Only 3 left in stock - order soon.'), { availability: 'limited', qty: 3 });
  assert.equal(normalizeAvailability('Currently unavailable.').availability, 'out_of_stock');
  assert.equal(normalizeAvailability('https://schema.org/OutOfStock'.split('/').pop()).availability, 'out_of_stock');
  assert.equal(normalizeAvailability('IN_STOCK').availability, 'in_stock');
  assert.equal(normalizeAvailability('SOLD_OUT'.replace('_', ' ')).availability, 'out_of_stock');
});

test('modelMatches ignores punctuation and region suffix', () => {
  assert.equal(modelMatches('<td>Model: MFHP4LL/A</td>', 'MFHP4LL/A'), true);
  assert.equal(modelMatches('<td>OLED65C6PUA</td>', 'OLED65C6PUA'), true);
  assert.equal(modelMatches('<td>OLED65C6P</td>', 'OLED65C6PUA'), false);
  assert.equal(modelMatches('<p>SM-S948UZKAXAA</p>', 'SM-S948UZKAXAA'), true);
  assert.equal(modelMatches('anything', null), null);
});

test('amazon: price, seller, stock from buy box', () => {
  const html = `<html><head><title>Amazon.com: thing</title></head><body>
    <span id="productTitle"> Apple AirPods Pro 3 </span>
    <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">$219.99</span></span>
      <span class="basisPrice"><span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$249.00</span></span></span></div>
    <div id="availability"><span> In Stock </span></div>
    <div id="merchantInfoFeature_feature_div"><span class="offer-display-feature-text-message">Amazon.com</span></div>
    <div id="fulfillerInfoFeature_feature_div"><span class="offer-display-feature-text-message">Amazon.com</span></div>
  </body></html>`;
  const x = extractAmazon(html);
  assert.equal(x.title, 'Apple AirPods Pro 3');
  assert.equal(x.price, 219.99);
  assert.equal(x.listPrice, 249);
  assert.equal(x.currency, 'USD');
  assert.equal(x.availability, 'in_stock');
  assert.equal(x.sellerName, 'Amazon.com');
  assert.equal(detectAmazonBlock(html, 200), null);
});

test('amazon: third-party seller id and captcha page', () => {
  const html = `<span id="productTitle">x</span><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$1,199.00</span></span></div>
    <a id="sellerProfileTriggerId" href="/gp/help/seller/at-a-glance.html?seller=A2XYZ123">XYZ Electronics</a>`;
  const x = extractAmazon(html);
  assert.equal(x.price, 1199);
  assert.equal(x.sellerName, 'XYZ Electronics');
  assert.equal(x.sellerId, 'A2XYZ123');
  const captcha = '<html><title>Amazon.com</title><form action="/errors/validateCaptcha"></form></html>';
  assert.equal(detectAmazonBlock(captcha, 200), 'captcha');
});

test('walmart: __NEXT_DATA__ product', () => {
  const data = {
    props: {
      pageProps: {
        initialData: {
          data: {
            product: {
              name: 'LG 65" C6 OLED',
              availabilityStatus: 'IN_STOCK',
              sellerDisplayName: 'Walmart.com',
              sellerId: 'F55CDC31AB754BB68FE0B39041159D63',
              priceInfo: { currentPrice: { price: 2296.99, currencyUnit: 'USD' }, wasPrice: { price: 2499.99 } },
            },
          },
        },
      },
    },
  };
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
  const x = extractWalmart(html);
  assert.equal(x.price, 2296.99);
  assert.equal(x.listPrice, 2499.99);
  assert.equal(x.availability, 'in_stock');
  assert.equal(x.sellerName, 'Walmart.com');
  assert.equal(detectWalmartBlock(html, 200), null);
  assert.equal(detectWalmartBlock('<html><title>Robot or human?</title></html>', 200), 'captcha');
});

test('bestbuy: JSON-LD offer and sold-by fallback', () => {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'LG 65" Class C6 Series OLED',
    offers: { '@type': 'Offer', price: '2499.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
  };
  const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script><h1>LG C6</h1></html>`;
  const x = extractBestBuy(html);
  assert.equal(x.price, 2499.99);
  assert.equal(x.availability, 'in_stock');
  assert.equal(x.sellerName, 'Best Buy');
  const mkt = `${html}<div>Sold by <a>Acme Electronics LLC</a></div>`;
  assert.equal(extractBestBuy(mkt).sellerName, 'Acme Electronics LLC');
  assert.equal(detectBestBuyBlock('<html><h1>Choose a country</h1></html>', 200), 'geo_interstitial');
});

test('robots.txt parsing', () => {
  const rules = parseRobots(`User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nAllow: /search/help\nDisallow: /*?ref=\n`);
  assert.equal(isAllowed(rules, '/ip/12345'), true);
  assert.equal(isAllowed(rules, '/search?q=tv'), false);
  assert.equal(isAllowed(rules, '/search/help'), true);
  assert.equal(isAllowed(rules, '/dp/B0?ref=x'), false);
});

test('channel SKU from URL', () => {
  assert.equal(channelSkuFromUrl('amazon_us', 'https://www.amazon.com/dp/B0FQFB8FMG'), 'B0FQFB8FMG');
  assert.equal(channelSkuFromUrl('bestbuy_us', 'https://www.bestbuy.com/product/x/JJ8VPZKZ8H/sku/6673112'), '6673112');
  assert.equal(channelSkuFromUrl('bestbuy_us', 'https://www.bestbuy.com/site/x/6501714.p?skuId=6501714'), '6501714');
  assert.equal(channelSkuFromUrl('bestbuy_us', 'https://www.bestbuy.com/product/x/JJGCQLYK5F'), null);
  assert.equal(channelSkuFromUrl('walmart_us', 'https://www.walmart.com/ip/17835006350'), '17835006350');
});
