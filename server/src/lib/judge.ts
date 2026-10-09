// Judging (Phase 3): observations of an account's Included listings -> verdicts -> violation
// episodes. Every fact is taken as it was in force at the observation's time: MAP version, promo
// window, seller classification and published rule versions. Verdicts are append-only and unique
// per (account, observation), so judging again adds nothing.
import { SETTINGS_DEFAULTS } from '../api/routes/settings.js';
import type { Db } from './db.js';
import {
  episode, evaluate, GRACE_REASON,
  type ActiveEpisode, type Evaluation, type JudgeSettings, type ObservationFacts, type RuleVersion,
  type SellerClass, type ViolationStatus,
} from './rules.js';
import { resolveReverified } from './cases.js';
import { closeUnwatched } from './violations.js';

export interface ObservationRow {
  id: string;
  observed_at: Date;
  listing_id: string;
  product_id: string;
  seller_id: string | null;
  source_id: string;
  source_code: string;
  source_category: string;
  price: number;
  currency: string | null;
}

/** A rule version with the time it was in force. */
export interface DatedRule extends RuleVersion {
  validFrom: Date;
  validTo: Date | null;
}

interface MapRow { id: string; product_id: string; amount: number; currency: string; region: string | null; from: Date; to: Date | null }
interface ClassRow { seller_id: string; class: SellerClass; from: Date; to: Date | null }
interface PromoRow { id: string; product_id: string; amount: number; from: Date; to: Date; cancelled_at: Date | null; sellers: string[] | null }

export interface JudgeContext {
  settings: JudgeSettings;
  currency: string;
  regions: string[];
  rules: DatedRule[];
  maps: Map<string, MapRow[]>; // by product
  classes: Map<string, ClassRow[]>; // by seller
  promos: Map<string, PromoRow[]>; // by product
  categories: Map<string, string | null>; // product -> category
}

const inForce = (t: Date, from: Date, to: Date | null) => from <= t && (to === null || t < to);
const groupBy = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

export async function readJudgeSettings(db: Db, accountId: string): Promise<{ settings: JudgeSettings; currency: string; regions: string[] }> {
  const a = (await db.query('SELECT settings, currency, regions FROM account WHERE id = $1', [accountId])).rows[0];
  if (!a) throw new Error(`account ${accountId} not found`);
  const s = { ...SETTINGS_DEFAULTS, ...(a.settings ?? {}) };
  return {
    settings: { tolerancePct: Number(s.map_tolerance_pct), minDepth: Number(s.min_depth), graceHours: Number(s.grace_hours) },
    currency: String(a.currency).trim(),
    regions: a.regions ?? ['US'],
  };
}

/** Published and closed rule versions (drafts never judge). */
export async function loadRules(db: Db, accountId: string): Promise<DatedRule[]> {
  const { rows } = await db.query(
    `SELECT rv.id, rv.rule_id, r.code, rv.version, rv.scope, rv.condition, rv.verdict, rv.severity, rv.priority, rv.valid_from, rv.valid_to
       FROM rule_version rv JOIN rule r ON r.id = rv.rule_id
      WHERE rv.account_id = $1 AND rv.status IN ('Published', 'Closed')`,
    [accountId],
  );
  return rows.map((r) => ({
    id: r.id, ruleId: r.rule_id, code: r.code, version: r.version, scope: r.scope, condition: r.condition,
    verdict: r.verdict, severity: r.severity, priority: r.priority, validFrom: r.valid_from, validTo: r.valid_to,
  }));
}

