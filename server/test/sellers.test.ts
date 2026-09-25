// Seller name normalisation (no database).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSellerName, normaliseSellerName } from '../src/lib/sellers.js';

test('spellings of one storefront share a key', () => {
  const key = normaliseSellerName('XYZ Electronics');
  for (const v of ['Sold by XYZ Electronics', 'XYZ Electronics, LLC', 'xyz electronics.', 'Ships from and sold by XYZ Electronics Inc.', '  XYZ   ELECTRONICS store ']) {
    assert.equal(normaliseSellerName(v), key, v);
  }
  assert.equal(key, 'xyz electronics');
});

test('different storefronts and domains stay apart', () => {
  assert.notEqual(normaliseSellerName('Amazon.com'), normaliseSellerName('Amazon Warehouse'));
  assert.equal(normaliseSellerName('Amazon.com'), 'amazon.com');
  assert.equal(normaliseSellerName('B&H Photo'), 'b and h photo');
  assert.equal(normaliseSellerName('Café Électronique'), 'cafe electronique');
  assert.equal(normaliseSellerName('Sold by'), '');
});

test('display names lose "Sold by" and stray punctuation only', () => {
  assert.equal(cleanSellerName('Sold by XYZ Electronics, LLC.'), 'XYZ Electronics, LLC');
  assert.equal(cleanSellerName('  Best  Buy '), 'Best Buy');
});
