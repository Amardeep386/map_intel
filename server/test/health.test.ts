import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeHealth, type HealthInput, type JobFact } from '../src/lib/health.js';

const now = new Date('2026-09-27T12:00:00Z');
const ok = (n: number): JobFact[] => Array.from({ length: n }, () => ({ status: 'done', skipReason: null, failureClass: null, found: null }));
const fail = (n: number, fc: JobFact['failureClass']): JobFact[] => Array.from({ length: n }, () => ({ status: 'failed', skipReason: null, failureClass: fc, found: null }));
const priced = (n: number, complete = true) => Array.from({ length: n }, () => ({ status: 'ok', priced: true, evidenceComplete: complete }));
const base: HealthInput = { jobs: ok(10), observations: priced(10), expectedListings: 10, observedListings: 10, lastSuccessAt: new Date('2026-09-27T08:00:00Z'), previousStreak: 0, now };

test('a clean run is Healthy with full numbers', () => {
  const h = computeHealth(base);
  assert.deepEqual([h.health, h.fetchOk, h.fetchTotal, h.extractOk, h.evidenceOk, h.failureStreak, h.mainFailure], ['Healthy', 10, 10, 10, 10, 0, null]);
});

test('bands: Blocked, Failing, Degraded (extraction, coverage, freshness), Idle', () => {
  assert.equal(computeHealth({ ...base, jobs: [...ok(4), ...fail(6, 'blocked')] }).health, 'Blocked');
  assert.equal(computeHealth({ ...base, jobs: [...ok(4), ...fail(3, 'timeout'), ...fail(3, 'blocked')] }).health, 'Failing');
  assert.equal(computeHealth({ ...base, jobs: [...ok(8), ...fail(2, 'layout_changed')] }).health, 'Degraded');
  assert.equal(computeHealth({ ...base, jobs: [...ok(8), ...fail(2, 'blocked')] }).health, 'Degraded'); // 20% blocked
  assert.equal(computeHealth({ ...base, observedListings: 7 }).health, 'Degraded');
  assert.equal(computeHealth({ ...base, lastSuccessAt: new Date('2026-09-25T12:00:00Z') }).health, 'Degraded');
  const idle = computeHealth({ ...base, jobs: [{ status: 'skipped', skipReason: 'not_executable', failureClass: null, found: null }], observations: [] });
  assert.deepEqual([idle.health, idle.jobsSkipped], ['Idle', { not_executable: 1 }]);
});

test('robots-skipped pages do not count as fetch failures; sold-out pages count as read', () => {
  const h = computeHealth({ ...base, jobs: [...ok(8), ...fail(1, 'robots'), ...fail(1, 'empty')] });
  assert.deepEqual([h.fetchTotal, h.fetchOk, h.extractOk, h.health], [9, 9, 9, 'Healthy']);
  assert.deepEqual(h.failureCounts, { robots: 1, empty: 1 });
});

test('the streak grows while unhealthy and a third degraded run in a row is Failing', () => {
  const degraded = { ...base, observedListings: 7 };
  assert.deepEqual([computeHealth({ ...degraded, previousStreak: 1 }).health, computeHealth({ ...degraded, previousStreak: 1 }).failureStreak], ['Degraded', 2]);
  assert.equal(computeHealth({ ...degraded, previousStreak: 2 }).health, 'Failing');
  assert.equal(computeHealth({ ...base, previousStreak: 5 }).failureStreak, 0);
});

test('evidence and held counts', () => {
  const h = computeHealth({ ...base, observations: [...priced(8), ...priced(1, false), { status: 'held', priced: true, evidenceComplete: true }] });
  assert.deepEqual([h.evidenceTotal, h.evidenceOk, h.held], [10, 9, 1]);
});
