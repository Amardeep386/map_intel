import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { randomBytes } from 'node:crypto';
import { hashPassword, needsRehash, signChallenge, signSsoState, signToken, verifyChallenge, verifyPassword, verifySsoState, type ChallengePurpose } from '../../lib/auth.js';
import { config } from '../../lib/config.js';
import { authorizationUrl, finish, provider, providers, randomToken, SsoError } from '../../lib/sso.js';
import { withApi } from '../../lib/db.js';
import { checkSecondFactor, confirmSetup, disableMfa, MfaError, mfaStatus, regenerateRecoveryCodes, startSetup } from '../../lib/mfaStore.js';
import { HttpError } from '../app.js';
import { parse } from '../validate.js';
import { actionsFor } from '../../lib/permissions.js';
import { hit, isLimited, reset, type Limit } from '../../lib/rateLimit.js';
import { hashToken } from './users.js';

const loginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  platform_role: 'admin' | 'member';
  status: string;
}

// Brake on password guessing, per IP + email, shared across API processes (Redis).
const LOGIN_LIMIT: Limit = { max: 5, windowSeconds: 10 * 60 };
/** SSO users have no password: store the hash of one nobody knows, so password sign-in never works for them. */
const unusablePassword = () => hashPassword(randomBytes(32).toString('base64'));

// Brake on guessing MFA codes, per user (a code has a million values; five tries per ten minutes).
const MFA_LIMIT: Limit = { max: 5, windowSeconds: 10 * 60 };
// Brake on guessing invite tokens, per IP.
const INVITE_LIMIT: Limit = { max: 20, windowSeconds: 10 * 60 };

