// Build sellers from the seller names already collected: each listing's latest named seller
// becomes its seller (resolved per source, spellings merged), and every account matched to that
// listing gets the seller as "Unknown" until an analyst classifies it. Safe to re-run.
//   npm run sellers:backfill
import { closeDb, withSystem } from '../lib/db.js';
import { ensureClassification, resolveSeller } from '../lib/sellers.js';

const result = await withSystem(async (db) => {
  const { rows } = await db.query<{ listing_id: string; source_id: string; seller: string; seller_id_raw: string | null }>(
    `SELECT DISTINCT ON (o.listing_id) o.listing_id, l.source_id, o.seller_name_raw AS seller, o.seller_id_raw
       FROM observation o JOIN listing l ON l.id = o.listing_id
      WHERE o.seller_name_raw IS NOT NULL AND btrim(o.seller_name_raw) <> ''
      ORDER BY o.listing_id, o.observed_at DESC`,
  );
  const sellers = new Set<string>();
  let classified = 0;
  for (const r of rows) {
    const sellerId = await resolveSeller(db, r.source_id, r.seller, r.seller_id_raw);
    if (!sellerId) continue;
    sellers.add(sellerId);
    await db.query('UPDATE listing SET seller_id = $2 WHERE id = $1 AND seller_id IS DISTINCT FROM $2', [r.listing_id, sellerId]);
    const accounts = (await db.query<{ account_id: string }>('SELECT account_id FROM listing_match WHERE listing_id = $1', [r.listing_id])).rows;
    for (const a of accounts) {
      await ensureClassification(db, a.account_id, sellerId);
      classified++;
    }
  }
  return { listings: rows.length, sellers: sellers.size, classified };
});
console.log(`sellers backfill: ${result.listings} listings with a seller name, ${result.sellers} sellers, ${result.classified} account/seller pairs checked`);
await closeDb();
