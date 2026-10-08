// Seller risk index (Phase 4 · M6): 0–100 per seller in one account over the last 90 days, from
// four parts a person can read back:
//   frequency       violations opened                         (5 or more = full weight)
//   depth           average deepest gap below MAP              (30% or more = full weight)
//   recurrence      repeat breaches of the same listing, plus cases marked Recurred (3 or more = full)
//   responsiveness  notices whose response date passed with no reply and no fix (share of notices)
// Responsiveness only counts once a notice has gone to the seller; until then the other three
// parts carry its weight. A seller with no violations in the window scores 0. Dismissed
// violations and listings no longer Included (excluded as the wrong product, for parts, ...) do
// not count against a seller.
import type { Db } from './db.js';

export const RISK_WINDOW_DAYS = 90;
export const RISK_WEIGHTS = { frequency: 35, depth: 25, recurrence: 25, responsiveness: 15 } as const;
const FULL = { violations: 5, depthPct: 30, repeats: 3 };

export interface RiskInput {
  violations: number;
  avgDepthPct: number | null;
  repeats: number;
  noticesDue: number; // notices whose response date has passed
  unanswered: number; // of those, no reply and no fix
}

export interface RiskParts { frequency: number; depth: number; recurrence: number; responsiveness: number | null }

/** Pure: the score and each part (0–1; responsiveness null when no notice is due yet). */
export function riskScore(i: RiskInput): { score: number; parts: RiskParts } {
  if (i.violations <= 0) return { score: 0, parts: { frequency: 0, depth: 0, recurrence: 0, responsiveness: i.noticesDue ? 0 : null } };
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const parts: RiskParts = {
    frequency: clamp(i.violations / FULL.violations),
    depth: clamp((i.avgDepthPct ?? 0) / FULL.depthPct),
    recurrence: clamp(i.repeats / FULL.repeats),
    responsiveness: i.noticesDue > 0 ? clamp(i.unanswered / i.noticesDue) : null,
  };
  const w = RISK_WEIGHTS;
  const weightSum = w.frequency + w.depth + w.recurrence + (parts.responsiveness === null ? 0 : w.responsiveness);
  const total = w.frequency * parts.frequency + w.depth * parts.depth + w.recurrence * parts.recurrence
    + (parts.responsiveness === null ? 0 : w.responsiveness * parts.responsiveness);
  return { score: Math.round((100 * total) / weightSum), parts };
}

export interface SellerStats {
  violations: number;
  active: number;
  repeats: number;
  avgDepthPct: number | null;
  ttcHours: number | null; // median, violations that ended on a compliant observation
  compliancePct: number | null; // share of judged observations that were not violations
  noticesSent: number;
  noticesDue: number;
  unanswered: number;
  openCases: number;
  risk: number;
  parts: RiskParts;
}

