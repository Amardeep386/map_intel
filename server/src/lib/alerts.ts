// Alerts (Phase 3, enforcement alerts Phase 4): evaluated after every judging and every hour. Each
// rule turns facts into events with a dedup key, so a change alerts once: a seller the first time it
// violates, a violation the first time it is severe, a degraded source once per upcoming report
// slot, a notice once while it waits for approval, a case once per missed response date, a
// re-offence once per violation, a case once when it resolves.
import cronParser from 'cron-parser';
import { dataQuality } from './dataQuality.js';
import type { Db } from './db.js';
import { sendMail } from './mailer.js';
import { isManual } from './schedules.js';
import { violationCode } from './violations.js';

interface Rule { id: string; code: string; name: string; trigger: string; config: Record<string, unknown>; email: boolean; recipients: string[] }
interface Candidate { key: string; level: 'Severe' | 'Standard' | 'Health' | 'Info'; title: string; body: string; violationId?: string | null; sellerId?: string | null; sourceId?: string | null; caseId?: string | null }

const caseCode = (seq: number) => `C-${String(seq).padStart(5, '0')}`;
const day = (d: string | Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const money = (n: number) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

async function newViolatingSellers(db: Db, accountId: string): Promise<Candidate[]> {
  const rows = (await db.query(
    `SELECT DISTINCT ON (v.seller_id) v.id, v.seq, v.seller_id, se.name AS seller, src.display_name AS source, src.id AS source_id,
            p.product_code AS sku, v.class_at_capture, v.last_price::float8 AS price, v.last_map::float8 AS map, v.last_depth_pct::float8 AS depth
       FROM violation_current v JOIN seller se ON se.id = v.seller_id JOIN source src ON src.id = v.source_id JOIN product p ON p.id = v.product_id
      WHERE v.account_id = $1 AND v.class_at_capture <> 'Brand Direct'
      ORDER BY v.seller_id, v.opened_at`,
    [accountId],
  )).rows;
  return rows.map((r) => ({
    key: `seller:${r.seller_id}`, level: 'Standard', sellerId: r.seller_id, violationId: r.id, sourceId: r.source_id,
    title: `New violating seller: ${r.seller} (${r.source})`,
    body: `${r.seller} on ${r.source} advertised ${r.sku} at ${money(r.price)}, ${Number(r.depth).toFixed(1)}% below MAP ${money(r.map)} (${violationCode(r.seq)}). Seller class at capture: ${r.class_at_capture}.`,
  }));
}

async function severeViolations(db: Db, accountId: string, severity: string): Promise<Candidate[]> {
  const rows = (await db.query(
    `SELECT v.id, v.seq, se.name AS seller, src.display_name AS source, p.product_code AS sku, v.max_depth_pct::float8 AS depth,
            v.last_price::float8 AS price, v.last_map::float8 AS map, v.seller_id, v.source_id
       FROM violation_current v LEFT JOIN seller se ON se.id = v.seller_id JOIN source src ON src.id = v.source_id JOIN product p ON p.id = v.product_id
      WHERE v.account_id = $1 AND v.severity = $2 AND NOT v.episode_closed AND v.status <> 'Dismissed'`,
    [accountId, severity],
  )).rows;
  return rows.map((r) => ({
    key: `violation:${r.id}`, level: 'Severe', violationId: r.id, sellerId: r.seller_id, sourceId: r.source_id,
    title: `${severity} violation ${violationCode(r.seq)}: ${r.sku} at ${r.seller ?? 'unknown seller'}`,
    body: `${r.sku} at ${money(r.price)} on ${r.source} (${r.seller ?? 'unknown seller'}), ${Number(r.depth).toFixed(1)}% below MAP ${money(r.map)}.`,
  }));
}

async function degradedBeforeReport(db: Db, accountId: string, hoursBefore: number, now: Date): Promise<Candidate[]> {
  const q = await dataQuality(db, accountId, now);
  if (!q.degraded.length) return [];
  const defs = (await db.query<{ id: string; name: string; cadence: string; timezone: string }>(
    'SELECT id, name, cadence, timezone FROM report_definition WHERE account_id = $1 AND active', [accountId])).rows;
  const out: Candidate[] = [];
  for (const d of defs) {
    if (isManual(d.cadence)) continue;
    let next: Date;
    try {
      next = cronParser.parseExpression(d.cadence, { currentDate: now, tz: d.timezone }).next().toDate();
    } catch {
      continue;
    }
    if (next.getTime() - now.getTime() > hoursBefore * 3_600_000) continue;
    for (const s of q.degraded) {
      const sourceId = (await db.query<{ id: string }>('SELECT id FROM source WHERE code = $1', [s.code])).rows[0]?.id ?? null;
      out.push({
        key: `source:${s.code}:report:${d.id}:${next.toISOString()}`, level: 'Health', sourceId,
        title: `${s.name} is ${s.health.toLowerCase()} before "${d.name}"`,
        body: `${s.name} is ${s.health.toLowerCase()}${s.mainFailure ? ` (${s.mainFailure.replace('_', ' ')})` : ''}. "${d.name}" runs ${next.toISOString().slice(0, 16).replace('T', ' ')} UTC and will carry a data-quality note unless collection recovers. See Data Health.`,
      });
    }
  }
  return out;
}

async function noticesAwaitingApproval(db: Db, accountId: string): Promise<Candidate[]> {
  const rows = (await db.query(
    `SELECT n.id, n.seq, n.subject, c.id AS case_id, c.seq AS case_seq, c.seller_id, c.source_id, coalesce(se.name, 'Unknown seller') AS seller
       FROM notice n JOIN enforcement_case c ON c.id = n.case_id LEFT JOIN seller se ON se.id = c.seller_id
      WHERE n.account_id = $1 AND n.status = 'Awaiting approval'`, [accountId])).rows;
  return rows.map((r) => ({
    key: `notice:${r.id}`, level: 'Info', caseId: r.case_id, sellerId: r.seller_id, sourceId: r.source_id,
    title: `Notice N-${String(r.seq).padStart(5, '0')} for ${r.seller} waits for brand approval`,
    body: `“${r.subject}” (${caseCode(r.case_seq)}) is waiting for a Brand user to approve or reject it in Enforcement.`,
  }));
}

async function responsesOverdue(db: Db, accountId: string): Promise<Candidate[]> {
  const rows = (await db.query(
    `SELECT c.id, c.seq, c.seller_id, c.source_id, to_char(c.response_due, 'YYYY-MM-DD') AS due, c.state, coalesce(se.name, 'Unknown seller') AS seller,
            (SELECT max(n.sent_at) FROM notice n WHERE n.case_id = c.id AND n.status = 'Sent') AS last_sent
       FROM case_current c LEFT JOIN seller se ON se.id = c.seller_id
      WHERE c.account_id = $1 AND NOT c.closed AND c.state IN ('Notice sent', 'Awaiting response') AND c.response_due < current_date
        AND NOT EXISTS (SELECT 1 FROM communication m WHERE m.case_id = c.id AND m.direction = 'inbound'
                         AND m.occurred_at >= coalesce((SELECT max(n.sent_at) FROM notice n WHERE n.case_id = c.id AND n.status = 'Sent'), c.opened_at))`,
    [accountId])).rows;
  return rows.map((r) => ({
    key: `case:${r.id}:due:${r.due}`, level: 'Standard', caseId: r.id, sellerId: r.seller_id, sourceId: r.source_id,
    title: `${caseCode(r.seq)}: ${r.seller} has not responded (due ${day(`${r.due}T00:00:00Z`)})`,
    body: `${caseCode(r.seq)} is ${r.state} and the response date ${day(`${r.due}T00:00:00Z`)} has passed with no reply logged${r.last_sent ? ` since the notice of ${day(r.last_sent)}` : ''}. Consider a final notice or escalation.`,
  }));
}

async function sellersReoffended(db: Db, accountId: string, days: number): Promise<Candidate[]> {
  const rows = (await db.query(
    `SELECT v.id, v.seq, v.seller_id, v.source_id, se.name AS seller, p.product_code AS sku, v.last_price::float8 AS price, v.last_map::float8 AS map,
            r.id AS case_id, r.seq AS case_seq
       FROM violation_current v JOIN seller se ON se.id = v.seller_id JOIN product p ON p.id = v.product_id
       JOIN LATERAL (SELECT c.id, c.seq, rs.at FROM case_current c
                       JOIN LATERAL (SELECT e.created_at AS at FROM case_event e WHERE e.case_id = c.id AND e.state = 'Resolved'
                                      ORDER BY e.created_at DESC LIMIT 1) rs ON true
                      WHERE c.account_id = v.account_id AND c.seller_id = v.seller_id AND c.state IN ('Resolved', 'Recurred')
                        AND rs.at BETWEEN v.opened_at - make_interval(days => $2) AND v.opened_at
                      ORDER BY rs.at DESC LIMIT 1) r ON true
      WHERE v.account_id = $1 AND NOT v.episode_closed AND v.status <> 'Dismissed'`,
    [accountId, days])).rows;
  return rows.map((r) => ({
    key: `violation:${r.id}`, level: 'Severe', violationId: r.id, caseId: r.case_id, sellerId: r.seller_id, sourceId: r.source_id,
    title: `${r.seller} re-offended: ${violationCode(r.seq)} after ${caseCode(r.case_seq)}`,
    body: `${r.seller} advertised ${r.sku} at ${money(r.price)} (MAP ${money(r.map)}) within ${days} days of ${caseCode(r.case_seq)} being resolved. Opening a case for it marks ${caseCode(r.case_seq)} Recurred; consider the final-notice template.`,
  }));
}

async function casesResolved(db: Db, accountId: string): Promise<Candidate[]> {
  const rows = (await db.query(
    `SELECT c.id, c.seq, c.seller_id, c.source_id, coalesce(se.name, 'Unknown seller') AS seller, e.reason, e.verdict_id, vd.observed_at
       FROM case_current c LEFT JOIN seller se ON se.id = c.seller_id
       JOIN LATERAL (SELECT x.reason, x.verdict_id FROM case_event x WHERE x.case_id = c.id AND x.state = 'Resolved' ORDER BY x.created_at DESC LIMIT 1) e ON true
       LEFT JOIN verdict vd ON vd.id = e.verdict_id
      WHERE c.account_id = $1 AND c.state = 'Resolved'`, [accountId])).rows;
  return rows.map((r) => ({
    key: `case:${r.id}`, level: 'Info', caseId: r.id, sellerId: r.seller_id, sourceId: r.source_id,
    title: `${caseCode(r.seq)} resolved: ${r.seller}`,
    body: r.verdict_id
      ? `A re-check on ${day(r.observed_at)} saw a compliant price for every listing in ${caseCode(r.seq)}.`
      : `${caseCode(r.seq)} was closed by a person: ${r.reason}.`,
  }));
}

export interface AlertResult { raised: number; emailed: number; byRule: Record<string, number> }

export async function evaluateAlerts(db: Db, accountId: string, now = new Date()): Promise<AlertResult> {
  const rules = (await db.query<Rule>('SELECT id, code, name, trigger, config, email, recipients FROM alert_rule WHERE account_id = $1 AND active ORDER BY code', [accountId])).rows;
  const out: AlertResult = { raised: 0, emailed: 0, byRule: {} };
  for (const r of rules) {
    const candidates =
      r.trigger === 'new_violating_seller' ? await newViolatingSellers(db, accountId)
        : r.trigger === 'severe_violation' ? await severeViolations(db, accountId, String(r.config.severity ?? 'Severe'))
          : r.trigger === 'notice_awaiting_approval' ? await noticesAwaitingApproval(db, accountId)
            : r.trigger === 'response_overdue' ? await responsesOverdue(db, accountId)
              : r.trigger === 'seller_reoffended' ? await sellersReoffended(db, accountId, Number(r.config.days ?? 60))
                : r.trigger === 'case_resolved' ? await casesResolved(db, accountId)
                  : await degradedBeforeReport(db, accountId, Number(r.config.hoursBefore ?? 24), now);
    let n = 0;
    for (const c of candidates) {
      const ev = (await db.query<{ id: string }>(
        `INSERT INTO alert_event (account_id, alert_rule_id, dedup_key, level, title, body, violation_id, seller_id, source_id, case_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (account_id, alert_rule_id, dedup_key) DO NOTHING RETURNING id`,
        [accountId, r.id, c.key, c.level, c.title, c.body, c.violationId ?? null, c.sellerId ?? null, c.sourceId ?? null, c.caseId ?? null, now],
      )).rows[0];
      if (!ev) continue;
      n++;
      if (r.email && r.recipients.length) {
        await sendMail(db, { accountId, to: r.recipients, subject: `[MAP Intel] ${c.title}`, body: `${c.body}\n\nAlert ${r.code}: ${r.name}.`, alertEventId: ev.id });
        out.emailed++;
      }
    }
    out.byRule[r.code] = n;
    out.raised += n;
  }
  return out;
}
