// Verdict rules and violation episodes (no database).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentHash, episode, evaluate, GRACE_REASON, scopeMatches, severityFor,
  type ObservationFacts, type RuleVersion, type JudgeSettings,
} from '../src/lib/rules.js';

const SEV = { minorBelowPct: 5, severeAbovePct: 15 };
const R00: RuleVersion = {
  id: 'r00v1', ruleId: 'r00', code: 'R-00', version: 1, scope: {},
  condition: { type: 'seller_class', classes: ['Brand Direct'] }, verdict: 'exempt', severity: SEV, priority: 10,
};
const R01: RuleVersion = {
  id: 'r01v1', ruleId: 'r01', code: 'R-01', version: 1, scope: {},
  condition: { type: 'below_map' }, verdict: 'violation', severity: SEV, priority: 100,
};
const RULES = [R01, R00]; // unsorted on purpose: evaluate sorts by priority
const S: JudgeSettings = { tolerancePct: 2, minDepth: 1, graceHours: 0 };
const facts = (over: Partial<ObservationFacts> = {}): ObservationFacts => ({
  price: 100, map: { id: 'map1', amount: 100 }, promo: null, sellerClass: 'Unauthorised',
  productId: 'p1', productCategory: 'Laptop', sourceCode: 'walmart', sourceCategory: 'Online Seller', ...over,
});

test('at MAP or inside tolerance is compliant', () => {
  assert.equal(evaluate(facts({ price: 100 }), RULES, S).outcome, 'compliant');
  assert.equal(evaluate(facts({ price: 98 }), RULES, S).outcome, 'compliant'); // exactly 2% = not more than tolerance
  assert.equal(evaluate(facts({ price: 120 }), RULES, S).outcome, 'compliant');
});

test('below MAP by more than tolerance and min depth is a violation, severity by depth', () => {
  const e = evaluate(facts({ price: 97 }), RULES, S);
  assert.equal(e.outcome, 'violation');
  assert.equal(e.severity, 'Minor');
  assert.equal(e.ruleVersionId, 'r01v1');
  assert.equal(e.depthAbs, 3);
  assert.equal(e.depthPct, 3);
  assert.equal(evaluate(facts({ price: 90 }), RULES, S).severity, 'Standard');
  assert.equal(evaluate(facts({ price: 85 }), RULES, S).severity, 'Standard'); // 15% exactly is not > 15
  assert.equal(evaluate(facts({ price: 84.99 }), RULES, S).severity, 'Severe');
});

test('min depth: a cheap product a few cents below MAP is not a violation', () => {
  const f = facts({ price: 9.5, map: { id: 'm', amount: 10 } }); // 5% but only $0.50
  assert.equal(evaluate(f, RULES, S).outcome, 'compliant');
  assert.equal(evaluate(f, RULES, { ...S, minDepth: 0.25 }).outcome, 'violation');
});

test('a rule condition can override the account tolerance', () => {
  const strict: RuleVersion = { ...R01, id: 'strict', condition: { type: 'below_map', tolerancePct: 0, minDepth: 0 } };
  assert.equal(evaluate(facts({ price: 99.5 }), [strict], S).outcome, 'violation');
});

test('no MAP in force: no_map, never a violation', () => {
  const e = evaluate(facts({ map: null, price: 1 }), RULES, S);
  assert.equal(e.outcome, 'no_map');
  assert.equal(e.depthPct, null);
});

test('Brand Direct is exempt even far below MAP', () => {
  const e = evaluate(facts({ price: 50, sellerClass: 'Brand Direct' }), RULES, S);
  assert.equal(e.outcome, 'exempt');
  assert.equal(e.ruleVersionId, 'r00v1');
});

test('promotion window: at or above the promo amount is authorised; below it is a violation against the promo amount', () => {
  const promo = { id: 'pw1', amount: 80 };
  assert.equal(evaluate(facts({ price: 85, promo }), RULES, S).outcome, 'authorised_promo');
  assert.equal(evaluate(facts({ price: 80, promo }), RULES, S).outcome, 'authorised_promo');
  const below = evaluate(facts({ price: 70, promo }), RULES, S);
  assert.equal(below.outcome, 'violation');
  assert.equal(below.effectiveMap, 80);
  assert.equal(below.depthAbs, 10);
  assert.equal(evaluate(facts({ price: 100, promo }), RULES, S).outcome, 'compliant');
});

