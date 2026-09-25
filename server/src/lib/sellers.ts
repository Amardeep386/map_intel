// Market identity: turn the seller names seen on listings into one seller per storefront and
// source. The same storefront shows up as "Sold by XYZ Electronics", "XYZ Electronics, LLC" or
// "xyz electronics." — all normalise to one key and resolve to one seller. Aliases hold other
// names (trading names) that should resolve to the same seller.
// Shared core: also used by the Phase 2b collectors (resolveSeller) and later by Pricing Intel.
import type { Db } from './db.js';

export const SELLER_CLASSES = ['MAP Authorised', 'Unauthorised', 'Brand Direct', 'Unknown'] as const;
export type SellerClass = (typeof SELLER_CLASSES)[number];

const PREFIXES = [/^ships from and sold by\b\s*/, /^sold and shipped by\b\s*/, /^sold by\b\s*/, /^seller:\s*/, /^by\s+/];
const SUFFIXES = /\b(inc|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|store|official store|shop)\b\.?$/;

/** Comparable key for a seller name: lower case, no "sold by", no legal suffix, no punctuation. */
export function normaliseSellerName(raw: string): string {
  let s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (const p of PREFIXES) s = s.replace(p, '');
  s = s.replace(/&/g, ' and ').replace(/[''`]/g, '');
  s = s.replace(/[^a-z0-9.]+/g, ' ').replace(/\.(?![a-z]{2,3}\b)/g, ' ').trim();
  // Drop legal suffixes, possibly several ("XYZ Store Inc").
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIXES, '').trim();
    if (next === s || !next) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Display name: the raw name without "Sold by" and surrounding punctuation. */
export function cleanSellerName(raw: string): string {
  let s = raw.trim();
  for (const p of PREFIXES) s = s.replace(new RegExp(p.source, 'i'), '');
  return s.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').replace(/\s+/g, ' ');
}

/**
 * Find or create the seller for a name (and platform id, when the source shows one) on one
 * source. Unknown spellings of a known seller become aliases.
 */
export async function resolveSeller(db: Db, sourceId: string, rawName: string, platformSellerId?: string | null): Promise<string | null> {
  const name = cleanSellerName(rawName);
  const key = normaliseSellerName(rawName);
  if (!key) return null;

  let id: string | undefined;
  if (platformSellerId) {
    id = (await db.query<{ id: string }>('SELECT id FROM seller WHERE source_id = $1 AND platform_seller_id = $2', [sourceId, platformSellerId])).rows[0]?.id;
  }
  id ??= (
    await db.query<{ id: string }>(
      `SELECT s.id FROM seller s WHERE s.source_id = $1 AND s.name_key = $2
       UNION ALL
       SELECT a.seller_id FROM seller_alias a JOIN seller s ON s.id = a.seller_id WHERE s.source_id = $1 AND a.alias_key = $2
       LIMIT 1`,
      [sourceId, key],
    )
  ).rows[0]?.id;

  if (!id) {
    id = (
      await db.query<{ id: string }>(
        `INSERT INTO seller (source_id, platform_seller_id, name, name_key, first_seen) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT DO NOTHING RETURNING id`,
        [sourceId, platformSellerId ?? null, name, key],
      )
    ).rows[0]?.id;
    // Lost a race with another writer: read theirs.
    id ??= (await db.query<{ id: string }>('SELECT id FROM seller WHERE source_id = $1 AND name_key = $2', [sourceId, key])).rows[0]?.id;
  }
  return id ?? null;
}

/** Add another name for a seller (e.g. a trading name). Returns false when that name already
 *  belongs to a different seller on the same source. */
export async function addAlias(db: Db, sellerId: string, alias: string): Promise<boolean> {
  const key = normaliseSellerName(alias);
  if (!key) return false;
  const clash = (
    await db.query(
      `SELECT 1 FROM seller s JOIN seller me ON me.id = $1
        WHERE s.source_id = me.source_id AND s.id <> me.id
          AND (s.name_key = $2 OR EXISTS (SELECT 1 FROM seller_alias a WHERE a.seller_id = s.id AND a.alias_key = $2))`,
      [sellerId, key],
    )
  ).rowCount;
  if (clash) return false;
  await db.query('INSERT INTO seller_alias (seller_id, alias, alias_key) VALUES ($1, $2, $3) ON CONFLICT (seller_id, alias_key) DO NOTHING', [
    sellerId, cleanSellerName(alias), key,
  ]);
  return true;
}

/** Give a seller the class "Unknown" in an account when it has no classification there yet. */
export async function ensureClassification(db: Db, accountId: string, sellerId: string): Promise<void> {
  await db.query(
    `INSERT INTO seller_classification (account_id, seller_id, class, note)
     SELECT $1, $2, 'Unknown', 'First seen'
      WHERE NOT EXISTS (SELECT 1 FROM seller_classification WHERE account_id = $1 AND seller_id = $2)`,
    [accountId, sellerId],
  );
}
