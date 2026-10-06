// Alerts (Phase 3): evaluated after every judging and by the reports runner. Each rule turns facts
// into events with a dedup key, so a change alerts once: a seller the first time it violates, a
// violation the first time it is severe, a degraded source once per upcoming report slot.
import cronParser from 'cron-parser';
import { dataQuality } from './dataQuality.js';
import type { Db } from './db.js';
import { sendMail } from './mailer.js';
import { isManual } from './schedules.js';
import { violationCode } from './violations.js';

interface Rule { id: string; code: string; name: string; trigger: string; config: Record<string, unknown>; email: boolean; recipients: string[] }
interface Candidate { key: string; level: 'Severe' | 'Standard' | 'Health' | 'Info'; title: string; body: string; violationId?: string | null; sellerId?: string | null; sourceId?: string | null }

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

export interface AlertResult { raised: number; emailed: number; byRule: Record<string, number> }

export async function evaluateAlerts(db: Db, accountId: string, now = new Date()): Promise<AlertResult> {
  const rules = (await db.query<Rule>('SELECT id, code, name, trigger, config, email, recipients FROM alert_rule WHERE account_id = $1 AND active ORDER BY code', [accountId])).rows;
  const out: AlertResult = { raised: 0, emailed: 0, byRule: {} };
  for (const r of rules) {
    const candidates =
      r.trigger === 'new_violating_seller' ? await newViolatingSellers(db, accountId)
        : r.trigger === 'severe_violation' ? await severeViolations(db, accountId, String(r.config.severity ?? 'Severe'))
          : await degradedBeforeReport(db, accountId, Number(r.config.hoursBefore ?? 24), now);
    let n = 0;
    for (const c of candidates) {
      const ev = (await db.query<{ id: string }>(
        `INSERT INTO alert_event (account_id, alert_rule_id, dedup_key, level, title, body, violation_id, seller_id, source_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (account_id, alert_rule_id, dedup_key) DO NOTHING RETURNING id`,
        [accountId, r.id, c.key, c.level, c.title, c.body, c.violationId ?? null, c.sellerId ?? null, c.sourceId ?? null, now],
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
