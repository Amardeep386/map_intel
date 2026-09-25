// Mapping: store what the matcher decided about a listing for one account, and the decisions
// analysts make in the Mapping Center. Every state change writes listing_state_event; a
// person's decision is a label (is_label) that feeds the "prior decisions" signal.
//
// Entry point for the Phase 2b collectors: stageCandidate(db, ctx, candidate) after each
// collected listing (ctx from loadMatchContext once per batch). Runs in the caller's transaction.
import type { Db } from './db.js';
import { decide, type MatchRule, type RuleCondition, type Suppression, suppressionHits } from './matchRules.js';
import { proposeProduct, scoreCandidate, type CandidateInput, type PriorLabel, type ProductRef, type Thresholds } from './matching.js';
import { ensureClassification, resolveSeller } from './sellers.js';

export const LISTING_STATES = ['Staged', 'Included', 'Excluded', 'Retired'] as const;
export type ListingState = (typeof LISTING_STATES)[number];

export const EXCLUSION_REASONS = [
  'Wrong product', 'Wrong variant', 'Used or refurbished', 'Bundle or multipack', 'Accessory or part',
  'Out of region', 'Not a purchasable offer', 'Brand direct',
] as const;
export const EXCLUSION_SCOPES = ['listing', 'seller_product', 'url_pattern', 'source'] as const;
export type ExclusionScope = (typeof EXCLUSION_SCOPES)[number];

export interface MatchContext {
  accountId: string;
  products: ProductRef[];
  thresholds: Thresholds;
  rules: MatchRule[];
  suppressions: Suppression[];
  /** Latest human decision per listing (for the prior-decisions signal). */
  labels: Map<string, { sellerId: string | null; productId: string | null; state: string }>;
  /** Current match per listing, kept up to date as the batch stages listings. */
  current: Map<string, { state: ListingState; decidedBy: string; productId: string | null }>;
  /** Sellers already classified in this account (no need to check again). */
  classified: Set<string>;
  /** Seller ids resolved in this batch: `${sourceId}|${name}` -> id. */
  sellers: Map<string, string | null>;
}

export interface Actor {
  type: 'user' | 'rule' | 'auto' | 'suppression' | 'system';
  id: string | null;
  label: string;
}

const supCode = (seq: number) => `SUP-${String(seq).padStart(3, '0')}`;

/** Everything the matcher needs for one account, loaded once per batch. */
export async function loadMatchContext(db: Db, accountId: string): Promise<MatchContext> {
  const settings = (await db.query<{ settings: Record<string, unknown> }>('SELECT settings FROM account WHERE id = $1', [accountId])).rows[0]?.settings ?? {};
  const include = Number(settings.match_include ?? 90);
  const review = Number(settings.match_review ?? 60);
  const products = (
    await db.query<ProductRef & { identifiers: { type: string; value: string }[] }>(
      `SELECT p.id, p.product_code AS code, p.name, p.brand, p.model_number AS model, p.standard_price AS msrp,
              (SELECT mp.amount FROM map_price mp WHERE mp.product_id = p.id AND mp.region IS NULL AND mp.effective_from <= now()
                  AND (mp.effective_to IS NULL OR mp.effective_to > now()) ORDER BY mp.effective_from DESC LIMIT 1) AS map,
              coalesce((SELECT json_agg(json_build_object('type', i.type, 'value', i.value)) FROM product_identifier i WHERE i.product_id = p.id), '[]') AS identifiers,
              -- Market reference: median of the latest prices on the product's included listings
              -- (observations from the last 30 days, else the price the matcher saw).
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.price)::numeric(12,2) FROM (
                 SELECT coalesce(
                          (SELECT o.advertised_price FROM observation o WHERE o.listing_id = m.listing_id AND o.observed_at > now() - interval '30 days'
                              AND o.advertised_price IS NOT NULL ORDER BY o.observed_at DESC LIMIT 1),
                          c.price) AS price
                   FROM listing_match m LEFT JOIN match_candidate c ON c.id = m.candidate_id
                  WHERE m.product_id = p.id AND m.state = 'Included') x WHERE x.price IS NOT NULL) AS market
         FROM product p WHERE p.account_id = $1 AND p.status <> 'Retired'`,
      [accountId],
    )
  ).rows;
  const rules = (
    await db.query<{ id: string; code: string; name: string; kind: 'include' | 'exclude'; condition: RuleCondition; reason: string | null; priority: number; active: boolean }>(
      'SELECT id, code, name, kind, condition, reason, priority, active FROM match_rule WHERE account_id = $1 AND active ORDER BY priority',
      [accountId],
    )
  ).rows;
  const labels = new Map(
    (
      await db.query<{ listing_id: string; seller_id: string | null; product_id: string | null; to_state: string }>(
        `SELECT DISTINCT ON (e.listing_id) e.listing_id, l.seller_id, e.product_id, e.to_state
           FROM listing_state_event e JOIN listing l ON l.id = e.listing_id
          WHERE e.account_id = $1 AND e.is_label
          ORDER BY e.listing_id, e.created_at DESC`,
        [accountId],
      )
    ).rows.map((r) => [r.listing_id, { sellerId: r.seller_id, productId: r.product_id, state: r.to_state }]),
  );
  const current = new Map(
    (
      await db.query<{ listing_id: string; state: ListingState; decided_by: string; product_id: string | null }>(
        'SELECT listing_id, state, decided_by, product_id FROM listing_match WHERE account_id = $1',
        [accountId],
      )
    ).rows.map((r) => [r.listing_id, { state: r.state, decidedBy: r.decided_by, productId: r.product_id }]),
  );
  const classified = new Set(
    (await db.query<{ seller_id: string }>('SELECT DISTINCT seller_id FROM seller_classification WHERE account_id = $1', [accountId])).rows.map((r) => r.seller_id),
  );
  return {
    accountId, products, thresholds: { include, review }, rules, suppressions: await loadSuppressions(db, accountId),
    labels, current, classified, sellers: new Map(),
  };
}

