// Guided onboarding (Phase 5 · M1). A new account goes through seven steps; each step is done
// only when the account's real configuration says so: nothing is ticked by hand. Required checks
// block go-live, advice is shown but does not. Go-live sets the account Active and asks the
// scheduler for a baseline crawl (scheduler/tick.ts fireBaselines).
import type { Db } from './db.js';

export const STEPS = ['account', 'catalogue', 'map', 'sellers', 'sources', 'rules', 'reports'] as const;
export type StepKey = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepKey, string> = {
  account: 'Account',
  catalogue: 'Catalogue',
  map: 'MAP & policy',
  sellers: 'Sellers',
  sources: 'Sources & terms',
  rules: 'Rules & baseline',
  reports: 'Reports & alerts',
};

export interface Check {
  key: string;
  label: string;
  required: boolean;
  ok: boolean;
  detail?: string;
}

export interface Step {
  key: StepKey;
  title: string;
  done: boolean; // every required check passes
  checks: Check[];
}

export interface OnboardingState {
  accountId: string;
  status: string;
  guided: boolean; // created through the flow (has an onboarding row)
  currentStep: StepKey;
  steps: Step[];
  ready: boolean; // every step done: go-live allowed
  wentLiveAt: string | null;
  baseline: { requestedAt: string | null; firedAt: string | null; runs: { id: string; status: string; jobsTotal: number; jobsDone: number }[] };
}

/** The numbers behind the checks, read in one query as the tenant. */
export interface Facts {
  name: string;
  brand: string;
  timezone: string;
  contractSet: boolean;
  users: number; // members + open invites
  brandUsers: number;
  brandApprovalRequired: boolean;
  products: number;
  productsWithoutIdentifier: number;
  productsWithoutMap: number;
  policyInForce: boolean;
  authorisedSellers: number;
  sellerContacts: number;
  subscriptions: number;
  activeTerms: number;
  subscribedGroups: number;
  activeSchedules: number;
  overBudget: boolean | null; // null when not known
  publishedRules: number;
  matchRules: number;
  scheduledReports: number;
  reportsWithRecipients: number;
  activeAlertRules: number;
}

const n = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;

/** Pure: facts → steps. */
export function evaluate(f: Facts, baselineRequested: boolean): Step[] {
  const steps: Record<StepKey, Check[]> = {
    account: [
      { key: 'profile', label: 'Brand, regions, currency and time zone', required: true, ok: Boolean(f.name.trim() && f.brand.trim() && f.timezone) },
      { key: 'users', label: 'At least one person has access (member or invite)', required: true, ok: f.users > 0, detail: n(f.users, 'person', 'people') },
      {
        key: 'brand-user',
        label: 'A Brand user to approve notices',
        required: false,
        ok: !f.brandApprovalRequired || f.brandUsers > 0,
        detail: f.brandApprovalRequired ? 'brand approval is on: only Brand users approve notices' : 'brand approval is off',
      },
      { key: 'contract', label: 'Contract dates', required: false, ok: f.contractSet },
    ],
    catalogue: [
      { key: 'products', label: 'Products imported', required: true, ok: f.products > 0, detail: n(f.products, 'active product') },
      {
        key: 'identifiers',
        label: 'Every product has an identifier (UPC, EAN, MPN or ASIN)',
        required: false,
        ok: f.products > 0 && f.productsWithoutIdentifier === 0,
        detail: f.productsWithoutIdentifier ? `${n(f.productsWithoutIdentifier, 'product')} without one: add a known URL instead` : undefined,
      },
    ],
    map: [
      {
        key: 'map',
        label: 'Every active product has a MAP in force',
        required: true,
        ok: f.products > 0 && f.productsWithoutMap === 0,
        detail: f.products ? `${f.products - f.productsWithoutMap} of ${f.products}` : 'no products yet',
      },
      { key: 'policy', label: 'MAP policy document in force (attached to notices)', required: false, ok: f.policyInForce },
    ],
    sellers: [
      { key: 'authorised', label: 'Authorised and brand-direct sellers classified', required: true, ok: f.authorisedSellers > 0, detail: n(f.authorisedSellers, 'seller') },
      { key: 'contacts', label: 'Seller contacts for notices', required: false, ok: f.sellerContacts > 0, detail: n(f.sellerContacts, 'contact') },
    ],
    sources: [
      { key: 'subscriptions', label: 'Sources subscribed', required: true, ok: f.subscriptions > 0, detail: n(f.subscriptions, 'source') },
      { key: 'terms', label: 'Active search terms', required: true, ok: f.activeTerms > 0, detail: n(f.activeTerms, 'term') },
      { key: 'matrix', label: 'A term group subscribed to a source category', required: true, ok: f.subscribedGroups > 0 },
      { key: 'schedule', label: 'An active collection schedule', required: true, ok: f.activeSchedules > 0, detail: n(f.activeSchedules, 'schedule') },
      { key: 'budget', label: 'Request estimate within the account budget', required: false, ok: f.overBudget === false, detail: f.overBudget === null ? 'not estimated yet' : undefined },
    ],
    rules: [
      { key: 'verdict-rules', label: 'Published violation rules', required: true, ok: f.publishedRules > 0, detail: n(f.publishedRules, 'rule') },
      { key: 'match-rules', label: 'Mapping rules (inclusion / exclusion)', required: true, ok: f.matchRules > 0, detail: n(f.matchRules, 'rule') },
      {
        key: 'baseline',
        label: 'Baseline crawl',
        required: false,
        ok: baselineRequested,
        detail: baselineRequested ? 'asked for at go-live' : 'runs at go-live',
      },
    ],
    reports: [
      { key: 'report', label: 'A scheduled report', required: true, ok: f.scheduledReports > 0, detail: n(f.scheduledReports, 'report') },
      { key: 'recipients', label: 'Report recipients', required: false, ok: f.reportsWithRecipients > 0 },
      { key: 'alerts', label: 'Alerts switched on', required: false, ok: f.activeAlertRules > 0, detail: n(f.activeAlertRules, 'alert rule') },
    ],
  };
  return STEPS.map((key) => ({ key, title: STEP_TITLES[key], checks: steps[key], done: steps[key].every((c) => !c.required || c.ok) }));
}

