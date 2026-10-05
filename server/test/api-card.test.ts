import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiCardHtml, ebayCardFields } from '../src/collector/apiCard.js';
import { conditionFrom } from '../src/collector/extract/results.js';

const item = {
  itemId: 'v1|188906025929|0',
  legacyItemId: '188906025929',
  title: 'LG Gram 15U50U-H.AA56U1 15.6" <32GB> #37',
  price: { value: '399.99', currency: 'USD' },
  condition: 'For parts or not working',
  seller: { username: 'windwing521', feedbackPercentage: '99.9', feedbackScore: 15313 },
  image: { imageUrl: 'https://i.ebayimg.com/images/g/x/s-l1600.jpg' },
  estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK', estimatedAvailableQuantity: 1 }],
  shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }],
  itemLocation: { city: 'Wilmington', stateOrProvince: 'Delaware', country: 'US' },
  mpn: '15U50U-H.AA56U1',
  gtin: '195174144220',
  itemWebUrl: 'https://www.ebay.com/itm/188906025929?amdata=enc%3Along',
};

test('evidence card: eBay item fields', () => {
  const f = ebayCardFields(JSON.stringify(item));
  assert.equal(f.price, '$399.99');
  assert.equal(f.condition, 'For parts or not working');
  assert.equal(f.sellerRating, '99.9% positive, 15313 ratings');
  assert.equal(f.availability, 'in stock (1 available)');
  assert.equal(f.shipping, 'Free shipping');
  assert.equal(f.location, 'Wilmington, Delaware, US');
  assert.equal(f.itemId, '188906025929');
  assert.equal(f.listingUrl, 'https://www.ebay.com/itm/188906025929'); // no tracking parameter
});

test('evidence card: escapes text, flags a condition that is not new, names its source and hash', () => {
  const html = apiCardHtml(ebayCardFields(JSON.stringify(item)), {
    sourceName: 'eBay',
    apiName: 'eBay Browse API',
    readAt: new Date('2026-10-04T10:00:16.730Z'),
    apiSha256: 'd340005148a83f9b813ea7ee0edf907e95e94e8faed02478d5951599c2d19050',
  });
  assert.match(html, /&lt;32GB&gt;/);
  assert.doesNotMatch(html, /<32GB>/);
  assert.match(html, /class="warn">For parts or not working/);
  assert.match(html, /not a screenshot of the web page/);
  assert.match(html, /2026-10-04 10:00:16 UTC/);
  assert.match(html, /d340005148a83f9b813ea7ee0edf907e95e94e8faed02478d5951599c2d19050/);
  const fresh = apiCardHtml(ebayCardFields(JSON.stringify({ ...item, condition: 'New' })), {
    sourceName: 'eBay', apiName: 'eBay Browse API', readAt: new Date(), apiSha256: 'x',
  });
  assert.doesNotMatch(fresh, /class="warn"/);
});

test('condition: eBay "For parts or not working" is not new', () => {
  assert.equal(conditionFrom('For parts or not working'), 'used');
  assert.equal(conditionFrom('Parts only'), 'used');
  assert.equal(conditionFrom('New'), 'new');
  assert.equal(conditionFrom('Brand New'), 'new');
});
