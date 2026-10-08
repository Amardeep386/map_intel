// IP track (Phase 4 · M5): marketplace reports on cases marked as an IP issue. Draft, record the
// filing (reference number), record the outcome or withdraw, and download the evidence pack.
// Every change is audited in the same transaction.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { CaseError } from '../../lib/cases.js';
import { withTenant, type Db } from '../../lib/db.js';
import {
  closeReport, createReport, evidencePack, fileReport, IP_BASES, IP_CHANNELS, listReports, reportDetail, type IpBasis, type IpChannel,
} from '../../lib/ipReports.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
type RP = { Params: Params & { reportId: string } };

async function audit(db: Db, req: FastifyRequest<{ Params: Params }>, entry: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  await recordAudit(db, { accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, ...entry });
}

const http = (err: unknown): never => {
  if (err instanceof CaseError) throw new HttpError(err.statusCode, err.message);
  throw err;
};

export async function ipReportRoutes(app: FastifyInstance): Promise<void> {
  const acct = '/accounts/:accountId';
  const path = `${acct}/ip-reports/:reportId`;

  app.get<{ Params: Params; Querystring: Record<string, string | undefined> }>(`${acct}/ip-reports`, { config: { permission: 'cases.read' } }, async (req) => {
    const q = parse(z.object({ case: z.string().uuid().optional() }), req.query);
    return withTenant(req.params.accountId, (db) => listReports(db, req.params.accountId, { caseId: q.case }));
  });

  app.post<{ Params: Params & { caseId: string } }>(`${acct}/cases/:caseId/ip-reports`, { config: { permission: 'cases.write' } }, async (req) => {
    const caseId = uuidOr404(req.params.caseId, 'case');
    const b = parse(z.object({
      channel: z.enum(IP_CHANNELS as unknown as [IpChannel, ...IpChannel[]]),
      ipBasis: z.enum(IP_BASES as unknown as [IpBasis, ...IpBasis[]]),
      reason: z.string().trim().min(1).max(1000),
    }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await createReport(db, req.params.accountId, caseId, b, req.user?.sub ?? null).catch(http);
      await audit(db, req, { action: 'ip_report.drafted', entityType: 'marketplace_report', entityId: r.id, summary: `Drafted ${r.code} (${b.channel}, ${b.ipBasis}) for ${r.caseCode}`, after: b });
      return reportDetail(db, r.id);
    });
  });

  app.get<RP>(path, { config: { permission: 'cases.read' } }, async (req) => {
    const id = uuidOr404(req.params.reportId, 'report');
    const r = await withTenant(req.params.accountId, (db) => reportDetail(db, id));
    if (!r) throw new HttpError(404, 'report not found');
    return r;
  });

  // Creates fresh secure links each time, so it needs write rights and is audited.
  app.get<RP>(`${path}/pack`, { config: { permission: 'cases.write' } }, async (req, reply) => {
    const id = uuidOr404(req.params.reportId, 'report');
    const pack = await withTenant(req.params.accountId, async (db) => {
      const p = await evidencePack(db, req.params.accountId, id, req.user?.sub ?? null).catch(http);
      await audit(db, req, { action: 'ip_report.pack_downloaded', entityType: 'marketplace_report', entityId: id, summary: `Evidence pack for ${p.code} downloaded` });
      return p;
    });
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${pack.code}-evidence.txt"`);
    return pack.text;
  });

  app.post<RP>(`${path}/file`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.reportId, 'report');
    const b = parse(z.object({ reference: z.string().trim().min(1).max(200), filedAt: z.string().datetime({ offset: true }).nullable().optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await fileReport(db, id, b.reference, b.filedAt ?? null, req.user?.sub ?? null).catch(http);
      await audit(db, req, { action: 'ip_report.filed', entityType: 'marketplace_report', entityId: id, summary: `${r.code} filed, reference ${b.reference}`, before: { status: r.before }, after: b });
      return reportDetail(db, id);
    });
  });

  app.post<RP>(`${path}/outcome`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.reportId, 'report');
    const b = parse(z.object({ status: z.enum(['Accepted', 'Rejected', 'Withdrawn']), note: z.string().trim().max(1000).optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await closeReport(db, id, b.status, b.note ?? null).catch(http);
      await audit(db, req, { action: 'ip_report.outcome', entityType: 'marketplace_report', entityId: id, summary: `${r.code}: ${r.before} → ${b.status}${b.note ? ` (${b.note})` : ''}`, before: { status: r.before }, after: b });
      return reportDetail(db, id);
    });
  });
}