/** Stats and risk for every seller of the account with judged observations in the window (or the given sellers). */
export async function sellerStats(db: Db, accountId: string, sellerIds?: string[], asOf: Date = new Date()): Promise<Map<string, SellerStats>> {
  // $2 = the moment the window ends (now, or a fixed time in tests), $3 = window length in days.
  const p: unknown[] = [accountId, asOf, RISK_WINDOW_DAYS];
  let only = '';
  if (sellerIds) { p.push(sellerIds); only = 'AND seller_id = ANY($4::uuid[])'; }
  const { rows } = await db.query<{
    seller_id: string; violations: number; active: number; listings: number; avg_depth: number | null; ttc_hours: number | null;
    judged: number; compliant: number; recurred: number; notices_sent: number; notices_due: number; unanswered: number; open_cases: number;
  }>(
    `WITH v AS (
       -- Time to compliance runs from the first breach to the observation that showed the fix.
       SELECT seller_id, count(*)::int AS violations, count(*) FILTER (WHERE NOT episode_closed)::int AS active,
              count(DISTINCT listing_id)::int AS listings, avg(max_depth_pct)::float8 AS avg_depth,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM fixed_at - opened_at) / 3600)
                 FILTER (WHERE fixed_at IS NOT NULL))::float8 AS ttc_hours
         FROM violation_current vc
         LEFT JOIN LATERAL (SELECT vd.observed_at AS fixed_at FROM violation_event e JOIN verdict vd ON vd.id = e.verdict_id
                             WHERE e.violation_id = vc.id AND e.episode_closed AND e.status = 'Resolved' LIMIT 1) fx ON true
        WHERE account_id = $1 AND seller_id IS NOT NULL AND opened_at >= $2::timestamptz - make_interval(days => $3) ${only}
          AND status <> 'Dismissed' AND EXISTS (SELECT 1 FROM listing_match m WHERE m.account_id = vc.account_id AND m.listing_id = vc.listing_id AND m.state = 'Included')
        GROUP BY seller_id),
     j AS (
       SELECT seller_id, count(*)::int AS judged, count(*) FILTER (WHERE outcome NOT IN ('violation', 'needs_review'))::int AS compliant
         FROM verdict vd
        WHERE account_id = $1 AND seller_id IS NOT NULL AND outcome <> 'no_map' AND observed_at >= $2::timestamptz - make_interval(days => $3) ${only}
          AND EXISTS (SELECT 1 FROM listing_match m WHERE m.account_id = vd.account_id AND m.listing_id = vd.listing_id AND m.state = 'Included')
        GROUP BY seller_id),
     c AS (
       SELECT c.seller_id,
              count(*) FILTER (WHERE c.state = 'Recurred')::int AS recurred,
              count(*) FILTER (WHERE NOT c.closed)::int AS open_cases
         FROM case_current c
        WHERE c.account_id = $1 AND (c.opened_at >= $2::timestamptz - make_interval(days => $3) OR NOT c.closed) ${only.replace('seller_id', 'c.seller_id')}
        GROUP BY c.seller_id),
     n AS (
       SELECT c.seller_id, count(*)::int AS notices_sent,
              count(*) FILTER (WHERE c.response_due < ($2::timestamptz)::date)::int AS notices_due,
              count(*) FILTER (WHERE c.response_due < ($2::timestamptz)::date
                AND NOT EXISTS (SELECT 1 FROM communication m WHERE m.case_id = c.id AND m.direction = 'inbound' AND m.occurred_at >= n.sent_at)
                AND NOT EXISTS (SELECT 1 FROM case_event e WHERE e.case_id = c.id AND e.state = 'Resolved' AND e.verdict_id IS NOT NULL))::int AS unanswered
         FROM notice n JOIN case_current c ON c.id = n.case_id
        WHERE n.account_id = $1 AND n.status = 'Sent' AND n.sent_at >= $2::timestamptz - make_interval(days => $3) ${only.replace('seller_id', 'c.seller_id')}
        GROUP BY c.seller_id)
     SELECT s.seller_id, coalesce(v.violations, 0) AS violations, coalesce(v.active, 0) AS active, coalesce(v.listings, 0) AS listings,
            v.avg_depth, v.ttc_hours, coalesce(j.judged, 0) AS judged, coalesce(j.compliant, 0) AS compliant,
            coalesce(c.recurred, 0) AS recurred, coalesce(c.open_cases, 0) AS open_cases,
            coalesce(n.notices_sent, 0) AS notices_sent, coalesce(n.notices_due, 0) AS notices_due, coalesce(n.unanswered, 0) AS unanswered
       FROM (SELECT seller_id FROM v UNION SELECT seller_id FROM j UNION SELECT seller_id FROM c UNION SELECT seller_id FROM n) s
       LEFT JOIN v ON v.seller_id = s.seller_id LEFT JOIN j ON j.seller_id = s.seller_id
       LEFT JOIN c ON c.seller_id = s.seller_id LEFT JOIN n ON n.seller_id = s.seller_id`,
    p,
  );
  const out = new Map<string, SellerStats>();
  for (const r of rows) {
    const repeats = Math.max(0, r.violations - r.listings) + r.recurred;
    const { score, parts } = riskScore({ violations: r.violations, avgDepthPct: r.avg_depth, repeats, noticesDue: r.notices_due, unanswered: r.unanswered });
    out.set(r.seller_id, {
      violations: r.violations, active: r.active, repeats,
      avgDepthPct: r.avg_depth === null ? null : Math.round(r.avg_depth * 10) / 10,
      ttcHours: r.ttc_hours === null ? null : Math.round(r.ttc_hours),
      compliancePct: r.judged ? Math.round((1000 * r.compliant) / r.judged) / 10 : null,
      noticesSent: r.notices_sent, noticesDue: r.notices_due, unanswered: r.unanswered, openCases: r.open_cases,
      risk: score, parts,
    });
  }
  return out;
}

export const EMPTY_STATS: SellerStats = {
  violations: 0, active: 0, repeats: 0, avgDepthPct: null, ttcHours: null, compliancePct: null,
  noticesSent: 0, noticesDue: 0, unanswered: 0, openCases: 0, risk: 0,
  parts: { frequency: 0, depth: 0, recurrence: 0, responsiveness: null },
};
