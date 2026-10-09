import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { verifyToken, type TokenClaims } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { authenticateKey, type ApiKeyAuth } from '../lib/apiKeys.js';
import { parseOrigins } from '../lib/cors.js';
import { apiPool, withApi } from '../lib/db.js';
import { can, type AccountAction, type RoutePermission } from '../lib/permissions.js';
import { closeRateLimiter } from '../lib/rateLimit.js';
import { accountRoutes } from './routes/accounts.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { platformRoutes } from './routes/platform.js';
import { publicApiRoutes } from './routes/publicApi.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { auditRoutes } from './routes/audit.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { policyRoutes } from './routes/policies.js';
import { mappingRoutes } from './routes/mapping.js';
import { ruleRoutes } from './routes/rules.js';
import { violationRoutes } from './routes/violations.js';
import { caseRoutes } from './routes/cases.js';
import { noticeRoutes } from './routes/notices.js';
import { ipReportRoutes } from './routes/ipReports.js';
import { qaRoutes } from './routes/qa.js';
import { evidenceLinkRoutes } from './routes/evidenceLinks.js';
import { reportRoutes } from './routes/reports.js';
import { alertRoutes } from './routes/alerts.js';
import { sellerRoutes } from './routes/sellers.js';
import { authRoutes } from './routes/auth.js';
import { collectionRoutes } from './routes/collection.js';
import { credentialRoutes } from './routes/credentials.js';
import { dataHealthRoutes } from './routes/dataHealth.js';
import { ebayRoutes } from './routes/ebay.js';
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
    /** Phase 5 · M9: set when the request carries an API key (only /v1 routes accept it). */
    apiKey: ApiKeyAuth | null;
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

/** The message the portal recognises to offer MFA set-up. */
export const MFA_NEEDED = 'this account requires multi-factor sign-in: turn it on under Security, then sign in again';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The caller's role in an account: their membership role, or Administrator for platform admins.
 * Throws 404 for an unknown account and 403 when the caller has no access.
 */
export async function accountRoleFor(user: TokenClaims, accountId: string): Promise<string> {
  if (!UUID.test(accountId)) throw new HttpError(404, 'account not found');
  const { exists, role, mfa_required } = await withApi(async (db) => {
    const { rows } = await db.query<{ exists: boolean; role: string | null; mfa_required: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account WHERE id = $1) AS exists, app_account_role($1, $2) AS role,
              coalesce((SELECT (settings->>'mfa_required')::boolean FROM account WHERE id = $1), false) AS mfa_required`,
      [accountId, user.sub],
    );
    return rows[0];
  });
  if (!exists) throw new HttpError(404, 'account not found');
  // Phase 5 · M7: an account that requires MFA opens only for sessions that used a second factor.
  if (mfa_required && !user.mfa && (role || user.role === 'admin')) throw new HttpError(403, MFA_NEEDED);
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
  app.decorateRequest('apiKey', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    // An API key (Phase 5 · M9) is never a session: it only opens the /v1 routes.
    if (header?.startsWith('Bearer mik_')) {
      req.apiKey = await withApi((db) => authenticateKey(db, header.slice(7))).catch(() => null);
      return;
    }
    if (header?.startsWith('Bearer ')) {
      try {
        const claims = await verifyToken(header.slice(7));
        // A disabled (or removed) user is signed out on their next request, not when the token expires.
        // One read, no transaction: this runs on every signed-in request.
        // ... and a session issued before the user's last password reset is over (whoever reset it may not be the one holding it).
        const active = (await apiPool().query(
          `SELECT 1 FROM app_user WHERE id = $1 AND status = 'Active'
              AND (password_changed_at IS NULL OR date_trunc('second', password_changed_at) <= to_timestamp($2))`,
          [claims.sub, claims.iat ?? 0],
        )).rowCount;
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
    if (permission === 'apikey') {
      if (!req.apiKey) return reply.code(401).send({ error: 'a valid API key is required (Authorization: Bearer mik_...)' });
      return undefined;
    }
    if (!req.user) return reply.code(401).send({ error: 'sign in required' });
    if (permission === 'user') return undefined;
    if (permission === 'platform') {
      if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Mirethos administrators only' });
      if (config.PLATFORM_MFA_REQUIRED && !req.user.mfa) return reply.code(403).send({ error: 'platform screens require multi-factor sign-in: turn it on under Security, then sign in again' });
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
  await app.register(ebayRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(accountRoutes);
  await app.register(onboardingRoutes);
  await app.register(platformRoutes);
  await app.register(apiKeyRoutes);
  await app.register(publicApiRoutes);
  await app.register(auditRoutes);
  await app.register(catalogueRoutes);
  await app.register(policyRoutes);
  await app.register(sellerRoutes);
  await app.register(mappingRoutes);
  await app.register(ruleRoutes);
  await app.register(violationRoutes);
  await app.register(caseRoutes);
  await app.register(noticeRoutes);
  await app.register(ipReportRoutes);
  await app.register(qaRoutes);
  await app.register(evidenceLinkRoutes);
  await app.register(reportRoutes);
  await app.register(alertRoutes);
  await app.register(collectionRoutes);
  await app.register(dataHealthRoutes);
  await app.register(credentialRoutes);
  await app.register(sourceRoutes);
  await app.register(termRoutes);
  await app.register(matrixRoutes);
  await app.register(scheduleRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  return app;
}
