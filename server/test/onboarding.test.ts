// Guided onboarding: steps are done only when the configuration behind them exists.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, STEPS, type Facts } from '../src/lib/onboarding.js';
import { slugFor } from '../src/api/routes/onboarding.js';

const empty: Facts = {
  name: 'Citizen Watch America',
  brand: 'Citizen',
  timezone: 'America/New_York',
  contractSet: false,
  users: 0,
  brandUsers: 0,
  brandApprovalRequired: true,
  products: 0,
  productsWithoutIdentifier: 0,
  productsWithoutMap: 0,
  policyInForce: false,
  authorisedSellers: 0,
  sellerContacts: 0,
  subscriptions: 0,
  activeTerms: 0,
  subscribedGroups: 0,
  activeSchedules: 0,
  overBudget: null,
  plannedPerDay: 0,
  publishedRules: 3,
  matchRules: 6,
  scheduledReports: 0,
  reportsWithRecipients: 0,
  activeAlertRules: 7,
};

const complete: Facts = {
  ...empty,
  users: 2,
  products: 10,
  productsWithoutIdentifier: 1,
  authorisedSellers: 1,
  subscriptions: 2,
  activeTerms: 20,
  subscribedGroups: 1,
  activeSchedules: 1,
  plannedPerDay: 40,
  scheduledReports: 1,
};

const done = (f: Facts) => Object.fromEntries(evaluate(f, false).map((s) => [s.key, s.done]));

test('a new account: only the steps its default configuration covers are done', () => {
  const steps = evaluate(empty, false);
  assert.deepEqual(steps.map((s) => s.key), [...STEPS]);
  assert.deepEqual(done(empty), { account: false, catalogue: false, map: false, sellers: false, sources: false, rules: true, reports: false });
});

test('MAP: every active product needs a MAP in force; no products is not done', () => {
  assert.equal(done({ ...complete, productsWithoutMap: 1 }).map, false);
  assert.equal(done({ ...complete, productsWithoutMap: 0 }).map, true);
  assert.equal(done({ ...complete, products: 0 }).map, false);
});

test('advice never blocks: a complete account with missing identifiers, no policy, no Brand user is ready', () => {
  const steps = evaluate(complete, false);
  assert.ok(steps.every((s) => s.done));
  const advice = steps.flatMap((s) => s.checks.filter((c) => !c.required && !c.ok).map((c) => c.key));
  assert.deepEqual(advice.sort(), ['baseline', 'brand-user', 'budget', 'contacts', 'contract', 'identifiers', 'policy', 'recipients']);
});

test('sources: subscriptions, terms, a subscribed group and a schedule are all required', () => {
  for (const k of ['subscriptions', 'activeTerms', 'subscribedGroups', 'activeSchedules', 'plannedPerDay'] as const) {
    assert.equal(done({ ...complete, [k]: 0 }).sources, false, k);
  }
});

test('sources: terms no source can run plan nothing, and the step says what to add', () => {
  const sources = evaluate({ ...complete, plannedPerDay: 0 }, false).find((s) => s.key === 'sources')!;
  const work = sources.checks.find((c) => c.key === 'work')!;
  assert.equal(work.ok, false);
  assert.match(work.detail!, /brand or category page URLs/);
  assert.equal(evaluate({ ...complete, plannedPerDay: null }, false).find((s) => s.key === 'sources')!.done, false);
});

test('brand user advice depends on brand approval', () => {
  const check = (f: Facts) => evaluate(f, false).find((s) => s.key === 'account')!.checks.find((c) => c.key === 'brand-user')!.ok;
  assert.equal(check(complete), false);
  assert.equal(check({ ...complete, brandUsers: 1 }), true);
  assert.equal(check({ ...complete, brandApprovalRequired: false }), true);
});

test('slug from the account name', () => {
  assert.equal(slugFor('Citizen Watch America'), 'citizen-watch-america');
  assert.equal(slugFor('  Bose® (US) '), 'bose-us');
  assert.equal(slugFor('***'), 'account');
});
