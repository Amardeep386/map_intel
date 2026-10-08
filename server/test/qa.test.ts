// Learning loop (Phase 4 · M7): the week a sample belongs to and how many are drawn.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QA_MAX_PER_KIND, sampleSize, weekOf } from '../src/lib/qa.js';
import { MATCHER_VERSION } from '../src/lib/matching.js';

test('weekOf: the Monday (UTC) of the week', () => {
  assert.equal(weekOf(new Date('2026-10-08T12:00:00Z')), '2026-10-05'); // Thursday
  assert.equal(weekOf(new Date('2026-10-05T00:00:00Z')), '2026-10-05'); // Monday itself
  assert.equal(weekOf(new Date('2026-10-04T23:59:59Z')), '2026-09-28'); // Sunday
});

test('sampleSize: pct of the eligible decisions, at least one when there are any, capped', () => {
  assert.equal(sampleSize(0, 5), 0);
  assert.equal(sampleSize(3, 5), 1);
  assert.equal(sampleSize(100, 5), 5);
  assert.equal(sampleSize(101, 5), 6);
  assert.equal(sampleSize(10_000, 5), QA_MAX_PER_KIND);
  assert.equal(sampleSize(10, 0), 0);
});

test('the matcher has a version', () => {
  assert.match(MATCHER_VERSION, /^m\d+$/);
});
