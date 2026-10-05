import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFailure, isRetryable } from '../src/collector/failure.js';
import { resultsEvidenceKey } from '../src/collector/resultsEvidence.js';
import { blockedStreak } from '../src/collector/stopOnBlock.js';

test('classifyFailure: fetch-level classes come first', () => {
  assert.equal(classifyFailure({ kind: 'product', robotsDisallowed: true, price: 10 }), 'robots');
  assert.equal(classifyFailure({ kind: 'product', authFailed: true }), 'auth');
  assert.equal(classifyFailure({ kind: 'product', fetchError: 'The operation was aborted due to timeout' }), 'timeout');
  assert.equal(classifyFailure({ kind: 'product', fetchError: 'fetch failed' }), 'network');
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 200, block: 'captcha', price: 99 }), 'blocked');
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 404 }), 'not_found');
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 403 }), 'blocked');
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 503 }), 'network');
});

test('classifyFailure: product pages', () => {
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 200, price: 499.99 }), null);
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 200, price: null, title: 'LG C4', availability: 'out_of_stock' }), 'empty');
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 200, price: null, title: 'LG C4', availability: 'in_stock' }), 'layout_changed');
  assert.equal(classifyFailure({ kind: 'product', httpStatus: 200, price: null, title: null }), 'layout_changed');
});

test('classifyFailure: results pages', () => {
  assert.equal(classifyFailure({ kind: 'results', httpStatus: 200, items: 24, recognized: true }), null);
  assert.equal(classifyFailure({ kind: 'results', httpStatus: 200, items: 0, recognized: true }), 'empty');
  assert.equal(classifyFailure({ kind: 'results', httpStatus: 200, items: 0, recognized: false }), 'layout_changed');
});

test('only transient classes are retried', () => {
  assert.deepEqual(
    (['blocked', 'timeout', 'network', 'layout_changed', 'robots', 'not_found', 'auth', 'empty', null] as const).filter(isRetryable),
    ['blocked', 'timeout', 'network'],
  );
});

test('stop on block: the latest results, newest first, must all be blocked', () => {
  assert.equal(blockedStreak(['blocked', 'blocked']), true);
  assert.equal(blockedStreak(['blocked', null, 'blocked']), false);
  assert.equal(blockedStreak(['blocked']), false);
  assert.equal(blockedStreak(['blocked', 'timeout']), false);
});

test('results page evidence keys sit beside the product evidence, by day', () => {
  assert.equal(resultsEvidenceKey('amazon_us', new Date('2026-10-01T03:30:00Z'), 'abc', 'png'), 'evidence/amazon_us/results/2026/10/01/abc.png');
});
