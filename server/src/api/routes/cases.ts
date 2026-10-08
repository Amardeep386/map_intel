// Enforcement cases (Phase 4): list, detail (violations, state history, seller contacts), open a
// case from one seller's violations, add violations, move it on, assign owner / due date / IP flag.
// Every change is audited in the same transaction.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { addViolations, CASE_STATES, CaseError, caseDetail, createCase, listCases, moveCase, updateCase, type CaseState } from '../../lib/cases.js';
import { withTenant, type Db } from '../../lib/db.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
type CaseParams = Params & { caseId: string };
type Query = Record<string, string | undefined>;

const date = z.string().date();
const uuids = z.array(z.string().uuid()).min(1).max(200);

const listQuery = z.object({
  state: z.string().optional(),
  open: z.enum(['true', 'false']).optional(),
  seller: z.string().uuid().optional(),
  owner: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

async function audit(db: Db, req: FastifyRequest<{ Params: Params }>, entry: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  await recordAudit(db, { accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, ...entry });
}

const http = (err: unknown): never => {
  if (err instanceof CaseError) throw new HttpError(err.statusCode, err.message);
  throw err;
};

export async function caseRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/cases';

  app.get<{ Params: Params; Querystring: Query }>(base, { config: { permission: 'cases.read' } }, async (req) => {
    const q = parse(listQuery, req.query);
    const state = q.state?.split(',').map((s) => s.trim()).filter(Boolean);
    if (state?.some((s) => !(CASE_STATES as readonly string[]).includes(s))) throw new HttpError(400, `state must be among ${CASE_STATES.join(', ')}`);
    return withTenant(req.params.accountId, (db) => listCases(db, req.params.accountId, {
      state, open: q.open === undefined ? undefined : q.open === 'true', sellerId: q.seller, owner: q.owner, q: q.q, limit: q.limit, offset: q.offset,
    }));
  });

  app.get<{ Params: CaseParams }>(`${base}/:caseId`, { config: { permission: 'cases.read' } }, async (req) => {
    const id = uuidOr404(req.params.caseId, 'case');
    const c = await withTenant(req.params.accountId, (db) => caseDetail(db, id));
    if (!c) throw new HttpError(404, 'case not found');
    return c;
  });

  app.post<{ Params: Params }>(base, { config: { permission: 'cases.write' } }, async (req) => {
    const b = parse(z.object({
      violationIds: uuids,
      owner: z.string().uuid().nullable().optional(),
      responseDue: date.nullable().optional(),
      note: z.string().trim().max(500).optional(),
    }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await createCase(db, req.params.accountId, b, req.user?.sub ?? null).catch(http);
      await audit(db, req, {
        action: 'case.opened', entityType: 'enforcement_case', entityId: r.id,
        summary: `Opened ${r.code} with ${b.violationIds.length} violation${b.violationIds.length === 1 ? '' : 's'}${r.recurredFrom ? ` (seller re-offended after ${r.recurredFrom})` : ''}`,
        after: { ...b, recurredFrom: r.recurredFrom },
      });
      return caseDetail(db, r.id);
    });
  });

  app.post<{ Params: CaseParams }>(`${base}/:caseId/violations`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.caseId, 'case');
    const b = parse(z.object({ violationIds: uuids }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await addViolations(db, req.params.accountId, id, b.violationIds, req.user?.sub ?? null).catch(http);
      await audit(db, req, {
        action: 'case.violations_added', entityType: 'enforcement_case', entityId: id,
        summary: `Added ${r.added} violation${r.added === 1 ? '' : 's'} to ${r.code}`, after: b,
      });
      return caseDetail(db, id);
    });
  });

  app.post<{ Params: CaseParams }>(`${base}/:caseId/state`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.caseId, 'case');
    const b = parse(z.object({ state: z.enum(CASE_STATES as unknown as [CaseState, ...CaseState[]]), reason: z.string().trim().max(500).optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await moveCase(db, req.params.accountId, id, b.state, b.reason ?? null, req.user?.sub ?? null).catch(http);
      await audit(db, req, {
        action: 'case.state_changed', entityType: 'enforcement_case', entityId: id,
        summary: `${r.code}: ${r.before} → ${r.after}${b.reason ? ` (${b.reason})` : ''}`, before: { state: r.before }, after: b,
      });
      return caseDetail(db, id);
    });
  });

  app.patch<{ Params: CaseParams }>(`${base}/:caseId`, { config: { permission: 'cases.write' } }, async (req) => {
    const id = uuidOr404(req.params.caseId, 'case');
    const b = parse(z.object({
      owner: z.string().uuid().nullable().optional(),
      responseDue: date.nullable().optional(),
      ipIssue: z.boolean().optional(),
      ipReason: z.string().trim().max(500).nullable().optional(),
    }).refine((v) => Object.keys(v).length > 0, 'nothing to change'), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await updateCase(db, req.params.accountId, id, b).catch(http);
      const what = [
        b.owner !== undefined && (b.owner ? 'owner set' : 'owner cleared'),
        b.responseDue !== undefined && `response due ${b.responseDue ?? 'cleared'}`,
        b.ipIssue !== undefined && (b.ipIssue ? `marked as an IP issue (${b.ipReason})` : 'no longer an IP issue'),
      ].filter(Boolean).join(', ');
      await audit(db, req, {
        action: 'case.updated', entityType: 'enforcement_case', entityId: id,
        summary: `${r.code}: ${what}`, before: r.before, after: b,
      });
      return caseDetail(db, id);
    });
  });
}
