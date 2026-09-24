// Users & access for one account: members, invites (single-use links), role changes, removal.
// Plus a platform route for Mirethos administrators to disable or re-enable a user everywhere.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { hashPassword } from '../../lib/auth.js';
import { config } from '../../lib/config.js';
import { withApi, withTenant, type Db } from '../../lib/db.js';
import { ACCOUNT_ROLES, actionsFor, grantableRoles, type AccountRole } from '../../lib/permissions.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
const INVITE_TTL_HOURS = 72;
const role = z.enum(ACCOUNT_ROLES as unknown as [AccountRole, ...AccountRole[]]);

const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  role,
});

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

interface MemberRow {
  user_id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: Date | null;
  role: AccountRole;
}

async function members(db: Db): Promise<MemberRow[]> {
  return (
    await db.query<MemberRow>(
      `SELECT u.id AS user_id, u.email, u.full_name, u.status, u.last_login_at, m.role
         FROM account_membership m JOIN app_user u ON u.id = m.user_id
        ORDER BY array_position($1::text[], m.role), lower(u.full_name)`,
      [ACCOUNT_ROLES],
    )
  ).rows;
}

async function member(db: Db, userId: string): Promise<MemberRow> {
  const m = (await members(db)).find((x) => x.user_id === uuidOr404(userId, 'user'));
  if (!m) throw new HttpError(404, 'user is not a member of this account');
  return m;
}

/** Callers may only manage members whose role they could grant (an Account manager cannot touch an Administrator). */
function assertCanManage(req: FastifyRequest, target: AccountRole, next?: AccountRole): void {
  const allowed = grantableRoles(req.accountRole);
  if (!allowed.includes(target) || (next && !allowed.includes(next))) {
    throw new HttpError(403, `your role (${req.accountRole}) cannot manage ${next && !allowed.includes(next) ? next : target} members`);
  }
}

async function assertNotLastAdmin(db: Db, target: MemberRow): Promise<void> {
  if (target.role !== 'Administrator') return;
  const admins = (await members(db)).filter((m) => m.role === 'Administrator' && m.status === 'Active').length;
  if (admins <= 1) throw new HttpError(409, 'this is the last Administrator of the account; add another one first');
}