/** Read the facts for one account. Runs as the tenant (RLS limits every table to the account). */
export async function loadFacts(db: Db, accountId: string, overBudget: boolean | null): Promise<Facts> {
  const { rows } = await db.query(
    `SELECT a.name, a.brand, a.timezone, (a.contract_from IS NOT NULL AND a.contract_to IS NOT NULL) AS contract_set,
            coalesce((a.settings->>'brand_approval_required')::boolean, true) AS brand_approval,
            (SELECT count(*) FROM account_membership m WHERE m.account_id = a.id)
              + (SELECT count(*) FROM user_invite i WHERE i.account_id = a.id AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
              AS users,
            (SELECT count(*) FROM account_membership m WHERE m.account_id = a.id AND m.role = 'Brand user')
              + (SELECT count(*) FROM user_invite i WHERE i.account_id = a.id AND i.role = 'Brand user' AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
              AS brand_users,
            (SELECT count(*) FROM product p WHERE p.account_id = a.id AND p.status = 'Active') AS products,
            (SELECT count(*) FROM product p WHERE p.account_id = a.id AND p.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM product_identifier i WHERE i.product_id = p.id AND i.type IN ('UPC', 'EAN', 'MPN', 'ASIN'))) AS no_identifier,
            (SELECT count(*) FROM product p WHERE p.account_id = a.id AND p.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM map_price mp WHERE mp.product_id = p.id AND mp.effective_from <= now()
                                  AND (mp.effective_to IS NULL OR now() < mp.effective_to))) AS no_map,
            EXISTS (SELECT 1 FROM policy_document d WHERE d.account_id = a.id AND d.effective_from <= now()
                      AND (d.effective_to IS NULL OR now() < d.effective_to)) AS policy_in_force,
            (SELECT count(DISTINCT c.seller_id) FROM seller_classification c WHERE c.account_id = a.id
                AND c.class IN ('MAP Authorised', 'Brand Direct') AND c.effective_from <= now()
                AND (c.effective_to IS NULL OR now() < c.effective_to)) AS authorised,
            (SELECT count(*) FROM seller_contact c WHERE c.account_id = a.id) AS contacts,
            (SELECT count(*) FROM account_source s WHERE s.account_id = a.id AND s.active) AS subscriptions,
            (SELECT count(*) FROM term t WHERE t.account_id = a.id AND t.active) AS terms,
            (SELECT count(DISTINCT g.group_id) FROM term_group_subscription g WHERE g.account_id = a.id AND g.mode <> 'None') AS groups,
            (SELECT count(*) FROM schedule s WHERE s.account_id = a.id AND s.active) AS schedules,
            (SELECT count(*) FROM rule_version v WHERE v.account_id = a.id AND v.status = 'Published') AS published_rules,
            (SELECT count(*) FROM match_rule r WHERE r.account_id = a.id AND r.active) AS match_rules,
            (SELECT count(*) FROM report_definition r WHERE r.account_id = a.id AND r.active AND r.cadence <> 'manual') AS reports,
            (SELECT count(*) FROM report_definition r WHERE r.account_id = a.id AND r.active AND cardinality(r.recipients) > 0) AS report_recipients,
            (SELECT count(*) FROM alert_rule r WHERE r.account_id = a.id AND r.active) AS alert_rules
       FROM account a WHERE a.id = $1`,
    [accountId],
  );
  const r = rows[0];
  if (!r) throw new Error('account not found');
  const num = (v: unknown) => Number(v ?? 0);
  return {
    name: r.name,
    brand: r.brand,
    timezone: r.timezone,
    contractSet: r.contract_set,
    users: num(r.users),
    brandUsers: num(r.brand_users),
    brandApprovalRequired: r.brand_approval,
    products: num(r.products),
    productsWithoutIdentifier: num(r.no_identifier),
    productsWithoutMap: num(r.no_map),
    policyInForce: r.policy_in_force,
    authorisedSellers: num(r.authorised),
    sellerContacts: num(r.contacts),
    subscriptions: num(r.subscriptions),
    activeTerms: num(r.terms),
    subscribedGroups: num(r.groups),
    activeSchedules: num(r.schedules),
    overBudget,
    publishedRules: num(r.published_rules),
    matchRules: num(r.match_rules),
    scheduledReports: num(r.reports),
    reportsWithRecipients: num(r.report_recipients),
    activeAlertRules: num(r.alert_rules),
  };
}

