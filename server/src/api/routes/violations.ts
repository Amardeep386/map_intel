// Violations (Phase 3): list with filters, CSV export, detail (status history, observation history
// with proof, policy in force) and status changes, each one a new event, audited.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant } from '../../lib/db.js';
import type { ViolationStatus } from '../../lib/rules.js';
import { changeStatus, listViolations, SEVERITIES, STATUSES, toCsv, violationDetail, ViolationError, type ViolationFilter } from '../../lib/violations.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
type Query = Record<string, string | undefined>;

const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const filterQuery = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  source: z.string().max(40).optional(),
  seller: z.string().uuid().optional(),
  product: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function toFilter(q: Query): ViolationFilter {
  const f = parse(filterQuery, q);
  const status = list(f.status);
  const severity = list(f.severity);
  if (status?.some((s) => !STATUSES.includes(s as ViolationStatus))) throw new HttpError(400, `status must be among ${STATUSES.join(', ')}`);
  if (severity?.some((s) => !(SEVERITIES as readonly string[]).includes(s))) throw new HttpError(400, `severity must be among ${SEVERITIES.join(', ')}`);
  return {
    status, severity, source: f.source, sellerId: f.seller, productId: f.product, q: f.q,
    active: f.active === undefined ? undefined : f.active === 'true', from: f.from, to: f.to, limit: f.limit, offset: f.offset,
  };
}

export async function violationRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/violations';

  app.get<{ Params: Params; Querystring: Query }>(base, { config: { permission: 'violations.read' } }, async (req) => {
    const f = toFilter(req.query);
    return withTenant(req.params.accountId, async (db) => {
      const r = await listViolations(db, f);
      const counts = (await db.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM violation_current GROUP BY status')).rows;
      return { ...r, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
    });
  });

  app.get<{ Params: Params; Querystring: Query }>(`${base}.csv`, { config: { permission: 'violations.read' } }, async (req, reply) => {
    const f = { ...toFilter(req.query), limit: 1000, offset: 0 };
    const { rows } = await withTenant(req.params.accountId, (db) => listViolations(db, f));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="violations.csv"');
    return toCsv(
      ['Violation', 'SKU', 'Product', 'Seller', 'Seller class', 'Source', 'MAP', 'Advertised', 'Below MAP %', 'Severity', 'Status', 'First seen', 'Last seen', 'Observations', 'Rule', 'Listing URL'],
      rows.map((v) => [v.code, v.sku, v.product, v.seller, v.class_at_capture, v.source, v.last_map, v.last_price, v.last_depth_pct, v.severity, v.status,
        v.opened_at, v.last_seen, v.observations, v.rule, v.url]),
    );
  });

  app.get<{ Params: Params & { violationId: string } }>(`${base}/:violationId`, { config: { permission: 'violations.read' } }, async (req) => {
    const id = uuidOr404(req.params.violationId, 'violation');
    const v = await withTenant(req.params.accountId, (db) => violationDetail(db, id));
    if (!v) throw new HttpError(404, 'violation not found');
    return v;
  });

  app.post<{ Params: Params & { violationId: string } }>(`${base}/:violationId/status`, { config: { permission: 'violations.write' } }, async (req) => {
    const id = uuidOr404(req.params.violationId, 'violation');
    const b = parse(z.object({ status: z.enum(STATUSES as [ViolationStatus, ...ViolationStatus[]]), reason: z.string().trim().max(500).optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await changeStatus(db, req.params.accountId, id, b.status, b.reason ?? null, req.user?.sub ?? null).catch((err) => {
        if (err instanceof ViolationError) throw new HttpError(err.statusCode, err.message);
        throw err;
      });
      await recordAudit(db, {
        accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id,
        action: 'violation.status_changed', entityType: 'violation', entityId: id,
        summary: `${r.code}: ${r.before} → ${r.after}${b.reason ? ` (${b.reason})` : ''}`, before: { status: r.before }, after: b,
      });
      return violationDetail(db, id);
    });
  });
}
