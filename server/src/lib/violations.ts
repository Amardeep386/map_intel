// Violations (Phase 3): the list every screen and report reads, a violation's detail, and status
// changes. Status is never updated in place: each change is a violation_event row.
import type { Db } from './db.js';
import type { ViolationStatus } from './rules.js';

export const STATUSES: ViolationStatus[] = ['Open', 'Needs review', 'Under notice', 'Authorised promo', 'Resolved', 'Dismissed'];
export const SEVERITIES = ['Minor', 'Standard', 'Severe'] as const;

/**
 * Episodes of listings that are no longer Included end: we no longer watch them. The judge runs
 * this after each pass, and Mapping Center runs it straight after an exclude / restore / retire so
 * the violation leaves the open list at once. Returns how many episodes it closed.
 */
export async function closeUnwatched(db: Db, accountId: string): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO violation_event (account_id, violation_id, status, episode_closed, reason)
     SELECT v.account_id, v.id, 'Dismissed', true, 'Listing no longer included'
       FROM violation v
      WHERE v.account_id = $1
        AND NOT EXISTS (SELECT 1 FROM violation_event c WHERE c.violation_id = v.id AND c.episode_closed)
        AND NOT EXISTS (SELECT 1 FROM listing_match m WHERE m.account_id = v.account_id AND m.listing_id = v.listing_id AND m.state = 'Included')`,
    [accountId],
  );
  return rowCount ?? 0;
}

export interface ViolationFilter {
  status?: string[];
  severity?: string[];
  source?: string; // source code
  sellerId?: string;
  productId?: string;
  q?: string;
  active?: boolean; // episode not closed
  from?: Date; // active at any time in [from, to): opened before `to`, not closed before `from`
  to?: Date;
  limit?: number;
  offset?: number;
}

export const violationCode = (seq: number) => `V-${String(seq).padStart(5, '0')}`;

/** Columns shared by the list, reports and the evidence page. */
const SELECT = `
  SELECT v.id, v.seq, v.status, v.status_at, v.status_reason, v.severity, v.last_severity, v.opened_at, v.last_seen, v.closed_at,
         v.episode_closed, v.observations, v.last_price::float8 AS last_price, v.last_map::float8 AS last_map,
         v.last_depth_abs::float8 AS last_depth_abs, v.last_depth_pct::float8 AS last_depth_pct, v.max_depth_pct::float8 AS max_depth_pct,
         v.class_at_capture, v.listing_id, v.product_id, v.seller_id, v.rule_version_id,
         p.product_code AS sku, p.name AS product, coalesce(se.name, 'Unknown seller') AS seller,
         src.code AS source_code, src.display_name AS source, l.url, l.title,
         (SELECT r.code || ' v' || rv.version FROM rule_version rv JOIN rule r ON r.id = rv.rule_id WHERE rv.id = v.rule_version_id) AS rule,
         (SELECT e.id FROM violation_observation vo JOIN verdict vd ON vd.id = vo.verdict_id
            JOIN evidence e ON e.observation_id = vd.observation_id AND e.observed_at = vd.observed_at
           WHERE vo.violation_id = v.id ORDER BY vo.observed_at DESC LIMIT 1) AS evidence_id
    FROM violation_current v
    JOIN product p ON p.id = v.product_id
    JOIN source src ON src.id = v.source_id
    JOIN listing l ON l.id = v.listing_id
    LEFT JOIN seller se ON se.id = v.seller_id`;

function where(accountId: string, f: ViolationFilter): { sql: string; params: unknown[] } {
  const c: string[] = ['v.account_id = $1'];
  const p: unknown[] = [accountId];
  const add = (sql: string, v: unknown) => { p.push(v); c.push(sql.replace('?', `$${p.length}`)); };
  if (f.status?.length) add('v.status = ANY(?::text[])', f.status);
  if (f.severity?.length) add('v.severity = ANY(?::text[])', f.severity);
  if (f.source) add('src.code = ?', f.source);
  if (f.sellerId) add('v.seller_id = ?::uuid', f.sellerId);
  if (f.productId) add('v.product_id = ?::uuid', f.productId);
  if (f.active !== undefined) c.push(f.active ? 'NOT v.episode_closed' : 'v.episode_closed');
  if (f.to) add('v.opened_at < ?', f.to);
  if (f.from) add('(v.closed_at IS NULL OR v.closed_at >= ?)', f.from);
  if (f.q) {
    p.push(`%${f.q}%`);
    const i = `$${p.length}`;
    c.push(`(p.product_code ILIKE ${i} OR p.name ILIKE ${i} OR se.name ILIKE ${i} OR 'V-' || lpad(v.seq::text, 5, '0') ILIKE ${i})`);
  }
  return { sql: `WHERE ${c.join(' AND ')}`, params: p };
}

export async function listViolations(db: Db, accountId: string, f: ViolationFilter = {}) {
  const w = where(accountId, f);
  const n = w.params.length;
  const rows = (await db.query(
    `${SELECT} ${w.sql} ORDER BY v.episode_closed, v.max_depth_pct DESC NULLS LAST, v.opened_at DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, f.limit ?? 200, f.offset ?? 0],
  )).rows;
  const total = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM violation_current v JOIN product p ON p.id = v.product_id JOIN source src ON src.id = v.source_id
       LEFT JOIN seller se ON se.id = v.seller_id ${w.sql}`,
    w.params,
  )).rows[0].n;
  return { total, rows: rows.map((r) => ({ ...r, code: violationCode(r.seq) })) };
}

export async function violationDetail(db: Db, violationId: string) {
  const v = (await db.query(`${SELECT} WHERE v.id = $1`, [violationId])).rows[0];
  if (!v) return null;
  const events = (await db.query(
    `SELECT e.id, e.status, e.reason, e.episode_closed, e.created_at, coalesce(u.email, 'System') AS actor, vd.observed_at
       FROM violation_event e LEFT JOIN app_user u ON u.id = e.actor LEFT JOIN verdict vd ON vd.id = e.verdict_id
      WHERE e.violation_id = $1 ORDER BY e.created_at, e.id`,
    [violationId],
  )).rows;
  // Every judged observation of the listing around the episode, with its proof.
  const history = (await db.query(
    `SELECT vd.observation_id, vd.observed_at, vd.observed_price::float8 AS price, vd.map_amount::float8 AS map, vd.promo_amount::float8 AS promo,
            vd.depth_pct::float8 AS depth_pct, vd.outcome, vd.severity, vd.class_at_capture,
            (vo.violation_id IS NOT NULL) AS in_violation,
            e.id AS evidence_id, (e.screenshot_uri IS NOT NULL) AS has_screenshot, (e.api_uri IS NOT NULL) AS has_api,
            (c.id IS NOT NULL) AS has_card, (e.html_uri IS NOT NULL) AS has_html
       FROM verdict vd
       LEFT JOIN violation_observation vo ON vo.verdict_id = vd.id AND vo.violation_id = $1
       LEFT JOIN evidence e ON e.observation_id = vd.observation_id AND e.observed_at = vd.observed_at
       LEFT JOIN evidence_card c ON c.evidence_id = e.id
      WHERE vd.listing_id = $2 AND vd.observed_at >= $3::timestamptz - interval '14 days'
      ORDER BY vd.observed_at DESC LIMIT 60`,
    [violationId, v.listing_id, v.opened_at],
  )).rows;
  const policy = (await db.query(
    `SELECT name, version, effective_from FROM policy_document
      WHERE effective_from <= $1 AND (effective_to IS NULL OR $1 < effective_to) ORDER BY effective_from DESC LIMIT 1`,
    [v.opened_at],
  )).rows[0] ?? null;
  return { ...v, code: violationCode(v.seq), events, history, policy };
}

/** Which manual changes are allowed from which status, and whether they end the episode. */
export const MANUAL: Record<string, { closes: boolean; needsReason: boolean }> = {
  Open: { closes: false, needsReason: false },
  'Needs review': { closes: false, needsReason: false },
  'Under notice': { closes: false, needsReason: false },
  'Authorised promo': { closes: false, needsReason: true },
  Dismissed: { closes: false, needsReason: true }, // keeps absorbing observations until a compliant one
  Resolved: { closes: true, needsReason: true }, // manual close with a reason
};

export class ViolationError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export async function changeStatus(db: Db, accountId: string, violationId: string, status: ViolationStatus, reason: string | null, actor: string | null) {
  const rule = MANUAL[status];
  if (!rule) throw new ViolationError(400, `unknown status ${status}`);
  if (rule.needsReason && !reason?.trim()) throw new ViolationError(400, `${status} needs a reason`);
  const cur = (await db.query<{ status: string; episode_closed: boolean; seq: number }>(
    'SELECT status, episode_closed, seq FROM violation_current WHERE id = $1', [violationId])).rows[0];
  if (!cur) throw new ViolationError(404, 'violation not found');
  if (cur.episode_closed) throw new ViolationError(409, 'this violation has ended; a new breach opens a new violation');
  if (cur.status === status) throw new ViolationError(409, `already ${status}`);
  await db.query(
    'INSERT INTO violation_event (account_id, violation_id, status, episode_closed, reason, actor) VALUES ($1, $2, $3, $4, $5, $6)',
    [accountId, violationId, status, rule.closes, reason?.trim() || null, actor],
  );
  return { before: cur.status, after: status, code: violationCode(cur.seq) };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