const audit = (db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<Parameters<typeof recordAudit>[1], 'accountId' | 'actor' | 'requestId'>) =>
  recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Params }>('/accounts/:accountId/users', { config: { permission: 'users.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const invites = (
        await db.query(
          `SELECT i.id, u.email, u.full_name, i.role, i.created_at, i.expires_at
             FROM user_invite i JOIN app_user u ON u.id = i.user_id
            WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
            ORDER BY i.created_at DESC`,
        )
      ).rows;
      return {
        members: (await members(db)).map((m) => ({
          userId: m.user_id,
          email: m.email,
          name: m.full_name,
          role: m.role,
          status: m.status,
          lastLoginAt: m.last_login_at,
          can: actionsFor(m.role),
        })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, name: i.full_name, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at })),
        grantableRoles: grantableRoles(req.accountRole),
      };
    }),
  );

  // Invite someone. Returns a single-use link to send them (email delivery arrives in Phase 3).
  app.post<{ Params: Params }>('/accounts/:accountId/users/invite', { config: { permission: 'users.manage' } }, async (req, reply) => {
    const b = parse(inviteBody, req.body);
    if (!grantableRoles(req.accountRole).includes(b.role)) throw new HttpError(403, `your role (${req.accountRole}) cannot grant ${b.role}`);
    const { accountId } = req.params;

    const result = await withTenant(accountId, async (db) => {
      const existing = (
        await db.query<{ id: string; status: string; platform_role: string }>('SELECT id, status, platform_role FROM app_user WHERE lower(email) = $1', [b.email])
      ).rows[0];
      if (existing?.status === 'Disabled') throw new HttpError(409, `${b.email} is disabled; a Mirethos administrator must re-enable them first`);
      if (existing && (await members(db)).some((m) => m.user_id === existing.id)) throw new HttpError(409, `${b.email} is already a member of this account`);

      // An existing active user just gets the membership: they already have a password.
      if (existing?.status === 'Active') {
        await db.query('INSERT INTO account_membership (account_id, user_id, role) VALUES ($1, $2, $3)', [accountId, existing.id, b.role]);
        await audit(db, req, { action: 'member.added', entityType: 'app_user', entityId: existing.id, summary: `Added ${b.email} as ${b.role}`, after: { email: b.email, role: b.role } });
        return { status: 'added' as const, userId: existing.id };
      }

      let userId = existing?.id;
      if (!userId) {
        // Unusable random password until the invite is accepted.
        const placeholder = await hashPassword(randomBytes(32).toString('base64url'));
        userId = (
          await db.query<{ id: string }>(
            `INSERT INTO app_user (email, full_name, password_hash, platform_role, status) VALUES ($1, $2, $3, 'member', 'Invited') RETURNING id`,
            [b.email, b.name, placeholder],
          )
        ).rows[0].id;
      }
      await db.query('UPDATE user_invite SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [userId]);
      const token = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
      const invite = (
        await db.query<{ id: string }>(
          `INSERT INTO user_invite (account_id, user_id, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [accountId, userId, b.role, hashToken(token), req.user!.sub, expires],
        )
      ).rows[0];
      await audit(db, req, {
        action: 'invite.created',
        entityType: 'user_invite',
        entityId: invite.id,
        summary: `Invited ${b.email} as ${b.role} (link valid ${INVITE_TTL_HOURS} h)`,
        after: { email: b.email, name: b.name, role: b.role, expiresAt: expires.toISOString() },
      });
      const url = new URL(config.PORTAL_URL);
      url.searchParams.set('invite', token);
      return { status: 'invited' as const, userId, inviteId: invite.id, inviteUrl: url.toString(), expiresAt: expires };
    });
    return reply.code(201).send(result);
  });

  app.delete<{ Params: Params & { inviteId: string } }>(
    '/accounts/:accountId/invites/:inviteId',
    { config: { permission: 'users.manage' } },
    async (req, reply) => {
      await withTenant(req.params.accountId, async (db) => {
        const inv = (
          await db.query('UPDATE user_invite SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING role, user_id', [
            uuidOr404(req.params.inviteId, 'invite'),
          ])
        ).rows[0];
        if (!inv) throw new HttpError(404, 'no open invite with that id');
        await audit(db, req, { action: 'invite.revoked', entityType: 'user_invite', entityId: req.params.inviteId, summary: 'Revoked an invite', before: { role: inv.role, userId: inv.user_id } });
      });
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: Params & { userId: string } }>(
    '/accounts/:accountId/users/:userId',
    { config: { permission: 'users.manage' } },
    async (req) => {
      const b = parse(z.object({ role }), req.body);
      return withTenant(req.params.accountId, async (db) => {
        const target = await member(db, req.params.userId);
        if (target.role === b.role) return { userId: target.user_id, role: target.role };
        assertCanManage(req, target.role, b.role);
        if (b.role !== 'Administrator') await assertNotLastAdmin(db, target);
        await db.query('UPDATE account_membership SET role = $2 WHERE user_id = $1', [target.user_id, b.role]);
        await audit(db, req, {
          action: 'member.role_changed',
          entityType: 'app_user',
          entityId: target.user_id,
          summary: `Changed ${target.email} from ${target.role} to ${b.role}`,
          before: { role: target.role },
          after: { role: b.role },
        });
        return { userId: target.user_id, role: b.role };
      });
    },
  );

  app.delete<{ Params: Params & { userId: string } }>(
    '/accounts/:accountId/users/:userId',
    { config: { permission: 'users.manage' } },
    async (req, reply) => {
      await withTenant(req.params.accountId, async (db) => {
        const target = await member(db, req.params.userId);
        assertCanManage(req, target.role);
        await assertNotLastAdmin(db, target);
        await db.query('DELETE FROM account_membership WHERE user_id = $1', [target.user_id]);
        await audit(db, req, {
          action: 'member.removed',
          entityType: 'app_user',
          entityId: target.user_id,
          summary: `Removed ${target.email} (${target.role}) from the account`,
          before: { email: target.email, role: target.role },
        });
      });
      return reply.code(204).send();
    },
  );

  // Platform: disable or re-enable a user everywhere (takes effect on their next request).
  app.patch<{ Params: { userId: string } }>('/users/:userId', { config: { permission: 'platform' } }, async (req) => {
    const b = parse(z.object({ status: z.enum(['Active', 'Disabled']) }), req.body);
    const userId = uuidOr404(req.params.userId, 'user');
    if (userId === req.user!.sub && b.status === 'Disabled') throw new HttpError(409, 'you cannot disable yourself');
    return withApi(async (db) => {
      const before = (await db.query<{ email: string; status: string }>('SELECT email, status FROM app_user WHERE id = $1', [userId])).rows[0];
      if (!before) throw new HttpError(404, 'user not found');
      if (before.status === 'Invited') throw new HttpError(409, 'this user has not accepted their invite yet; revoke the invite instead');
      await db.query('UPDATE app_user SET status = $2 WHERE id = $1', [userId, b.status]);
      await recordAudit(db, {
        accountId: null,
        actor: actorFrom(req),
        action: b.status === 'Disabled' ? 'user.disabled' : 'user.enabled',
        entityType: 'app_user',
        entityId: userId,
        summary: `${b.status === 'Disabled' ? 'Disabled' : 'Re-enabled'} ${before.email}`,
        before: { status: before.status },
        after: { status: b.status },
        requestId: req.id,
      });
      return { userId, status: b.status };
    });
  });
}
