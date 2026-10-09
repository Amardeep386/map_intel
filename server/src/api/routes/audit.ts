import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withApi, withTenant, type Db } from '../../lib/db.js';
import { parse } from '../validate.js';

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Verify one audit chain (account id, or null for the platform chain). Phase 5 · M6. */
export async function verifyChain(db: Db, accountId: string | null) {
  const r = (await db.query('SELECT * FROM app_audit_verify($1)', [accountId])).rows[0];
  const cp = (await db.query('SELECT purged_before, purged_count FROM audit_checkpoint WHERE account_id IS NOT DISTINCT FROM $1', [accountId])).rows[0] ?? null;
  return {
    ok: r.broken_seq === null,
    checked: Number(r.checked),
    firstSeq: r.first_seq === null ? null : Number(r.first_seq),
    lastSeq: r.last_seq === null ? null : Number(r.last_seq),
    lastHash: r.last_hash,
    broken: r.broken_seq === null ? null : { seq: Number(r.broken_seq), reason: r.broken_reason },
    purged: cp ? { before: cp.purged_before, count: Number(cp.purged_count) } : null,
    checkedAt: new Date().toISOString(),
  };
}

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(), // page: events older than this time
  actor: z.string().trim().max(200).optional(), // matches the actor label (e.g. an email)
  entity: z.string().trim().max(64).optional(), // entity type, e.g. 'product', 'term'
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // Newest first. Page with ?before=<occurredAt of the last row>.
  app.get<{ Params: { accountId: string }; Querystring: Record<string, string> }>(
    '/accounts/:accountId/audit',
    { config: { permission: 'audit.read' } },
    async (req, reply) => {
      const q = auditQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      const { limit, before, actor, entity, from, to } = q.data;
      const rows = await withTenant(req.params.accountId, async (db) => {
        const { rows } = await db.query(
          `SELECT id, occurred_at, actor_type, actor_label, action, entity_type, entity_id, summary, before, after
             FROM audit_event
            WHERE ($1::timestamptz IS NULL OR occurred_at < $1)
              AND ($2::text IS NULL OR actor_label ILIKE '%' || $2 || '%')
              AND ($3::text IS NULL OR entity_type = $3)
              AND ($4::date IS NULL OR occurred_at >= $4::date)
              AND ($5::date IS NULL OR occurred_at < $5::date + 1)
            ORDER BY occurred_at DESC
            LIMIT $6`,
          [before ?? null, actor ?? null, entity ?? null, from ?? null, to ?? null, limit],
        );
        return rows;
      });
      return {
        events: rows.map((r) => ({
          id: r.id,
          occurredAt: r.occurred_at,
          actorType: r.actor_type,
          actor: r.actor_label,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          summary: r.summary,
          before: r.before,
          after: r.after,
        })),
        next: rows.length === limit ? rows[rows.length - 1].occurred_at : null,
      };
    },
  );

  // Tamper evidence (Phase 5 · M6): recompute the account's audit hash chain.
  app.get<{ Params: { accountId: string } }>('/accounts/:accountId/audit/verify', { config: { permission: 'audit.read' } }, async (req) =>
    withApi((db) => verifyChain(db, req.params.accountId)));

  // The audit log as CSV, oldest first, with each event's chain hashes so it can be checked outside.
  app.get<{ Params: { accountId: string }; Querystring: Record<string, string> }>(
    '/accounts/:accountId/audit/export',
    { config: { permission: 'audit.read' } },
    async (req, reply) => {
      const q = parse(z.object({ from: z.string().date().optional(), to: z.string().date().optional() }), req.query);
      const { accountId } = req.params;
      const rows = await withTenant(accountId, async (db) => {
        const { rows } = await db.query(
          `SELECT seq, occurred_at, actor_type, actor_label, action, entity_type, entity_id, summary, before, after, request_id, prev_hash, hash
             FROM audit_event
            WHERE ($1::date IS NULL OR occurred_at >= $1::date) AND ($2::date IS NULL OR occurred_at < $2::date + 1)
            ORDER BY seq`,
          [q.from ?? null, q.to ?? null],
        );
        await recordAudit(db, {
          accountId, actor: actorFrom(req), requestId: req.id, action: 'audit.exported', entityType: 'audit_event',
          summary: `Exported the audit log (${rows.length} events${q.from || q.to ? `, ${q.from ?? 'start'} to ${q.to ?? 'today'}` : ''})`,
          after: { from: q.from ?? null, to: q.to ?? null, events: rows.length },
        });
        return rows;
      });
      const head = ['seq', 'occurred_at', 'actor_type', 'actor', 'action', 'entity_type', 'entity_id', 'summary', 'before', 'after', 'request_id', 'prev_hash', 'hash'];
      const body = [head.join(','), ...rows.map((r) => [r.seq, r.occurred_at, r.actor_type, r.actor_label, r.action, r.entity_type, r.entity_id, r.summary, r.before, r.after, r.request_id, r.prev_hash, r.hash].map(csvCell).join(','))].join('\r\n');
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(`${body}\r\n`);
    },
  );
}