async function loadSuppressions(db: Db, accountId: string): Promise<Suppression[]> {
  return (
    await db.query<Suppression & { seq: number }>(
      `SELECT id, seq, reason, scope, listing_id AS "listingId", seller_id AS "sellerId", seller_name AS "sellerName",
              product_id AS "productId", source_id AS "sourceId", url_pattern AS "urlPattern"
         FROM suppression WHERE account_id = $1 AND revoked_at IS NULL ORDER BY seq`,
      [accountId],
    )
  ).rows.map((s) => ({ ...s, code: supCode(s.seq) }));
}

/** Earlier human decisions on this URL, and on other listings of the same seller. */
function priorLabels(ctx: MatchContext, listingId: string, sellerId: string | null): PriorLabel[] {
  const out: PriorLabel[] = [];
  for (const [id, l] of ctx.labels) {
    if (l.state !== 'Included' && l.state !== 'Excluded') continue;
    if (id === listingId) out.push({ productId: l.productId, state: l.state, sameUrl: true });
    else if (sellerId && l.sellerId === sellerId) out.push({ productId: l.productId, state: l.state, sameUrl: false });
  }
  return out;
}

// clock_timestamp(), not now(): several events in one transaction must keep their order.
async function writeEvent(
  db: Db,
  accountId: string,
  listingId: string,
  from: string | null,
  to: string,
  e: { productId: string | null; confidence: number | null; actor: Actor; reason?: string | null; scope?: string | null; ruleId?: string | null; suppressionId?: string | null; candidateId?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO listing_state_event (account_id, listing_id, from_state, to_state, product_id, confidence, actor_type, actor_id, actor_label,
                                      reason, scope, rule_id, suppression_id, candidate_id, is_label, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, clock_timestamp())`,
    [accountId, listingId, from, to, e.productId, e.confidence, e.actor.type, e.actor.id, e.actor.label, e.reason ?? null, e.scope ?? null,
      e.ruleId ?? null, e.suppressionId ?? null, e.candidateId ?? null, e.actor.type === 'user'],
  );
}

export interface StageInput extends CandidateInput {
  listingId: string;
  sourceId: string;
  sellerId: string | null;
  origin: 'collector' | 'import' | 'synthetic' | 'rescore';
  /** A product suggested by whoever found the listing (a term's product, an import column). */
  proposedProductId?: string | null;
}

export interface StageResult {
  state: ListingState;
  decidedBy: string;
  confidence: number;
  productId: string | null;
  candidateId: string;
  changed: boolean;
}

/**
 * Score a listing for an account, store the candidate with its six signals, and apply
 * suppressions, rules and bands. A person's earlier Include / Exclude stands: the new candidate
 * is recorded but the state is only changed by the matcher if the listing is new, Staged,
 * Retired or was last decided by the matcher itself.
 */
export async function stageCandidate(db: Db, ctx: MatchContext, c: StageInput): Promise<StageResult> {
  const product = proposeProduct(c, ctx.products, c.proposedProductId);
  const result = scoreCandidate(c, product, priorLabels(ctx, c.listingId, c.sellerId), ctx.thresholds);
  const decision = decide({ listingId: c.listingId, sourceId: c.sourceId, sellerId: c.sellerId, input: c }, result, ctx.rules, ctx.suppressions);

  // The candidate and its six signals in one statement.
  const candidateId = (
    await db.query<{ candidate_id: string }>(
      `WITH cand AS (
         INSERT INTO match_candidate (account_id, listing_id, product_id, title, price, currency, seller_name, seller_id, image_url, condition,
                                      listing_format, found, confidence, band, origin)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id)
       INSERT INTO match_signal (candidate_id, account_id, signal, score, weight, passed, detail)
       SELECT cand.id, $1, s.signal, s.score, s.weight, s.passed, s.detail
         FROM cand, jsonb_to_recordset($15::jsonb) AS s(signal text, score numeric, weight numeric, passed boolean, detail text)
       RETURNING candidate_id`,
      [ctx.accountId, c.listingId, result.productId, c.title, c.price, c.sellerName, c.sellerId, c.imageUrl, c.condition, c.format,
        JSON.stringify(result.found), result.confidence, result.band, c.origin, JSON.stringify(result.signals)],
    )
  ).rows[0].candidate_id;

  const cur = ctx.current.get(c.listingId);
  if (cur && cur.decidedBy === 'user' && (cur.state === 'Included' || cur.state === 'Excluded')) {
    await db.query(
      'UPDATE listing_match SET candidate_id = $3, confidence = $4, priority = $5 WHERE account_id = $1 AND listing_id = $2',
      [ctx.accountId, c.listingId, candidateId, result.confidence, result.priority],
    );
    return { state: cur.state, decidedBy: 'user', confidence: result.confidence, productId: cur.productId, candidateId, changed: false };
  }

  const actor: Actor =
    decision.decidedBy === 'rule' ? { type: 'rule', id: decision.ruleId, label: `Rule ${ctx.rules.find((r) => r.id === decision.ruleId)?.code ?? ''}`.trim() }
    : decision.decidedBy === 'suppression' ? { type: 'suppression', id: decision.suppressionId, label: 'Suppression' }
    : { type: 'auto', id: null, label: 'Matcher' };
  const changed = !cur || cur.state !== decision.state || cur.productId !== result.productId;
  // The match, and its history event when the state or product changed, in one statement.
  await db.query(
    `WITH m AS (
       INSERT INTO listing_match (account_id, listing_id, product_id, state, confidence, priority, candidate_id, decided_by, rule_id, suppression_id, reason, state_since)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (account_id, listing_id) DO UPDATE SET
         product_id = EXCLUDED.product_id, confidence = EXCLUDED.confidence, priority = EXCLUDED.priority, candidate_id = EXCLUDED.candidate_id,
         decided_by = EXCLUDED.decided_by, rule_id = EXCLUDED.rule_id, suppression_id = EXCLUDED.suppression_id, reason = EXCLUDED.reason,
         scope = NULL, decided_user = NULL, state = EXCLUDED.state,
         state_since = CASE WHEN listing_match.state = EXCLUDED.state THEN listing_match.state_since ELSE now() END
       RETURNING listing_id)
     INSERT INTO listing_state_event (account_id, listing_id, from_state, to_state, product_id, confidence, actor_type, actor_id, actor_label,
                                      reason, rule_id, suppression_id, candidate_id, is_label, created_at)
     SELECT $1, m.listing_id, $12, $4, $3, $5, $13, $14, $15, $11, $9, $10, $7, false, clock_timestamp() FROM m WHERE $16`,
    [ctx.accountId, c.listingId, result.productId, decision.state, result.confidence, result.priority, candidateId, decision.decidedBy,
      decision.ruleId, decision.suppressionId, decision.reason, cur?.state ?? null, actor.type, actor.id, actor.label, changed],
  );
  ctx.current.set(c.listingId, { state: decision.state, decidedBy: decision.decidedBy, productId: result.productId });
  if (decision.ruleId) await db.query('UPDATE match_rule SET hits = hits + 1 WHERE id = $1', [decision.ruleId]);
  if (decision.suppressionId) await db.query('UPDATE suppression SET hits = hits + 1 WHERE id = $1', [decision.suppressionId]);
  if (c.sellerId && !ctx.classified.has(c.sellerId)) {
    await ensureClassification(db, ctx.accountId, c.sellerId);
    ctx.classified.add(c.sellerId);
  }
  return { state: decision.state, decidedBy: decision.decidedBy, confidence: result.confidence, productId: result.productId, candidateId, changed };
}

/** Re-run rules, suppressions and bands over every Staged listing ("Apply rules now"). */
export async function applyRules(db: Db, accountId: string): Promise<{ checked: number; included: number; excluded: number; staged: number }> {
  const ctx = await loadMatchContext(db, accountId);
  const snaps = (
    await db.query(
      `SELECT l.id, l.url, l.source_id, l.seller_id, l.channel_sku, c.title, c.price, c.seller_name, c.condition, c.listing_format, c.image_url
         FROM listing_match m JOIN listing l ON l.id = m.listing_id LEFT JOIN match_candidate c ON c.id = m.candidate_id
        WHERE m.account_id = $1 AND m.state = 'Staged'`,
      [accountId],
    )
  ).rows;
  const out = { checked: snaps.length, included: 0, excluded: 0, staged: 0 };
  for (const r of snaps) {
    const res = await stageCandidate(db, ctx, {
      listingId: r.id, sourceId: r.source_id, sellerId: r.seller_id, url: r.url, channelSku: r.channel_sku, title: r.title ?? null,
      price: r.price, sellerName: r.seller_name, condition: r.condition, format: r.listing_format, imageUrl: r.image_url, origin: 'rescore',
    });
    if (res.state === 'Included') out.included++;
    else if (res.state === 'Excluded') out.excluded++;
    else out.staged++;
  }
  return out;
}

export interface DecisionInput {
  listingIds: string[];
  action: 'include' | 'exclude' | 'restore' | 'retire';
  productId?: string | null;
  reason?: string | null;
  scope?: ExclusionScope;
  urlPattern?: string | null;
  note?: string | null;
}

export interface DecisionResult {
  updated: number;
  suppression: { id: string; code: string; alsoExcluded: number } | null;
}

/**
 * An analyst's decision on one or more listings: include (as the proposed or another product),
 * exclude with a reason and scope (a scope wider than the listing becomes a standing
 * suppression that also excludes matching Staged listings now), restore to Staged, or retire.
 */
export async function decideListings(db: Db, accountId: string, d: DecisionInput, actor: Actor): Promise<DecisionResult> {
  const rows = (
    await db.query<{ listing_id: string; state: ListingState; product_id: string | null; confidence: number | null; source_id: string; seller_id: string | null; url: string; seller_name: string | null; candidate_id: string | null }>(
      `SELECT m.listing_id, m.state, m.product_id, m.confidence, l.source_id, l.seller_id, l.url, c.seller_name, m.candidate_id
         FROM listing_match m JOIN listing l ON l.id = m.listing_id LEFT JOIN match_candidate c ON c.id = m.candidate_id
        WHERE m.account_id = $1 AND m.listing_id = ANY($2::uuid[])`,
      [accountId, d.listingIds],
    )
  ).rows;
  if (rows.length !== new Set(d.listingIds).size) throw new MappingError(404, 'listing not found in this account');

  let suppression: DecisionResult['suppression'] = null;
  if (d.action === 'include') {
    for (const r of rows) {
      const productId = d.productId ?? r.product_id;
      if (!productId) throw new MappingError(400, 'choose the product to include this listing as');
      await setState(db, accountId, r, 'Included', productId, actor, d.reason ?? (d.productId && d.productId !== r.product_id ? 'Assigned to another SKU' : 'Included'), null);
    }
  } else if (d.action === 'exclude') {
    if (!d.reason) throw new MappingError(400, 'an exclusion needs a reason');
    const scope = d.scope ?? 'listing';
    if (scope === 'seller_product' && rows.length > 1) throw new MappingError(400, 'a seller + product suppression is made from one listing at a time');
    for (const r of rows) await setState(db, accountId, r, 'Excluded', r.product_id, actor, d.reason, scope);
    if (scope !== 'listing') suppression = await createSuppression(db, accountId, rows[0], d, scope, actor);
  } else if (d.action === 'restore') {
    for (const r of rows) await setState(db, accountId, r, 'Staged', r.product_id, actor, d.reason ?? 'Restored for review', null);
  } else {
    for (const r of rows) await setState(db, accountId, r, 'Retired', r.product_id, actor, d.reason ?? 'Retired by an analyst', null);
  }
  return { updated: rows.length, suppression };
}

export class MappingError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

async function setState(
  db: Db,
  accountId: string,
  r: { listing_id: string; state: ListingState; confidence: number | null; candidate_id: string | null },
  to: ListingState,
  productId: string | null,
  actor: Actor,
  reason: string | null,
  scope: string | null,
  suppressionId: string | null = null,
): Promise<void> {
  const decidedBy = actor.type === 'user' ? 'user' : actor.type === 'suppression' ? 'suppression' : 'system';
  await db.query(
    `UPDATE listing_match SET state = $3, product_id = $4, decided_by = $5, reason = $6, scope = $7, decided_user = $8, suppression_id = $9,
            rule_id = NULL, state_since = CASE WHEN state = $3 THEN state_since ELSE now() END
      WHERE account_id = $1 AND listing_id = $2`,
    [accountId, r.listing_id, to, productId, decidedBy, reason, scope, actor.type === 'user' ? actor.id : null, suppressionId],
  );
  await writeEvent(db, accountId, r.listing_id, r.state, to, {
    productId, confidence: r.confidence, actor, reason, scope, suppressionId, candidateId: r.candidate_id,
  });
}

async function createSuppression(
  db: Db,
  accountId: string,
  r: { listing_id: string; product_id: string | null; source_id: string; seller_id: string | null; url: string; seller_name: string | null },
  d: DecisionInput,
  scope: ExclusionScope,
  actor: Actor,
): Promise<NonNullable<DecisionResult['suppression']>> {
  if (scope === 'seller_product' && (!r.product_id || (!r.seller_id && !r.seller_name))) throw new MappingError(400, 'this listing has no seller or product for a seller + product suppression');
  let urlPattern: string | null = null;
  if (scope === 'url_pattern') {
    urlPattern = d.urlPattern?.trim() || null;
    if (!urlPattern) throw new MappingError(400, 'give the URL pattern (use * as a wildcard)');
    if (urlPattern.replace(/\*/g, '').length < 6) throw new MappingError(400, 'the URL pattern is too broad');
  }
  const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM suppression')).rows[0].n;
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO suppression (account_id, seq, reason, scope, listing_id, seller_id, seller_name, product_id, source_id, url_pattern, note, created_by, hits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1) RETURNING id`,
      [accountId, seq, d.reason, scope, r.listing_id,
        scope === 'seller_product' ? r.seller_id : null, scope === 'seller_product' && !r.seller_id ? r.seller_name : null,
        scope === 'seller_product' ? r.product_id : null, scope === 'source' ? r.source_id : null, urlPattern, d.note ?? null,
        actor.type === 'user' ? actor.id : null],
    )
  ).rows[0].id;
  await db.query('UPDATE listing_match SET suppression_id = $3 WHERE account_id = $1 AND listing_id = $2', [accountId, r.listing_id, id]);

  // Exclude the other Staged listings this suppression covers, now.
  const sup: Suppression = {
    id, code: supCode(seq), reason: d.reason!, scope, listingId: r.listing_id,
    sellerId: scope === 'seller_product' ? r.seller_id : null, sellerName: scope === 'seller_product' && !r.seller_id ? r.seller_name : null,
    productId: scope === 'seller_product' ? r.product_id : null, sourceId: scope === 'source' ? r.source_id : null, urlPattern,
  };
  const staged = (
    await db.query<{ listing_id: string; state: ListingState; product_id: string | null; confidence: number | null; candidate_id: string | null; source_id: string; seller_id: string | null; url: string; seller_name: string | null; title: string | null }>(
      `SELECT m.listing_id, m.state, m.product_id, m.confidence, m.candidate_id, l.source_id, l.seller_id, l.url, c.seller_name, c.title
         FROM listing_match m JOIN listing l ON l.id = m.listing_id LEFT JOIN match_candidate c ON c.id = m.candidate_id
        WHERE m.account_id = $1 AND m.state = 'Staged' AND m.listing_id <> $2`,
      [accountId, r.listing_id],
    )
  ).rows;
  let also = 0;
  const auto: Actor = { type: 'suppression', id, label: `Suppression ${supCode(seq)}` };
  for (const s of staged) {
    const hit = suppressionHits(sup, {
      listingId: s.listing_id, sourceId: s.source_id, sellerId: s.seller_id,
      input: { url: s.url, title: s.title, price: null, channelSku: null, sellerName: s.seller_name, condition: null, format: null, imageUrl: null },
    }, s.product_id);
    if (!hit) continue;
    await setState(db, accountId, s, 'Excluded', s.product_id, auto, `${d.reason} (suppression ${supCode(seq)})`, scope, id);
    also++;
  }
  if (also) await db.query('UPDATE suppression SET hits = hits + $2 WHERE id = $1', [id, also]);
  return { id, code: supCode(seq), alsoExcluded: also };
}

