import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { verifyToken, type TokenClaims } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { parseOrigins } from '../lib/cors.js';
import { apiPool, withApi } from '../lib/db.js';
import { can, type AccountAction, type RoutePermission } from '../lib/permissions.js';
import { closeRateLimiter } from '../lib/rateLimit.js';
import { accountRoutes } from './routes/accounts.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { auditRoutes } from './routes/audit.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { authRoutes } from './routes/auth.js';
import { collectionRoutes } from './routes/collection.js';
import { credentialRoutes } from './routes/credentials.js';
import { healthRoutes } from './routes/health.js';
import { matrixRoutes } from './routes/matrix.js';
import { scheduleRoutes } from './routes/schedules.js';
import { sourceRoutes } from './routes/sources.js';
import { termRoutes } from './routes/terms.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenClaims | null;
    /** Set for routes with an account action: the :accountId and the caller's role in it. */
    accountId: string | null;
    accountRole: string | null;
  }
  interface FastifyContextConfig {
    permission?: RoutePermission;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The caller's role in an account: their membership role, or Administrator for platform admins.
 * Throws 404 for an unknown account and 403 when the caller has no access.
 */
export async function accountRoleFor(user: TokenClaims, accountId: string): Promise<string> {
  if (!UUID.test(accountId)) throw new HttpError(404, 'account not found');
  const { exists, role } = await withApi(async (db) => {
    const { rows } = await db.query<{ exists: boolean; role: string | null }>(
      'SELECT EXISTS (SELECT 1 FROM account WHERE id = $1) AS exists, app_account_role($1, $2) AS role',
      [accountId, user.sub],
    );
    return rows[0];
  });
  if (!exists) throw new HttpError(404, 'account not found');
  if (user.role === 'admin') return 'Administrator';
  if (!role) throw new HttpError(403, 'no access to this account');
  return role;
}

/** For routes whose account is not in the URL (e.g. evidence): check the action inside the handler. */
export async function requireAccountAction(user: TokenClaims, accountId: string, action: AccountAction): Promise<string> {
  const role = await accountRoleFor(user, accountId);
  if (!can(role, action)) throw new HttpError(403, `your role (${role}) cannot do this`);
  return role;
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization'] },
    trustProxy: true,
  });

  // Every route must say who may call it. HEAD and OPTIONS routes are added by Fastify and CORS.
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (methods.every((m) => m === 'HEAD' || m === 'OPTIONS')) return;
    if (!route.config?.permission) throw new Error(`route ${methods.join(',')} ${route.url} has no permission in its config`);
  });

  await app.register(cors, {
    origin: parseOrigins(config.CORS_ORIGINS),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });

  app.decorateRequest('user', null);
  app.decorateRequest('accountId', null);
  app.decorateRequest('accountRole', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const claims = await verifyToken(header.slice(7));
        // A disabled (or removed) user is signed out on their next request, not when the token expires.
        // One read, no transaction: this runs on every signed-in request.
        const active = (await apiPool().query("SELECT 1 FROM app_user WHERE id = $1 AND status = 'Active'", [claims.sub])).rowCount;
        req.user = active ? claims : null;
      } catch {
        req.user = null;
      }
    }
  });

  // Enforce the declared permission before any handler runs.
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const permission = req.routeOptions.config?.permission;
    if (!permission || permission === 'public') return undefined;
    if (!req.user) return reply.code(401).send({ error: 'sign in required' });
    if (permission === 'user') return undefined;
    if (permission === 'platform') {
      if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Mirethos administrators only' });
      return undefined;
    }
    const accountId = (req.params as { accountId?: string } | undefined)?.accountId;
    if (!accountId) throw new Error(`route ${req.routeOptions.url} needs :accountId for permission ${permission}`);
    const role = await accountRoleFor(req.user, accountId);
    if (!can(role, permission)) return reply.code(403).send({ error: `your role (${role}) cannot do this` });
    req.accountId = accountId;
    req.accountRole = role;
    return undefined;
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  app.addHook('onClose', async () => {
    await closeRateLimiter();
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(accountRoutes);
  await app.register(auditRoutes);
  await app.register(catalogueRoutes);
  await app.register(collectionRoutes);
  await app.register(credentialRoutes);
  await app.register(sourceRoutes);
  await app.register(termRoutes);
  await app.register(matrixRoutes);
  await app.register(scheduleRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  return app;
}