export async function loadContext(db: Db, accountId: string, obs: ObservationRow[], rules?: DatedRule[]): Promise<JudgeContext> {
  const base = await readJudgeSettings(db, accountId);
  const products = [...new Set(obs.map((o) => o.product_id))];
  const sellers = [...new Set(obs.map((o) => o.seller_id).filter((s): s is string => !!s))];
  // One query at a time: pg does not allow parallel queries on one client.
  const maps = await db.query(
      `SELECT id, product_id, amount::float8 AS amount, currency, region, effective_from AS "from", effective_to AS "to"
         FROM map_price WHERE account_id = $1 AND product_id = ANY($2::uuid[])`,
      [accountId, products],
    );
  const classes = await db.query(
      `SELECT seller_id, class, effective_from AS "from", effective_to AS "to"
         FROM seller_classification WHERE account_id = $1 AND seller_id = ANY($2::uuid[])`,
      [accountId, sellers],
    );
  const promos = await db.query(
      `SELECT w.id, p.product_id, p.promo_amount::float8 AS amount, w.effective_from AS "from", w.effective_to AS "to", w.cancelled_at,
              (SELECT array_agg(s.seller_id) FROM promo_window_seller s WHERE s.promo_id = w.id) AS sellers
         FROM promo_window w JOIN promo_window_product p ON p.promo_id = w.id
        WHERE w.account_id = $1 AND p.product_id = ANY($2::uuid[])`,
      [accountId, products],
    );
  const cats = await db.query('SELECT id, category FROM product WHERE account_id = $1 AND id = ANY($2::uuid[])', [accountId, products]);
  return {
    ...base,
    rules: rules ?? (await loadRules(db, accountId)),
    maps: groupBy(maps.rows as MapRow[], (r) => r.product_id),
    classes: groupBy(classes.rows as ClassRow[], (r) => r.seller_id),
    promos: groupBy(promos.rows as PromoRow[], (r) => r.product_id),
    categories: new Map(cats.rows.map((r) => [r.id, r.category ?? null])),
  };
}

/** The MAP in force: same currency, region-specific before region-less, latest start first. */
export function mapAt(ctx: JudgeContext, o: ObservationRow): MapRow | null {
  const cur = (o.currency ?? ctx.currency).trim();
  const rows = (ctx.maps.get(o.product_id) ?? []).filter(
    (m) => inForce(o.observed_at, m.from, m.to) && m.currency.trim() === cur && (m.region === null || ctx.regions.includes(m.region)),
  );
  rows.sort((a, b) => Number(b.region !== null) - Number(a.region !== null) || b.from.getTime() - a.from.getTime());
  return rows[0] ?? null;
}

export function classAt(ctx: JudgeContext, sellerId: string | null, t: Date): SellerClass {
  if (!sellerId) return 'Unknown';
  return (ctx.classes.get(sellerId) ?? []).find((c) => inForce(t, c.from, c.to))?.class ?? 'Unknown';
}

/** The lowest promo amount of the windows active for this product (and seller, when the window names sellers). */
export function promoAt(ctx: JudgeContext, o: ObservationRow): { id: string; amount: number } | null {
  const t = o.observed_at;
  const rows = (ctx.promos.get(o.product_id) ?? []).filter(
    (p) => inForce(t, p.from, p.to) && (p.cancelled_at === null || t < p.cancelled_at) &&
      (!p.sellers?.length || (o.seller_id !== null && p.sellers.includes(o.seller_id))),
  );
  rows.sort((a, b) => a.amount - b.amount);
  return rows[0] ? { id: rows[0].id, amount: rows[0].amount } : null;
}

export function rulesAt(rules: DatedRule[], t: Date): DatedRule[] {
  return rules.filter((r) => inForce(t, r.validFrom, r.validTo));
}

export interface Judged {
  obs: ObservationRow;
  facts: ObservationFacts;
  evaluation: Evaluation;
  map: MapRow | null;
  promo: { id: string; amount: number } | null;
  ruleSet: string[];
}

export function judgeOne(ctx: JudgeContext, o: ObservationRow, rules: DatedRule[] = ctx.rules): Judged {
  const map = mapAt(ctx, o);
  const promo = map ? promoAt(ctx, o) : null;
  const facts: ObservationFacts = {
    price: o.price,
    map: map ? { id: map.id, amount: map.amount } : null,
    promo,
    sellerClass: classAt(ctx, o.seller_id, o.observed_at),
    productId: o.product_id,
    productCategory: ctx.categories.get(o.product_id) ?? null,
    sourceCode: o.source_code,
    sourceCategory: o.source_category,
  };
  const set = rulesAt(rules, o.observed_at);
  return { obs: o, facts, evaluation: evaluate(facts, set, ctx.settings), map, promo, ruleSet: set.map((r) => r.id) };
}

