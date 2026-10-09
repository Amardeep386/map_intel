// Org-wide crawl budget: what is left today, and how often schedules fire.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firesPerDay, remaining, type Cap } from '../src/lib/crawlBudget.js';

const cap = (sourceId: string | null, dailyRequests: number): Cap => ({ sourceId, dailyRequests, note: null, updatedAt: '' });

test('remaining: caps minus today’s usage, never negative; no org cap = null', () => {
  const usage = [
    { sourceId: 'a', requests: 40 },
    { sourceId: 'a', requests: 30 },
    { sourceId: 'b', requests: 500 },
  ];
  assert.deepEqual(remaining([cap('a', 100), cap('b', 200)], usage), { org: null, sources: { a: 30, b: 0 } });
  assert.deepEqual(remaining([cap(null, 1000)], usage), { org: 430, sources: {} });
  assert.deepEqual(remaining([cap(null, 100), cap('c', 5)], []), { org: 100, sources: { c: 5 } });
});

test('firesPerDay: cron runs in the next 24 hours; manual and bad cron = 0', () => {
  const now = new Date('2026-10-09T00:30:00Z');
  assert.equal(firesPerDay('0 6 * * *', 'UTC', now), 1);
  assert.equal(firesPerDay('0 * * * *', 'UTC', now), 24);
  assert.equal(firesPerDay('0 */6 * * *', 'America/New_York', now), 4);
  assert.equal(firesPerDay('0 8 * * 1', 'UTC', now), 0); // Friday: next Monday is more than a day away
  assert.equal(firesPerDay('manual', 'UTC', now), 0);
  assert.equal(firesPerDay('not a cron', 'UTC', now), 0);
});
