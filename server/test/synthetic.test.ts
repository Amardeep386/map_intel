// Synthetic candidates and the matcher together: on a day of candidates for each pilot brand,
// automatic decisions (rules + bands) must agree with what an analyst would decide. What the
// matcher is unsure of goes to review, which is fine; a wrong automatic call is not.   npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decide, type MatchRule } from '../src/lib/matchRules.js';
import { proposeProduct, scoreCandidate, type ProductRef } from '../src/lib/matching.js';
import { defaultBasePrice, generateCandidates, type SyntheticProduct } from '../src/lib/synthetic.js';

// The default rules as seeded by migration 009.
const RULES: MatchRule[] = [
  { code: 'EXC-CONDITION', kind: 'exclude', condition: { type: 'condition', values: ['used', 'refurbished', 'renewed', 'open box', 'pre-owned', 'for parts'] }, reason: 'Used or refurbished', priority: 10 },
  { code: 'EXC-WAREHOUSE', kind: 'exclude', condition: { type: 'seller_or_title', patterns: ['amazon warehouse', 'warehouse deal', 'amazon resale', 'renewed premium'] }, reason: 'Used or refurbished', priority: 20 },
  { code: 'EXC-AUCTION', kind: 'exclude', condition: { type: 'listing_format', values: ['auction'] }, reason: 'Not a purchasable offer', priority: 30 },
  { code: 'INC-ASIN-URL', kind: 'include', condition: { type: 'identifier_in_url', identifier: 'ASIN' }, reason: null, priority: 50 },
  { code: 'INC-MPN', kind: 'include', condition: { type: 'identifier_in_url_or_title', identifier: 'MPN' }, reason: null, priority: 60 },
  { code: 'INC-ATTRIBUTES', kind: 'include', condition: { type: 'attribute_match', minTitle: 0.5 }, reason: null, priority: 70 },
].map((r) => ({ ...r, id: r.code, name: r.code, active: true }) as MatchRule);

const seed = JSON.parse(readFileSync(new URL('../seeds/pilot-skus.json', import.meta.url), 'utf8')) as {
  accounts: { slug: string; brand: string }[];
  products: { account: string; code: string; name: string; category: string; model: string; urls: Record<string, string | null> }[];
};

function catalogue(slug: string): (SyntheticProduct & ProductRef)[] {
  const brand = seed.accounts.find((a) => a.slug === slug)!.brand;
  return seed.products
    .filter((p) => p.account === slug)
    .map((p) => {
      const asin = p.urls.amazon_us?.match(/dp\/(\w{10})/)?.[1] ?? null;
      const price = defaultBasePrice(p.name, p.category);
      return {
        id: p.code, code: p.code, name: p.name, brand, model: p.model, category: p.category, asin, basePrice: price,
        msrp: null, map: null, market: price, identifiers: asin ? [{ type: 'ASIN', value: asin }] : [],
      };
    });
}

test('the generator is deterministic and produces every kind of candidate', () => {
  const products = catalogue('lg');
  const a = generateCandidates(products, 300, 7);
  assert.deepEqual(a, generateCandidates(products, 300, 7));
  const kinds = new Set(a.map((c) => c.kind));
  for (const k of ['asin', 'model', 'title', 'variant', 'refurbished', 'bundle', 'accessory', 'other-brand', 'warehouse', 'auction', 'grey-market']) {
    assert.ok(kinds.has(k as never), k);
  }
  assert.ok(a.every((c) => c.url.includes('mi-synthetic')));
});

for (const slug of ['lg', 'apple', 'samsung']) {
  test(`${slug}: no wrong automatic decisions on three days of synthetic candidates`, () => {
    const products = catalogue(slug);
    for (const s of [1, 2, 3]) {
      let review = 0;
      for (const c of generateCandidates(products, 300, s)) {
        const input = { url: c.url, title: c.title, price: c.price, channelSku: c.channelSku, sellerName: c.sellerName, condition: c.condition, format: c.format, imageUrl: null };
        const r = scoreCandidate(input, proposeProduct(input, products), [], { include: 90, review: 60 });
        const d = decide({ listingId: 'l', sourceId: 's', sellerId: null, input }, r, RULES, []);
        const expectInclude = c.truth.decision === 'include';
        if (d.state === 'Included') {
          assert.ok(expectInclude, `auto-included a ${c.kind}: ${c.title}`);
          assert.equal(r.productId, (c.truth as { productId: string }).productId, `included as the wrong product: ${c.title}`);
        }
        if (d.state === 'Excluded') assert.ok(!expectInclude, `auto-excluded a real ${c.kind}: ${c.title} (${r.confidence})`);
        if (d.state === 'Staged') review++;
      }
      assert.ok(review >= 20 && review <= 120, `seed ${s}: ${review} to review`);
    }
  });
}
