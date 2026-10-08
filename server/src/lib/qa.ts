// Learning loop (Phase 4 · M7): QA sampling of automatic Mapping Center decisions and the precision
// they reach. Each week (Monday, UTC) a random share — account setting qa_sample_pct — of the
// previous week's automatic includes and, separately, automatic excludes is drawn for a person to
// check. "Wrong" corrects the listing through decideListings (a person's decision: a training
// label); reviewed samples give the precision per confidence band and matcher version.
import type { Db } from './db.js';
import { decideListings, type Actor } from './mapping.js';

export const QA_MAX_PER_KIND = 50;
const DEFAULT_PCT = 5;

/** Monday 00:00 UTC of the week containing `d`, as YYYY-MM-DD. */
export function weekOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

/** How many to draw from `eligible` decisions: pct %, at least 1 when there are any, at most QA_MAX_PER_KIND. */
export function sampleSize(eligible: number, pct: number): number {
  if (eligible <= 0 || pct <= 0) return 0;
  return Math.min(QA_MAX_PER_KIND, eligible, Math.max(1, Math.ceil((eligible * pct) / 100)));
}

/**
 * Draw this week's sample for one account (once per week: a second call adds nothing). The order is
 * random but reproducible for the week (md5 of listing and week).
 */
export async function drawSample(db: Db, accountId: string, now: Date = new Date()): Promise<{ week: string; drawn: number; included: number; excluded: number }> {
  const week = weekOf(now);
  const exists = (await db.query('SELECT 1 FROM qa_sample WHERE account_id = $1 AND week = $2 LIMIT 1', [accountId, week])).rowCount;
  if (exists) return { week, drawn: 0, included: 0, excluded: 0 };
  const settings = (await db.query<{ settings: Record<string, unknown> | null }>('SELECT settings FROM account WHERE id = $1', [accountId])).rows[0]?.settings;
  const pct = Number(settings?.qa_sample_pct ?? DEFAULT_PCT);
  const out = { week, drawn: 0, included: 0, excluded: 0 };
  for (const state of ['Included', 'Excluded'] as const) {
    const eligible = (await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM listing_match m JOIN listing l ON l.id = m.listing_id
        WHERE m.account_id = $1 AND m.state = $2 AND m.decided_by IN ('auto', 'rule', 'suppression') AND l.origin <> 'synthetic'
          AND m.state_since >= $3::date - 7 AND m.state_since < $3::date`,
      [accountId, state, week])).rows[0].n;
    const n = sampleSize(eligible, pct);
    if (!n) continue;
    const { rowCount } = await db.query(
      `INSERT INTO qa_sample (account_id, week, listing_id, candidate_id, product_id, state, decided_by, confidence, matcher_version)
       SELECT m.account_id, $3::date, m.listing_id, m.candidate_id, m.product_id, m.state, m.decided_by, m.confidence, c.matcher_version
         FROM listing_match m JOIN listing l ON l.id = m.listing_id LEFT JOIN match_candidate c ON c.id = m.candidate_id
        WHERE m.account_id = $1 AND m.state = $2 AND m.decided_by IN ('auto', 'rule', 'suppression') AND l.origin <> 'synthetic'
          AND m.state_since >= $3::date - 7 AND m.state_since < $3::date
        ORDER BY md5(m.listing_id::text || $3::text) LIMIT $4`,
      [accountId, state, week, n]);
    out.drawn += rowCount ?? 0;
    if (state === 'Included') out.included = rowCount ?? 0;
    else out.excluded = rowCount ?? 0;
  }
  return out;
}

export async function listSamples(db: Db, accountId: string, f: { week?: string; open?: boolean } = {}) {
  const p: unknown[] = [accountId];
  const c = ['q.account_id = $1'];
  if (f.week) { p.push(f.week); c.push(`q.week = $${p.length}::date`); }
  if (f.open) c.push('q.verdict IS NULL');
  return (await db.query(
    `SELECT q.id, to_char(q.week, 'YYYY-MM-DD') AS week, q.listing_id, q.state, q.decided_by, q.confidence::float8 AS confidence, q.matcher_version,
            q.verdict, q.note, q.reviewed_at, u.email AS reviewed_by,
            p.product_code AS sku, p.name AS product, l.url, coalesce(c.title, l.title) AS title, c.price::float8 AS price,
            s.display_name AS source, coalesce(se.name, c.seller_name) AS seller, m.state AS state_now
       FROM qa_sample q JOIN listing l ON l.id = q.listing_id JOIN source s ON s.id = l.source_id
       LEFT JOIN match_candidate c ON c.id = q.candidate_id LEFT JOIN product p ON p.id = q.product_id
       LEFT JOIN seller se ON se.id = l.seller_id LEFT JOIN app_user u ON u.id = q.reviewed_by
       LEFT JOIN listing_match m ON m.account_id = q.account_id AND m.listing_id = q.listing_id
      WHERE ${c.join(' AND ')} ORDER BY q.week DESC, (q.verdict IS NULL) DESC, q.state, q.confidence DESC NULLS LAST LIMIT 500`,
    p)).rows;
}

export class QaError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/**
 * A person's verdict on a sample. "Wrong" needs a note and corrects the listing: a wrong include is
 * excluded (listing scope), a wrong exclude goes back to review. Either way it is a training label.
 */
export async function reviewSample(db: Db, accountId: string, sampleId: string, verdict: 'correct' | 'wrong', note: string | null, actor: Actor) {
  const q = (await db.query<{ id: string; listing_id: string; state: string; verdict: string | null }>(
    'SELECT id, listing_id, state, verdict FROM qa_sample WHERE id = $1', [sampleId])).rows[0];
  if (!q) throw new QaError(404, 'sample not found');
  if (q.verdict) throw new QaError(409, `already marked ${q.verdict}`);
  if (verdict === 'wrong' && !note?.trim()) throw new QaError(400, 'say what was wrong (it becomes the exclusion reason or the review note)');
  await db.query('UPDATE qa_sample SET verdict = $2, note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1',
    [sampleId, verdict, note?.trim() || null, actor.id]);
  let corrected: string | null = null;
  if (verdict === 'wrong') {
    const now = (await db.query<{ state: string }>('SELECT state FROM listing_match WHERE account_id = $1 AND listing_id = $2', [accountId, q.listing_id])).rows[0]?.state;
    // Only correct what still stands: someone may already have changed the listing.
    if (q.state === 'Included' && now === 'Included') {
      await decideListings(db, accountId, { listingIds: [q.listing_id], action: 'exclude', reason: `QA: ${note!.trim()}`, scope: 'listing' }, actor);
      corrected = 'Excluded';
    } else if (q.state === 'Excluded' && now === 'Excluded') {
      await decideListings(db, accountId, { listingIds: [q.listing_id], action: 'restore', reason: `QA: ${note!.trim()}` }, actor);
      corrected = 'Staged';
    }
  }
  return { listingId: q.listing_id, corrected };
}

/** Which band an automatic decision falls in, for precision. */
export const BAND_SQL = `CASE
    WHEN q.decided_by IN ('rule', 'suppression') THEN 'Rule / suppression'
    WHEN q.state = 'Included' AND q.confidence >= 95 THEN '95–100'
    WHEN q.state = 'Included' THEN '90–94'
    WHEN q.confidence >= 30 THEN '30–59'
    ELSE '0–29' END`;

/**
 * Precision of automatic decisions from reviewed samples (the last 12 weeks): per state, band and
 * matcher version, plus how often people overrode an automatic decision in the last 90 days.
 */
export async function qaStats(db: Db, accountId: string) {
  const bands = (await db.query<{ state: string; band: string; matcher_version: string | null; reviewed: number; correct: number; open: number }>(
    `SELECT q.state, ${BAND_SQL} AS band, q.matcher_version,
            count(*) FILTER (WHERE q.verdict IS NOT NULL)::int AS reviewed, count(*) FILTER (WHERE q.verdict = 'correct')::int AS correct,
            count(*) FILTER (WHERE q.verdict IS NULL)::int AS open
       FROM qa_sample q WHERE q.account_id = $1 AND q.week >= current_date - 84
      GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2 DESC, 3`, [accountId])).rows;
  // Overridden = a person later turned the automatic decision round (Included ↔ Excluded). Sending a
  // listing back to review (Restore) is not a verdict on the matcher, so it does not count.
  const overrides = (await db.query<{ automatic: number; overridden: number }>(
    `WITH auto AS (
       SELECT e.listing_id, e.to_state, e.created_at FROM listing_state_event e
        WHERE e.account_id = $1 AND e.actor_type IN ('auto', 'rule', 'suppression') AND e.to_state IN ('Included', 'Excluded')
          AND e.created_at >= now() - interval '90 days')
     SELECT count(*)::int AS automatic,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM listing_state_event u WHERE u.account_id = $1 AND u.listing_id = auto.listing_id
                                             AND u.is_label AND u.created_at > auto.created_at
                                             AND u.to_state IN ('Included', 'Excluded') AND u.to_state <> auto.to_state))::int AS overridden
       FROM auto`, [accountId])).rows[0];
  const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const total = (state: string) => {
    const rows = bands.filter((b) => b.state === state);
    const reviewed = rows.reduce((n, r) => n + r.reviewed, 0);
    const correct = rows.reduce((n, r) => n + r.correct, 0);
    return { reviewed, correct, precision: pct(correct, reviewed), open: rows.reduce((n, r) => n + r.open, 0) };
  };
  return {
    included: total('Included'),
    excluded: total('Excluded'),
    bands: bands.map((b) => ({ ...b, precision: pct(b.correct, b.reviewed) })),
    overrides: { ...overrides, rate: pct(overrides.overridden, overrides.automatic) },
  };
}
