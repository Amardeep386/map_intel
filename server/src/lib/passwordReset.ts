// Password resets (9 Oct 2026). No email provider yet: an Administrator / Account manager (their
// members) or Mirethos (anyone) creates a one-hour, single-use link and sends it by hand.
// "Forgot password?" opens an internal ticket for Mirethos, and answers the same whether or not
// the email exists (no way to find out who has an account). A reset ends every older session.
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import type { Db } from './db.js';

export const RESET_HOURS = 1;
const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

export class ResetError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** A new link for a user. Older open links of that user stop working. */
export async function createReset(db: Db, userId: string, createdBy: string | null): Promise<{ resetUrl: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  await db.query('UPDATE password_reset SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const r = (await db.query<{ expires_at: Date }>(
    `INSERT INTO password_reset (user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))
     RETURNING expires_at`,
    [userId, hash(token), createdBy, RESET_HOURS],
  )).rows[0];
  const url = new URL(config.PORTAL_URL);
  url.searchParams.set('reset', token);
  return { resetUrl: url.toString(), expiresAt: r.expires_at };
}

/** What a link is for, so the page can show it. */
export async function resetInfo(db: Db, token: string): Promise<{ email: string; state: 'open' | 'used' | 'expired' } | null> {
  const r = (await db.query<{ email: string; used_at: Date | null; expires_at: Date }>(
    'SELECT u.email, r.used_at, r.expires_at FROM password_reset r JOIN app_user u ON u.id = r.user_id WHERE r.token_hash = $1',
    [hash(token)],
  )).rows[0];
  if (!r) return null;
  return { email: r.email, state: r.used_at ? 'used' : r.expires_at < new Date() ? 'expired' : 'open' };
}

/** Set the new password with an open link. Returns the user (for the audit). */
export async function useReset(db: Db, token: string, passwordHash: string): Promise<{ userId: string; email: string }> {
  const r = (await db.query<{ id: string; user_id: string }>(
    `SELECT r.id, r.user_id FROM password_reset r JOIN app_user u ON u.id = r.user_id
      WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'Active' FOR UPDATE OF r`,
    [hash(token)],
  )).rows[0];
  if (!r) throw new ResetError(410, 'this reset link has expired or was already used: ask for a new one');
  await db.query('UPDATE password_reset SET used_at = now() WHERE id = $1', [r.id]);
  const u = (await db.query<{ email: string }>(
    'UPDATE app_user SET password_hash = $2, password_changed_at = now() WHERE id = $1 RETURNING email',
    [r.user_id, passwordHash],
  )).rows[0];
  return { userId: r.user_id, email: u.email };
}

/**
 * "Forgot password?": opens one ticket for Mirethos per user per day. Says nothing about whether the
 * email exists. Returns whether a ticket was opened (for tests only; the route never shows it).
 */
export async function requestReset(db: Db, email: string): Promise<boolean> {
  const u = (await db.query<{ id: string; email: string; account_id: string | null }>(
    // Memberships through app_user_memberships: the API role cannot read account_membership directly.
    `SELECT u.id, u.email, (SELECT m.account_id FROM app_user_memberships(u.id) m LIMIT 1) AS account_id
       FROM app_user u WHERE lower(u.email) = lower($1) AND u.status = 'Active'`,
    [email.trim()],
  )).rows[0];
  if (!u) return false;
  const recent = (await db.query(
    `SELECT 1 FROM ticket WHERE links->>'passwordResetFor' = $1 AND created_at > now() - interval '24 hours'`,
    [u.id],
  )).rowCount;
  if (recent) return false;
  const t = (await db.query<{ id: string }>(
    `INSERT INTO ticket (title, description, kind, priority, account_id, links)
     VALUES ($1, $2, 'other', 'High', $3, $4) RETURNING id`,
    [
      `Password reset requested: ${u.email}`,
      `Someone asked for a password reset for ${u.email} on the sign-in page. Check it is them (by phone or a known address), then create a reset link (Users & Access → Reset password, or Platform for Mirethos staff) and send it. The link works once, for ${RESET_HOURS} hour.`,
      u.account_id,
      JSON.stringify({ passwordResetFor: u.id, view: 'users' }),
    ],
  )).rows[0];
  await db.query("INSERT INTO ticket_event (ticket_id, kind, body) VALUES ($1, 'opened', 'Opened from Forgot password on the sign-in page')", [t.id]);
  return true;
}
