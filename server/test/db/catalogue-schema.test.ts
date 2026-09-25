// Phase 2a schema rules as the API's database role: tenant isolation on the new tables,
// effective-dated MAP and seller classes, append-only history, default rules.   npm run test:db
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDb, type Db } from '../../src/lib/db.js';
import { accountIds, asTenant, createTestAccount, expectRefused, removeTestAccounts, rolledBack } from './helpers.js';

let accounts: Record<string, string> = {};

before(async () => {
  accounts = await accountIds();
});

after(async () => {
  await removeTestAccounts();
  await closeDb();
});

async function anyProduct(db: Db): Promise<string> {
  return (await db.query<{ id: string }>('SELECT id FROM product ORDER BY product_code LIMIT 1')).rows[0].id;
}

test('as LG, the mapping, rule and history tables only show LG rows', () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    for (const t of ['listing_match', 'listing_state_event', 'match_rule']) {
      const { rows } = await db.query<{ account_id: string }>(`SELECT DISTINCT account_id FROM ${t}`);
      assert.deepEqual(rows.map((r) => r.account_id), [accounts.lg], t);
    }
    await expectRefused(db, `INSERT INTO match_rule (account_id, code, name, kind, condition) VALUES ($1, 'X', 'x', 'include', '{}')`, [accounts.apple]);
  }));

test('MAP versions: an open row can be closed, never rewritten or deleted, and never overlaps', () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    const productId = await anyProduct(db);
    const region = 'ZZ-TEST';
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO map_price (account_id, product_id, amount, region, effective_from) VALUES ($1, $2, 100, $3, '2030-01-01') RETURNING id`,
      [accounts.lg, productId, region],
    );
    const id = rows[0].id;
    await expectRefused(db, 'UPDATE map_price SET amount = 90 WHERE id = $1', [id]);
    await expectRefused(db, 'DELETE FROM map_price WHERE id = $1', [id]);
    await expectRefused(
      db,
      `INSERT INTO map_price (account_id, product_id, amount, region, effective_from) VALUES ($1, $2, 95, $3, '2030-06-01')`,
      [accounts.lg, productId, region],
    );
    await db.query(`UPDATE map_price SET effective_to = '2030-06-01' WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO map_price (account_id, product_id, amount, region, effective_from) VALUES ($1, $2, 95, $3, '2030-06-01')`,
      [accounts.lg, productId, region],
    );
    await expectRefused(db, `UPDATE map_price SET effective_to = '2030-07-01' WHERE id = $1`, [id]);
  }));

test('seller classes are effective-dated per account, and the API cannot delete shared sellers', () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    const source = (await db.query<{ id: string }>('SELECT id FROM source ORDER BY code LIMIT 1')).rows[0].id;
    const seller = (
      await db.query<{ id: string }>(`INSERT INTO seller (source_id, name, name_key) VALUES ($1, 'ZZ Test Seller', 'zz test seller') RETURNING id`, [source])
    ).rows[0].id;
    const cls = (
      await db.query<{ id: string }>(
        `INSERT INTO seller_classification (account_id, seller_id, class, effective_from) VALUES ($1, $2, 'Unknown', '2030-01-01') RETURNING id`,
        [accounts.lg, seller],
      )
    ).rows[0].id;
    await expectRefused(db, `UPDATE seller_classification SET class = 'Unauthorised' WHERE id = $1`, [cls]);
    await expectRefused(
      db,
      `INSERT INTO seller_classification (account_id, seller_id, class, effective_from) VALUES ($1, $2, 'Unauthorised', '2030-02-01')`,
      [accounts.lg, seller],
    );
    await expectRefused(db, 'DELETE FROM seller WHERE id = $1', [seller]);
    await asTenant(db, accounts.apple);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM seller_classification WHERE seller_id = $1', [seller])).rows[0].n, 0);
  }));

test('listing history and match signals are append-only', () =>
  rolledBack(async (db) => {
    await asTenant(db, accounts.lg);
    const ev = (await db.query<{ id: string }>('SELECT id FROM listing_state_event LIMIT 1')).rows[0].id;
    await expectRefused(db, `UPDATE listing_state_event SET reason = 'x' WHERE id = $1`, [ev]);
    await expectRefused(db, 'DELETE FROM listing_state_event WHERE id = $1', [ev]);
  }));

test('a new account gets the six default match rules', async () => {
  const id = await createTestAccount('p2a-rules');
  await rolledBack(async (db) => {
    await asTenant(db, id);
    const { rows } = await db.query<{ code: string }>('SELECT code FROM match_rule ORDER BY priority');
    assert.deepEqual(rows.map((r) => r.code), ['EXC-CONDITION', 'EXC-WAREHOUSE', 'EXC-AUCTION', 'INC-ASIN-URL', 'INC-MPN', 'INC-ATTRIBUTES']);
  });
});
