// Match confidence, rules and suppressions (no database).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, ruleHits, urlPatternMatches, type MatchRule, type Suppression } from '../src/lib/matchRules.js';
import { findIdentifiers, proposeProduct, scoreCandidate, titleSimilarity, type CandidateInput, type ProductRef } from '../src/lib/matching.js';

const T = { include: 90, review: 60 };

const oled65: ProductRef = {
  id: 'p65', code: 'LG-P01', name: 'LG 65" C6 OLED evo 4K TV (2026)', brand: 'LG', model: 'OLED65C6PUA', msrp: 2999, map: 2499,
  identifiers: [{ type: 'ASIN', value: 'B0GRK5D3RW' }, { type: 'UPC', value: '195174055281' }],
};
const oled55: ProductRef = { ...oled65, id: 'p55', code: 'LG-P02', name: 'LG 55" C6 OLED evo 4K TV (2026)', model: 'OLED55C6PUA', map: 1799, identifiers: [] };
const qned: ProductRef = { id: 'pq', code: 'LG-P04', name: 'LG 65" QNED75 4K TV', brand: 'LG', model: '65QNED75BUA', msrp: 799, map: null, identifiers: [] };
const catalogue = [oled65, oled55, qned];

const cand = (over: Partial<CandidateInput>): CandidateInput => ({
  url: 'https://www.walmart.com/ip/123', title: null, price: null, channelSku: null, sellerName: 'Some Seller', condition: null, format: null, imageUrl: null, ...over,
});

test('identifiers are found in the URL, retailer id or title; a base model counts as partial', () => {
  const byUrl = findIdentifiers(cand({ url: 'https://www.amazon.com/dp/B0GRK5D3RW?th=1' }), oled65);
  assert.deepEqual(byUrl.map((i) => [i.type, i.where, i.exact]), [['ASIN', 'url', true]]);
  const byTitle = findIdentifiers(cand({ title: 'LG OLED evo C6 65 inch OLED65C6PUA' }), oled65);
  assert.deepEqual(byTitle.map((i) => [i.type, i.where]), [['MPN', 'title']]);
  const partial = findIdentifiers(cand({ title: 'LG 65QNED75B 4K QNED TV' }), qned);
  assert.deepEqual(partial.map((i) => [i.type, i.exact]), [['MPN', false]]);
});

test('title similarity rewards the product name and model, not generic words', () => {
  const good = titleSimilarity('LG 65-Inch Class OLED evo C6 Series 4K Smart TV OLED65C6PUA (2026)', oled65);
  const other = titleSimilarity('Samsung 65" Class QN90F Neo QLED 4K TV', oled65);
  assert.ok(good > 0.8, String(good));
  assert.ok(other < 0.35, String(other));
});

test('a clean listing with the ASIN in the URL is auto-included', () => {
  const r = scoreCandidate(cand({ url: 'https://www.amazon.com/dp/B0GRK5D3RW', title: 'LG 65" C6 OLED evo 4K TV', price: 2499 }), oled65, [], T);
  assert.equal(r.band, 'include');
  assert.ok(r.confidence >= 92);
  assert.equal(r.signals.length, 6);
  const image = r.signals.find((s) => s.signal === 'image')!;
  assert.equal(image.score, null);
  assert.equal(image.weight, 0, 'a missing signal carries no weight');
  assert.equal(Math.round(r.signals.reduce((a, s) => a + s.weight, 0)), 100);
});

test('refurbished, accessories and different sizes never auto-include', () => {
  const refurb = scoreCandidate(cand({ url: 'https://www.amazon.com/dp/B0GRK5D3RW', title: 'LG 65" C6 OLED (Renewed)', price: 1899 }), oled65, [], T);
  assert.equal(refurb.band, 'exclude');
  assert.equal(refurb.found.condition, 'renewed');
  const mount = scoreCandidate(cand({ title: 'Wall mount for LG 65" OLED65C6PUA', price: 89 }), oled65, [], T);
  assert.equal(mount.band, 'exclude');
  const size = scoreCandidate(cand({ title: 'LG 77" C6 OLED evo 4K TV OLED77C6PUA', price: 3499 }), oled65, [], T);
  assert.notEqual(size.band, 'include');
  assert.match(size.found.variant ?? '', /size 77/);
  const bundle = scoreCandidate(cand({ title: 'LG 65" C6 OLED OLED65C6PUA + Soundbar Bundle', price: 2999 }), oled65, [], T);
  assert.equal(bundle.band, 'review');
});

test('no identifier but a matching title lands in review, ordered by discount depth', () => {
  const shallow = scoreCandidate(cand({ title: 'LG 65 inch C6 OLED evo 4K TV 2026', price: 2450 }), oled65, [], T);
  const deep = scoreCandidate(cand({ title: 'LG 65 inch C6 OLED evo 4K TV 2026', price: 1900 }), oled65, [], T);
  assert.equal(shallow.band, 'review');
  assert.equal(deep.band, 'review');
  assert.ok(deep.depth > shallow.depth);
  assert.ok(deep.priority > shallow.priority, 'deeper discounts are reviewed first');
});

test('earlier human decisions move the score', () => {
  const c = cand({ title: 'LG 65 inch C6 OLED evo 4K TV 2026', price: 2450 });
  const none = scoreCandidate(c, oled65, [], T);
  const included = scoreCandidate(c, oled65, [{ productId: 'p65', state: 'Included', sameUrl: true }], T);
  const excluded = scoreCandidate(c, oled65, [{ productId: 'p65', state: 'Excluded', sameUrl: true }], T);
  assert.ok(included.confidence > none.confidence);
  assert.equal(excluded.band, 'exclude');
});

