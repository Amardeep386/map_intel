// Sets the seed admin's password to SEED_ADMIN_PASSWORD from server/.env. Use it to rotate the
// password: `db:seed` never changes an existing user. Prints the email only, never the password.
import { SYSTEM_ACTOR, recordAudit } from '../lib/audit.js';
import { hashPassword } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';

async function main(): Promise<void> {
  if (!config.SEED_ADMIN_EMAIL || !config.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set in server/.env');
  }
  const hash = await hashPassword(config.SEED_ADMIN_PASSWORD);
  const rowCount = await withSystem(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE app_user SET password_hash = $2 WHERE lower(email) = lower($1) RETURNING id`,
      [config.SEED_ADMIN_EMAIL, hash],
    );
    if (rows[0]) {
      await recordAudit(db, {
        accountId: null,
        actor: { ...SYSTEM_ACTOR, label: 'admin:set-password script' },
        action: 'user.password_set',
        entityType: 'app_user',
        entityId: rows[0].id,
        summary: `Password changed for ${config.SEED_ADMIN_EMAIL}`,
      });
    }
    return rows.length;
  });
  if (!rowCount) throw new Error(`no user with email ${config.SEED_ADMIN_EMAIL} (run db:seed first)`);
  console.log(`password updated for ${config.SEED_ADMIN_EMAIL}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
