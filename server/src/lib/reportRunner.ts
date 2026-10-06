// Report runs (Phase 3): queue -> generate (frozen snapshot + CSV; fast, done by the API on
// "Run now") -> PDF + delivery (needs a browser: done by the reports runner, hourly on GitHub
// Actions while the Render worker is off). Schedules fire through the same dueSlot as collection.
import type { Db } from './db.js';
import { createLink } from './evidenceLinks.js';
import { sendMail } from './mailer.js';
import {
  buildSnapshot, fmtDay, isTemplateCode, parseParams, periodForRun, REPORT_LINK_DAYS, snapshotCsv, snapshotHtml,
  type Snapshot, type TemplateCode,
} from './reports.js';
import { putObject } from './storage.js';
import { dueSlot } from '../scheduler/due.js';

export const runCode = (seq: number) => `RPT-${String(seq).padStart(4, '0')}`;

export class ReportError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface QueueInput {
  accountId: string;
  templateCode: string;
  params?: unknown;
  name?: string;
  definitionId?: string | null;
  trigger: 'schedule' | 'manual' | 'test';
  requestedBy?: string | null;
  now?: Date;
}

/** Validate parameters, fix the period now, and add a queued run. */
export async function queueRun(db: Db, q: QueueInput): Promise<{ id: string; code: string }> {
  if (!isTemplateCode(q.templateCode)) throw new ReportError(400, `unknown template ${q.templateCode}`);
  const t = (await db.query<{ id: string; name: string; version: number; active: boolean }>('SELECT id, name, version, active FROM report_template WHERE code = $1', [q.templateCode])).rows[0];
  if (!t?.active) throw new ReportError(400, `template ${q.templateCode} is not available`);
  let params;
  try {
    params = parseParams(q.templateCode, q.params);
  } catch (err) {
    throw new ReportError(400, `parameters: ${(err as Error).message}`);
  }
  const tz = (await db.query<{ timezone: string }>('SELECT timezone FROM account WHERE id = $1', [q.accountId])).rows[0].timezone;
  const period = periodForRun(q.templateCode, params, q.now ?? new Date(), tz);
  await db.query("SELECT pg_advisory_xact_lock(hashtext('report_seq:' || $1))", [q.accountId]);
  const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0)::int + 1 AS n FROM report_run WHERE account_id = $1', [q.accountId])).rows[0].n;
  const id = (await db.query<{ id: string }>(
    `INSERT INTO report_run (account_id, seq, definition_id, template_id, template_version, name, params, trigger, period_from, period_to, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [q.accountId, seq, q.definitionId ?? null, t.id, t.version, q.name ?? t.name, JSON.stringify(params), q.trigger, period.from, period.to, q.requestedBy ?? null],
  )).rows[0].id;
  return { id, code: runCode(seq) };
}

interface RunRow {
  id: string; account_id: string; seq: number; name: string; params: Record<string, unknown>; status: string;
  period_from: Date; period_to: Date; snapshot: Snapshot | null; files: StoredFile[]; definition_id: string | null;
  template_code: TemplateCode; template_name: string; template_version: number; timezone: string;
}
export interface StoredFile { kind: 'csv' | 'pdf'; key: string; uri: string; sha256: string; bytes: number; contentType: string; fileName: string }

async function loadRun(db: Db, runId: string): Promise<RunRow> {
  const r = (await db.query<RunRow>(
    `SELECT r.*, t.code AS template_code, t.name AS template_name, a.timezone
       FROM report_run r JOIN report_template t ON t.id = r.template_id JOIN account a ON a.id = r.account_id WHERE r.id = $1`,
    [runId],
  )).rows[0];
  if (!r) throw new ReportError(404, 'report run not found');
  return r;
}

const fileBase = (r: RunRow) => `${runCode(r.seq)}-${r.template_code}-${r.period_from.toISOString().slice(0, 10)}`;

/** Build and freeze the snapshot and write the CSV. queued -> awaiting_pdf. */
export async function generateRun(db: Db, runId: string, now = new Date()): Promise<void> {
  const r = await loadRun(db, runId);
  if (r.status !== 'queued') throw new ReportError(409, `run is ${r.status}`);
  const period = { from: r.period_from, to: r.period_to, label: periodLabel(r) };
  const snapshot = await buildSnapshot(db, {
    runId, runCode: runCode(r.seq), name: r.name, accountId: r.account_id,
    template: { code: r.template_code, name: r.template_name, version: r.template_version },
    params: r.params, period, now,
  });
  const csv = await putObject(`reports/${r.account_id}/${runId}/${fileBase(r)}.csv`, Buffer.from(snapshotCsv(snapshot), 'utf8'), 'text/csv; charset=utf-8');
  const files: StoredFile[] = [{ kind: 'csv', key: csv.key, uri: csv.uri, sha256: csv.sha256, bytes: csv.bytes, contentType: 'text/csv', fileName: `${fileBase(r)}.csv` }];
  await db.query(
    `UPDATE report_run SET snapshot = $2, rows = $3, rule_set = $4, quality_note = $5, files = $6, status = 'awaiting_pdf', generated_at = $7 WHERE id = $1`,
    [runId, JSON.stringify(snapshot), snapshot.rows.length, JSON.stringify(snapshot.ruleSet), snapshot.quality.note, JSON.stringify(files), now],
  );
}

function periodLabel(r: RunRow): string {
  // Recomputed from the stored period so a run generated later keeps its own label.
  if (r.template_code === 'monthly_trend') {
    const mid = new Date((r.period_from.getTime() + r.period_to.getTime()) / 2);
    return mid.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: r.timezone });
  }
  return `${fmtDay(r.period_from, r.timezone)} – ${fmtDay(new Date(r.period_to.getTime() - 1), r.timezone)}`;
}

/** The hosted page / PDF HTML of a generated run. */
export async function runHtml(db: Db, runId: string): Promise<string> {
  const r = await loadRun(db, runId);
  if (!r.snapshot) throw new ReportError(409, 'this report has not been generated yet');
  return snapshotHtml(r.snapshot);
}

/** Store the PDF (rendered by the caller's browser) and deliver. awaiting_pdf -> done. */
export async function completeRun(db: Db, runId: string, pdf: Buffer, now = new Date()): Promise<{ deliveries: DeliveryResult[] }> {
  const r = await loadRun(db, runId);
  if (r.status !== 'awaiting_pdf') throw new ReportError(409, `run is ${r.status}`);
  const put = await putObject(`reports/${r.account_id}/${runId}/${fileBase(r)}.pdf`, pdf, 'application/pdf');
  const files = [...r.files, { kind: 'pdf', key: put.key, uri: put.uri, sha256: put.sha256, bytes: put.bytes, contentType: 'application/pdf', fileName: `${fileBase(r)}.pdf` }];
  await db.query('UPDATE report_run SET files = $2 WHERE id = $1', [runId, JSON.stringify(files)]);
  const deliveries = await deliverRun(db, runId, now);
  await db.query("UPDATE report_run SET status = 'done', finished_at = $2 WHERE id = $1", [runId, now]);
  return { deliveries };
}

export async function failRun(db: Db, runId: string, error: string): Promise<void> {
  await db.query("UPDATE report_run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [runId, error.slice(0, 2000)]);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------
export interface DeliveryResult { channel: 'email' | 'hosted' | 'sftp'; status: string; target: string; detail?: Record<string, unknown> }
export interface SftpDest { credentialId: string; host: string; port?: number; folder?: string; hostKey?: string }
type SftpDeliver = (db: Db, run: { id: string; accountId: string; files: StoredFile[] }, dest: SftpDest) => Promise<DeliveryResult>;
let sftpDeliver: SftpDeliver | null = null;
/** lib/sftp.ts registers itself here (keeps ssh2 out of the API bundle when unused). */
export function registerSftp(fn: SftpDeliver): void {
  sftpDeliver = fn;
}

export async function deliverRun(db: Db, runId: string, now = new Date()): Promise<DeliveryResult[]> {
  const r = await loadRun(db, runId);
  const def = r.definition_id
    ? (await db.query<{ recipients: string[]; destinations: { email?: boolean; hosted?: boolean; sftp?: SftpDest | null } }>(
      'SELECT recipients, destinations FROM report_definition WHERE id = $1', [r.definition_id])).rows[0]
    : null;
  const dest = def?.destinations ?? { hosted: true };
  const out: DeliveryResult[] = [];
  let hostedUrl: string | null = null;

  if (dest.hosted !== false) {
    const link = await createLink(db, { accountId: r.account_id, scope: 'report:view', reportRunId: runId, via: 'report', days: REPORT_LINK_DAYS, now });
    hostedUrl = link.url;
    out.push({ channel: 'hosted', status: 'delivered', target: `link, expires ${link.expiresAt.toISOString().slice(0, 10)}`, detail: { linkId: link.id, expiresAt: link.expiresAt } });
  }
  if (dest.email !== false && def?.recipients?.length) {
    const s = r.snapshot!;
    const lines = [
      `${r.name} — ${s.period.label}`,
      `${s.account.name} · ${runCode(r.seq)}`,
      '',
      ...Object.entries(s.summary).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`),
      '',
      s.quality.note ?? 'Data quality: all subscribed sources healthy.',
      '',
      hostedUrl ? `View the report (expires in ${REPORT_LINK_DAYS} days): ${hostedUrl}` : 'Open it in MAP Intel → Reports → Repository.',
      'Every violation row links to its evidence page.',
    ];
    const m = await sendMail(db, { accountId: r.account_id, to: def.recipients, subject: `${r.name} — ${s.period.label}`, body: lines.join('\n'), reportRunId: runId });
    out.push({ channel: 'email', status: m.status, target: def.recipients.join(', '), detail: { notificationId: m.id, provider: m.provider } });
  }
  if (dest.sftp?.credentialId) {
    if (!sftpDeliver) {
      out.push({ channel: 'sftp', status: 'failed', target: dest.sftp.folder ?? '/', detail: { error: 'SFTP delivery is not loaded in this process' } });
    } else {
      out.push(await sftpDeliver(db, { id: runId, accountId: r.account_id, files: (await loadRun(db, runId)).files }, dest.sftp).catch((err) => ({
        channel: 'sftp' as const, status: 'failed', target: dest.sftp!.folder ?? '/', detail: { error: String((err as Error).message ?? err).slice(0, 500) },
      })));
    }
  }
  for (const d of out) {
    await db.query(
      'INSERT INTO report_delivery (account_id, report_run_id, channel, target, status, detail) VALUES ($1, $2, $3, $4, $5, $6)',
      [r.account_id, runId, d.channel, d.target, d.status, JSON.stringify(d.detail ?? {})],
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------
/** Queue one run per definition whose latest cron slot is due (once per slot). */
export async function queueDueRuns(db: Db, now = new Date()): Promise<{ definitionId: string; runId: string; code: string }[]> {
  const defs = (await db.query<{ id: string; account_id: string; name: string; params: unknown; cadence: string; timezone: string; last_fired_slot: Date | null; code: string }>(
    `SELECT d.id, d.account_id, d.name, d.params, d.cadence, d.timezone, d.last_fired_slot, t.code
       FROM report_definition d JOIN report_template t ON t.id = d.template_id WHERE d.active AND t.active`,
  )).rows;
  const out = [];
  for (const d of defs) {
    const slot = dueSlot(d.cadence, d.timezone, now, d.last_fired_slot);
    if (!slot) continue;
    const q = await queueRun(db, { accountId: d.account_id, templateCode: d.code, params: d.params, name: d.name, definitionId: d.id, trigger: 'schedule', now });
    await db.query('UPDATE report_definition SET last_fired_slot = $2 WHERE id = $1', [d.id, slot]);
    out.push({ definitionId: d.id, runId: q.id, code: q.code });
  }
  return out;
}
