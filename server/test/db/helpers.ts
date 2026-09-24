// Shared fixtures for database tests: throwaway users with a role in one pilot account.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/app.js';
import { hashPassword, signToken } from '../../src/lib/auth.js';
import { withSystem } from '../../src/lib/db.js';

export const TEST_EMAIL_DOMAIN = 'p1-test.mirethos.invalid';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export async function accountIds(): Promise<Record<string, string>> {
  return withSystem(async (db) => {
    const { rows } = await db.query<{ slug: string; id: string }>('SELECT slug, id FROM account');
    return Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  });
}

/** Create a user with `role` in `accountId`, or a platform admin when role is 'admin'. */
export async function createUser(label: string, role: string, accountId?: string): Promise<TestUser> {
  const email = `${label}@${TEST_EMAIL_DOMAIN}`;
  const hash = await hashPassword('not-a-real-password-123');
  const isAdmin = role === 'admin';
  const id = await withSystem(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO app_user (email, full_name, password_hash, platform_role) VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(email))) DO UPDATE SET platform_role = EXCLUDED.platform_role RETURNING id`,
      [email, `Test ${label}`, hash, isAdmin ? 'admin' : 'member'],
    );
    if (accountId && !isAdmin) {
      await db.query(
        `INSERT INTO account_membership (account_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [accountId, rows[0].id, role],
      );
    }
    return rows[0].id;
  });
  const token = await signToken({ sub: id, email, role: isAdmin ? 'admin' : 'member' });
  return { id, email, token };
}

/** Remove every test user (memberships cascade). */
export async function removeTestUsers(): Promise<void> {
  await withSystem((db) => db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_EMAIL_DOMAIN}`]));
}

export async function testApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export function call(app: FastifyInstance, user: TestUser | null, method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as 'GET',
    url,
    headers: user ? { authorization: `Bearer ${user.token}` } : {},
    payload: payload as Record<string, unknown> | undefined,
  });
}
