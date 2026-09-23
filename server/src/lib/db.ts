import pg from 'pg';
import { config } from './config.js';

// numeric -> JS number (prices fit comfortably in a double at 2 decimal places)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type Db = pg.PoolClient;

async function inTransaction<T>(setup: (c: Db) => Promise<void>, fn: (c: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setup(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run queries for one account. Row-level security limits every account-owned table to
 * `accountId`, even if a query forgets its WHERE clause.
 */
export function withTenant<T>(accountId: string, fn: (c: Db) => Promise<T>): Promise<T> {
  return inTransaction(
    async (c) => {
      await c.query('SET LOCAL ROLE mapintel_tenant');
      await c.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
    },
    fn,
  );
}

/** Run queries as the platform (migrations, seeds, collector worker, admin tooling). */
export function withSystem<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return inTransaction(async (c) => {
    await c.query("SELECT set_config('app.role', 'system', true)");
  }, fn);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
