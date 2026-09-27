// Adapters on real saved pages (test/fixtures). No network.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adapters, channelSkuFromUrl } from '../src/collector/sources.js';
import { fixture } from './fixtures.js';

test('walmart brand page: every product, canonical URLs, prices, no duplicates', () => {
  const url = 'https://www.walmart.com/brand/samsung/10030086';
  const page = adapters.walmart_us.extractResults!(fixture('walmart/brand-samsung'), url);
  assert.equal(page.recognized, true);
  assert.equal(page.items.length, 15);
  assert.equal(new Set(page.items.map((i) => i.channelSku)).size, 15);
  for (const i of page.items) assert.match(i.url, /^https:\/\/www\.walmart\.com\/ip\/\d+$/);
  const tv = page.items.find((i) => i.title?.includes('UN75M70HBFXZA'));
  assert.equal(tv?.price, 548);
  assert.ok(tv?.imageUrl?.startsWith('https://i5.walmartimages.com/'));
  assert.equal(page.nextUrl, `${url}?page=2`);
});

test('walmart product page (CSP names captcha.net): not a block, price, seller, other offers counted', () => {
  const html = fixture('walmart/product-lg-p01');
  const a = adapters.walmart_us;
  assert.equal(a.detectBlock(html, 200), null);
  const x = a.extract(html, 'https://www.walmart.com/ip/18196407846');
  assert.equal(x.price, 1599.99);
  assert.equal(x.sellerName, 'Walmart.com');
  assert.equal(x.currency, 'USD');
  assert.equal(x.hits.otherOffers, '6');
  assert.equal(x.condition, 'new');
});

test('target "Press & hold" challenge in headless is a block, never a price', () => {
  const html = fixture('target/challenge-press-hold');
  assert.equal(adapters.target_us.detectBlock(html, 200), 'captcha');
  assert.equal(adapters.target_us.extract(html, 'https://www.target.com/b/lg-electronics/-/N-4y41g').price, null);
});

// Small pages in each site's shape, until real US fixtures are captured from the Ohio worker.
test('amazon search results: ASIN cards, sponsored marked, condition from the title only', () => {
  const card = (asin: string, title: string, price: string, extra = '') =>
    `<div data-component-type="s-search-result" data-asin="${asin}"><img class="s-image" src="https://m.media-amazon.com/${asin}.jpg" alt="${title}">
     <h2><span>${title}</span></h2><span class="a-price"><span class="a-offscreen">${price}</span></span>${extra}</div>`;
  const html = `<html>${card('B0CVS4CYYF', 'LG 65-Inch OLED evo C4', '$1,496.99', '<span>(12 used &amp; new offers)</span>')}
    ${card('B0CVS4CYYF', 'dupe', '$1')}${card('B0D1234567', 'LG C4 (Renewed)', '$999.00', '<span class="puis-sponsored-label-text">Sponsored</span>')}
    <a class="s-pagination-next" href="/s?k=lg&page=2">Next</a></html>`;
  const page = adapters.amazon_us.extractResults!(html, 'https://www.amazon.com/s?k=LG%20C4');
  assert.deepEqual(page.items.map((i) => [i.channelSku, i.price, i.condition, i.format]), [
    ['B0CVS4CYYF', 1496.99, null, null],
    ['B0D1234567', 999, 'refurbished', 'sponsored'],
  ]);
  assert.equal(page.items[0].url, 'https://www.amazon.com/dp/B0CVS4CYYF');
  assert.equal(page.nextUrl, 'https://www.amazon.com/s?k=LG+C4&page=2');
});

