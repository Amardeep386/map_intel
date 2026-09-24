// Tenant isolation as the API's database role (mapintel_api), against the real database.
// Every test runs in a transaction that is rolled back.   npm run test:db   (needs DATABASE_URL_API)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiPool, closeDb, type Db } from '../../src/lib/db.js';

let accounts: Record<string, string> = {};

async function rolledBack(fn: (db: Db) => Promise<void>): Promise<void> {
  const db = await apiPool().connect();
  try {
    await db.query('BEGIN');
    await fn(db);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
}

async function asTenant(db: Db, accountId: string | null): Promise<void> {
  await db.query('SET LOCAL ROLE mapintel_tenant');
  if (accountId) await db.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
}

/** Expect `sql` to fail inside a savepoint, so the surrounding test transaction stays usable. */
async function expectRefused(db: Db, sql: string, params: unknown[] = []): Promise<void> {
  await db.query('SAVEPOINT refused');
  await assert.rejects(db.query(sql, params));
  await db.query('ROLLBACK TO SAVEPOINT refused');
}

before(async () => {
  const { rows } = await apiPool().query<{ session_user: string }>('SELECT session_user');
  assert.equal(rows[0].session_user, 'mapintel_api', 'set DATABASE_URL_API to the mapintel_api role before running test:db');
  const acc = await apiPool().query<{ slug: string; id: string }>('SELECT slug, id FROM account');
  accounts = Object.fromEntries(acc.rows.map((r) => [r.slug, r.id]));
  assert.ok(accounts.lg && accounts.apple && accounts.samsung, 'seeded pilot accounts are missing');
});

after(async () => {
  await closeDb();
});

test('mapintel_api is a plain role: no superuser, no BYPASSRLS', async () => {
  const { rows } = await apiPool().query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user');
  assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false });
});

test('as LG, only LG products are visible', () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    const { rows } = await db.query<{ account_id: string }>('SELECT DISTINCT account_id FROM product');
    assert.deepEqual(rows.map((r) => r.account_id), [accounts.lg]);
  }));

test("setting app.role = 'system' does not widen access for the API role", () =>
  rolledBack(async (db) => {
    await db.query("SELECT set_config('app.role', 'system', true)");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM product')).rows[0].n, 0);
    await asTenant(db, accounts.lg);
    const { rows } = await db.query<{ n: number }>('SELECT count(DISTINCT account_id)::int AS n FROM product');
    assert.equal(rows[0].n, 1);
  }));

test('no account set means no account-owned rows', () =>
  rolledBack(async (db) => {
    await asTenant(db, null);
    for (const table of ['product', 'product_identifier', 'map_price', 'account_membership']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      assert.equal(rows[0].n, 0, table);
    }
  }));

test("filtering on another account's id returns nothing", () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM product WHERE account_id = $1', [accounts.apple]);
    assert.equal(rows[0].n, 0);
  }));

test("inserting a row for another account is refused", () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    await expectRefused(
      db,
      `INSERT INTO product (account_id, product_code, name, brand) VALUES ($1, 'RLS-TEST', 'x', 'Apple')`,
      [accounts.apple],
    );
  }));

test('the API role cannot switch to the owner role', () =>
  rolledBack(async (db) => {
    const { rows } = await db.query<{ owner: string }>(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'product'",
    );
    await expectRefused(db, `SET ROLE "${rows[0].owner.replaceAll('"', '""')}"`);
  }));

test('observations stay append-only for the API role', () =>
  rolledBack(async (db) => {
    await expectRefused(db, "UPDATE observation SET error = 'x' WHERE observed_at > now() - interval '400 days'");
    await expectRefused(db, "DELETE FROM observation WHERE observed_at > now() - interval '400 days'");
  }));

test('cross-account helper functions return only what they are for', () =>
  rolledBack(async (db) => {
    const all = await db.query('SELECT slug FROM app_accounts_for_user($1, true)', ['00000000-0000-0000-0000-000000000000']);
    assert.equal(all.rowCount, Object.keys(accounts).length);
    const none = await db.query('SELECT slug FROM app_accounts_for_user($1, false)', ['00000000-0000-0000-0000-000000000000']);
    assert.equal(none.rowCount, 0);
    const role = await db.query('SELECT app_account_role($1, $2) AS role', [accounts.lg, '00000000-0000-0000-0000-000000000000']);
    assert.equal(role.rows[0].role, null);
  }));
