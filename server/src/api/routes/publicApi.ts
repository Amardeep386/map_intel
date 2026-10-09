// The read-only public API (Phase 5 · M9) for brands' BI teams: an account's API key reads that
// account's products, violations, price observations, sellers and cases, page by page. Nothing
// here writes account data. 120 calls a minute per key; every call is logged (api_request_log).
//   GET /v1                       what the key can read
//   GET /v1/<dataset>?limit=&cursor=&from=&to=&status=&product=
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DATASET_IDS, DATASETS, decodeCursor } from '../../lib/datasets.js';
import { withTenant } from '../../lib/db.js';
import { hit, isLimited, type Limit } from '../../lib/rateLimit.js';
import { HttpError } from '../app.js';
import { parse } from '../validate.js';

const KEY_LIMIT: Limit = { max: 120, windowSeconds: 60 };

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().max(500).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.string().trim().max(40).optional(),
  product: z.string().trim().max(100).optional(),
});

declare module 'fastify' {
  interface FastifyRequest {
    apiRows?: number;
  }
}

export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  // Brake and log every keyed call.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.apiKey) return undefined;
    const key = `apikey:${req.apiKey.id}`;
    if (await isLimited(key, KEY_LIMIT)) {
      return reply.code(429).header('retry-after', '60').send({ error: 'rate limit: 120 calls a minute per key' });
    }
    await hit(key, KEY_LIMIT);
    return undefined;
  });
  app.addHook('onResponse', async (req: FastifyRequest, reply) => {
    const k = req.apiKey;
    if (!k) return;
    await withTenant(k.accountId, async (db) => {
      await db.query('INSERT INTO api_request_log (account_id, api_key_id, method, path, status, rows, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        k.accountId, k.id, req.method, req.url.slice(0, 500), reply.statusCode, req.apiRows ?? null, req.ip,
      ]);
      await db.query('UPDATE api_key SET last_used_at = now() WHERE id = $1', [k.id]);
    }).catch((err) => req.log.warn({ err }, 'api request log failed'));
  });

  app.get('/v1', { config: { permission: 'apikey' } }, async (req) =>
    withTenant(req.apiKey!.accountId, async (db) => {
      const a = (await db.query<{ name: string; currency: string; timezone: string }>('SELECT name, currency, timezone FROM account WHERE id = $1', [req.apiKey!.accountId])).rows[0];
      return {
        account: { name: a.name, currency: a.currency, timezone: a.timezone },
        key: req.apiKey!.name,
        datasets: DATASET_IDS.map((id) => ({ id, title: DATASETS[id].title, path: `/v1/${id}`, fields: DATASETS[id].columns.map((c) => ({ name: c.key, type: c.type ?? 'text' })) })),
        paging: 'Pass next_cursor back as ?cursor= until it is null. limit: 1–1,000 (default 100).',
      };
    }));

  for (const id of DATASET_IDS) {
    app.get(`/v1/${id}`, { config: { permission: 'apikey' } }, async (req) => {
      const q = parse(pageQuery, req.query);
      if (q.cursor && !decodeCursor(q.cursor)) throw new HttpError(400, 'cursor: not a cursor from this API');
      const page = await withTenant(req.apiKey!.accountId, (db) =>
        DATASETS[id].page(db, { limit: q.limit, after: q.cursor ?? null, from: q.from, to: q.to, status: q.status, product: q.product }));
      req.apiRows = page.rows.length;
      return { data: page.rows, next_cursor: page.next };
    });
  }
}
