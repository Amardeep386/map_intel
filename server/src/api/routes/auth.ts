import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signToken, verifyPassword } from '../../lib/auth.js';
import { withApi } from '../../lib/db.js';
import { actionsFor } from '../../lib/permissions.js';
import { hit, isLimited, reset, type Limit } from '../../lib/rateLimit.js';

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
    await withApi((db) => db.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [user.id]));
    const token = await signToken({ sub: user.id, email: user.email, role: user.platform_role });
    return { token, user: { id: user.id, email: user.email, name: user.full_name, role: user.platform_role } };
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
      return {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.platform_role,
        accounts: accounts.map((a) => ({ id: a.id, slug: a.slug, name: a.name, role: a.role, actions: actionsFor(a.role) })),
      };
    });
  });
}
