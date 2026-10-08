// Enforcement cases (Phase 4): one seller's violations grouped for enforcement. A case's state is
// only ever a new case_event row; owner, response due date and the IP flag change in place
// (audited by the routes). When a case moves to Notice sent, its active violations go Under notice.
import type { Db } from './db.js';

export const CASE_STATES = ['Open', 'Notice sent', 'Awaiting response', 'Contested', 'Escalated', 'Resolved', 'Recurred'] as const;
export type CaseState = (typeof CASE_STATES)[number];

/** A resolved case whose seller offends again within this many days is marked Recurred. */
export const RECURRENCE_DAYS = 60;
export const DEFAULT_RESPONSE_DAYS = 7;

export const caseCode = (seq: number) => `C-${String(seq).padStart(5, '0')}`;

/**
 * Moves a person may make, from each state. Notice sent normally comes from logging a notice
 * (M3); by hand it records a notice sent outside MAP Intel and needs a reason. Resolved by hand is
 * a manual close and needs a reason; the re-check resolves a case on a compliant observation.
 * Recurred is set by the system only.
 */
export const MANUAL_MOVES: Record<CaseState, CaseState[]> = {
  Open: ['Notice sent', 'Escalated', 'Resolved'],
  'Notice sent': ['Awaiting response', 'Contested', 'Escalated', 'Resolved'],
  'Awaiting response': ['Contested', 'Escalated', 'Resolved'],
  Contested: ['Awaiting response', 'Escalated', 'Resolved'],
  Escalated: ['Awaiting response', 'Contested', 'Resolved'],
  Resolved: [],
  Recurred: [],
};
const NEEDS_REASON: CaseState[] = ['Notice sent', 'Contested', 'Escalated', 'Resolved'];