test('best buy search results: old and new product links become one canonical URL per SKU', () => {
  const html = `<ul><li><a href="/site/lg-65-class-c4/6578569.p?skuId=6578569">LG 65" C4</a> <span>$1,499.99</span></li>
    <li><a href="/product/samsung-s25/JJGRF39WLC/sku/6641206">Samsung S25</a></li><li><a href="/site/lg-65-class-c4/6578569.p">again</a></li></ul>`;
  const page = adapters.bestbuy_us.extractResults!(html, 'https://www.bestbuy.com/site/searchpage.jsp?st=lg');
  assert.deepEqual(page.items.map((i) => [i.channelSku, i.url, i.price]), [
    ['6578569', 'https://www.bestbuy.com/site/6578569.p?skuId=6578569', 1499.99],
    ['6641206', 'https://www.bestbuy.com/site/6641206.p?skuId=6641206', null],
  ]);
  assert.equal(adapters.bestbuy_us.searchUrl!('LG C4', 2), 'https://www.bestbuy.com/site/searchpage.jsp?st=LG+C4&intl=nosplash&cp=2');
});

test('ebay item: JSON-LD price and condition, seller from the store link, buy it now', () => {
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'LG OLED65C4PUA 65"', image: ['https://i.ebayimg.com/1.jpg'],
    offers: { '@type': 'Offer', price: '1299.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' } };
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script><a href="https://www.ebay.com/str/tvdealsusa?_trksid=1">Visit store</a> Buy It Now`;
  const x = adapters.ebay_us.extract(html, 'https://www.ebay.com/itm/123456789012');
  assert.deepEqual([x.price, x.currency, x.condition, x.sellerName, x.availability, x.hits.format], [1299, 'USD', 'new', 'tvdealsusa', 'in_stock', 'buy_it_now']);
  const page = adapters.ebay_us.extractResults!(`<li><a href="https://www.ebay.com/itm/lg-c4/123456789012?hash=x">LG C4 Pre-Owned</a> $900.00</li>`, 'https://www.ebay.com/b/LG-TVs/11071/bn_1851207');
  assert.deepEqual(page.items.map((i) => [i.url, i.condition, i.price]), [['https://www.ebay.com/itm/123456789012', 'used', 900]]);
});

test('home depot and target product pages: price with the first-party seller', () => {
  const ld = { '@type': 'Product', name: 'LG 27 cu. ft. French Door', offers: { price: 2199, priceCurrency: 'USD', availability: 'InStock' } };
  const hd = adapters.homedepot_us.extract(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, 'https://www.homedepot.com/p/x/318790937');
  assert.deepEqual([hd.price, hd.sellerName, hd.condition], [2199, 'The Home Depot', 'new']);
  const t = adapters.target_us.extract(`<h1 data-test="product-title">Samsung 65" QN90F</h1><span data-test="product-price">$1,799.99</span>`, '');
  assert.deepEqual([t.title, t.price, t.sellerName, t.currency], ['Samsung 65" QN90F', 1799.99, 'Target', 'USD']);
  const plus = adapters.target_us.extract(`<span data-test="product-price">$10.00</span> Sold &amp; shipped by <a>Gadget Co</a>`, '');
  assert.equal(plus.sellerName, 'Gadget Co');
});

test('channel ids and product-page detection for every source', () => {
  const cases: [string, string, string][] = [
    ['ebay_us', 'https://www.ebay.com/itm/lg-c4/123456789012?x=1', '123456789012'],
    ['target_us', 'https://www.target.com/p/samsung-65/-/A-89123456', '89123456'],
    ['homedepot_us', 'https://www.homedepot.com/p/LG-27-cu-ft/318790937', '318790937'],
  ];
  for (const [src, url, id] of cases) {
    assert.equal(channelSkuFromUrl(src, url), id, src);
    assert.equal(adapters[src].isProductUrl!(url), true, src);
  }
  assert.equal(adapters.homedepot_us.isProductUrl!('https://www.homedepot.com/b/Appliances/LG/N-5yc1vZbv1wZ8qk'), false);
  assert.equal(adapters.walmart_us.isProductUrl!('https://www.walmart.com/brand/samsung/10030086'), false);
});
