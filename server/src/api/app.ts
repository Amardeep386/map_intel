import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { verifyToken, type TokenClaims } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { withSystem } from '../lib/db.js';
import { accountRoutes } from './routes/accounts.js';
import { authRoutes } from './routes/auth.js';
import { collectionRoutes } from './routes/collection.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenClaims | null;
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Throws 403 unless the user is a platform admin or a member of the account. Returns the role. */
export async function assertAccountAccess(user: TokenClaims, accountId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new HttpError(404, 'account not found');
  if (user.role === 'admin') return 'Administrator';
  const role = await withSystem(async (db) => {
    const { rows } = await db.query<{ role: string }>(
      'SELECT role FROM account_membership WHERE account_id = $1 AND user_id = $2',
      [accountId, user.sub],
    );
    return rows[0]?.role ?? null;
  });
  if (!role) throw new HttpError(403, 'no access to this account');
  return role;
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization'] },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        req.user = await verifyToken(header.slice(7));
      } catch {
        req.user = null;
      }
    }
  });

  // In async hooks Fastify stops the request when the hook returns the reply it sent.
  app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'sign in required' });
    return undefined;
  });
  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'sign in required' });
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    return undefined;
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(accountRoutes);
  await app.register(collectionRoutes);
  return app;
}
