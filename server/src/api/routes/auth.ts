import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signToken, verifyPassword } from '../../lib/auth.js';
import { withApi } from '../../lib/db.js';

const loginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  platform_role: 'admin' | 'member';
  status: string;
}

// Very small in-memory brake on password guessing (per IP + email). Phase 1 replaces this.
const attempts = new Map<string, { count: number; until: number }>();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'email and password are required' });
    const key = `${req.ip}:${body.data.email.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.count >= 5 && a.until > Date.now()) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });

    const user = await withApi(async (db) => {
      const { rows } = await db.query<UserRow>('SELECT * FROM app_user WHERE lower(email) = lower($1)', [body.data.email]);
      return rows[0];
    });
    const ok = user && user.status === 'Active' && (await verifyPassword(body.data.password, user.password_hash));
    if (!ok) {
      attempts.set(key, { count: (a?.count ?? 0) + 1, until: Date.now() + 10 * 60_000 });
      return reply.code(401).send({ error: 'wrong email or password' });
    }
    attempts.delete(key);
    await withApi((db) => db.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [user.id]));
    const token = await signToken({ sub: user.id, email: user.email, role: user.platform_role });
    return { token, user: { id: user.id, email: user.email, name: user.full_name, role: user.platform_role } };
  });

  app.get('/me', { preHandler: app.requireUser }, async (req) => {
    const user = await withApi(async (db) => {
      const { rows } = await db.query<UserRow>('SELECT * FROM app_user WHERE id = $1', [req.user!.sub]);
      return rows[0];
    });
    return { id: user.id, email: user.email, name: user.full_name, role: user.platform_role };
  });
}
