// Shared set-up for the Phase 4 DB tests: a rolled-back system transaction and a scratch account
// with judged violations (two sellers on Walmart, two violating listings each).
import assert from 'node:assert/strict';
import { pool, type Db } from '../../src/lib/db.js';
import { judgeAccount } from '../../src/lib/judge.js';

/** As system, inside a transaction that is always rolled back (observations are append-only). */
export async function scratch(fn: (db: Db) => Promise<void>): Promise<void> {
  const db = await pool().connect();
  try {
    await db.query("BEGIN; SELECT set_config('app.role', 'system', true)");
    await fn(db);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
}

export const one = async <T = Record<string, unknown>>(db: Db, sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as T;
export const at = (s: string) => new Date(`2026-${s}Z`);

export interface World { account: string; sellers: string[]; violations: Record<string, string[]> }

/**
 * A scratch account with one product (MAP 1000), two sellers on Walmart with two listings each,
 * every listing observed at 700 and judged: four violations, two per seller.
 */
export async function world(db: Db, label: string): Promise<World> {
  const account = (await one<{ id: string }>(db,
    `INSERT INTO account (slug, name, brand, status) VALUES ($1, $1, 'TestBrand', 'Sandbox') RETURNING id`, [`zz-p1-test-case-${label}-${Date.now()}`])).id;
  const source = (await one<{ id: string }>(db, "SELECT id FROM source WHERE code = 'walmart_us'")).id;
  const product = (await one<{ id: string }>(db,
    "INSERT INTO product (account_id, product_code, name, brand, category) VALUES ($1, 'CASE-1', 'Test TV', 'TestBrand', 'TV') RETURNING id", [account])).id;
  await db.query('INSERT INTO map_price (account_id, product_id, amount, effective_from) VALUES ($1, $2, 1000, $3)', [account, product, at('09-01T00:00:00')]);
  const sellers: string[] = [];
  for (const name of ['A', 'B']) {
    const seller = (await one<{ id: string }>(db,
      'INSERT INTO seller (source_id, name, name_key) VALUES ($1, $2, $3) RETURNING id', [source, `Case Seller ${name}`, `case seller ${name} ${Date.now()} ${label}`])).id;
    sellers.push(seller);
    for (const n of [1, 2]) {
      const listing = (await one<{ id: string }>(db,
        'INSERT INTO listing (source_id, url, seller_id) VALUES ($1, $2, $3) RETURNING id', [source, `https://www.walmart.com/ip/case-${label}-${name}${n}-${Date.now()}`, seller])).id;
      await db.query("INSERT INTO listing_match (account_id, listing_id, product_id, state, decided_by) VALUES ($1, $2, $3, 'Included', 'user')", [account, listing, product]);
      await db.query(
        "INSERT INTO observation (observed_at, listing_id, status, advertised_price, currency, seller_id) VALUES ($1, $2, 'ok', 700, 'USD', $3)",
        [at('10-02T00:00:00'), listing, seller]);
    }
  }
  await judgeAccount(db, account, { trigger: 'test' });
  const violations: Record<string, string[]> = {};
  for (const s of sellers) {
    violations[s] = (await db.query<{ id: string }>('SELECT id FROM violation WHERE account_id = $1 AND seller_id = $2 ORDER BY seq', [account, s])).rows.map((r) => r.id);
    assert.equal(violations[s].length, 2);
  }
  return { account, sellers, violations };
}