export class CaseError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface CaseFilter {
  state?: string[];
  open?: boolean;
  sellerId?: string;
  owner?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const SELECT = `
  SELECT c.id, c.seq, c.state, c.state_at, c.closed, c.violations, c.seller_id, c.source_id, c.owner, to_char(c.response_due, 'YYYY-MM-DD') AS response_due,
         c.ip_issue, c.ip_reason, c.recurred_from, c.opened_at, c.created_by, c.updated_at,
         coalesce(se.name, 'Unknown seller') AS seller, src.code AS source_code, src.display_name AS source,
         ou.email AS owner_email, ou.full_name AS owner_name,
         (SELECT 'C-' || lpad(r.seq::text, 5, '0') FROM enforcement_case r WHERE r.id = c.recurred_from) AS recurred_from_code,
         (SELECT string_agg(DISTINCT p.product_code, ', ' ORDER BY p.product_code)
            FROM case_violation cv JOIN violation v ON v.id = cv.violation_id JOIN product p ON p.id = v.product_id
           WHERE cv.case_id = c.id) AS products,
         (SELECT count(*)::int FROM case_violation cv JOIN violation_current v ON v.id = cv.violation_id
           WHERE cv.case_id = c.id AND NOT v.episode_closed) AS active_violations,
         (NOT c.closed AND c.response_due IS NOT NULL AND c.response_due < current_date) AS overdue
    FROM case_current c
    JOIN source src ON src.id = c.source_id
    LEFT JOIN seller se ON se.id = c.seller_id
    LEFT JOIN app_user ou ON ou.id = c.owner`;

export async function listCases(db: Db, accountId: string, f: CaseFilter = {}) {
  const c: string[] = ['c.account_id = $1'];
  const p: unknown[] = [accountId];
  const add = (sql: string, v: unknown) => { p.push(v); c.push(sql.replace('?', `$${p.length}`)); };
  if (f.state?.length) add('c.state = ANY(?::text[])', f.state);
  if (f.open !== undefined) c.push(f.open ? 'NOT c.closed' : 'c.closed');
  if (f.sellerId) add('c.seller_id = ?::uuid', f.sellerId);
  if (f.owner) add('c.owner = ?::uuid', f.owner);
  if (f.q) {
    p.push(`%${f.q}%`);
    const i = `$${p.length}`;
    c.push(`(se.name ILIKE ${i} OR 'C-' || lpad(c.seq::text, 5, '0') ILIKE ${i})`);
  }
  const where = `WHERE ${c.join(' AND ')}`;
  const n = p.length;
  const rows = (await db.query(`${SELECT} ${where} ORDER BY c.closed, c.response_due NULLS LAST, c.opened_at DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...p, f.limit ?? 200, f.offset ?? 0])).rows;
  const total = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM case_current c LEFT JOIN seller se ON se.id = c.seller_id ${where}`, p)).rows[0].n;
  const counts = (await db.query<{ state: string; n: number }>(
    'SELECT state, count(*)::int AS n FROM case_current WHERE account_id = $1 GROUP BY state', [accountId])).rows;
  return { total, rows: rows.map((r) => ({ ...r, code: caseCode(r.seq) })), counts: Object.fromEntries(counts.map((x) => [x.state, x.n])) };
}

export async function caseDetail(db: Db, caseId: string) {
  const c = (await db.query(`${SELECT} WHERE c.id = $1`, [caseId])).rows[0];
  if (!c) return null;
  const violations = (await db.query(
    `SELECT v.id, 'V-' || lpad(v.seq::text, 5, '0') AS code, v.status, v.severity, v.episode_closed, v.opened_at, v.last_seen,
            v.last_price::float8 AS last_price, v.last_map::float8 AS last_map, v.last_depth_pct::float8 AS last_depth_pct,
            p.product_code AS sku, p.name AS product, l.url, cv.added_at
       FROM case_violation cv JOIN violation_current v ON v.id = cv.violation_id
       JOIN product p ON p.id = v.product_id JOIN listing l ON l.id = v.listing_id
      WHERE cv.case_id = $1 ORDER BY v.seq`,
    [caseId],
  )).rows;
  const events = (await db.query(
    `SELECT e.id, e.state, e.reason, e.created_at, coalesce(u.email, 'System') AS actor, vd.observed_at
       FROM case_event e LEFT JOIN app_user u ON u.id = e.actor LEFT JOIN verdict vd ON vd.id = e.verdict_id
      WHERE e.case_id = $1 ORDER BY e.created_at, e.id`,
    [caseId],
  )).rows;
  const contacts = (await db.query(
    'SELECT kind, value, label FROM seller_contact WHERE seller_id = $1 ORDER BY (label = \'Notices\') DESC NULLS LAST, created_at',
    [c.seller_id],
  )).rows;
  return { ...c, code: caseCode(c.seq), violations, events, contacts };
}

async function responseDays(db: Db, accountId: string): Promise<number> {
  const s = (await db.query<{ settings: Record<string, unknown> | null }>('SELECT settings FROM account WHERE id = $1', [accountId])).rows[0]?.settings;
  const d = Number(s?.case_response_days);
  return Number.isInteger(d) && d > 0 ? d : DEFAULT_RESPONSE_DAYS;
}

/** The owner must work on this account (not a Brand user), or be a platform administrator. */
async function checkOwner(db: Db, accountId: string, owner: string | null | undefined): Promise<void> {
  if (!owner) return;
  const ok = (await db.query(
    `SELECT 1 FROM app_user u
      WHERE u.id = $2 AND u.status = 'Active'
        AND (u.platform_role = 'admin'
             OR EXISTS (SELECT 1 FROM account_membership m WHERE m.account_id = $1 AND m.user_id = u.id AND m.role <> 'Brand user'))`,
    [accountId, owner],
  )).rowCount;
  if (!ok) throw new CaseError(400, 'the owner must be an analyst or manager on this account');
}

interface ActiveViolation { id: string; seq: number; seller_id: string | null; source_id: string; episode_closed: boolean; case_id: string | null }

async function loadViolations(db: Db, accountId: string, ids: string[]): Promise<ActiveViolation[]> {
  const rows = (await db.query<ActiveViolation>(
    `SELECT v.id, v.seq, v.seller_id, v.source_id, v.episode_closed, cv.case_id
       FROM violation_current v LEFT JOIN case_violation cv ON cv.violation_id = v.id
      WHERE v.account_id = $1 AND v.id = ANY($2::uuid[])`,
    [accountId, ids],
  )).rows;
  if (rows.length !== new Set(ids).size) throw new CaseError(404, 'violation not found in this account');
  const code = (v: ActiveViolation) => `V-${String(v.seq).padStart(5, '0')}`;
  const ended = rows.filter((v) => v.episode_closed);
  if (ended.length) throw new CaseError(409, `${ended.map(code).join(', ')} has ended: only active violations go into a case`);
  const taken = rows.filter((v) => v.case_id);
  if (taken.length) throw new CaseError(409, `${taken.map(code).join(', ')} is already in a case`);
  if (rows.some((v) => !v.seller_id)) throw new CaseError(400, 'a violation with an unknown seller cannot go into a case');
  return rows;
}

export interface NewCase {
  violationIds: string[];
  owner?: string | null;
  responseDue?: string | null; // YYYY-MM-DD
  note?: string | null;
}

/**
 * Open a case for one seller's active violations. If the same seller had a case resolved within
 * RECURRENCE_DAYS, that case is marked Recurred and the new one points back to it.
 */
export async function createCase(db: Db, accountId: string, input: NewCase, actor: string | null) {
  const vs = await loadViolations(db, accountId, [...new Set(input.violationIds)]);
  const sellers = new Set(vs.map((v) => v.seller_id));
  if (sellers.size !== 1) throw new CaseError(400, 'a case covers one seller: pick violations of the same seller');
  const sellerId = vs[0].seller_id!;
  await checkOwner(db, accountId, input.owner);

  const due = input.responseDue ?? (await db.query<{ d: string }>(
    "SELECT to_char(current_date + $1::int, 'YYYY-MM-DD') AS d", [await responseDays(db, accountId)])).rows[0].d;
  const prior = (await db.query<{ id: string; seq: number }>(
    `SELECT c.id, c.seq FROM case_current c
      WHERE c.account_id = $1 AND c.seller_id = $2 AND c.state = 'Resolved' AND c.state_at >= now() - make_interval(days => $3)
      ORDER BY c.state_at DESC LIMIT 1`,
    [accountId, sellerId, RECURRENCE_DAYS],
  )).rows[0];

  // One case number at a time per account.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`case-seq:${accountId}`]);
  const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM enforcement_case WHERE account_id = $1', [accountId])).rows[0].n;
  const id = (await db.query<{ id: string }>(
    `INSERT INTO enforcement_case (account_id, seq, seller_id, source_id, owner, response_due, recurred_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [accountId, seq, sellerId, vs[0].source_id, input.owner ?? null, due, prior?.id ?? null, actor],
  )).rows[0].id;
  for (const v of vs) {
    await db.query('INSERT INTO case_violation (case_id, violation_id, account_id, added_by) VALUES ($1, $2, $3, $4)', [id, v.id, accountId, actor]);
  }
  await addEvent(db, accountId, id, 'Open', input.note?.trim() || null, actor);
  if (prior) await addEvent(db, accountId, prior.id, 'Recurred', `Seller offended again: ${caseCode(seq)}`, null);
  return { id, code: caseCode(seq), recurredFrom: prior ? caseCode(prior.seq) : null };
}

async function currentCase(db: Db, caseId: string) {
  const c = (await db.query<{ id: string; seq: number; account_id: string; state: CaseState; closed: boolean; seller_id: string }>(
    'SELECT id, seq, account_id, state, closed, seller_id FROM case_current WHERE id = $1', [caseId])).rows[0];
  if (!c) throw new CaseError(404, 'case not found');
  return c;
}

/** Add more of the same seller's active violations to an open case. */
export async function addViolations(db: Db, accountId: string, caseId: string, violationIds: string[], actor: string | null) {
  const c = await currentCase(db, caseId);
  if (c.closed) throw new CaseError(409, `${caseCode(c.seq)} is closed: open a new case`);
  const vs = await loadViolations(db, accountId, [...new Set(violationIds)]);
  if (vs.some((v) => v.seller_id !== c.seller_id)) throw new CaseError(400, "only this case's seller's violations can be added");
  for (const v of vs) {
    await db.query('INSERT INTO case_violation (case_id, violation_id, account_id, added_by) VALUES ($1, $2, $3, $4)', [caseId, v.id, accountId, actor]);
  }
  // Already under notice: the new ones are too.
  if (c.state !== 'Open') await markUnderNotice(db, accountId, caseId, actor);
  return { code: caseCode(c.seq), added: vs.length };
}

/** A person moves the case on. Returns the before / after state for the audit log. */
export async function moveCase(db: Db, accountId: string, caseId: string, to: CaseState, reason: string | null, actor: string | null) {
  const c = await currentCase(db, caseId);
  if (!MANUAL_MOVES[c.state].includes(to)) {
    throw new CaseError(409, c.closed ? `${caseCode(c.seq)} is closed` : `a case cannot move from ${c.state} to ${to}`);
  }
  if (NEEDS_REASON.includes(to) && !reason?.trim()) throw new CaseError(400, `${to} needs a reason`);
  await addEvent(db, accountId, caseId, to, reason?.trim() || null, actor);
  if (to === 'Notice sent') await markUnderNotice(db, accountId, caseId, actor);
  return { code: caseCode(c.seq), before: c.state, after: to };
}

export interface CasePatch {
  owner?: string | null;
  responseDue?: string | null;
  ipIssue?: boolean;
  ipReason?: string | null;
}

export async function updateCase(db: Db, accountId: string, caseId: string, patch: CasePatch) {
  const c = await currentCase(db, caseId);
  if (c.closed) throw new CaseError(409, `${caseCode(c.seq)} is closed`);
  if (patch.owner !== undefined) await checkOwner(db, accountId, patch.owner);
  if (patch.ipIssue === true && !patch.ipReason?.trim()) throw new CaseError(400, 'marking a case as an IP issue needs a reason');
  const before = (await db.query('SELECT owner, response_due, ip_issue, ip_reason FROM enforcement_case WHERE id = $1', [caseId])).rows[0];
  const sets: string[] = [];
  const p: unknown[] = [caseId];
  const set = (col: string, v: unknown) => { p.push(v); sets.push(`${col} = $${p.length}`); };
  if (patch.owner !== undefined) set('owner', patch.owner);
  if (patch.responseDue !== undefined) set('response_due', patch.responseDue);
  if (patch.ipIssue !== undefined) {
    set('ip_issue', patch.ipIssue);
    set('ip_reason', patch.ipIssue ? patch.ipReason!.trim() : null);
  }
  if (!sets.length) throw new CaseError(400, 'nothing to change');
  try {
    await db.query(`UPDATE enforcement_case SET ${sets.join(', ')} WHERE id = $1`, p);
  } catch (err) {
    if ((err as { code?: string }).code === '23514') throw new CaseError(409, (err as Error).message);
    throw err;
  }
  return { code: caseCode(c.seq), before };
}

async function addEvent(db: Db, accountId: string, caseId: string, state: CaseState, reason: string | null, actor: string | null, verdictId: string | null = null) {
  await db.query('INSERT INTO case_event (account_id, case_id, state, reason, actor, verdict_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [accountId, caseId, state, reason, actor, verdictId]);
}

/** The case's active Open / Needs review violations become Under notice (a Dismissed or promo one stays as it is). */
async function markUnderNotice(db: Db, accountId: string, caseId: string, actor: string | null): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO violation_event (account_id, violation_id, status, reason, actor)
     SELECT $1, v.id, 'Under notice', 'Case ' || $3, $4
       FROM case_violation cv JOIN violation_current v ON v.id = cv.violation_id
      WHERE cv.case_id = $2 AND NOT v.episode_closed AND v.status IN ('Open', 'Needs review')`,
    [accountId, caseId, caseCode((await currentCase(db, caseId)).seq), actor],
  );
  return rowCount ?? 0;
}
