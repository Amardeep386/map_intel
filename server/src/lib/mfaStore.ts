// MFA state of a user (Phase 5 · M7): set-up, the second sign-in step, recovery codes, turning it
// off, and whether a user must use it (an account they can open requires it, or they are a
// platform administrator and PLATFORM_MFA_REQUIRED is on). Runs as the API role (app_user).
import { config } from './config.js';
import type { Db } from './db.js';
import { checkTotp, hashRecoveryCode, looksLikeRecoveryCode, newRecoveryCodes, newSecret, openSecret, otpauthUri, qrSvg, sealSecret } from './mfa.js';

export class MfaError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface MfaRow {
  id: string;
  email: string;
  platform_role: 'admin' | 'member';
  mfa_secret: string | null;
  mfa_pending_secret: string | null;
  mfa_enabled_at: Date | null;
  mfa_last_step: string | null;
}

async function load(db: Db, userId: string): Promise<MfaRow> {
  const u = (await db.query<MfaRow>(
    'SELECT id, email, platform_role, mfa_secret, mfa_pending_secret, mfa_enabled_at, mfa_last_step FROM app_user WHERE id = $1 FOR UPDATE',
    [userId],
  )).rows[0];
  if (!u) throw new MfaError(404, 'user not found');
  return u;
}

/** The accounts (by name) that make this user use MFA, plus 'Mirethos platform' when that applies. */
export async function mfaRequiredBy(db: Db, userId: string): Promise<string[]> {
  const u = (await db.query<{ platform_role: string }>('SELECT platform_role FROM app_user WHERE id = $1', [userId])).rows[0];
  if (!u) return [];
  const accounts = (await db.query<{ name: string }>(
    `SELECT f.name FROM app_accounts_for_user($1, $2) f JOIN account a ON a.id = f.id
      WHERE coalesce((a.settings->>'mfa_required')::boolean, false) ORDER BY f.name`,
    [userId, u.platform_role === 'admin'],
  )).rows.map((r) => r.name);
  return u.platform_role === 'admin' && config.PLATFORM_MFA_REQUIRED ? ['Mirethos platform', ...accounts] : accounts;
}

export async function mfaStatus(db: Db, userId: string) {
  const u = await load(db, userId);
  const left = Number((await db.query('SELECT count(*) FROM mfa_recovery_code WHERE user_id = $1 AND used_at IS NULL', [userId])).rows[0].count);
  const requiredBy = await mfaRequiredBy(db, userId);
  return { enabled: !!u.mfa_enabled_at, enabledAt: u.mfa_enabled_at, recoveryCodesLeft: u.mfa_enabled_at ? left : 0, required: requiredBy.length > 0, requiredBy };
}

/** A new secret to scan; kept pending until the first code confirms it. */
export async function startSetup(db: Db, userId: string) {
  const u = await load(db, userId);
  if (u.mfa_enabled_at) throw new MfaError(409, 'multi-factor sign-in is already on');
  const secret = newSecret();
  await db.query('UPDATE app_user SET mfa_pending_secret = $2 WHERE id = $1', [userId, sealSecret(secret)]);
  const uri = otpauthUri(secret, u.email);
  return { secret, uri, qrSvg: await qrSvg(uri) };
}

async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.query('DELETE FROM mfa_recovery_code WHERE user_id = $1', [userId]);
  await db.query('INSERT INTO mfa_recovery_code (user_id, code_hash) SELECT $1, unnest($2::text[])', [userId, codes.map(hashRecoveryCode)]);
  return codes;
}

/** The first code from the app turns MFA on. Returns the recovery codes (shown once). */
export async function confirmSetup(db: Db, userId: string, code: string, now = new Date()): Promise<string[]> {
  const u = await load(db, userId);
  if (u.mfa_enabled_at) throw new MfaError(409, 'multi-factor sign-in is already on');
  if (!u.mfa_pending_secret) throw new MfaError(409, 'start the set-up first');
  const step = checkTotp(openSecret(u.mfa_pending_secret), code, now, null);
  if (step === null) throw new MfaError(400, 'that code is not right: check the time on your phone and try the newest code');
  await db.query(
    'UPDATE app_user SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled_at = now(), mfa_last_step = $2 WHERE id = $1',
    [userId, step],
  );
  return replaceRecoveryCodes(db, userId);
}

/** The second sign-in step: an app code (never the same step twice) or an unused recovery code. */
export async function checkSecondFactor(db: Db, userId: string, code: string, now = new Date()): Promise<'code' | 'recovery' | null> {
  const u = await load(db, userId);
  if (!u.mfa_secret) return null;
  const step = checkTotp(openSecret(u.mfa_secret), code, now, u.mfa_last_step === null ? null : Number(u.mfa_last_step));
  if (step !== null) {
    await db.query('UPDATE app_user SET mfa_last_step = $2 WHERE id = $1', [userId, step]);
    return 'code';
  }
  if (looksLikeRecoveryCode(code)) {
    const used = (await db.query(
      'UPDATE mfa_recovery_code SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
      [userId, hashRecoveryCode(code)],
    )).rowCount;
    if (used) return 'recovery';
  }
  return null;
}

/** New recovery codes (the old ones stop working). Needs a current app code. */
export async function regenerateRecoveryCodes(db: Db, userId: string, code: string, now = new Date()): Promise<string[]> {
  if ((await checkSecondFactor(db, userId, code, now)) === null) throw new MfaError(400, 'that code is not right');
  return replaceRecoveryCodes(db, userId);
}

/** Turn MFA off: needs a current code, and is refused while an account requires it. */
export async function disableMfa(db: Db, userId: string, code: string, now = new Date()): Promise<void> {
  const requiredBy = await mfaRequiredBy(db, userId);
  if (requiredBy.length) throw new MfaError(409, `multi-factor sign-in is required by ${requiredBy.join(', ')}`);
  if ((await checkSecondFactor(db, userId, code, now)) === null) throw new MfaError(400, 'that code is not right');
  await clearMfa(db, userId);
}

/** Remove a user's MFA (they lost their phone): an administrator's action, audited by the caller. */
export async function clearMfa(db: Db, userId: string): Promise<void> {
  await db.query('UPDATE app_user SET mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE id = $1', [userId]);
  await db.query('DELETE FROM mfa_recovery_code WHERE user_id = $1', [userId]);
}
