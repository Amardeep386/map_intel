// Overview dashboard (Phase 3): KPIs, severity mix, authorised vs unauthorised trend with degraded
// days shaded, recent violations and top sellers. Every number comes from verdicts and violation
// episodes; nothing is stored separately.
import { dataQuality, degradedDays } from './dataQuality.js';
import type { Db } from './db.js';
import { listViolations } from './violations.js';

const DAY = 86_400_000;
const ACTIVE = "NOT v.episode_closed AND v.status IN ('Open', 'Needs review', 'Under notice')";
const VIOLATING = "('violation', 'needs_review')";

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Share of judged prices (MAP known) at or above MAP, in [from, to). */
export async function compliance(db: Db, accountId: string, from: Date, to: Date): Promise<{ pct: number | null; judged: number; violating: number }> {
  const r = (await db.query<{ judged: number; violating: number }>(
    `SELECT count(*) FILTER (WHERE outcome <> 'no_map')::int AS judged, count(*) FILTER (WHERE outcome IN ${VIOLATING})::int AS violating
       FROM verdict WHERE account_id = $1 AND observed_at >= $2 AND observed_at < $3`,
    [accountId, from, to],
  )).rows[0];
  return { pct: r.judged ? Math.round((1 - r.violating / r.judged) * 1000) / 10 : null, ...r };
}

/** Median hours from first violating observation to the compliant one, for episodes resolved in [from, to). */
export async function medianTimeToCompliance(db: Db, accountId: string, from: Date, to: Date): Promise<{ hours: number | null; resolved: number }> {
  const r = (await db.query<{ hours: number | null; resolved: number }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (coalesce(vd.observed_at, e.created_at) - v.opened_at)) / 3600)::float8 AS hours,
            count(*)::int AS resolved
       FROM violation v
       JOIN violation_event e ON e.violation_id = v.id AND e.episode_closed AND e.status IN ('Resolved', 'Authorised promo')
       LEFT JOIN verdict vd ON vd.id = e.verdict_id
      WHERE v.account_id = $1 AND coalesce(vd.observed_at, e.created_at) >= $2 AND coalesce(vd.observed_at, e.created_at) < $3`,
    [accountId, from, to],
  )).rows[0];
  return { hours: r.hours === null ? null : Math.round(r.hours * 10) / 10, resolved: r.resolved };
}

/** Per UTC day: listings below MAP that day, split by seller class at capture. */
export async function dailyTrend(db: Db, accountId: string, from: Date, to: Date) {
  const rows = (await db.query<{ day: string; authorised: number; unauthorised: number }>(
    `SELECT to_char(vd.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            count(DISTINCT vd.listing_id) FILTER (WHERE vd.class_at_capture = 'MAP Authorised')::int AS authorised,
            count(DISTINCT vd.listing_id) FILTER (WHERE vd.class_at_capture <> 'MAP Authorised')::int AS unauthorised
       FROM verdict vd
      WHERE vd.account_id = $1 AND vd.observed_at >= $2 AND vd.observed_at < $3 AND vd.outcome IN ${VIOLATING}
      GROUP BY 1`,
    [accountId, from, to],
  )).rows;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t < to.getTime(); t += DAY) {
    const day = dayKey(new Date(t));
    out.push({ day, authorised: byDay.get(day)?.authorised ?? 0, unauthorised: byDay.get(day)?.unauthorised ?? 0 });
  }
  return out;
}

export async function topSellers(db: Db, accountId: string, from: Date, to: Date, limit = 6) {
  return (await db.query(
    `SELECT coalesce(se.name, 'Unknown seller') AS seller, v.seller_id, src.display_name AS source,
            count(*)::int AS violations, count(*) FILTER (WHERE ${ACTIVE})::int AS active,
            round(avg(v.max_depth_pct), 1)::float8 AS avg_depth, max(v.max_depth_pct)::float8 AS max_depth,
            (array_agg(v.class_at_capture ORDER BY v.opened_at DESC))[1] AS class
       FROM violation_current v JOIN source src ON src.id = v.source_id LEFT JOIN seller se ON se.id = v.seller_id
      WHERE v.account_id = $4 AND v.opened_at < $2 AND (v.closed_at IS NULL OR v.closed_at >= $1)
      GROUP BY 1, 2, 3 ORDER BY violations DESC, max_depth DESC LIMIT $3`,
    [from, to, limit, accountId],
  )).rows;
}

export async function overview(db: Db, accountId: string, opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 30;
  const from = new Date(now.getTime() - days * DAY);
  const week = new Date(now.getTime() - 7 * DAY);
  const prevWeek = new Date(now.getTime() - 14 * DAY);

  const comp = await compliance(db, accountId, week, now);
  const compPrev = await compliance(db, accountId, prevWeek, week);
  const counts = (await db.query<{ open: number; opened_24h: number; unauthorised_sellers: number }>(
    `SELECT count(*) FILTER (WHERE ${ACTIVE})::int AS open,
            count(*) FILTER (WHERE v.opened_at >= $1)::int AS opened_24h,
            count(DISTINCT v.seller_id) FILTER (WHERE ${ACTIVE} AND v.class_at_capture <> 'MAP Authorised')::int AS unauthorised_sellers
       FROM violation_current v WHERE v.account_id = $2`,
    [new Date(now.getTime() - DAY), accountId],
  )).rows[0];
  const skus = (await db.query<{ n: number }>(
    `SELECT count(DISTINCT m.product_id)::int AS n FROM listing_match m JOIN listing l ON l.id = m.listing_id
      WHERE m.account_id = $1 AND m.state = 'Included' AND l.origin <> 'synthetic'`,
    [accountId],
  )).rows[0].n;
  const ttc = await medianTimeToCompliance(db, accountId, from, now);
  const quality = await dataQuality(db, accountId, now);
  const severity = (await db.query<{ severity: string; n: number }>(
    `SELECT v.severity, count(*)::int AS n FROM violation_current v
      WHERE v.account_id = $3 AND v.opened_at < $2 AND (v.closed_at IS NULL OR v.closed_at >= $1) GROUP BY 1`,
    [from, now, accountId],
  )).rows;

  return {
    period: { from, to: now, days },
    kpis: {
      compliance: comp.pct, compliancePrev: compPrev.pct, judged: comp.judged,
      openViolations: counts.open, openedLast24h: counts.opened_24h,
      unauthorisedSellers: counts.unauthorised_sellers,
      skusMonitored: skus,
      medianTtcHours: ttc.hours, resolvedInPeriod: ttc.resolved,
      coverage: quality.coverage,
    },
    severity: ['Minor', 'Standard', 'Severe'].map((s) => ({ name: s, value: severity.find((x) => x.severity === s)?.n ?? 0 })),
    trend: await dailyTrend(db, accountId, from, now),
    degradedDays: await degradedDays(db, accountId, from, now),
    quality,
    recent: (await listViolations(db, accountId, { active: true, severity: ['Severe', 'Standard'], limit: 6 })).rows,
    topSellers: await topSellers(db, accountId, from, now),
  };
}
