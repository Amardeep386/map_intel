import pg from 'pg';
import { config } from './config.js';

// numeric -> JS number (prices fit comfortably in a double at 2 decimal places)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));

const makePool = (connectionString: string) =>
  new pg.Pool({
    connectionString,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

let ownerPool: pg.Pool | null = null;
let apiPoolInstance: pg.Pool | null = null;

/** Owner connection: migrations, seed, collector worker and admin scripts. Never used by API routes. */
export function pool(): pg.Pool {
  ownerPool ??= makePool(config.DATABASE_URL);
  return ownerPool;
}

/**
 * The API's connection as `mapintel_api` (no BYPASSRLS, `app.role = 'system'` ignored), so
 * row-level security is enforced by Postgres. Falls back to the owner connection in development.
 */
export function apiPool(): pg.Pool {
  if (!apiPoolInstance) {
    if (config.DATABASE_URL_API) {
      apiPoolInstance = makePool(config.DATABASE_URL_API);
    } else if (config.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL_API is required in production (the API must not connect as the database owner)');
    } else {
      console.warn('DATABASE_URL_API is not set: the API is using the owner connection (development only)');
      apiPoolInstance = pool();
    }
  }
  return apiPoolInstance;
}

export type Db = pg.PoolClient;

async function inTransaction<T>(p: pg.Pool, setup: (c: Db) => Promise<void>, fn: (c: Db) => Promise<T>): Promise<T> {
  const client = await p.connect();
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
 * Run API queries for one account. Row-level security limits every account-owned table to
 * `accountId`, even if a query forgets its WHERE clause.
 */
export function withTenant<T>(accountId: string, fn: (c: Db) => Promise<T>): Promise<T> {
  return inTransaction(
    apiPool(),
    async (c) => {
      await c.query('SET LOCAL ROLE mapintel_tenant');
      await c.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
    },
    fn,
  );
}

/**
 * Run API queries that belong to no account (users, sign-in, the shared source catalogue).
 * Account-owned tables return no rows here; cross-account reads go through the app_* functions.
 */
export function withApi<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return inTransaction(apiPool(), async () => undefined, fn);
}

/** Run queries as the platform (migrations, seeds, collector worker, admin scripts). Not for API routes. */
export function withSystem<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return inTransaction(
    pool(),
    async (c) => {
      await c.query("SELECT set_config('app.role', 'system', true)");
    },
    fn,
  );
}

export async function closeDb(): Promise<void> {
  const pools = new Set([ownerPool, apiPoolInstance].filter((p): p is pg.Pool => p !== null));
  ownerPool = null;
  apiPoolInstance = null;
  await Promise.all([...pools].map((p) => p.end()));
}