/** Priced observations of the account's Included listings (synthetic listings left out). */
export async function loadObservations(
  db: Db,
  accountId: string,
  opts: { from?: Date; to?: Date; unjudgedOnly?: boolean; limit?: number; after?: { at: Date; id: string } } = {},
): Promise<ObservationRow[]> {
  const { rows } = await db.query(
    `SELECT o.id, o.observed_at, o.listing_id, m.product_id, coalesce(o.seller_id, l.seller_id) AS seller_id,
            l.source_id, s.code AS source_code, s.category AS source_category,
            o.advertised_price::float8 AS price, o.currency
       FROM observation o
       JOIN listing l ON l.id = o.listing_id
       JOIN listing_match m ON m.listing_id = l.id AND m.account_id = $1 AND m.state = 'Included' AND m.product_id IS NOT NULL
       JOIN source s ON s.id = l.source_id
      WHERE o.status = 'ok' AND o.advertised_price IS NOT NULL AND l.origin <> 'synthetic'
        AND o.observed_at >= $2 AND o.observed_at < $3
        AND ($4::boolean IS FALSE OR NOT EXISTS (SELECT 1 FROM verdict v WHERE v.account_id = $1 AND v.observation_id = o.id))
        AND ($6::timestamptz IS NULL OR (date_trunc('milliseconds', o.observed_at), o.id) > ($6::timestamptz, $7::uuid))
      -- Milliseconds, as a JS Date holds them: a cursor taken from the last row then compares exactly.
      ORDER BY date_trunc('milliseconds', o.observed_at), o.id
      LIMIT $5`,
    [accountId, opts.from ?? new Date('2000-01-01'), opts.to ?? new Date('2100-01-01'), opts.unjudgedOnly ?? false, opts.limit ?? 100000,
      opts.after?.at ?? null, opts.after?.id ?? null],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Writing verdicts and episodes
// ---------------------------------------------------------------------------

interface ActiveRow { id: string; listing_id: string; opened_at: Date; status: ViolationStatus; reason: string | null }

async function activeEpisodes(db: Db, accountId: string): Promise<Map<string, ActiveRow>> {
  const { rows } = await db.query<ActiveRow>(
    `SELECT v.id, v.listing_id, v.opened_at, e.status, e.reason
       FROM violation v
       JOIN LATERAL (SELECT status, reason FROM violation_event WHERE violation_id = v.id ORDER BY created_at DESC, id DESC LIMIT 1) e ON true
      WHERE v.account_id = $1
        AND NOT EXISTS (SELECT 1 FROM violation_event c WHERE c.violation_id = v.id AND c.episode_closed)`,
    [accountId],
  );
  return new Map(rows.map((r) => [r.listing_id, r]));
}

export interface JudgeResult {
  judgeRunId: string;
  observations: number;
  verdicts: number;
  opened: number;
  resolved: number;
  closedExcluded: number;
  /** Enforcement cases resolved because a re-check saw a compliant price (Phase 4). */
  casesResolved: number;
}

/**
 * Judge every unjudged observation of an account (oldest first). Runs as system inside the
 * caller's transaction; an advisory lock keeps two judges of one account from interleaving.
 */
export async function judgeAccount(
  db: Db,
  accountId: string,
  opts: { trigger: 'crawl' | 'cli' | 'api' | 'backfill' | 'test'; since?: Date; crawlRunId?: string | null } ,
): Promise<JudgeResult> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('judge:' || $1))", [accountId]);
  const run = (await db.query<{ id: string }>(
    'INSERT INTO judge_run (account_id, trigger, crawl_run_id) VALUES ($1, $2, $3) RETURNING id',
    [accountId, opts.trigger, opts.crawlRunId ?? null],
  )).rows[0].id;

  const obs = await loadObservations(db, accountId, { from: opts.since, unjudgedOnly: true });
  const ctx = await loadContext(db, accountId, obs);
  const active = await activeEpisodes(db, accountId);
  let seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0)::int AS n FROM violation WHERE account_id = $1', [accountId])).rows[0].n;
  const out: JudgeResult = { judgeRunId: run, observations: obs.length, verdicts: 0, opened: 0, resolved: 0, closedExcluded: 0, casesResolved: 0 };

  for (const o of obs) {
    const j = judgeOne(ctx, o);
    const e = j.evaluation;
    const v = await db.query<{ id: string }>(
      `INSERT INTO verdict (account_id, judge_run_id, observation_id, observed_at, listing_id, product_id, seller_id, source_id,
                            outcome, severity, rule_version_id, map_price_id, promo_id, map_amount, promo_amount, observed_price,
                            currency, depth_abs, depth_pct, class_at_capture, rule_set)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (account_id, observation_id) DO NOTHING RETURNING id`,
      [accountId, run, o.id, o.observed_at, o.listing_id, o.product_id, o.seller_id, o.source_id,
        e.outcome, e.severity, e.ruleVersionId, j.map?.id ?? null, j.promo?.id ?? null, j.map?.amount ?? null, j.promo?.amount ?? null,
        o.price, o.currency, e.depthAbs, e.depthPct, j.facts.sellerClass, JSON.stringify(j.ruleSet)],
    );
    const verdictId = v.rows[0]?.id;
    if (!verdictId) continue; // judged meanwhile
    out.verdicts++;

    const cur = active.get(o.listing_id) ?? null;
    const state: ActiveEpisode | null = cur
      ? { status: cur.status, openedAt: cur.opened_at, graceHeld: cur.status === 'Needs review' && cur.reason === GRACE_REASON }
      : null;
    const action = episode(state, e.outcome, o.observed_at, ctx.settings.graceHours);

    if (action.kind === 'open') {
      seq++;
      const vid = (await db.query<{ id: string }>(
        `INSERT INTO violation (account_id, seq, listing_id, product_id, seller_id, source_id, first_verdict_id, opened_at,
                                class_at_capture, map_price_id, rule_version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [accountId, seq, o.listing_id, o.product_id, o.seller_id, o.source_id, verdictId, o.observed_at,
          j.facts.sellerClass, j.map?.id ?? null, e.ruleVersionId],
      )).rows[0].id;
      await linkVerdict(db, accountId, vid, verdictId, o.observed_at);
      await addEvent(db, accountId, vid, action.event.status, action.event.closed, action.event.reason, verdictId);
      active.set(o.listing_id, { id: vid, listing_id: o.listing_id, opened_at: o.observed_at, status: action.event.status, reason: action.event.reason });
      out.opened++;
    } else if (action.kind === 'link' && cur) {
      await linkVerdict(db, accountId, cur.id, verdictId, o.observed_at);
      for (const ev of action.events) {
        await addEvent(db, accountId, cur.id, ev.status, ev.closed, ev.reason, verdictId);
        cur.status = ev.status;
        cur.reason = ev.reason;
      }
    } else if (action.kind === 'close' && cur) {
      for (const ev of action.events) await addEvent(db, accountId, cur.id, ev.status, ev.closed, ev.reason, verdictId);
      active.delete(o.listing_id);
      out.resolved++;
    }
  }

  // Episodes of listings that are no longer Included end: we no longer watch them.
  out.closedExcluded = await closeUnwatched(db, accountId);
  // A case whose violations have all ended on a compliant observation is re-verified: Resolved.
  out.casesResolved = (await resolveReverified(db, accountId)).length;

  await db.query(
    'UPDATE judge_run SET finished_at = now(), observations = $2, verdicts = $3, opened = $4, resolved = $5 WHERE id = $1',
    [run, out.observations, out.verdicts, out.opened, out.resolved],
  );
  return out;
}

async function linkVerdict(db: Db, accountId: string, violationId: string, verdictId: string, observedAt: Date): Promise<void> {
  await db.query(
    'INSERT INTO violation_observation (violation_id, verdict_id, account_id, observed_at) VALUES ($1, $2, $3, $4)',
    [violationId, verdictId, accountId, observedAt],
  );
}

async function addEvent(db: Db, accountId: string, violationId: string, status: ViolationStatus, closed: boolean, reason: string | null, verdictId: string | null): Promise<void> {
  await db.query(
    'INSERT INTO violation_event (account_id, violation_id, status, episode_closed, reason, verdict_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [accountId, violationId, status, closed, reason, verdictId],
  );
}
