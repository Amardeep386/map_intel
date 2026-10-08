// Notices (Phase 4 · M3): letters to a case's seller, filled from a template, the case's active
// violations with a secure evidence link each, the seller's contact and the MAP policy in force.
// Draft → (brand approval when the account requires it) → Sent. "Sent" goes through the mailer,
// which only logs until an email provider is configured (decision 42): the analyst copies or
// downloads the letter and sends it. The database freezes the letter once it leaves Draft.
import { caseCode, CaseError, markUnderNotice } from './cases.js';
import type { Db } from './db.js';
import { createLink } from './evidenceLinks.js';
import { sendMail } from './mailer.js';

export const NOTICE_STATUSES = ['Draft', 'Awaiting approval', 'Approved', 'Rejected', 'Sent', 'Cancelled'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];
export const CHANNELS = ['email', 'marketplace message', 'phone', 'letter', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Evidence links in a notice stay valid this long. */
export const NOTICE_LINK_DAYS = 90;

export const noticeCode = (seq: number) => `N-${String(seq).padStart(5, '0')}`;
export const PLACEHOLDERS = ['brand', 'seller', 'source', 'period', 'violationCount', 'violationTable', 'responseDue', 'policy', 'sellerHistory', 'signature'] as const;

const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (n: number | null, currency: string) =>
  n === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);

/** Fill {{placeholders}}; unknown ones are left in place so a submit can refuse them. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}
export const unfilled = (text: string) => [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];

interface CaseRow { id: string; seq: number; closed: boolean; state: string; seller_id: string; seller: string; source: string; response_due: string | null }

async function loadCase(db: Db, caseId: string): Promise<CaseRow> {
  const c = (await db.query<CaseRow>(
    `SELECT c.id, c.seq, c.closed, c.state, c.seller_id, coalesce(se.name, 'Unknown seller') AS seller, src.display_name AS source,
            to_char(c.response_due, 'YYYY-MM-DD') AS response_due
       FROM case_current c JOIN source src ON src.id = c.source_id LEFT JOIN seller se ON se.id = c.seller_id
      WHERE c.id = $1`, [caseId])).rows[0];
  if (!c) throw new CaseError(404, 'case not found');
  return c;
}

export interface NewNotice { templateId: string; recipients?: string[] | null }

/**
 * Draft a notice for a case from a template. Each active violation gets a fresh evidence link,
 * frozen into the notice. Recipients default to the seller's email contacts ("Notices" first).
 */