/** Stop a suppression from applying to new listings. Listings it already excluded stay excluded. */
export async function revokeSuppression(db: Db, suppressionId: string, userId: string): Promise<{ code: string } | null> {
  const { rows } = await db.query<{ seq: number }>(
    'UPDATE suppression SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING seq',
    [suppressionId, userId],
  );
  return rows[0] ? { code: supCode(rows[0].seq) } : null;
}

/**
 * Retire listings that are no longer found (for the Phase 2b scheduler: listings absent from
 * N consecutive successful crawls). Only Included and Staged listings are retired.
 */
export async function retireListings(db: Db, accountId: string, listingIds: string[], reason: string): Promise<number> {
  const rows = (
    await db.query<{ listing_id: string; state: ListingState; product_id: string | null; confidence: number | null; candidate_id: string | null }>(
      `SELECT listing_id, state, product_id, confidence, candidate_id FROM listing_match
        WHERE account_id = $1 AND listing_id = ANY($2::uuid[]) AND state IN ('Included', 'Staged')`,
      [accountId, listingIds],
    )
  ).rows;
  for (const r of rows) await setState(db, accountId, r, 'Retired', r.product_id, { type: 'system', id: null, label: 'Scheduler' }, reason, null);
  return rows.length;
}

/** Create (or find) a listing and its seller for a candidate found outside a crawl (import, synthetic data). */
export async function upsertListing(
  db: Db,
  l: { sourceId: string; url: string; channelSku?: string | null; title?: string | null; sellerName?: string | null; imageUrl?: string | null; origin: 'import' | 'synthetic' },
  ctx?: MatchContext,
): Promise<{ listingId: string; sellerId: string | null; created: boolean }> {
  let sellerId: string | null = null;
  if (l.sellerName) {
    const key = `${l.sourceId}|${l.sellerName}`;
    if (ctx?.sellers.has(key)) sellerId = ctx.sellers.get(key)!;
    else {
      sellerId = await resolveSeller(db, l.sourceId, l.sellerName);
      ctx?.sellers.set(key, sellerId);
    }
  }
  const { rows } = await db.query<{ id: string; created: boolean }>(
    `INSERT INTO listing (source_id, url, channel_sku, title, state, origin, seller_id, image_url, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, 'Staged', $5, $6, $7, now(), now())
     ON CONFLICT (source_id, url) DO UPDATE SET last_seen = now(), title = coalesce(EXCLUDED.title, listing.title),
       seller_id = coalesce(EXCLUDED.seller_id, listing.seller_id), image_url = coalesce(EXCLUDED.image_url, listing.image_url)
     RETURNING id, (xmax = 0) AS created`,
    [l.sourceId, l.url, l.channelSku ?? null, l.title ?? null, l.origin, sellerId, l.imageUrl ?? null],
  );
  return { listingId: rows[0].id, sellerId, created: rows[0].created };
}
