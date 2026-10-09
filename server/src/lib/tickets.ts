// Internal tickets (Phase 5 · M4): Mirethos's tracker for operational issues, separate from cases.
// Platform administrators open and work them; syncTickets (hourly) opens one per issue it detects
// and resolves it when the issue is gone:
//   * source: a subscribed source's latest health for a live / sandbox account is Failing or Blocked
//   * mapping: an account has a Mapping Center backlog (BACKLOG_MIN+ listings staged for BACKLOG_DAYS+ days)
// Every change is a ticket_event (append-only history).
import type { Db } from './db.js';

export const KINDS = ['source', 'mapping', 'data_quality', 'onboarding', 'other'] as const;
export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;
export const STATUSES = ['Open', 'In progress', 'Waiting', 'Resolved'] as const;
export type Kind = (typeof KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];

export const BACKLOG_MIN = 25;
export const BACKLOG_DAYS = 3;

export class TicketError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- automatic tickets

/** An issue the sync found now. */
export interface Issue {
  key: string; // dedupe_key
  kind: Kind;
  title: string;
  description: string;
  priority: Priority;
  accountId: string;
  sourceId: string | null;
  links: Record<string, unknown>;
}

export interface OpenAuto {
  id: string;
  key: string;
}

/** Pure: which issues need a new ticket and which open automatic tickets are resolved. */
export function planSync(issues: Issue[], open: OpenAuto[]): { toOpen: Issue[]; toResolve: OpenAuto[] } {
  const openKeys = new Set(open.map((o) => o.key));
  const issueKeys = new Set(issues.map((i) => i.key));
  return { toOpen: issues.filter((i) => !openKeys.has(i.key)), toResolve: open.filter((o) => !issueKeys.has(o.key)) };
}

export function sourceIssue(r: { account_id: string; account: string; source_id: string; source: string; health: string; main_failure: string | null; crawl_run_id: string; created_at: Date }): Issue {
  return {
    key: `source:${r.account_id}:${r.source_id}`,
    kind: 'source',
    title: `${r.source} is ${r.health.toLowerCase()} for ${r.account}`,
    description: `The latest collection run (${r.created_at.toISOString().slice(0, 16).replace('T', ' ')} UTC) found ${r.source} ${r.health}${r.main_failure ? `, mostly "${r.main_failure}"` : ''}. See Data Health for the failed jobs.`,
    priority: r.health === 'Blocked' ? 'High' : 'Normal',
    accountId: r.account_id,
    sourceId: r.source_id,
    links: { view: 'health', crawlRunId: r.crawl_run_id },
  };
}

export function backlogIssue(r: { account_id: string; account: string; staged: number; oldest: Date }): Issue {
  return {
    key: `mapping:${r.account_id}`,
    kind: 'mapping',
    title: `Mapping backlog for ${r.account}: ${r.staged} listings waiting`,
    description: `${r.staged} listings have been staged for review in the Mapping Center for ${BACKLOG_DAYS} days or more (oldest since ${r.oldest.toISOString().slice(0, 10)}). Unreviewed listings are not judged.`,
    priority: r.staged >= 100 ? 'High' : 'Normal',
    accountId: r.account_id,
    sourceId: null,
    links: { view: 'mapping' },
  };
}