export async function draftNotice(db: Db, accountId: string, caseId: string, input: NewNotice, actor: string | null) {
  const c = await loadCase(db, caseId);
  if (c.closed) throw new CaseError(409, `${caseCode(c.seq)} is closed`);
  const t = (await db.query<{ id: string; subject: string; body: string; version: number; attaches_policy: boolean; active: boolean }>(
    'SELECT id, subject, body, version, attaches_policy, active FROM notice_template WHERE id = $1', [input.templateId])).rows[0];
  if (!t) throw new CaseError(404, 'template not found');
  if (!t.active) throw new CaseError(409, 'this template is switched off');

  const acct = (await db.query<{ name: string; brand: string; currency: string; settings: Record<string, unknown> | null }>(
    'SELECT name, brand, currency, settings FROM account WHERE id = $1', [accountId])).rows[0];
  const vs = (await db.query<{ id: string; seq: number; sku: string; product: string; url: string; last_price: number | null; last_map: number | null; last_depth_pct: number | null; opened_at: Date; last_seen: Date }>(
    `SELECT v.id, v.seq, p.product_code AS sku, p.name AS product, l.url, v.last_price::float8 AS last_price, v.last_map::float8 AS last_map,
            v.last_depth_pct::float8 AS last_depth_pct, v.opened_at, v.last_seen
       FROM case_violation cv JOIN violation_current v ON v.id = cv.violation_id
       JOIN product p ON p.id = v.product_id JOIN listing l ON l.id = v.listing_id
      WHERE cv.case_id = $1 AND NOT v.episode_closed AND v.status IN ('Open', 'Needs review', 'Under notice') ORDER BY v.seq`, [caseId])).rows;
  if (!vs.length) throw new CaseError(409, `${caseCode(c.seq)} has no active violations to write about`);

  const evidence: { violationId: string; code: string; linkId: string; url: string; expiresAt: string }[] = [];
  for (const v of vs) {
    const l = await createLink(db, { accountId, scope: 'violation:view', violationId: v.id, days: NOTICE_LINK_DAYS, createdBy: actor, via: 'notice' });
    evidence.push({ violationId: v.id, code: `V-${String(v.seq).padStart(5, '0')}`, linkId: l.id, url: l.url, expiresAt: l.expiresAt.toISOString() });
  }
  const policy = (await db.query<{ id: string; name: string; version: number }>(
    `SELECT id, name, version FROM policy_document
      WHERE effective_from <= now() AND (effective_to IS NULL OR now() < effective_to) ORDER BY effective_from DESC LIMIT 1`)).rows[0] ?? null;
  const history = (await db.query<{ cases: number; violations: number }>(
    `SELECT (SELECT count(*)::int FROM enforcement_case WHERE seller_id = $1 AND id <> $2) AS cases,
            (SELECT count(*)::int FROM violation WHERE seller_id = $1 AND opened_at >= now() - interval '90 days') AS violations`,
    [c.seller_id, caseId])).rows[0];

  const first = new Date(Math.min(...vs.map((v) => new Date(v.opened_at).getTime())));
  const last = new Date(Math.max(...vs.map((v) => new Date(v.last_seen ?? v.opened_at).getTime())));
  const period = fmtDate(first) === fmtDate(last) ? fmtDate(first) : `${fmtDate(first)} – ${fmtDate(last)}`;
  const table = vs.map((v, i) => [
    `${i + 1}. ${v.sku} · ${v.product}`,
    `   Advertised ${money(v.last_price, acct.currency)} vs MAP ${money(v.last_map, acct.currency)}${v.last_depth_pct !== null ? ` (${v.last_depth_pct.toFixed(1)}% below)` : ''}`,
    `   Listing: ${v.url}`,
    `   Evidence: ${evidence[i].url}`,
  ].join('\n')).join('\n\n');
  const values: Record<string, string> = {
    brand: acct.brand,
    seller: c.seller,
    source: c.source,
    period,
    violationCount: String(vs.length),
    violationTable: table,
    responseDue: c.response_due ? fmtDate(`${c.response_due}T00:00:00Z`) : 'the date in this letter',
    policy: policy ? `${policy.name} v${policy.version}` : 'MAP policy',
    sellerHistory: `${history.cases} earlier case${history.cases === 1 ? '' : 's'} and ${history.violations} violation${history.violations === 1 ? '' : 's'} in the last 90 days`,
    signature: String(acct.settings?.notice_signature ?? `${acct.brand} brand protection\n(sent by Mirethos MAP Intel on behalf of ${acct.brand})`),
  };

  const recipients = input.recipients ?? (await db.query<{ value: string }>(
    `SELECT value FROM seller_contact WHERE seller_id = $1 AND kind = 'email' ORDER BY (label = 'Notices') DESC NULLS LAST, created_at`,
    [c.seller_id])).rows.map((r) => r.value);
  const needsApproval = acct.settings?.brand_approval_required !== false;

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notice-seq:${accountId}`]);
  const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM notice WHERE account_id = $1', [accountId])).rows[0].n;
  const id = (await db.query<{ id: string }>(
    `INSERT INTO notice (account_id, case_id, seq, template_id, template_version, recipients, subject, body, evidence, policy_document_id, needs_approval, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [accountId, caseId, seq, t.id, t.version, recipients, fill(t.subject, values), fill(t.body, values), JSON.stringify(evidence),
      t.attaches_policy ? policy?.id ?? null : null, needsApproval, actor],
  )).rows[0].id;
  return { id, code: noticeCode(seq), caseCode: caseCode(c.seq) };
}

interface NoticeRow { id: string; seq: number; case_id: string; case_seq: number; status: NoticeStatus; needs_approval: boolean; recipients: string[]; subject: string; body: string }

async function loadNotice(db: Db, noticeId: string): Promise<NoticeRow> {
  const n = (await db.query<NoticeRow>(
    `SELECT n.id, n.seq, n.case_id, c.seq AS case_seq, n.status, n.needs_approval, n.recipients, n.subject, n.body
       FROM notice n JOIN enforcement_case c ON c.id = n.case_id WHERE n.id = $1`, [noticeId])).rows[0];
  if (!n) throw new CaseError(404, 'notice not found');
  return n;
}

export interface NoticeEdit { recipients?: string[]; subject?: string; body?: string }

