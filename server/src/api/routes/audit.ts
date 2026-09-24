import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../../lib/db.js';

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
}
