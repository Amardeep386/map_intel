// Reports (Phase 3): template library with adoption counts, scheduled report definitions, "Run
// now" (snapshot + CSV straight away, PDF from the reports runner), the repository, hosted links,
// and the public hosted page behind a link.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { withApi, withTenant, type Db } from '../../lib/db.js';
import { createLink, openLink } from '../../lib/evidenceLinks.js';
import { generateRun, queueRun, ReportError, runCode, runHtml, type StoredFile } from '../../lib/reportRunner.js';
import { isTemplateCode, parseParams, REPORT_LINK_DAYS } from '../../lib/reports.js';
import { isManual } from '../../lib/schedules.js';
import { signedUrl } from '../../lib/storage.js';
import { dueSlot } from '../../scheduler/due.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';
import cronParser from 'cron-parser';

type Params = { accountId: string };

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const validCadence = (c: string) => { if (isManual(c)) return true; try { cronParser.parseExpression(c); return true; } catch { return false; } };

const definitionBody = z.object({
  name: z.string().trim().min(1).max(120),
  templateCode: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  cadence: z.string().trim().max(100).refine(validCadence, 'a cron expression (e.g. "0 8 * * 1") or "manual"'),
  timezone: z.string().trim().max(64).refine(validTz, 'unknown timezone').optional(),
  recipients: z.array(z.string().trim().email()).max(50).default([]),
  destinations: z.object({
    email: z.boolean().default(true),
    hosted: z.boolean().default(true),
    sftp: z.object({ credentialId: z.string().uuid(), folder: z.string().trim().max(300).optional() }).nullable().optional(),
  }).default({ email: true, hosted: true }),
  visibility: z.enum(['Account', 'Brand users']).default('Account'),
  active: z.boolean().default(true),
});