test('scope limits a rule to products, sources and categories', () => {
  const f = facts();
  assert.ok(scopeMatches({}, f));
  assert.ok(scopeMatches({ sources: ['walmart', 'ebay'] }, f));
  assert.equal(scopeMatches({ sources: ['ebay'] }, f), false);
  assert.equal(scopeMatches({ categories: ['TV'] }, f), false);
  assert.equal(scopeMatches({ categories: ['TV'] }, facts({ productCategory: null })), false);
  const ebayOnly: RuleVersion = { ...R01, scope: { sources: ['ebay'] } };
  assert.equal(evaluate(facts({ price: 50 }), [ebayOnly], S).outcome, 'compliant');
});

test('severity bands are configurable', () => {
  assert.equal(severityFor(4, { minorBelowPct: 3, severeAbovePct: 10 }), 'Standard');
  assert.equal(severityFor(11, { minorBelowPct: 3, severeAbovePct: 10 }), 'Severe');
});

test('episode: a violation opens Open, or Needs review during a grace period', () => {
  const t = new Date('2026-10-01T10:00:00Z');
  assert.deepEqual(episode(null, 'violation', t, 0), { kind: 'open', event: { status: 'Open', closed: false, reason: null } });
  assert.deepEqual(episode(null, 'violation', t, 24), { kind: 'open', event: { status: 'Needs review', closed: false, reason: GRACE_REASON } });
  assert.equal(episode(null, 'needs_review', t, 0).kind, 'open');
});

test('episode: grace — opens once the breach has lasted grace_hours', () => {
  const opened = new Date('2026-10-01T00:00:00Z');
  const active = { status: 'Needs review' as const, openedAt: opened, graceHeld: true };
  assert.deepEqual(episode(active, 'violation', new Date('2026-10-01T12:00:00Z'), 24), { kind: 'link', events: [] });
  const later = episode(active, 'violation', new Date('2026-10-02T00:00:00Z'), 24);
  assert.equal(later.kind, 'link');
  assert.equal(later.kind === 'link' && later.events[0].status, 'Open');
});

test('episode: compliant resolves, promo ends as Authorised promo, dismissed stays dismissed', () => {
  const t = new Date();
  const open = { status: 'Open' as const, openedAt: t, graceHeld: false };
  assert.deepEqual(episode(open, 'compliant', t, 0), { kind: 'close', events: [{ status: 'Resolved', closed: true, reason: 'Compliant observation' }] });
  const promo = episode(open, 'authorised_promo', t, 0);
  assert.equal(promo.kind === 'close' && promo.events[0].status, 'Authorised promo');
  const dismissed = episode({ ...open, status: 'Dismissed' }, 'compliant', t, 0);
  assert.equal(dismissed.kind === 'close' && dismissed.events[0].status, 'Dismissed');
  assert.deepEqual(episode({ ...open, status: 'Dismissed' }, 'violation', t, 0), { kind: 'link', events: [] });
});

test('episode: exempt and no_map leave the episode alone; compliant without an episode does nothing', () => {
  const t = new Date();
  const open = { status: 'Open' as const, openedAt: t, graceHeld: false };
  assert.deepEqual(episode(open, 'exempt', t, 0), { kind: 'none' });
  assert.deepEqual(episode(open, 'no_map', t, 0), { kind: 'none' });
  assert.deepEqual(episode(null, 'compliant', t, 0), { kind: 'none' });
});

test('content hash ignores key order and changes with content', () => {
  const a = contentHash({ scope: { sources: ['ebay'] }, condition: { type: 'below_map', tolerancePct: 2 }, verdict: 'violation', severity: SEV, priority: 100 });
  const b = contentHash({ priority: 100, severity: { severeAbovePct: 15, minorBelowPct: 5 }, verdict: 'violation', condition: { tolerancePct: 2, type: 'below_map' }, scope: { sources: ['ebay'] } });
  assert.equal(a, b);
  const c = contentHash({ scope: { sources: ['ebay'] }, condition: { type: 'below_map', tolerancePct: 3 }, verdict: 'violation', severity: SEV, priority: 100 });
  assert.notEqual(a, c);
});
