// Generate a day of synthetic candidate listings for one account and run them through the
// matcher, or remove all synthetic listings.
//   npm run synthetic -- --account lg [--count 300] [--seed 1]
//   npm run synthetic -- --clear
import { parseArgs } from 'node:util';
import { closeDb, withSystem, type Db } from '../lib/db.js';
import { loadMatchContext, stageCandidate, upsertListing } from '../lib/mapping.js';
import { defaultBasePrice, generateCandidates, type SyntheticCandidate, type SyntheticProduct } from '../lib/synthetic.js';

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    count: { type: 'string', default: '300' },
    seed: { type: 'string', default: '1' },
    clear: { type: 'boolean', default: false },
  },
});

/** Products of an account with the price to build offers around. */
export async function syntheticProducts(db: Db, accountId: string): Promise<SyntheticProduct[]> {
  const ctx = await loadMatchContext(db, accountId);
  const cats = new Map((await db.query<{ id: string; category: string | null }>('SELECT id, category FROM product WHERE account_id = $1', [accountId])).rows.map((r) => [r.id, r.category]));
  return ctx.products.map((p) => ({
    id: p.id, code: p.code, name: p.name, brand: p.brand, model: p.model, category: cats.get(p.id) ?? null,
    asin: p.identifiers.find((i) => i.type === 'ASIN')?.value ?? null,
    basePrice: p.map ?? p.msrp ?? p.market ?? defaultBasePrice(p.name, cats.get(p.id) ?? null),
  }));
}

/** Store and score candidates in chunks (one transaction each). Returns the outcome per state. */
export async function stageSynthetic(accountId: string, candidates: SyntheticCandidate[], onProgress?: (done: number) => void) {
  const outcome: Record<string, number> = { Included: 0, Excluded: 0, Staged: 0, Retired: 0 };
  const listings: { candidate: SyntheticCandidate; listingId: string }[] = [];
  for (let i = 0; i < candidates.length; i += 50) {
    await withSystem(async (db) => {
      const sources = new Map((await db.query<{ code: string; id: string }>('SELECT code, id FROM source')).rows.map((r) => [r.code, r.id]));
      const ctx = await loadMatchContext(db, accountId);
      for (const c of candidates.slice(i, i + 50)) {
        const sourceId = sources.get(c.sourceCode)!;
        const l = await upsertListing(db, { sourceId, url: c.url, channelSku: c.channelSku, title: c.title, sellerName: c.sellerName, origin: 'synthetic' }, ctx);
        const r = await stageCandidate(db, ctx, {
          listingId: l.listingId, sourceId, sellerId: l.sellerId, url: c.url, title: c.title, price: c.price, channelSku: c.channelSku,
          sellerName: c.sellerName, condition: c.condition, format: c.format, imageUrl: null, origin: 'synthetic',
        });
        outcome[r.state]++;
        listings.push({ candidate: c, listingId: l.listingId });
      }
    });
    onProgress?.(Math.min(i + 50, candidates.length));
  }
  return { outcome, listings };
}

/** Remove every synthetic listing (their matches, candidates and history go with them). */
export async function clearSynthetic(): Promise<number> {
  return withSystem(async (db) => {
    const { rowCount } = await db.query("DELETE FROM listing WHERE origin = 'synthetic'");
    // Sellers that only ever appeared on synthetic listings and were never touched by a person.
    await db.query(
      `DELETE FROM seller s
        WHERE NOT EXISTS (SELECT 1 FROM listing l WHERE l.seller_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM seller_classification c WHERE c.seller_id = s.id AND c.set_by IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM seller_contact c WHERE c.seller_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM seller_alias a WHERE a.seller_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM seller_link k WHERE s.id IN (k.seller_a, k.seller_b))
          AND NOT EXISTS (SELECT 1 FROM match_candidate c WHERE c.seller_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM suppression x WHERE x.seller_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM promo_window_seller p WHERE p.seller_id = s.id)`,
    );
    return rowCount ?? 0;
  });
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/synthetic-candidates.ts') || process.argv[1]?.endsWith('synthetic-candidates.js');
if (isMain) {
  if (values.clear) {
    console.log(`removed ${await clearSynthetic()} synthetic listings`);
  } else {
    if (!values.account) throw new Error('give --account <slug> (lg, apple, samsung) or --clear');
    const accountId = await withSystem(async (db) => (await db.query<{ id: string }>('SELECT id FROM account WHERE slug = $1', [values.account])).rows[0]?.id);
    if (!accountId) throw new Error(`unknown account ${values.account}`);
    const products = await withSystem((db) => syntheticProducts(db, accountId));
    const candidates = generateCandidates(products, Number(values.count), Number(values.seed));
    const started = Date.now();
    const { outcome } = await stageSynthetic(accountId, candidates, (done) => process.stdout.write(`\r${done}/${candidates.length}`));
    console.log(`\n${values.account}: ${candidates.length} synthetic candidates in ${Math.round((Date.now() - started) / 1000)} s → ${outcome.Included} included, ${outcome.Excluded} excluded, ${outcome.Staged} to review`);
  }
  await closeDb();
}