const acceptBody = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(12, 'the password must be at least 12 characters').max(200),
  name: z.string().trim().max(120).optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', { config: { permission: 'public' } }, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'email and password are required' });
    const key = `login:${req.ip}:${body.data.email.toLowerCase()}`;
    if (await isLimited(key, LOGIN_LIMIT)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });

    const user = await withApi(async (db) => {
      const { rows } = await db.query<UserRow>('SELECT * FROM app_user WHERE lower(email) = lower($1)', [body.data.email]);
      return rows[0];
    });
    const ok = user && user.status === 'Active' && (await verifyPassword(body.data.password, user.password_hash));
    if (!ok) {
      await hit(key, LOGIN_LIMIT);
      return reply.code(401).send({ error: 'wrong email or password' });
    }
    await reset(key);
    const rehash = needsRehash(user.password_hash) ? await hashPassword(body.data.password) : null;
    if (rehash) await withApi((db) => db.query('UPDATE app_user SET password_hash = $2 WHERE id = $1', [user.id, rehash]));
    return afterFirstFactor(user);
  });

  /**
   * The password (or an SSO provider) is right. Second step (Phase 5 · M7): a code when MFA is on;
   * set-up first when an account requires it; otherwise the session.
   */
  async function afterFirstFactor(user: Pick<UserRow, 'id' | 'email' | 'full_name' | 'platform_role'>) {
    const next = await withApi(async (db) => {
      const s = await mfaStatus(db, user.id);
      return s.enabled ? 'code' : s.required ? 'setup' : null;
    });
    if (next) {
      return { mfa: next, challenge: await signChallenge(user.id, next === 'code' ? 'mfa' : 'mfa-setup'), user: { email: user.email, name: user.full_name } };
    }
    return session(user, false);
  }

  // ---------------------------------------------------------------- single sign-on (Phase 5 · M8)
  // 1. The portal sends the browser here (a full page load, so the cookie below is first-party).
  // 2. The provider sends it back to /callback with a code; the API checks everything and sends it
  //    to the portal with a one-minute, one-time code (never the session itself in a URL).
  // 3. The portal trades that code at /sso/exchange and continues as after a password.
  const SSO_COOKIE = 'mi_sso';
  const portal = (params: Record<string, string>) => `${config.PORTAL_URL.replace(/\/$/, '')}/?${new URLSearchParams(params)}`;
  const cookieValue = (req: FastifyRequest, name: string) =>
    (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1] ?? null;
  const cookie = (value: string, maxAge: number) =>
    `${SSO_COOKIE}=${value}; Path=/auth/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.API_PUBLIC_URL.startsWith('https:') ? '; Secure' : ''}`;

  app.get('/sso/providers', { config: { permission: 'public' } }, async () => providers().map((p) => ({ id: p.id, name: p.name })));

  app.get<{ Params: { provider: string } }>('/sso/:provider/start', { config: { permission: 'public' } }, async (req, reply) => {
    const p = provider(req.params.provider);
    if (!p) return reply.redirect(portal({ sso_error: 'this sign-in method is not available' }));
    const s = { provider: p.id, nonce: randomToken(), verifier: randomToken(48), browser: randomToken(16) };
    try {
      const url = await authorizationUrl(p, { state: await signSsoState(s), nonce: s.nonce, verifier: s.verifier });
      return reply.header('set-cookie', cookie(s.browser, 600)).redirect(url);
    } catch (err) {
      req.log.warn({ err }, 'sso start failed');
      return reply.redirect(portal({ sso_error: err instanceof SsoError ? err.message : `${p.name} sign-in is not available right now` }));
    }
  });

  app.get<{ Params: { provider: string }; Querystring: Record<string, string | undefined> }>(
    '/sso/:provider/callback',
    { config: { permission: 'public' } },
    async (req, reply) => {
      reply.header('set-cookie', cookie('', 0));
      const fail = (message: string) => reply.redirect(portal({ sso_error: message }));
      const p = provider(req.params.provider);
      if (!p) return fail('this sign-in method is not available');
      if (req.query.error) return fail(req.query.error === 'access_denied' ? 'sign-in was cancelled' : `${p.name} refused the sign-in`);
      let s;
      try {
        s = await verifySsoState(req.query.state ?? '');
      } catch {
        return fail('the sign-in took too long: try again');
      }
      if (s.provider !== p.id || !req.query.code || cookieValue(req, SSO_COOKIE) !== s.browser) return fail('the sign-in did not match this browser: try again');
      try {
        const who = await finish(p, req.query.code, s.verifier, s.nonce);
        const joined = await withApi(async (db) =>
          (await db.query<{ user_id: string; how: string }>('SELECT * FROM app_sso_join($1, $2, $3, $4, $5)', [p.id, who.subject, who.email, who.name, await unusablePassword()])).rows[0]);
        if (!joined) return fail(`${who.email} has no access to MAP Intel: ask your administrator for an invite`);
        const code = randomToken();
        await withApi((db) =>
          db.query("INSERT INTO sso_login (code_hash, user_id, provider, expires_at) VALUES ($1, $2, $3, now() + interval '60 seconds')", [hashToken(code), joined.user_id, p.id]));
        return reply.redirect(portal({ sso: code }));
      } catch (err) {
        req.log.warn({ err }, 'sso callback failed');
        return fail(err instanceof SsoError ? err.message : `${p.name} sign-in failed: try again`);
      }
    },
  );

  app.post('/sso/exchange', { config: { permission: 'public' } }, async (req, reply) => {
    const b = parse(z.object({ code: z.string().min(20).max(200) }), req.body);
    const user = await withApi(async (db) => {
      const row = (await db.query<{ user_id: string; provider: string }>(
        'UPDATE sso_login SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, provider',
        [hashToken(b.code)],
      )).rows[0];
      if (!row) return null;
      return (await db.query<UserRow>("SELECT * FROM app_user WHERE id = $1 AND status = 'Active'", [row.user_id])).rows[0] ?? null;
    });
    if (!user) return reply.code(401).send({ error: 'the sign-in link expired: sign in again' });
    return afterFirstFactor(user);
  });

  /** A session token for a user who has passed every step; records the sign-in. */
  async function session(user: Pick<UserRow, 'id' | 'email' | 'full_name' | 'platform_role'>, mfa: boolean) {
    await withApi((db) => db.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [user.id]));
    const token = await signToken({ sub: user.id, email: user.email, role: user.platform_role, mfa });
    return { token, user: { id: user.id, email: user.email, name: user.full_name, role: user.platform_role } };
  }

  const challengeUser = async (challenge: string, purposes: ChallengePurpose[]) => {
    let userId: string;
    try {
      ({ userId } = await verifyChallenge(challenge, purposes));
    } catch {
      throw new HttpError(401, 'the sign-in step expired: sign in again');
    }
    const user = await withApi(async (db) => (await db.query<UserRow>("SELECT * FROM app_user WHERE id = $1 AND status = 'Active'", [userId])).rows[0]);
    if (!user) throw new HttpError(401, 'sign in again');
    return user;
  };
  const mfaFail = (err: unknown): never => {
    if (err instanceof MfaError) throw new HttpError(err.statusCode, err.message);
    throw err;
  };
  const securityAudit = (req: FastifyRequest, userId: string, action: string, summary: string) =>
    withApi((db) => recordAudit(db, { accountId: null, actor: actorFrom(req), requestId: req.id, action, entityType: 'app_user', entityId: userId, summary }));

  // The second step: a code from the app, or a recovery code.
  app.post('/mfa/verify', { config: { permission: 'public' } }, async (req, reply) => {
    const b = parse(z.object({ challenge: z.string().min(20).max(2000), code: z.string().trim().min(6).max(20) }), req.body);
    const user = await challengeUser(b.challenge, ['mfa']);
    const key = `mfa:${user.id}`;
    if (await isLimited(key, MFA_LIMIT)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const how = await withApi((db) => checkSecondFactor(db, user.id, b.code));
    if (!how) {
      await hit(key, MFA_LIMIT);
      return reply.code(401).send({ error: 'that code is not right' });
    }
    await reset(key);
    if (how === 'recovery') {
      req.user = { sub: user.id, email: user.email, role: user.platform_role };
      await securityAudit(req, user.id, 'mfa.recovery_used', `${user.email} signed in with a recovery code`);
    }
    return { ...(await session(user, true)), usedRecoveryCode: how === 'recovery' };
  });

  // Set-up during sign-in, when an account requires MFA and the user has none yet.
  app.post('/mfa/setup', { config: { permission: 'public' } }, async (req) => {
    const b = parse(z.object({ challenge: z.string().min(20).max(2000) }), req.body);
    const user = await challengeUser(b.challenge, ['mfa-setup']);
    return withApi((db) => startSetup(db, user.id)).catch(mfaFail);
  });
  app.post('/mfa/setup/confirm', { config: { permission: 'public' } }, async (req, reply) => {
    const b = parse(z.object({ challenge: z.string().min(20).max(2000), code: z.string().trim().min(6).max(10) }), req.body);
    const user = await challengeUser(b.challenge, ['mfa-setup']);
    const key = `mfa:${user.id}`;
    if (await isLimited(key, MFA_LIMIT)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const codes = await withApi((db) => confirmSetup(db, user.id, b.code)).catch(async (err) => {
      await hit(key, MFA_LIMIT);
      return mfaFail(err);
    });
    req.user = { sub: user.id, email: user.email, role: user.platform_role };
    await securityAudit(req, user.id, 'mfa.enabled', `${user.email} turned on multi-factor sign-in`);
    return { ...(await session(user, true)), recoveryCodes: codes };
  });

  // Signed in: the user's own MFA.
  app.get('/mfa', { config: { permission: 'user' } }, async (req) => withApi((db) => mfaStatus(db, req.user!.sub)));
  app.post('/mfa/enrol', { config: { permission: 'user' } }, async (req) => withApi((db) => startSetup(db, req.user!.sub)).catch(mfaFail));
  app.post('/mfa/enrol/confirm', { config: { permission: 'user' } }, async (req) => {
    const b = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const user = await withApi(async (db) => (await db.query<UserRow>('SELECT * FROM app_user WHERE id = $1', [req.user!.sub])).rows[0]);
    const codes = await withApi((db) => confirmSetup(db, user.id, b.code)).catch(mfaFail);
    await securityAudit(req, user.id, 'mfa.enabled', `${user.email} turned on multi-factor sign-in`);
    // A fresh session that counts as MFA, so accounts that require it open at once.
    return { ...(await session(user, true)), recoveryCodes: codes };
  });
  app.post('/mfa/recovery-codes', { config: { permission: 'user' } }, async (req) => {
    const b = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const codes = await withApi((db) => regenerateRecoveryCodes(db, req.user!.sub, b.code)).catch(mfaFail);
    await securityAudit(req, req.user!.sub, 'mfa.recovery_codes', `${req.user!.email} made new recovery codes (the old ones no longer work)`);
    return { recoveryCodes: codes };
  });
  app.post('/mfa/disable', { config: { permission: 'user' } }, async (req) => {
    const b = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    await withApi((db) => disableMfa(db, req.user!.sub, b.code)).catch(mfaFail);
    await securityAudit(req, req.user!.sub, 'mfa.disabled', `${req.user!.email} turned off multi-factor sign-in`);
    return { ok: true };
  });

  // What an invite link is for, so the accept page can show it. 404 for unknown tokens.
  app.get<{ Params: { token: string } }>('/invite/:token', { config: { permission: 'public' } }, async (req, reply) => {
    const key = `invite:${req.ip}`;
    if (await isLimited(key, INVITE_LIMIT)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const info = await withApi(async (db) => (await db.query('SELECT * FROM app_invite_info($1)', [hashToken(req.params.token)])).rows[0]);
    if (!info) {
      await hit(key, INVITE_LIMIT);
      return reply.code(404).send({ error: 'this invite link is not valid' });
    }
    return { email: info.email, name: info.full_name, account: info.account_name, role: info.role, expiresAt: info.expires_at, state: info.state };
  });

  // Accept an invite: set a password, join the account, and sign in.
  app.post('/accept-invite', { config: { permission: 'public' } }, async (req, reply) => {
    const body = acceptBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const key = `invite:${req.ip}`;
    if (await isLimited(key, INVITE_LIMIT)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const hash = await hashPassword(body.data.password);
    const accepted = await withApi(
      async (db) =>
        (
          await db.query<{ user_id: string; email: string; platform_role: 'admin' | 'member'; account_id: string }>(
            'SELECT * FROM app_accept_invite($1, $2, $3)',
            [hashToken(body.data.token), hash, body.data.name ?? null],
          )
        ).rows[0],
    );
    if (!accepted) {
      await hit(key, INVITE_LIMIT);
      return reply.code(410).send({ error: 'this invite link has expired, was already used, or was revoked' });
    }
    const user = await withApi(async (db) => (await db.query<UserRow>('SELECT * FROM app_user WHERE id = $1', [accepted.user_id])).rows[0]);
    // Joining an account that requires MFA: set it up before the first session.
    const next = await withApi(async (db) => {
      const s = await mfaStatus(db, user.id);
      return s.enabled ? 'code' : s.required ? 'setup' : null;
    });
    if (next) {
      return { mfa: next, challenge: await signChallenge(user.id, next === 'code' ? 'mfa' : 'mfa-setup'), user: { email: user.email, name: user.full_name }, accountId: accepted.account_id };
    }
    const token = await signToken({ sub: user.id, email: user.email, role: user.platform_role });
    return { token, user: { id: user.id, email: user.email, name: user.full_name, role: user.platform_role }, accountId: accepted.account_id };
  });

  // The signed-in user with each account they can open, their role there and what that role allows.
  app.get('/me', { config: { permission: 'user' } }, async (req) => {
    const claims = req.user!;
    return withApi(async (db) => {
      const { rows } = await db.query<UserRow>('SELECT * FROM app_user WHERE id = $1', [claims.sub]);
      const user = rows[0];
      const accounts = (
        await db.query<{ id: string; slug: string; name: string; role: string }>(
          'SELECT id, slug, name, role FROM app_accounts_for_user($1, $2)',
          [claims.sub, user.platform_role === 'admin'],
        )
      ).rows;
      const mfa = await mfaStatus(db, user.id);
      const requiring = new Set(
        (await db.query<{ id: string }>("SELECT id FROM account WHERE id = ANY($1::uuid[]) AND coalesce((settings->>'mfa_required')::boolean, false)", [accounts.map((a) => a.id)])).rows.map((r) => r.id),
      );
      return {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.platform_role,
        // session: this sign-in used a second factor (accounts that require MFA open only then).
        mfa: { enabled: mfa.enabled, required: mfa.required, requiredBy: mfa.requiredBy, recoveryCodesLeft: mfa.recoveryCodesLeft, session: claims.mfa === true },
        accounts: accounts.map((a) => ({ id: a.id, slug: a.slug, name: a.name, role: a.role, actions: actionsFor(a.role), mfaRequired: requiring.has(a.id) })),
      };
    });
  });
}
