// Rule 6: never store a blocked or failed page as a price; never carry an old price forward.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideOutcome } from '../src/collector/outcome.js';
import { emptyExtracted } from '../src/collector/types.js';
import { validatePrice } from '../src/lib/validate.js';

const priced = { ...emptyExtracted(), title: 'LG C4', price: 1499.99, listPrice: 1799.99, currency: 'USD', availability: 'in_stock' as const, sellerName: 'Walmart.com' };

test('a blocked page stores no price, even when a price could be read from it', () => {
  const d = decideOutcome({ kind: 'product', httpStatus: 200, block: 'captcha', price: priced.price, title: priced.title }, priced, null);
  assert.deepEqual([d.status, d.failureClass, d.retryable], ['blocked', 'blocked', true]);
  assert.deepEqual(d.stored, { price: null, listPrice: null, currency: null });
});

test('failures map to statuses and never carry a price', () => {
  const cases = [
    [{ kind: 'product' as const, robotsDisallowed: true }, 'skipped_robots', 'robots'],
    [{ kind: 'product' as const, fetchError: 'The operation was aborted due to timeout' }, 'failed', 'timeout'],
    [{ kind: 'product' as const, httpStatus: 404 }, 'not_found', 'not_found'],
    [{ kind: 'product' as const, httpStatus: 200, price: null, title: null }, 'failed', 'layout_changed'],
    [{ kind: 'product' as const, httpStatus: 200, price: null, title: 'LG C4', availability: 'out_of_stock' as const }, 'failed', 'empty'],
    [{ kind: 'product' as const, authFailed: true }, 'failed', 'auth'],
  ] as const;
  for (const [facts, status, fc] of cases) {
    const d = decideOutcome(facts, null, null);
    assert.deepEqual([d.status, d.failureClass, d.stored.price], [status, fc, null], fc);
  }
});

test('a good reading is ok (or partial without seller / stock), a suspicious one is held with its price', () => {
  const facts = { kind: 'product' as const, httpStatus: 200, price: priced.price, title: priced.title };
  assert.equal(decideOutcome(facts, priced, null).status, 'ok');
  assert.equal(decideOutcome(facts, { ...priced, sellerName: null }, null).status, 'partial');
  const hold = validatePrice({ price: 99, currency: 'USD', expectedCurrency: 'USD', reference: { kind: 'map', amount: 1100 }, lastAccepted: null, observedAt: new Date() });
  const d = decideOutcome({ ...facts, price: 99 }, { ...priced, price: 99 }, hold);
  assert.deepEqual([d.status, d.stored.price, d.failureClass], ['held', 99, null]);
});
