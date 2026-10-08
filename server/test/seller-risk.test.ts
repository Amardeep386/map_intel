// Seller risk index (Phase 4 · M6): the pure score.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { riskScore } from '../src/lib/sellerRisk.js';

test('no violations in the window: 0, whatever else', () => {
  assert.equal(riskScore({ violations: 0, avgDepthPct: 40, repeats: 4, noticesDue: 2, unanswered: 2 }).score, 0);
});

test('without a notice due, responsiveness does not count and the other parts carry its weight', () => {
  const r = riskScore({ violations: 5, avgDepthPct: 30, repeats: 3, noticesDue: 0, unanswered: 0 });
  assert.equal(r.parts.responsiveness, null);
  assert.equal(r.score, 100);
  // one violation, 15% deep, no repeat: (35·0.2 + 25·0.5) / 85
  assert.equal(riskScore({ violations: 1, avgDepthPct: 15, repeats: 0, noticesDue: 0, unanswered: 0 }).score, 23);
});

test('ignoring notices raises the score; answering them lowers it; parts are capped at 1', () => {
  const base = { violations: 2, avgDepthPct: 12, repeats: 1, noticesDue: 2 };
  const ignored = riskScore({ ...base, unanswered: 2 });
  const answered = riskScore({ ...base, unanswered: 0 });
  assert.ok(ignored.score > answered.score);
  assert.equal(ignored.parts.responsiveness, 1);
  // 35·0.4 + 25·0.4 + 25·(1/3) + 15·1 = 47.33
  assert.equal(ignored.score, 47);
  assert.equal(riskScore({ violations: 50, avgDepthPct: 90, repeats: 20, noticesDue: 1, unanswered: 1 }).score, 100);
});