export async function editNotice(db: Db, noticeId: string, e: NoticeEdit) {
  const n = await loadNotice(db, noticeId);
  if (n.status !== 'Draft') throw new CaseError(409, `${noticeCode(n.seq)} is ${n.status}: only a draft can be edited`);
  await db.query(
    'UPDATE notice SET recipients = coalesce($2, recipients), subject = coalesce($3, subject), body = coalesce($4, body) WHERE id = $1',
    [noticeId, e.recipients ?? null, e.subject ?? null, e.body ?? null]);
  return { code: noticeCode(n.seq), before: { recipients: n.recipients, subject: n.subject } };
}

function readyToLeaveDraft(n: NoticeRow): void {
  const left = unfilled(`${n.subject}\n${n.body}`);
  if (left.length) throw new CaseError(400, `fill in ${left.map((k) => `{{${k}}}`).join(', ')} first`);
}

/** Draft → Awaiting approval (the letter is frozen from here on). */
export async function submitNotice(db: Db, noticeId: string) {
  const n = await loadNotice(db, noticeId);
  if (n.status !== 'Draft') throw new CaseError(409, `${noticeCode(n.seq)} is ${n.status}`);
  if (!n.needs_approval) throw new CaseError(409, 'this account does not need brand approval: send the notice directly');
  readyToLeaveDraft(n);
  await db.query("UPDATE notice SET status = 'Awaiting approval' WHERE id = $1", [noticeId]);
  return { code: noticeCode(n.seq) };
}

export async function decideNotice(db: Db, noticeId: string, approve: boolean, note: string | null, actor: string | null) {
  const n = await loadNotice(db, noticeId);
  if (n.status !== 'Awaiting approval') throw new CaseError(409, `${noticeCode(n.seq)} is ${n.status}, not awaiting approval`);
  if (!approve && !note?.trim()) throw new CaseError(400, 'a rejection needs a note for the analyst');
  await db.query('UPDATE notice SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1',
    [noticeId, approve ? 'Approved' : 'Rejected', actor, note?.trim() || null]);
  return { code: noticeCode(n.seq), status: approve ? 'Approved' : 'Rejected' };
}

/**
 * Record the notice as sent: the mailer logs it (no provider yet), the communications log gets an
 * outbound entry, and an Open case moves to Notice sent, which puts its violations Under notice.
 */
export async function sendNotice(db: Db, accountId: string, noticeId: string, channel: Channel, actor: string | null) {
  const n = await loadNotice(db, noticeId);
  const ok = n.status === 'Approved' || (n.status === 'Draft' && !n.needs_approval);
  if (!ok) {
    throw new CaseError(409, n.status === 'Draft' || n.status === 'Awaiting approval'
      ? `${noticeCode(n.seq)} needs brand approval before it is sent`
      : `${noticeCode(n.seq)} is ${n.status}`);
  }
  if (n.status === 'Draft') readyToLeaveDraft(n);
  if (channel === 'email' && !n.recipients.length) throw new CaseError(400, 'add the seller’s email address first, or record another channel');
  const c = await loadCase(db, n.case_id);
  if (c.closed) throw new CaseError(409, `${caseCode(c.seq)} is closed`);

  let notificationId: string | null = null;
  if (channel === 'email') {
    notificationId = (await sendMail(db, { accountId, to: n.recipients, subject: n.subject, body: n.body })).id;
  }
  await db.query("UPDATE notice SET status = 'Sent', sent_by = $2, sent_at = now(), notification_id = $3 WHERE id = $1", [noticeId, actor, notificationId]);
  await db.query(
    `INSERT INTO communication (account_id, case_id, notice_id, direction, kind, channel, summary, actor)
     VALUES ($1, $2, $3, 'outbound', 'notice', $4, $5, $6)`,
    [accountId, n.case_id, noticeId, channel, `${noticeCode(n.seq)} sent: ${n.subject}`, actor]);
  let underNotice = 0;
  if (c.state === 'Open') {
    await db.query("INSERT INTO case_event (account_id, case_id, state, reason, actor) VALUES ($1, $2, 'Notice sent', $3, $4)",
      [accountId, n.case_id, `${noticeCode(n.seq)} sent (${channel})`, actor]);
  }
  underNotice = await markUnderNotice(db, accountId, n.case_id, actor);
  return { code: noticeCode(n.seq), caseCode: caseCode(c.seq), logged: notificationId !== null, underNotice };
}

