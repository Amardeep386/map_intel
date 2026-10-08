// Notices, letter templates and the communications log (Phase 4 · M3). Draft a notice from a
// template for a case, edit the draft, submit it for brand approval, approve / reject (Brand users),
// send (logged until an email provider is configured), cancel, download as text; log a seller's
// response or contest. Every change is audited in the same transaction.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { CaseError } from '../../lib/cases.js';
import { withTenant, type Db } from '../../lib/db.js';
import {
  cancelNotice, CHANNELS, createTemplate, decideNotice, draftNotice, editNotice, listCommunications, listNotices, listTemplates,
  logCommunication, NOTICE_STATUSES, noticeDetail, noticeText, sendNotice, submitNotice, updateTemplate, type Channel,
} from '../../lib/notices.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
type Query = Record<string, string | undefined>;

async function audit(db: Db, req: FastifyRequest<{ Params: Params }>, entry: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  await recordAudit(db, { accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, ...entry });
}

const http = (err: unknown): never => {
  if (err instanceof CaseError) throw new HttpError(err.statusCode, err.message);
  throw err;
};

const emails = z.array(z.string().trim().email().max(200)).max(20);
const channel = z.enum(CHANNELS as unknown as [Channel, ...Channel[]]);

export async function noticeRoutes(app: FastifyInstance): Promise<void> {
  const acct = '/accounts/:accountId';

  // ---- Templates --------------------------------------------------------
  app.get<{ Params: Params }>(`${acct}/notice-templates`, { config: { permission: 'cases.read' } }, async (req) =>
    withTenant(req.params.accountId, (db) => listTemplates(db, req.params.accountId)));

  const templateBody = z.object({
    name: z.string().trim().min(1).max(120),
    usedFor: z.string().trim().max(200).nullable(),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
    attachesPolicy: z.boolean(),
    active: z.boolean(),
  });

  app.post<{ Params: Params }>(`${acct}/notice-templates`, { config: { permission: 'settings.write' } }, async (req) => {
    const b = parse(templateBody.partial().required({ name: true, subject: true, body: true }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await createTemplate(db, req.params.accountId, b, req.user?.sub ?? null).catch(http);
      await audit(db, req, { action: 'notice_template.created', entityType: 'notice_template', entityId: r.id, summary: `Added letter template ${r.code} ${b.name}`, after: b });
      return (await listTemplates(db, req.params.accountId)).find((t) => t.id === r.id);
    });
  });

  app.patch<{ Params: Params & { templateId: string } }>(`${acct}/notice-templates/:templateId`, { config: { permission: 'settings.write' } }, async (req) => {
    const id = uuidOr404(req.params.templateId, 'template');
    const b = parse(templateBody.partial().refine((v) => Object.keys(v).length > 0, 'nothing to change'), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await updateTemplate(db, id, b, req.user?.sub ?? null).catch(http);
      await audit(db, req, { action: 'notice_template.updated', entityType: 'notice_template', entityId: id, summary: `Edited letter template ${r.code}`, before: r.before, after: b });
      return (await listTemplates(db, req.params.accountId)).find((t) => t.id === id);
    });
  });

  // ---- Notices ----------------------------------------------------------
  app.get<{ Params: Params; Querystring: Query }>(`${acct}/notices`, { config: { permission: 'cases.read' } }, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), case: z.string().uuid().optional() }), req.query);
    const status = q.status?.split(',').map((s) => s.trim()).filter(Boolean);
    if (status?.some((s) => !(NOTICE_STATUSES as readonly string[]).includes(s))) throw new HttpError(400, `status must be among ${NOTICE_STATUSES.join(', ')}`);
    return withTenant(req.params.accountId, (db) => listNotices(db, req.params.accountId, { status, caseId: q.case }));
  });

  app.post<{ Params: Params & { caseId: string } }>(`${acct}/cases/:caseId/notices`, { config: { permission: 'cases.write' } }, async (req) => {
    const caseId = uuidOr404(req.params.caseId, 'case');
    const b = parse(z.object({ templateId: z.string().uuid(), recipients: emails.optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await draftNotice(db, req.params.accountId, caseId, b, req.user?.sub ?? null).catch(http);
      await audit(db, req, { action: 'notice.drafted', entityType: 'notice', entityId: r.id, summary: `Drafted ${r.code} for ${r.caseCode}`, after: b });
      return noticeDetail(db, r.id);
    });
  });

  const noticePath = `${acct}/notices/:noticeId`;
  type NP = { Params: Params & { noticeId: string } };

  app.get<NP>(noticePath, { config: { permission: 'cases.read' } }, async (req) => {
    const id = uuidOr404(req.params.noticeId, 'notice');
    const n = await withTenant(req.params.accountId, (db) => noticeDetail(db, id));
    if (!n) throw new HttpError(404, 'notice not found');
    return n;
  });

  app.get<NP>(`${noticePath}/text`, { config: { permission: 'cases.read' } }, async (req, reply) => {
    const id = uuidOr404(req.params.noticeId, 'notice');
    const n = await withTenant(req.params.accountId, (db) => noticeDetail(db, id));
    if (!n) throw new HttpError(404, 'notice not found');
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${n.code}.txt"`);
    return noticeText(n);
  });

  app.patch<NP>(noticePath, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.noticeId, 'notice');
    const b = parse(z.object({
      recipients: emails.optional(),
      subject: z.string().trim().min(1).max(300).optional(),
      body: z.string().trim().min(1).max(20_000).optional(),
    }).refine((v) => Object.keys(v).length > 0, 'nothing to change'), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await editNotice(db, id, b).catch(http);
      await audit(db, req, { action: 'notice.edited', entityType: 'notice', entityId: id, summary: `Edited draft ${r.code}`, before: r.before, after: { recipients: b.recipients, subject: b.subject, bodyChanged: b.body !== undefined } });
      return noticeDetail(db, id);
    });
  });

  app.post<NP>(`${noticePath}/submit`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.noticeId, 'notice');
    return withTenant(req.params.accountId, async (db) => {
      const r = await submitNotice(db, id).catch(http);
      await audit(db, req, { action: 'notice.submitted', entityType: 'notice', entityId: id, summary: `${r.code} sent to the brand for approval` });
      return noticeDetail(db, id);
    });
  });

  for (const [verb, approve] of [['approve', true], ['reject', false]] as const) {
    app.post<NP>(`${noticePath}/${verb}`, { config: { permission: 'notices.approve' } }, async (req) => {
      const id = uuidOr404(req.params.noticeId, 'notice');
      const b = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body ?? {});
      return withTenant(req.params.accountId, async (db) => {
        const r = await decideNotice(db, id, approve, b.note ?? null, req.user?.sub ?? null).catch(http);
        await audit(db, req, { action: `notice.${approve ? 'approved' : 'rejected'}`, entityType: 'notice', entityId: id, summary: `${r.code} ${r.status.toLowerCase()}${b.note ? `: ${b.note}` : ''}`, after: b });
        return noticeDetail(db, id);
      });
    });
  }

  app.post<NP>(`${noticePath}/send`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.noticeId, 'notice');
    const b = parse(z.object({ channel: channel.default('email') }), req.body ?? {});
    return withTenant(req.params.accountId, async (db) => {
      const r = await sendNotice(db, req.params.accountId, id, b.channel, req.user?.sub ?? null).catch(http);
      await audit(db, req, {
        action: 'notice.sent', entityType: 'notice', entityId: id,
        summary: `${r.code} ${r.logged ? 'logged as sent by email (no email provider: send it yourself)' : `recorded as sent by ${b.channel}`} for ${r.caseCode}${r.underNotice ? `; ${r.underNotice} violation${r.underNotice === 1 ? '' : 's'} under notice` : ''}`,
        after: b,
      });
      return noticeDetail(db, id);
    });
  });

  app.post<NP>(`${noticePath}/cancel`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.noticeId, 'notice');
    return withTenant(req.params.accountId, async (db) => {
      const r = await cancelNotice(db, id).catch(http);
      await audit(db, req, { action: 'notice.cancelled', entityType: 'notice', entityId: id, summary: `${r.code} cancelled` });
      return noticeDetail(db, id);
    });
  });

  // ---- Communications log -------------------------------------------------
  app.get<{ Params: Params; Querystring: Query }>(`${acct}/communications`, { config: { permission: 'cases.read' } }, async (req) => {
    const q = parse(z.object({ case: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
    return withTenant(req.params.accountId, (db) => listCommunications(db, req.params.accountId, { caseId: q.case, limit: q.limit }));
  });

  app.post<{ Params: Params & { caseId: string } }>(`${acct}/cases/:caseId/communications`, { config: { permission: 'cases.write' } }, async (req) => {
    const caseId = uuidOr404(req.params.caseId, 'case');
    const b = parse(z.object({
      kind: z.enum(['response', 'contest', 'note']),
      channel: channel.optional(),
      summary: z.string().trim().min(1).max(500),
      body: z.string().max(20_000).nullable().optional(),
      occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
    }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await logCommunication(db, req.params.accountId, caseId, b, req.user?.sub ?? null).catch(http);
      await audit(db, req, {
        action: `communication.${b.kind}`, entityType: 'enforcement_case', entityId: caseId,
        summary: `${r.caseCode}: ${b.kind === 'note' ? 'note' : `seller ${b.kind}`} logged${r.moved ? ` → ${r.moved}` : ''}`, after: { kind: b.kind, channel: b.channel, summary: b.summary },
      });
      return listCommunications(db, req.params.accountId, { caseId });
    });
  });
}