export async function onboardingState(db: Db, accountId: string, overBudget: boolean | null): Promise<OnboardingState> {
  const facts = await loadFacts(db, accountId, overBudget);
  const { rows } = await db.query(
    `SELECT a.status, o.account_id IS NOT NULL AS guided, o.current_step, o.went_live_at, o.baseline_requested_at, o.baseline_fired_at,
            coalesce((SELECT json_agg(json_build_object('id', r.id, 'status', r.status, 'jobsTotal', r.jobs_total, 'jobsDone', r.jobs_done) ORDER BY r.started_at)
                        FROM crawl_run r WHERE r.id = ANY(o.baseline_run_ids)), '[]') AS runs
       FROM account a LEFT JOIN account_onboarding o ON o.account_id = a.id WHERE a.id = $1`,
    [accountId],
  );
  const o = rows[0];
  const steps = evaluate(facts, Boolean(o.baseline_requested_at));
  return {
    accountId,
    status: o.status,
    guided: o.guided,
    currentStep: (o.current_step ?? 'account') as StepKey,
    steps,
    ready: steps.every((s) => s.done),
    wentLiveAt: o.went_live_at,
    baseline: { requestedAt: o.baseline_requested_at, firedAt: o.baseline_fired_at, runs: o.runs },
  };
}

export class OnboardingError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function setCurrentStep(db: Db, accountId: string, step: StepKey): Promise<void> {
  const { rowCount } = await db.query('UPDATE account_onboarding SET current_step = $2 WHERE account_id = $1', [accountId, step]);
  if (!rowCount) throw new OnboardingError(404, 'this account was not created through guided onboarding');
}

/** Go live: every required check passes; the account becomes Active and a baseline crawl is asked for. */
export async function goLive(db: Db, accountId: string, userId: string | null, overBudget: boolean | null): Promise<OnboardingState> {
  const state = await onboardingState(db, accountId, overBudget);
  if (!state.guided) throw new OnboardingError(404, 'this account was not created through guided onboarding');
  if (state.wentLiveAt) throw new OnboardingError(409, 'this account is already live');
  if (state.status !== 'Onboarding') throw new OnboardingError(409, `the account is ${state.status}, not Onboarding`);
  if (!state.ready) {
    const missing = state.steps.flatMap((s) => s.checks.filter((c) => c.required && !c.ok).map((c) => `${s.title}: ${c.label}`));
    throw new OnboardingError(409, `not ready to go live: ${missing.join('; ')}`);
  }
  await db.query(
    `UPDATE account_onboarding SET went_live_at = now(), went_live_by = $2, baseline_requested_at = now(), current_step = 'reports' WHERE account_id = $1`,
    [accountId, userId],
  );
  await db.query(`UPDATE account SET status = 'Active' WHERE id = $1`, [accountId]);
  return onboardingState(db, accountId, overBudget);
}