test('the proposed product is the one whose identifiers appear, else the closest title', () => {
  assert.equal(proposeProduct(cand({ title: 'LG OLED55C6PUA 55 inch' }), catalogue)?.id, 'p55');
  assert.equal(proposeProduct(cand({ title: 'LG 65" QNED75 4K Smart TV' }), catalogue)?.id, 'pq');
  assert.equal(proposeProduct(cand({ title: 'Dyson V15 Detect vacuum' }), catalogue), null);
  const none = scoreCandidate(cand({ title: 'Dyson V15' }), null, [], T);
  assert.equal(none.band, 'exclude');
  assert.equal(none.productId, null);
});

const rule = (code: string, kind: 'include' | 'exclude', condition: MatchRule['condition'], priority: number, reason: string | null = null): MatchRule =>
  ({ id: code, code, name: code, kind, condition, reason, priority, active: true });
const RULES: MatchRule[] = [
  rule('EXC-CONDITION', 'exclude', { type: 'condition', values: ['used', 'refurbished', 'renewed', 'open box'] }, 10, 'Used or refurbished'),
  rule('EXC-WAREHOUSE', 'exclude', { type: 'seller_or_title', patterns: ['amazon warehouse', 'warehouse deal'] }, 20, 'Used or refurbished'),
  rule('EXC-AUCTION', 'exclude', { type: 'listing_format', values: ['auction'] }, 30, 'Not a purchasable offer'),
  rule('INC-ASIN-URL', 'include', { type: 'identifier_in_url', identifier: 'ASIN' }, 50),
  rule('INC-MPN', 'include', { type: 'identifier_in_url_or_title', identifier: 'MPN' }, 60),
];
const ctx = (input: CandidateInput) => ({ listingId: 'l1', sourceId: 's-amazon', sellerId: 'seller-1', input });

test('default rules: warehouse and auctions are excluded; an MPN in the title includes a clean review-band listing', () => {
  const wh = cand({ url: 'https://www.amazon.com/dp/B0GRK5D3RW', title: 'LG 65" C6 OLED', price: 2100, sellerName: 'Amazon Warehouse' });
  const r1 = scoreCandidate(wh, oled65, [], T);
  assert.deepEqual(decide(ctx(wh), r1, RULES, []).reason, 'Used or refurbished');
  const auction = cand({ url: 'https://www.ebay.com/itm/1', title: 'LG OLED65C6PUA', format: 'auction', price: 900 });
  assert.equal(decide(ctx(auction), scoreCandidate(auction, oled65, [], T), RULES, []).state, 'Excluded');
  const mpn = cand({ title: 'LG OLED65C6PUA 4K TV', price: 2450 });
  const r3 = scoreCandidate(mpn, oled65, [], T);
  const d3 = decide(ctx(mpn), r3, RULES, []);
  assert.equal(d3.state, 'Included');
  assert.ok(['rule', 'auto'].includes(d3.decidedBy));
  assert.ok(ruleHits(RULES[4], ctx(mpn), r3));
});

test('an inclusion rule never includes a variant or a used listing', () => {
  const variant = cand({ title: 'LG 77" OLED OLED65C6PUA compatible 77 inch', price: 2400 });
  const r = scoreCandidate(variant, oled65, [], T);
  assert.notEqual(decide(ctx(variant), r, RULES, []).state, 'Included');
});

test('suppressions win over rules and bands', () => {
  const c = cand({ url: 'https://www.amazon.com/dp/B0GRK5D3RW', title: 'LG 65" C6 OLED evo 4K TV', price: 2499, sellerName: 'XYZ Electronics LLC' });
  const r = scoreCandidate(c, oled65, [], T);
  const base: Omit<Suppression, 'scope'> = { id: 'sup', code: 'SUP-001', reason: 'Wrong variant', listingId: null, sellerId: null, sellerName: null, productId: null, sourceId: null, urlPattern: null };
  const bySellerName: Suppression = { ...base, scope: 'seller_product', sellerName: 'Sold by XYZ Electronics', productId: 'p65' };
  assert.equal(decide({ ...ctx(c), sellerId: null }, r, RULES, [bySellerName]).decidedBy, 'suppression');
  const otherProduct: Suppression = { ...bySellerName, productId: 'p55' };
  assert.equal(decide({ ...ctx(c), sellerId: null }, r, RULES, [otherProduct]).state, 'Included');
  const byUrl: Suppression = { ...base, scope: 'url_pattern', urlPattern: 'amazon.com/dp/B0GRK5*' };
  assert.equal(decide(ctx(c), r, RULES, [byUrl]).state, 'Excluded');
});

test('URL patterns ignore protocol, www and case', () => {
  assert.ok(urlPatternMatches('walmart.com/ip/*', 'https://www.walmart.com/ip/123'));
  assert.ok(urlPatternMatches('*refurb*', 'https://www.bestbuy.com/site/refurbished-lg/1.p'));
  assert.equal(urlPatternMatches('walmart.com/ip/1', 'https://www.walmart.com/ip/12'), false);
  assert.ok(urlPatternMatches('WALMART.COM/IP/(x)*', 'http://walmart.com/ip/(x)1'));
});
