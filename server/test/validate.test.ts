import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, pickReference, promoType, validatePrice, type ValidationInput } from '../src/lib/validate.js';

const day = (d: string) => new Date(`2026-09-${d}T12:00:00Z`);
const base: ValidationInput = { price: 1000, currency: 'USD', expectedCurrency: 'USD', reference: { kind: 'map', amount: 1100 }, lastAccepted: { price: 1050, at: day('20') }, observedAt: day('27') };

test('a normal price is accepted with every check recorded', () => {
  const v = validatePrice(base);
  assert.equal(v.verdict, 'accept');
  assert.deepEqual(v.checks.map((c) => [c.name, c.passed]), [['price', true], ['currency', true], ['bounds', true], ['sudden_change', true]]);
});

test('out of bounds, wrong currency and sudden change are held', () => {
  assert.deepEqual(validatePrice({ ...base, price: 99, lastAccepted: null }).held, ['bounds']); // $99 for a $1,100 MAP TV: a misread
  assert.deepEqual(validatePrice({ ...base, price: 4000, lastAccepted: null }).held, ['bounds']);
  assert.deepEqual(validatePrice({ ...base, currency: 'CAD' }).held, ['currency']);
  assert.deepEqual(validatePrice({ ...base, price: 580, reference: null }).held, ['sudden_change']); // -45% in a week
});

test('sudden change only looks back 14 days, and a missing reference skips bounds', () => {
  const v = validatePrice({ ...base, price: 580, reference: null, lastAccepted: { price: 1050, at: day('01') } });
  assert.equal(v.verdict, 'accept');
  assert.deepEqual(v.checks.map((c) => c.name), ['price', 'currency']);
});

test('a consistent recheck confirms a held price; an inconsistent one stays held; currency is never confirmed', () => {
  assert.equal(validatePrice({ ...base, price: 580, recheckOf: { price: 585 } }).verdict, 'accept');
  assert.deepEqual(validatePrice({ ...base, price: 580, recheckOf: { price: 700 } }).held, ['sudden_change']);
  assert.deepEqual(validatePrice({ ...base, currency: 'CAD', recheckOf: { price: 1000 } }).held, ['currency']);
});

test('no price: nothing to validate (the failure class explains why)', () => {
  assert.deepEqual(validatePrice({ ...base, price: null }), { verdict: 'accept', checks: [], held: [], reference: base.reference });
});

test('reference: MAP, then MSRP, then the median of recent accepted prices', () => {
  assert.deepEqual(pickReference(1100, 1299, [900]), { kind: 'map', amount: 1100 });
  assert.deepEqual(pickReference(null, 1299, [900]), { kind: 'msrp', amount: 1299 });
  assert.deepEqual(pickReference(null, null, [900, 1000, 950, 2000]), { kind: 'median', amount: 975 });
  assert.equal(pickReference(null, null, []), null);
  assert.equal(median([3, 1, 2]), 2);
});

test('promo type', () => {
  const x = { price: 900, listPrice: null, promoText: null, couponText: null };
  assert.equal(promoType({ ...x, couponText: 'Save $50 with coupon' }), 'coupon');
  assert.equal(promoType({ ...x, listPrice: 1000 }), 'strike_through');
  assert.equal(promoType({ ...x, promoText: 'Rollback' }), 'sale');
  assert.equal(promoType(x), null);
});
