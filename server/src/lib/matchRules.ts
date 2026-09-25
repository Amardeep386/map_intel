// Inclusion / exclusion rules and suppressions, applied after scoring. Order of precedence:
//   1. a standing suppression (an analyst's scoped exclusion) -> Excluded
//   2. the first active rule that hits, by priority (defaults: exclusions 10–30, inclusions 50–70)
//   3. the confidence band: >= include -> Included, < review -> Excluded, otherwise Staged (review)
// Pure functions; lib/mapping.ts loads the rules and suppressions.
import type { CandidateInput, MatchResult } from './matching.js';
import { normaliseSellerName } from './sellers.js';

export interface MatchRule {
  id: string;
  code: string;
  name: string;
  kind: 'include' | 'exclude';
  condition: RuleCondition;
  reason: string | null;
  priority: number;
  active: boolean;
}

export type RuleCondition =
  | { type: 'condition'; values: string[] }
  | { type: 'seller_or_title'; patterns: string[] }
  | { type: 'listing_format'; values: string[] }
  | { type: 'identifier_in_url'; identifier: string }
  | { type: 'identifier_in_url_or_title'; identifier: string }
  | { type: 'attribute_match'; minTitle?: number }
  | { type: 'url_contains'; patterns: string[] };

export interface Suppression {
  id: string;
  code: string;
  reason: string;
  scope: 'listing' | 'seller_product' | 'url_pattern' | 'source';
  listingId: string | null;
  sellerId: string | null;
  sellerName: string | null;
  productId: string | null;
  sourceId: string | null;
  urlPattern: string | null;
}

export interface CandidateContext {
  listingId: string;
  sourceId: string;
  sellerId: string | null;
  input: CandidateInput;
}

const has = (text: string | null, word: string) => !!text && new RegExp(`(^|[^a-z])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?')}([^a-z]|$)`, 'i').test(text);

/** Does a rule hit this scored candidate? */
export function ruleHits(rule: MatchRule, c: CandidateContext, r: MatchResult): boolean {
  const cond = rule.condition;
  const title = c.input.title ?? '';
  switch (cond.type) {
    case 'condition':
      return cond.values.some((v) => has(c.input.condition, v) || has(title, v) || (r.found.condition !== null && has(r.found.condition, v)));
    case 'seller_or_title':
      return cond.patterns.some((p) => has(c.input.sellerName, p) || has(title, p));
    case 'listing_format':
      return cond.values.some((v) => (c.input.format ?? '').toLowerCase() === v.toLowerCase());
    case 'url_contains':
      return cond.patterns.some((p) => c.input.url.toLowerCase().includes(p.toLowerCase()));
    case 'identifier_in_url':
      return r.productId !== null && r.found.identifiers.some((i) => i.type === cond.identifier && i.exact && (i.where === 'url' || i.where === 'retailer id'));
    case 'identifier_in_url_or_title':
      return r.productId !== null && r.found.identifiers.some((i) => i.type === cond.identifier && i.exact);
    case 'attribute_match': {
      if (r.productId === null) return false;
      const attrs = r.signals.find((s) => s.signal === 'attributes');
      const title = r.signals.find((s) => s.signal === 'title');
      return r.found.identifiers.length > 0 && attrs?.passed === true && (title?.score ?? 0) >= (cond.minTitle ?? 0.5);
    }
    default:
      return false;
  }
}

/** Glob match ("walmart.com/ip/*refurb*") on the URL without protocol and "www.", ignoring case. */
export function urlPatternMatches(pattern: string, url: string): boolean {
  const strip = (x: string) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  const body = strip(pattern).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`).test(strip(url));
}

export function suppressionHits(s: Suppression, c: CandidateContext, productId: string | null): boolean {
  switch (s.scope) {
    case 'listing':
      return s.listingId === c.listingId;
    case 'source':
      return s.sourceId === c.sourceId;
    case 'url_pattern':
      return !!s.urlPattern && urlPatternMatches(s.urlPattern, c.input.url);
    case 'seller_product': {
      if (s.productId !== productId) return false;
      if (s.sellerId && c.sellerId) return s.sellerId === c.sellerId;
      return !!s.sellerName && !!c.input.sellerName && normaliseSellerName(s.sellerName) === normaliseSellerName(c.input.sellerName);
    }
    default:
      return false;
  }
}

export interface Decision {
  state: 'Included' | 'Excluded' | 'Staged';
  decidedBy: 'suppression' | 'rule' | 'auto' | 'pending';
  reason: string | null;
  ruleId: string | null;
  suppressionId: string | null;
}

export function decide(c: CandidateContext, r: MatchResult, rules: MatchRule[], suppressions: Suppression[]): Decision {
  const sup = suppressions.find((s) => suppressionHits(s, c, r.productId));
  if (sup) return { state: 'Excluded', decidedBy: 'suppression', reason: `${sup.reason} (suppression ${sup.code})`, ruleId: null, suppressionId: sup.id };
  for (const rule of [...rules].filter((x) => x.active).sort((a, b) => a.priority - b.priority)) {
    if (!ruleHits(rule, c, r)) continue;
    if (rule.kind === 'exclude') return { state: 'Excluded', decidedBy: 'rule', reason: rule.reason ?? rule.name, ruleId: rule.id, suppressionId: null };
    // An inclusion rule never overrides the hard limits of the score (condition, accessory, variant...).
    if (r.productId && r.band !== 'exclude' && r.signals.find((s) => s.signal === 'attributes')?.passed !== false) {
      return { state: 'Included', decidedBy: 'rule', reason: rule.name, ruleId: rule.id, suppressionId: null };
    }
  }
  if (r.band === 'include') return { state: 'Included', decidedBy: 'auto', reason: `Confidence ${r.confidence}`, ruleId: null, suppressionId: null };
  if (r.band === 'exclude') return { state: 'Excluded', decidedBy: 'auto', reason: r.productId ? `Low confidence (${r.confidence})` : 'No matching product', ruleId: null, suppressionId: null };
  return { state: 'Staged', decidedBy: 'pending', reason: null, ruleId: null, suppressionId: null };
}
