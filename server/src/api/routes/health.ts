import type { FastifyInstance } from 'fastify';
import { apiPool } from '../../lib/db.js';
import { redisHealthy } from '../../lib/queue.js';
import { storageHealthy } from '../../lib/storage.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const [db, redis, storage] = await Promise.all([
      apiPool().query('SELECT 1').then(() => true).catch(() => false),
      redisHealthy(),
      storageHealthy(),
    ]);
    const ok = db && redis && storage;
    return reply.code(ok ? 200 : 503).send({ ok, db, redis, storage, time: new Date().toISOString() });
  });
}