/** Find the issues and open / resolve automatic tickets. Runs as the system (hourly job). */
export async function syncTickets(db: Db, now: Date = new Date()): Promise<{ opened: string[]; resolved: string[] }> {
  const sources = (await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (h.account_id, h.source_id) h.account_id, h.source_id, h.health, h.main_failure, h.crawl_run_id, h.created_at
         FROM source_health_snapshot h ORDER BY h.account_id, h.source_id, h.created_at DESC)
     SELECT l.*, a.name AS account, s.display_name AS source
       FROM latest l
       JOIN account a ON a.id = l.account_id AND a.status IN ('Sandbox', 'Active')
       JOIN account_source x ON x.account_id = l.account_id AND x.source_id = l.source_id AND x.active
       JOIN source s ON s.id = l.source_id
      WHERE l.health IN ('Failing', 'Blocked')`,
  )).rows;
  const backlogs = (await db.query(
    `SELECT m.account_id, a.name AS account, count(*)::int AS staged, min(m.state_since) AS oldest
       FROM listing_match m JOIN account a ON a.id = m.account_id AND a.status IN ('Sandbox', 'Active')
      WHERE m.state = 'Staged' AND m.state_since < $1::timestamptz - make_interval(days => $2)
      GROUP BY m.account_id, a.name HAVING count(*) >= $3`,
    [now, BACKLOG_DAYS, BACKLOG_MIN],
  )).rows;
  const issues = [...sources.map(sourceIssue), ...backlogs.map(backlogIssue)];
  const open = (await db.query<OpenAuto>("SELECT id, dedupe_key AS key FROM ticket WHERE origin = 'auto' AND status <> 'Resolved'")).rows;
  const plan = planSync(issues, open);

  const opened: string[] = [];
  for (const i of plan.toOpen) {
    const t = (await db.query<{ id: string; code: string }>(
      `INSERT INTO ticket (title, description, kind, priority, account_id, source_id, origin, dedupe_key, links)
       VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7, $8) ON CONFLICT DO NOTHING RETURNING id, code`,
      [i.title, i.description, i.kind, i.priority, i.accountId, i.sourceId, i.key, JSON.stringify(i.links)],
    )).rows[0];
    if (!t) continue;
    await db.query("INSERT INTO ticket_event (ticket_id, kind, body) VALUES ($1, 'opened', 'Opened automatically')", [t.id]);
    opened.push(t.code);
  }
  const resolved: string[] = [];
  for (const o of plan.toResolve) {
    const t = (await db.query<{ code: string; status: string }>("SELECT code, status FROM ticket WHERE id = $1 AND status <> 'Resolved' FOR UPDATE", [o.id])).rows[0];
    if (!t) continue;
    await db.query("UPDATE ticket SET status = 'Resolved', resolved_at = now(), updated_at = now() WHERE id = $1", [o.id]);
    await db.query(
      "INSERT INTO ticket_event (ticket_id, kind, body, before, after) VALUES ($1, 'auto', $2, $3, '{\"status\": \"Resolved\"}')",
      [o.id, o.key.startsWith('source:') ? 'The source is healthy again (or no longer subscribed): resolved automatically' : 'The backlog is cleared: resolved automatically', JSON.stringify({ status: t.status })],
    );
    resolved.push(t.code);
  }
  return { opened, resolved };
}

// ---------------------------------------------------------------- people

export interface NewTicket {
  title: string;
  description?: string;
  kind: Kind;
  priority?: Priority;
  accountId?: string | null;
  sourceId?: string | null;
  assigneeId?: string | null;
}

async function checkAssignee(db: Db, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const ok = (await db.query("SELECT 1 FROM app_user WHERE id = $1 AND platform_role = 'admin' AND status = 'Active'", [assigneeId])).rowCount;
  if (!ok) throw new TicketError(400, 'tickets are assigned to Mirethos platform administrators only');
}

export async function createTicket(db: Db, t: NewTicket, actorId: string): Promise<{ id: string; code: string }> {
  await checkAssignee(db, t.assigneeId);
  const row = (await db.query<{ id: string; code: string }>(
    `INSERT INTO ticket (title, description, kind, priority, account_id, source_id, assignee_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, code`,
    [t.title.trim(), t.description?.trim() || null, t.kind, t.priority ?? 'Normal', t.accountId ?? null, t.sourceId ?? null, t.assigneeId ?? null, actorId],
  )).rows[0];
  await db.query("INSERT INTO ticket_event (ticket_id, kind, actor_id) VALUES ($1, 'opened', $2)", [row.id, actorId]);
  return row;
}

export interface TicketFilters {
  status?: 'active' | Status;
  kind?: Kind;
  accountId?: string;
  assignee?: 'me' | 'none';
}

const SELECT = `
  SELECT t.id, t.code, t.title, t.description, t.kind, t.priority, t.status, t.origin, t.links,
         t.account_id, a.name AS account, t.source_id, s.display_name AS source,
         t.assignee_id, u.full_name AS assignee, c.full_name AS created_by, t.created_at, t.updated_at, t.resolved_at
    FROM ticket t
    LEFT JOIN account a ON a.id = t.account_id
    LEFT JOIN source s ON s.id = t.source_id
    LEFT JOIN app_user u ON u.id = t.assignee_id
    LEFT JOIN app_user c ON c.id = t.created_by`;

const PRIORITY_ORDER = "CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END";

export async function listTickets(db: Db, f: TicketFilters, userId: string) {
  const { rows } = await db.query(
    `${SELECT}
      WHERE ($1::text IS NULL OR ($1 = 'active' AND t.status <> 'Resolved') OR t.status = $1)
        AND ($2::text IS NULL OR t.kind = $2)
        AND ($3::uuid IS NULL OR t.account_id = $3)
        AND ($4::text IS NULL OR ($4 = 'me' AND t.assignee_id = $5) OR ($4 = 'none' AND t.assignee_id IS NULL))
      ORDER BY (t.status = 'Resolved'), ${PRIORITY_ORDER}, t.updated_at DESC
      LIMIT 500`,
    [f.status ?? null, f.kind ?? null, f.accountId ?? null, f.assignee ?? null, userId],
  );
  const counts = (await db.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM ticket GROUP BY status')).rows;
  return { tickets: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

export async function ticketDetail(db: Db, id: string) {
  const t = (await db.query(`${SELECT} WHERE t.id = $1`, [id])).rows[0];
  if (!t) return null;
  const events = (await db.query(
    `SELECT e.id, e.kind, e.body, e.before, e.after, e.created_at, coalesce(u.full_name, 'System') AS actor
       FROM ticket_event e LEFT JOIN app_user u ON u.id = e.actor_id WHERE e.ticket_id = $1 ORDER BY e.created_at, e.id`,
    [id],
  )).rows;
  return { ...t, events };
}

export interface TicketPatch {
  status?: Status;
  priority?: Priority;
  assigneeId?: string | null;
  note?: string;
}

/** Change status, priority or assignee; each change is an event. Returns what changed (for the audit). */
export async function updateTicket(db: Db, id: string, p: TicketPatch, actorId: string) {
  const before = (await db.query<{ code: string; status: Status; priority: Priority; assignee_id: string | null }>(
    'SELECT code, status, priority, assignee_id FROM ticket WHERE id = $1 FOR UPDATE',
    [id],
  )).rows[0];
  if (!before) throw new TicketError(404, 'ticket not found');
  if (p.assigneeId !== undefined) await checkAssignee(db, p.assigneeId);
  const changes: { kind: 'status' | 'priority' | 'assignee'; before: unknown; after: unknown }[] = [];
  if (p.status && p.status !== before.status) changes.push({ kind: 'status', before: before.status, after: p.status });
  if (p.priority && p.priority !== before.priority) changes.push({ kind: 'priority', before: before.priority, after: p.priority });
  if (p.assigneeId !== undefined && p.assigneeId !== before.assignee_id) changes.push({ kind: 'assignee', before: before.assignee_id, after: p.assigneeId });
  if (!changes.length && !p.note?.trim()) return { code: before.code, changes };
  const status = p.status ?? before.status;
  await db.query(
    `UPDATE ticket SET status = $2, priority = $3, assignee_id = $4, updated_at = now(),
            resolved_at = CASE WHEN $2 = 'Resolved' THEN coalesce(resolved_at, now()) ELSE NULL END
      WHERE id = $1`,
    [id, status, p.priority ?? before.priority, p.assigneeId !== undefined ? p.assigneeId : before.assignee_id],
  );
  for (const c of changes) {
    await db.query('INSERT INTO ticket_event (ticket_id, kind, before, after, actor_id) VALUES ($1, $2, $3, $4, $5)', [
      id,
      c.kind,
      JSON.stringify({ [c.kind]: c.before }),
      JSON.stringify({ [c.kind]: c.after }),
      actorId,
    ]);
  }
  if (p.note?.trim()) await db.query("INSERT INTO ticket_event (ticket_id, kind, body, actor_id) VALUES ($1, 'comment', $2, $3)", [id, p.note.trim(), actorId]);
  return { code: before.code, changes };
}