function audit(db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  return recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });
}
const reportError = (err: unknown) => {
  if (err instanceof ReportError) throw new HttpError(err.statusCode, err.message);
  if (err instanceof z.ZodError) throw new HttpError(400, err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  throw err;
};

async function checkDefinition(db: Db, b: z.infer<typeof definitionBody>): Promise<string> {
  if (!isTemplateCode(b.templateCode)) throw new HttpError(400, `unknown template ${b.templateCode}`);
  try {
    b.params = parseParams(b.templateCode, b.params);
  } catch (err) {
    reportError(err);
  }
  if (b.destinations.sftp) {
    const c = (await db.query<{ kind: string }>('SELECT kind FROM credential WHERE id = $1', [b.destinations.sftp.credentialId])).rows[0];
    if (c?.kind !== 'sftp') throw new HttpError(400, 'the SFTP destination needs an SFTP credential from Settings → Credentials');
  }
  const t = (await db.query<{ id: string }>('SELECT id FROM report_template WHERE code = $1 AND active', [b.templateCode])).rows[0];
  if (!t) throw new HttpError(400, `template ${b.templateCode} is not available`);
  return t.id;
}

/** Files with short-lived download links. */
const filesOut = async (files: StoredFile[]) =>
  Promise.all((files ?? []).map(async (f) => ({ kind: f.kind, fileName: f.fileName, sha256: f.sha256, bytes: f.bytes, url: await signedUrl(f.uri) })));

const brandOnly = (req: FastifyRequest) => req.accountRole === 'Brand user';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/reports';

  app.get<{ Params: Params }>(`${base}/templates`, { config: { permission: 'reports.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (await db.query(
        `SELECT t.id, t.code, t.name, t.type, t.version, t.params, t.description, a.accounts, a.definitions, a.last_used,
                (SELECT count(*)::int FROM report_definition d WHERE d.template_id = t.id AND d.active) AS used_here
           FROM report_template t JOIN app_report_template_adoption() a ON a.template_id = t.id
          WHERE t.active ORDER BY t.type, t.name`,
      )).rows,
    ),
  );

  app.get<{ Params: Params }>(`${base}/definitions`, { config: { permission: 'reports.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (await db.query(
        `SELECT d.id, d.name, t.code AS template_code, t.name AS template, d.params, d.cadence, d.timezone, d.recipients, d.destinations,
                d.visibility, d.active, d.last_fired_slot, d.updated_at,
                (SELECT to_jsonb(x) FROM (SELECT r.id, r.seq, r.status, r.created_at FROM report_run r WHERE r.definition_id = d.id ORDER BY r.created_at DESC LIMIT 1) x) AS last_run
           FROM report_definition d JOIN report_template t ON t.id = d.template_id
          WHERE ($1::boolean IS FALSE OR d.visibility = 'Brand users')
          ORDER BY d.name`,
        [brandOnly(req)],
      )).rows.map((d) => ({ ...d, next_run: nextRun(d.cadence, d.timezone) })),
    ),
  );

  app.post<{ Params: Params }>(`${base}/definitions`, { config: { permission: 'reports.write' } }, async (req) => {
    const b = parse(definitionBody, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const templateId = await checkDefinition(db, b);
      const tz = b.timezone ?? (await db.query<{ timezone: string }>('SELECT timezone FROM account WHERE id = $1', [req.params.accountId])).rows[0].timezone;
      const d = (await db.query(
        `INSERT INTO report_definition (account_id, name, template_id, params, cadence, timezone, recipients, destinations, visibility, active, created_by, last_fired_slot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        // A new schedule starts with its latest past slot marked fired: it runs at the next slot, not at once.
        [req.params.accountId, b.name, templateId, JSON.stringify(b.params), b.cadence, tz, b.recipients, JSON.stringify(b.destinations), b.visibility, b.active,
          req.user?.sub ?? null, dueSlot(b.cadence, tz, new Date(), null, 24 * 366)],
      ).catch((err) => { if ((err as { code?: string }).code === '23505') throw new HttpError(409, `a report named "${b.name}" exists`); throw err; })).rows[0];
      await audit(db, req, { action: 'report_definition.created', entityType: 'report_definition', entityId: d.id, summary: `Scheduled report "${b.name}" (${b.cadence})`, after: b });
      return d;
    });
  });

  app.patch<{ Params: Params & { definitionId: string } }>(`${base}/definitions/:definitionId`, { config: { permission: 'reports.write' } }, async (req) => {
    const id = uuidOr404(req.params.definitionId, 'report');
    return withTenant(req.params.accountId, async (db) => {
      const cur = (await db.query(
        'SELECT d.*, t.code AS template_code FROM report_definition d JOIN report_template t ON t.id = d.template_id WHERE d.id = $1', [id])).rows[0];
      if (!cur) throw new HttpError(404, 'report not found');
      const merged = parse(definitionBody, {
        name: cur.name, templateCode: cur.template_code, params: cur.params, cadence: cur.cadence, timezone: cur.timezone,
        recipients: cur.recipients, destinations: cur.destinations, visibility: cur.visibility, active: cur.active, ...(req.body as object),
      });
      const templateId = await checkDefinition(db, merged);
      const d = (await db.query(
        `UPDATE report_definition SET name = $2, template_id = $3, params = $4, cadence = $5, timezone = $6, recipients = $7, destinations = $8,
                visibility = $9, active = $10 WHERE id = $1 RETURNING *`,
        [id, merged.name, templateId, JSON.stringify(merged.params), merged.cadence, merged.timezone, merged.recipients, JSON.stringify(merged.destinations), merged.visibility, merged.active],
      )).rows[0];
      await audit(db, req, { action: 'report_definition.updated', entityType: 'report_definition', entityId: id, summary: `Updated report "${merged.name}"`, before: cur, after: merged });
      return d;
    });
  });

  /** Run a scheduled report now (its own period, recipients and destinations; PDF within the hour). */
  app.post<{ Params: Params & { definitionId: string } }>(`${base}/definitions/:definitionId/run`, { config: { permission: 'reports.write' } }, async (req) => {
    const id = uuidOr404(req.params.definitionId, 'report');
    return withTenant(req.params.accountId, async (db) => {
      const d = (await db.query('SELECT d.name, d.params, t.code FROM report_definition d JOIN report_template t ON t.id = d.template_id WHERE d.id = $1', [id])).rows[0];
      if (!d) throw new HttpError(404, 'report not found');
      const q = await queueRun(db, { accountId: req.params.accountId, templateCode: d.code, params: d.params, name: d.name, definitionId: id, trigger: 'manual', requestedBy: req.user?.sub ?? null }).catch(reportError);
      await generateRun(db, q.id).catch(reportError);
      await audit(db, req, { action: 'report_run.requested', entityType: 'report_run', entityId: q.id, summary: `Ran "${d.name}" now (${q.code})` });
      return { id: q.id, code: q.code, status: 'awaiting_pdf' };
    });
  });

  /** An ad-hoc run from a template (no schedule, no recipients; hosted link when the PDF is ready). */
  app.post<{ Params: Params }>(`${base}/runs`, { config: { permission: 'reports.write' } }, async (req) => {
    const b = parse(z.object({ templateCode: z.string(), params: z.record(z.string(), z.unknown()).default({}), name: z.string().trim().max(120).optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const q = await queueRun(db, { accountId: req.params.accountId, templateCode: b.templateCode, params: b.params, name: b.name, trigger: 'manual', requestedBy: req.user?.sub ?? null }).catch(reportError);
      await generateRun(db, q.id).catch(reportError);
      await audit(db, req, { action: 'report_run.requested', entityType: 'report_run', entityId: q.id, summary: `Ran ${b.templateCode} (${q.code})`, after: b });
      return { id: q.id, code: q.code, status: 'awaiting_pdf' };
    });
  });

  /** The repository: every run with its rule set, data-quality note and deliveries. */
  app.get<{ Params: Params; Querystring: { limit?: string } }>(`${base}/runs`, { config: { permission: 'reports.read' } }, async (req) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    return withTenant(req.params.accountId, async (db) =>
      (await db.query(
        `SELECT r.id, r.seq, r.name, t.name AS template, t.code AS template_code, r.trigger, r.status, r.period_from, r.period_to, r.rows, r.rule_set,
                r.quality_note, r.error, r.created_at, r.generated_at, r.finished_at,
                coalesce((SELECT jsonb_agg(f - 'uri' - 'key') FROM jsonb_array_elements(r.files) f), '[]') AS files,
                coalesce((SELECT jsonb_agg(jsonb_build_object('channel', x.channel, 'status', x.status, 'target', x.target) ORDER BY x.created_at)
                            FROM report_delivery x WHERE x.report_run_id = r.id), '[]') AS deliveries
           FROM report_run r JOIN report_template t ON t.id = r.template_id
           LEFT JOIN report_definition d ON d.id = r.definition_id
          WHERE ($1::boolean IS FALSE OR d.visibility = 'Brand users')
          ORDER BY r.created_at DESC LIMIT $2`,
        [brandOnly(req), limit],
      )).rows.map((r) => ({ ...r, code: runCode(r.seq) })),
    );
  });

  app.get<{ Params: Params & { runId: string } }>(`${base}/runs/:runId`, { config: { permission: 'reports.read' } }, async (req) => {
    const id = uuidOr404(req.params.runId, 'report run');
    return withTenant(req.params.accountId, async (db) => {
      const r = (await db.query(
        `SELECT r.*, d.visibility FROM report_run r LEFT JOIN report_definition d ON d.id = r.definition_id WHERE r.id = $1`, [id])).rows[0];
      if (!r || (brandOnly(req) && r.visibility !== 'Brand users')) throw new HttpError(404, 'report run not found');
      const html = r.snapshot ? await runHtml(db, id) : null;
      const { snapshot: _s, ...meta } = r;
      void _s;
      return { ...meta, code: runCode(r.seq), files: await filesOut(r.files), html };
    });
  });

  app.post<{ Params: Params & { runId: string } }>(`${base}/runs/:runId/link`, { config: { permission: 'reports.write' } }, async (req) => {
    const id = uuidOr404(req.params.runId, 'report run');
    const b = parse(z.object({ days: z.number().int().min(1).max(365).default(REPORT_LINK_DAYS) }), req.body ?? {});
    return withTenant(req.params.accountId, async (db) => {
      const r = (await db.query<{ seq: number; snapshot: unknown }>('SELECT seq, snapshot IS NOT NULL AS snapshot FROM report_run WHERE id = $1', [id])).rows[0];
      if (!r) throw new HttpError(404, 'report run not found');
      if (!r.snapshot) throw new HttpError(409, 'this report has not been generated yet');
      const link = await createLink(db, { accountId: req.params.accountId, scope: 'report:view', reportRunId: id, days: b.days, createdBy: req.user?.sub ?? null });
      await audit(db, req, { action: 'report_link.created', entityType: 'report_run', entityId: id, summary: `Hosted link for ${runCode(r.seq)}, ${b.days} days` });
      return { url: link.url, expiresAt: link.expiresAt };
    });
  });

  /** The hosted report behind a link. 404 unknown, 410 expired / revoked, 403 a link of another scope. */
  app.get<{ Params: { token: string } }>('/r/:token', { config: { permission: 'public' } }, async (req, reply) => {
    const link = await withApi((db) => openLink(db, req.params.token));
    if (!link) throw new HttpError(404, 'This report link is not valid.');
    if (link.state !== 'open') {
      reply.code(410);
      return { state: link.state, message: link.state === 'expired' ? 'This report link has expired.' : 'This report link was revoked.' };
    }
    if (link.scope !== 'report:view' || !link.report_run_id) throw new HttpError(403, 'This link does not open a report.');
    const out = await withTenant(link.account_id, async (db) => {
      const r = (await db.query('SELECT seq, name, period_from, period_to, generated_at, quality_note, files FROM report_run WHERE id = $1', [link.report_run_id])).rows[0];
      if (!r) return null;
      return { state: 'open', expiresAt: link.expires_at, code: runCode(r.seq), name: r.name, periodFrom: r.period_from, periodTo: r.period_to,
        generatedAt: r.generated_at, qualityNote: r.quality_note, files: await filesOut(r.files), html: await runHtml(db, link.report_run_id!) };
    });
    if (!out) throw new HttpError(404, 'This report no longer exists.');
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex');
    return out;
  });
}

function nextRun(cadence: string, tz: string): Date | null {
  if (isManual(cadence)) return null;
  try {
    return cronParser.parseExpression(cadence, { tz }).next().toDate();
  } catch {
    return null;
  }
}
