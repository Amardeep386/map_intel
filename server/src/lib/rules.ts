// MAP verdict rules (Phase 3). Pure: no database. lib/judge.ts loads the facts in force at an
// observation's time and calls evaluate(); episode() turns a verdict into violation events.
import { createHash } from 'node:crypto';

export type SellerClass = 'MAP Authorised' | 'Unauthorised' | 'Brand Direct' | 'Unknown';
export type Outcome = 'violation' | 'needs_review' | 'authorised_promo' | 'compliant' | 'exempt' | 'no_map';
export type Severity = 'Minor' | 'Standard' | 'Severe';
export type RuleVerdict = 'violation' | 'exempt' | 'needs_review';
export type ViolationStatus = 'Open' | 'Needs review' | 'Under notice' | 'Authorised promo' | 'Resolved' | 'Dismissed';

/** Empty or missing arrays match everything. */
export interface RuleScope {
  products?: string[];
  categories?: string[];
  sources?: string[]; // source codes
  sourceCategories?: string[]; // Marketplace / Online Seller / Price Comparison
}

export type RuleCondition =
  | { type: 'below_map'; tolerancePct?: number | null; minDepth?: number | null }
  | { type: 'seller_class'; classes: SellerClass[] };

export interface SeverityBands {
  minorBelowPct: number; // depth < this = Minor
  severeAbovePct: number; // depth > this = Severe; between = Standard
}

export interface RuleVersion {
  id: string;
  ruleId: string;
  code: string;
  version: number;
  scope: RuleScope;
  condition: RuleCondition;
  verdict: RuleVerdict;
  severity: SeverityBands;
  priority: number;
}

export interface JudgeSettings {
  tolerancePct: number; // account map_tolerance_pct
  minDepth: number; // account min_depth (currency units)
  graceHours: number;
}

/** Everything in force at the observation's time. */
export interface ObservationFacts {
  price: number;
  map: { id: string; amount: number } | null;
  promo: { id: string; amount: number } | null; // active window covering this product (and seller)
  sellerClass: SellerClass;
  productId: string;
  productCategory: string | null;
  sourceCode: string;
  sourceCategory: string;
}

export interface Evaluation {
  outcome: Outcome;
  severity: Severity | null;
  ruleVersionId: string | null;
  depthAbs: number | null; // MAP in force − price; positive = below
  depthPct: number | null;
  effectiveMap: number | null; // the promo amount inside a window, else MAP
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export function scopeMatches(scope: RuleScope, f: ObservationFacts): boolean {
  const hit = (list: string[] | undefined, v: string | null) => !list?.length || (v !== null && list.includes(v));
  return (
    hit(scope.products, f.productId) &&
    hit(scope.categories, f.productCategory) &&
    hit(scope.sources, f.sourceCode) &&
    hit(scope.sourceCategories, f.sourceCategory)
  );
}

export function severityFor(depthPct: number, bands: SeverityBands): Severity {
  if (depthPct < bands.minorBelowPct) return 'Minor';
  if (depthPct > bands.severeAbovePct) return 'Severe';
  return 'Standard';
}

/**
 * Judge one observation. Rules run by priority (lower first); the first hit decides. Inside an
 * active promotion window the promo amount is the MAP in force: at or above it is an authorised
 * promotion, below it is judged like any other price.
 */
export function evaluate(f: ObservationFacts, rules: RuleVersion[], s: JudgeSettings): Evaluation {
  if (!f.map) return { outcome: 'no_map', severity: null, ruleVersionId: null, depthAbs: null, depthPct: null, effectiveMap: null };
  const effectiveMap = f.promo && f.promo.amount < f.map.amount ? f.promo.amount : f.map.amount;
  const depthAbs = round(effectiveMap - f.price, 2);
  const depthPct = round((depthAbs / effectiveMap) * 100, 3);
  const base = { depthAbs, depthPct, effectiveMap };

  for (const r of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (!scopeMatches(r.scope, f)) continue;
    const c = r.condition;
    if (c.type === 'seller_class') {
      if (c.classes.includes(f.sellerClass)) return { ...base, outcome: r.verdict, severity: null, ruleVersionId: r.id };
      continue;
    }
    const tol = c.tolerancePct ?? s.tolerancePct;
    const minDepth = c.minDepth ?? s.minDepth;
    if (depthPct > tol && depthAbs > minDepth) {
      return {
        ...base,
        outcome: r.verdict,
        severity: r.verdict === 'exempt' ? null : severityFor(depthPct, r.severity),
        ruleVersionId: r.id,
      };
    }
  }
  const promoApplied = effectiveMap < f.map.amount && f.price < f.map.amount;
  return { ...base, outcome: promoApplied ? 'authorised_promo' : 'compliant', severity: null, ruleVersionId: null };
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

/** The listing's active (not yet closed) episode, if any. */
export interface ActiveEpisode {
  status: ViolationStatus;
  openedAt: Date;
  graceHeld: boolean; // Needs review only because the grace period has not passed
}

export interface EpisodeEvent {
  status: ViolationStatus;
  closed: boolean;
  reason: string | null;
}

export type EpisodeAction =
  | { kind: 'none' }
  | { kind: 'open'; event: EpisodeEvent }
  | { kind: 'link'; events: EpisodeEvent[] }
  | { kind: 'close'; events: EpisodeEvent[] };

export const isViolating = (o: Outcome) => o === 'violation' || o === 'needs_review';
export const GRACE_REASON = 'Grace period';

/**
 * What a new verdict does to the listing's episode. A violating verdict opens an episode or joins
 * the active one; a compliant or authorised-promo price ends it. Exempt and no-MAP verdicts leave
 * it alone. A dismissed episode keeps absorbing violating observations until a compliant one ends it.
 */
export function episode(active: ActiveEpisode | null, outcome: Outcome, observedAt: Date, graceHours: number): EpisodeAction {
  if (isViolating(outcome)) {
    if (!active) {
      if (outcome === 'needs_review') return { kind: 'open', event: { status: 'Needs review', closed: false, reason: 'Rule verdict' } };
      if (graceHours > 0) return { kind: 'open', event: { status: 'Needs review', closed: false, reason: GRACE_REASON } };
      return { kind: 'open', event: { status: 'Open', closed: false, reason: null } };
    }
    const events: EpisodeEvent[] = [];
    const elapsedHours = (observedAt.getTime() - active.openedAt.getTime()) / 3_600_000;
    if (active.status === 'Needs review' && active.graceHeld && outcome === 'violation' && elapsedHours >= graceHours) {
      events.push({ status: 'Open', closed: false, reason: 'Sustained past the grace period' });
    }
    return { kind: 'link', events };
  }
  if (!active) return { kind: 'none' };
  if (outcome === 'compliant' || outcome === 'authorised_promo') {
    if (active.status === 'Dismissed') return { kind: 'close', events: [{ status: 'Dismissed', closed: true, reason: 'Compliant observation' }] };
    if (outcome === 'authorised_promo') return { kind: 'close', events: [{ status: 'Authorised promo', closed: true, reason: 'Inside a promotion window' }] };
    return { kind: 'close', events: [{ status: 'Resolved', closed: true, reason: 'Compliant observation' }] };
  }
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** Stable JSON: object keys sorted at every level. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** What a dry run approves: publishing is refused unless a dry run exists for this exact hash. */
export function contentHash(v: Pick<RuleVersion, 'scope' | 'condition' | 'verdict' | 'severity' | 'priority'>): string {
  return createHash('sha256')
    .update(canonicalJson({ scope: v.scope, condition: v.condition, verdict: v.verdict, severity: v.severity, priority: v.priority }))
    .digest('hex');
}