export async function cancelNotice(db: Db, noticeId: string) {
  const n = await loadNotice(db, noticeId);
  if (!['Draft', 'Awaiting approval', 'Approved'].includes(n.status)) throw new CaseError(409, `${noticeCode(n.seq)} is ${n.status}`);
  await db.query("UPDATE notice SET status = 'Cancelled' WHERE id = $1", [noticeId]);
  return { code: noticeCode(n.seq) };
}

const NOTICE_SELECT = `
  SELECT n.id, n.seq, n.case_id, 'C-' || lpad(c.seq::text, 5, '0') AS case_code, coalesce(se.name, 'Unknown seller') AS seller,
         n.status, n.needs_approval, n.recipients, n.subject, n.body, n.evidence, n.template_version,
         t.code AS template_code, t.name AS template_name, pd.name AS policy_name, pd.version AS policy_version,
         n.created_at, cu.email AS created_by, n.decided_at, du.email AS decided_by, n.decision_note,
         n.sent_at, su.email AS sent_by, nt.status AS delivery, nt.provider
    FROM notice n JOIN enforcement_case c ON c.id = n.case_id LEFT JOIN seller se ON se.id = c.seller_id
    LEFT JOIN notice_template t ON t.id = n.template_id LEFT JOIN policy_document pd ON pd.id = n.policy_document_id
    LEFT JOIN app_user cu ON cu.id = n.created_by LEFT JOIN app_user du ON du.id = n.decided_by LEFT JOIN app_user su ON su.id = n.sent_by
    LEFT JOIN notification nt ON nt.id = n.notification_id`;

export async function listNotices(db: Db, accountId: string, f: { caseId?: string; status?: string[] } = {}) {
  const c = ['n.account_id = $1'];
  const p: unknown[] = [accountId];
  if (f.caseId) { p.push(f.caseId); c.push(`n.case_id = $${p.length}`); }
  if (f.status?.length) { p.push(f.status); c.push(`n.status = ANY($${p.length}::text[])`); }
  const rows = (await db.query(`${NOTICE_SELECT} WHERE ${c.join(' AND ')} ORDER BY n.created_at DESC LIMIT 500`, p)).rows;
  return rows.map((r) => ({ ...r, code: noticeCode(r.seq) }));
}

export async function noticeDetail(db: Db, noticeId: string) {
  const r = (await db.query(`${NOTICE_SELECT} WHERE n.id = $1`, [noticeId])).rows[0];
  return r ? { ...r, code: noticeCode(r.seq) } : null;
}

