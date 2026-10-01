// eBay Marketplace Account Deletion (decision 39), as the API's database role.   npm run test:db
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDb } from '../../src/lib/db.js';
import { accountIds, expectRefused, rolledBack } from './helpers.js';

let accounts: Record<string, string> = {};
before(async () => {
  accounts = await accountIds();
});
after(async () => {
  await closeDb();
});

test('a deletion anonymises the eBay seller, drops aliases and every account’s contacts, logs hashes only, once', () =>
  rolledBack(async (db) => {
    const src = (await db.query<{ id: string }>(`SELECT id FROM source WHERE code = 'ebay_us'`)).rows[0].id;
    const other = (await db.query<{ id: string }>(`SELECT id FROM source WHERE code = 'walmart_us'`)).rows[0].id;
    const user = `zz_tvdeals_${Date.now()}`;
    const seller = (await db.query<{ id: string }>(`INSERT INTO seller (source_id, platform_seller_id, name, name_key) VALUES ($1, $2, $2, $2) RETURNING id`, [src, user])).rows[0].id;
    // Same name on another source: not the eBay account, untouched.
    const walmart = (await db.query<{ id: string }>(`INSERT INTO seller (source_id, name, name_key) VALUES ($1, $2, $2) RETURNING id`, [other, user])).rows[0].id;
    await db.query(`INSERT INTO seller_alias (seller_id, alias, alias_key) VALUES ($1, 'TV Deals Outlet', 'tv deals outlet')`, [seller]);
    for (const a of [accounts.lg, accounts.apple]) {
      await db.query("SELECT set_config('app.account_id', $1, true)", [a]);
      await db.query(`INSERT INTO seller_contact (account_id, seller_id, kind, value) VALUES ($1, $2, 'email', 'owner@example.invalid')`, [a, seller]);
    }

    const run = (n: string) => db.query<{ n: number }>('SELECT app_ebay_account_deletion($1, $2, $3, $4, now()) AS n', [n, user.toUpperCase(), 'not-a-key', 'u-1']);
    const notification = `test-${Date.now()}`;
    assert.equal((await run(notification)).rows[0].n, 1);
    assert.equal((await run(notification)).rows[0].n, 0); // eBay retry: nothing more

    const s = (await db.query('SELECT name, platform_seller_id, storefront_url FROM seller WHERE id = $1', [seller])).rows[0];
    assert.equal(s.name, 'Deleted eBay user');
    assert.equal(s.platform_seller_id, `deleted:${seller}`);
    assert.equal((await db.query('SELECT name FROM seller WHERE id = $1', [walmart])).rows[0].name, user);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM seller_alias WHERE seller_id = $1', [seller])).rows[0].n, 0);
    for (const a of [accounts.lg, accounts.apple]) {
      await db.query("SELECT set_config('app.account_id', $1, true)", [a]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM seller_contact WHERE seller_id = $1', [seller])).rows[0].n, 0);
    }
    const log = (await db.query('SELECT * FROM ebay_account_deletion WHERE notification_id = $1', [notification])).rows[0];
    assert.equal(log.sellers_anonymised, 1);
    assert.equal(log.username_sha256.length, 64);
    assert.ok(!JSON.stringify(log).toLowerCase().includes(user.toLowerCase()), 'the username itself is not stored');
    await expectRefused(db, 'DELETE FROM ebay_account_deletion WHERE notification_id = $1', [notification]);
  }));
