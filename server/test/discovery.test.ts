import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelSkuFor, planTerm } from '../src/collector/discovery.js';
import type { SourceAdapter } from '../src/collector/types.js';

const base = { extract: () => ({}) as never, detectBlock: () => null };
const amazon: SourceAdapter = {
  ...base,
  code: 'amazon_us',
  host: 'www.amazon.com',
  searchUrl: (q, p) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&page=${p}`,
  productUrl: (asin) => `https://www.amazon.com/dp/${asin}`,
  isProductUrl: (u) => /\/dp\//.test(u),
};
const target: SourceAdapter = { ...base, code: 'target_us', host: 'www.target.com', isProductUrl: (u) => /\/p\//.test(u) };

test('keyword and brand terms search where search is allowed, else are not executable', () => {
  assert.deepEqual(planTerm(amazon, 'amazon_us', { type: 'keyword', value: 'LG C4 65' }), {
    kind: 'search',
    url: 'https://www.amazon.com/s?k=LG%20C4%2065&page=1',
    query: 'LG C4 65',
  });
  assert.deepEqual(planTerm(target, 'target_us', { type: 'brand', value: 'LG' }), { kind: 'skip', reason: 'not_executable' });
  assert.deepEqual(planTerm(undefined, 'google_shopping_us', { type: 'brand', value: 'LG' }), { kind: 'skip', reason: 'no_collector' });
});

test('identifiers: an ASIN is an Amazon product page and not work anywhere else; a model number is searched', () => {
  assert.deepEqual(planTerm(amazon, 'amazon_us', { type: 'identifier', value: 'b0d3j71rm7' }), { kind: 'product', url: 'https://www.amazon.com/dp/B0D3J71RM7' });
  assert.deepEqual(planTerm(target, 'target_us', { type: 'identifier', value: 'B0D3J71RM7' }), { kind: 'ignore' });
  assert.equal(planTerm(amazon, 'amazon_us', { type: 'identifier', value: 'OLED65C4PUA' }).kind, 'search');
  assert.equal(channelSkuFor('amazon_us', 'OLED65C4PUA'), null);
});

test('url terms run only on their own host, as a product or a browse page', () => {
  assert.deepEqual(planTerm(target, 'target_us', { type: 'url', value: 'https://www.target.com/b/lg-electronics/-/N-4y41g' }), {
    kind: 'browse',
    url: 'https://www.target.com/b/lg-electronics/-/N-4y41g',
  });
  assert.equal(planTerm(target, 'target_us', { type: 'url', value: 'https://target.com/p/x/-/A-123' }).kind, 'product');
  assert.deepEqual(planTerm(amazon, 'amazon_us', { type: 'url', value: 'https://www.target.com/b/lg' }), { kind: 'ignore' });
  assert.deepEqual(planTerm(amazon, 'amazon_us', { type: 'url', value: 'not a url' }), { kind: 'ignore' });
});

test('seller terms are not crawled in P2b', () => {
  assert.deepEqual(planTerm(amazon, 'amazon_us', { type: 'seller', value: 'Acme' }), { kind: 'skip', reason: 'not_executable' });
});