/** The letter as a plain-text file to download and send. */
export function noticeText(n: { code: string; recipients: string[]; subject: string; body: string; policy_name?: string | null; policy_version?: number | null }): string {
  return [
    `To: ${n.recipients.join(', ') || '(add the seller’s address)'}`,
    `Subject: ${n.subject}`,
    ...(n.policy_name ? [`Attach: ${n.policy_name} v${n.policy_version}`] : []),
    '',
    n.body,
    '',
    `[${n.code}]`,
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Communications log
// ---------------------------------------------------------------------------

export interface NewCommunication {
  kind: 'response' | 'contest' | 'note';
  channel?: Channel;
  summary: string;
  body?: string | null;
  occurredAt?: string | null;
}

/**
 * Log a seller's response, a contest, or an internal note. A contest moves a case that is waiting
 * on the seller (Notice sent / Awaiting response) to Contested, with the summary as the reason.
 */
export async function logCommunication(db: Db, accountId: string, caseId: string, m: NewCommunication, actor: string | null) {
  const c = await loadCase(db, caseId);
  if (!m.summary.trim()) throw new CaseError(400, 'a summary is needed');
  const direction = m.kind === 'note' ? 'internal' : 'inbound';
  const id = (await db.query<{ id: string }>(
    `INSERT INTO communication (account_id, case_id, direction, kind, channel, summary, body, occurred_at, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9) RETURNING id`,
    [accountId, caseId, direction, m.kind, m.channel ?? 'email', m.summary.trim(), m.body ?? null, m.occurredAt ?? null, actor])).rows[0].id;
  let moved: string | null = null;
  if (m.kind === 'contest' && !c.closed && ['Notice sent', 'Awaiting response'].includes(c.state)) {
    await db.query("INSERT INTO case_event (account_id, case_id, state, reason, actor) VALUES ($1, $2, 'Contested', $3, $4)",
      [accountId, caseId, m.summary.trim(), actor]);
    moved = 'Contested';
  }
  return { id, caseCode: caseCode(c.seq), moved };
}

export async function listCommunications(db: Db, accountId: string, f: { caseId?: string; limit?: number } = {}) {
  const p: unknown[] = [accountId];
  let where = 'm.account_id = $1';
  if (f.caseId) { p.push(f.caseId); where += ` AND m.case_id = $${p.length}`; }
  p.push(f.limit ?? 200);
  return (await db.query(
    `SELECT m.id, m.case_id, 'C-' || lpad(c.seq::text, 5, '0') AS case_code, coalesce(se.name, 'Unknown seller') AS seller,
            m.notice_id, 'N-' || lpad(n.seq::text, 5, '0') AS notice_code, t.name AS template, m.direction, m.kind, m.channel,
            m.summary, m.body, m.occurred_at, coalesce(u.email, 'System') AS actor, nt.status AS delivery
       FROM communication m JOIN enforcement_case c ON c.id = m.case_id LEFT JOIN seller se ON se.id = c.seller_id
       LEFT JOIN notice n ON n.id = m.notice_id LEFT JOIN notice_template t ON t.id = n.template_id
       LEFT JOIN notification nt ON nt.id = n.notification_id LEFT JOIN app_user u ON u.id = m.actor
      WHERE ${where} ORDER BY m.occurred_at DESC, m.created_at DESC LIMIT $${p.length}`, p)).rows;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function listTemplates(db: Db, accountId: string) {
  return (await db.query(
    `SELECT t.id, t.code, t.name, t.used_for, t.subject, t.body, t.attaches_policy, t.version, t.active, t.is_default, t.updated_at,
            u.email AS updated_by, (SELECT count(*)::int FROM notice n WHERE n.template_id = t.id AND n.status = 'Sent') AS sent
       FROM notice_template t LEFT JOIN app_user u ON u.id = t.updated_by
      WHERE t.account_id = $1 ORDER BY t.code`, [accountId])).rows;
}

export interface TemplateInput { name?: string; usedFor?: string | null; subject?: string; body?: string; attachesPolicy?: boolean; active?: boolean }

function checkPlaceholders(t: { subject?: string; body?: string }): void {
  const unknown = unfilled(`${t.subject ?? ''}\n${t.body ?? ''}`).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
  if (unknown.length) throw new CaseError(400, `unknown placeholder ${unknown.map((k) => `{{${k}}}`).join(', ')}; use ${PLACEHOLDERS.map((k) => `{{${k}}}`).join(', ')}`);
}

export async function createTemplate(db: Db, accountId: string, t: Required<Pick<TemplateInput, 'name' | 'subject' | 'body'>> & TemplateInput, actor: string | null) {
  checkPlaceholders(t);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`template-code:${accountId}`]);
  const n = (await db.query<{ n: number }>(
    "SELECT coalesce(max(substring(code from 3)::int), 0) + 1 AS n FROM notice_template WHERE account_id = $1 AND code ~ '^T-[0-9]+$'", [accountId])).rows[0].n;
  const code = `T-${n}`;
  const id = (await db.query<{ id: string }>(
    `INSERT INTO notice_template (account_id, code, name, used_for, subject, body, attaches_policy, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [accountId, code, t.name, t.usedFor ?? null, t.subject, t.body, t.attachesPolicy ?? true, actor])).rows[0].id;
  return { id, code };
}

/** Edit a template: its version goes up; notices already drafted keep the text they were made with. */
export async function updateTemplate(db: Db, templateId: string, t: TemplateInput, actor: string | null) {
  checkPlaceholders(t);
  const before = (await db.query('SELECT code, name, used_for, subject, body, attaches_policy, active, version FROM notice_template WHERE id = $1', [templateId])).rows[0];
  if (!before) throw new CaseError(404, 'template not found');
  const textChanged = t.subject !== undefined || t.body !== undefined || t.attachesPolicy !== undefined;
  await db.query(
    `UPDATE notice_template SET name = coalesce($2, name), used_for = CASE WHEN $3::boolean THEN $4 ELSE used_for END,
            subject = coalesce($5, subject), body = coalesce($6, body), attaches_policy = coalesce($7, attaches_policy),
            active = coalesce($8, active), version = version + $9, updated_by = $10
      WHERE id = $1`,
    [templateId, t.name ?? null, t.usedFor !== undefined, t.usedFor ?? null, t.subject ?? null, t.body ?? null, t.attachesPolicy ?? null,
      t.active ?? null, textChanged ? 1 : 0, actor]);
  return { code: before.code as string, before };
}
