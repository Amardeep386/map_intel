import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueRun } from '../../collector/runs.js';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withApi } from '../../lib/db.js';

const runBody = z.object({
  account: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  product: z.string().max(64).optional(),
  limit: z.coerce.number().int().positive().max(10_000).optional(),
});

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sources', { config: { permission: 'user' } }, async () =>
    withApi(async (db) => {
      const { rows } = await db.query(
        `SELECT id, code, display_name AS name, category, country, base_url, logo_url, active FROM source ORDER BY display_name`,
      );
      return rows;
    }),
  );

  app.get<{ Querystring: { limit?: string } }>('/crawl-runs', { config: { permission: 'platform' } }, async (req) =>
    withApi(async (db) => {
      const limit = Math.min(Number.parseInt(req.query.limit ?? '20', 10) || 20, 100);
      const { rows } = await db.query('SELECT * FROM crawl_run ORDER BY started_at DESC LIMIT $1', [limit]);
      return rows;
    }),
  );

  // Queue a collection run for the worker (admin only).
  app.post('/crawl-runs', { config: { permission: 'platform' } }, async (req, reply) => {
    const body = runBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid run scope' });
    const result = await enqueueRun(body.data, 'manual', withApi);
    await withApi((db) =>
      recordAudit(db, {
        accountId: null,
        actor: actorFrom(req),
        action: 'crawl_run.queued',
        entityType: 'crawl_run',
        entityId: result.crawlRunId,
        summary: `Queued a collection run (${result.jobs} listings)`,
        after: { scope: body.data, jobs: result.jobs },
        requestId: req.id,
      }),
    );
    return reply.code(202).send(result);
  });
}
