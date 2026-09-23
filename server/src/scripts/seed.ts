// Loads the pilot accounts (LG, Apple, Samsung), the three launch sources, the pilot SKUs and
// their retailer listings, and the first admin user. Safe to run more than once.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { channelSkuFromUrl } from '../collector/sources.js';

interface SeedFile {
  accounts: { slug: string; name: string; brand: string; status: string; accentLight: string; accentDark: string }[];
  sources: {
    code: string;
    internalName: string;
    displayName: string;
    category: string;
    baseUrl: string;
    capability: Record<string, unknown>;
  }[];
  products: {
    account: string;
    code: string;
    name: string;
    category: string;
    model: string;
    msrp?: number;
    urls: Record<string, string | null>;
  }[];
}

const seedPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../seeds/pilot-skus.json');

async function main(): Promise<void> {
  const seed = JSON.parse(await readFile(seedPath, 'utf8')) as SeedFile;

  await withSystem(async (db) => {
    const accountIds = new Map<string, string>();
    for (const a of seed.accounts) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO account (slug, name, brand, status, accent_light, accent_dark)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, accent_light = EXCLUDED.accent_light,
           accent_dark = EXCLUDED.accent_dark
         RETURNING id`,
        [a.slug, a.name, a.brand, a.status, a.accentLight, a.accentDark],
      );
      accountIds.set(a.slug, rows[0].id);
    }

    const sourceIds = new Map<string, string>();
    for (const s of seed.sources) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO source (code, internal_name, display_name, category, base_url, capability)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, capability = EXCLUDED.capability
         RETURNING id`,
        [s.code, s.internalName, s.displayName, s.category, s.baseUrl, JSON.stringify(s.capability)],
      );
      sourceIds.set(s.code, rows[0].id);
    }

    let listings = 0;
    for (const p of seed.products) {
      const accountId = accountIds.get(p.account);
      if (!accountId) throw new Error(`unknown account ${p.account} for ${p.code}`);
      const brand = seed.accounts.find((a) => a.slug === p.account)!.brand;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO product (account_id, product_code, name, brand, category, model_number, standard_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (account_id, product_code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
           model_number = EXCLUDED.model_number
         RETURNING id`,
        [accountId, p.code, p.name, brand, p.category, p.model, p.msrp ?? null],
      );
      const productId = rows[0].id;
      await db.query(
        `INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, 'MPN', $3)
         ON CONFLICT DO NOTHING`,
        [accountId, productId, p.model],
      );

      for (const [sourceCode, url] of Object.entries(p.urls)) {
        if (!url) continue;
        const sourceId = sourceIds.get(sourceCode);
        if (!sourceId) throw new Error(`unknown source ${sourceCode}`);
        const channelSku = channelSkuFromUrl(sourceCode, url);
        await db.query(
          `INSERT INTO listing (source_id, product_id, url, channel_sku, state, match_confidence)
           VALUES ($1, $2, $3, $4, 'Included', 100)
           ON CONFLICT (source_id, url) DO UPDATE SET product_id = EXCLUDED.product_id, channel_sku = EXCLUDED.channel_sku`,
          [sourceId, productId, url, channelSku],
        );
        if (channelSku) {
          const type = sourceCode === 'amazon_us' ? 'ASIN' : sourceCode === 'bestbuy_us' ? 'BESTBUY_SKU' : 'WALMART_ID';
          await db.query(
            `INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [accountId, productId, type, channelSku],
          );
        }
        listings++;
      }
    }

    if (config.SEED_ADMIN_EMAIL && config.SEED_ADMIN_PASSWORD) {
      const hash = await hashPassword(config.SEED_ADMIN_PASSWORD);
      await db.query(
        `INSERT INTO app_user (email, full_name, password_hash, platform_role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT ((lower(email))) DO NOTHING`,
        [config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_NAME, hash],
      );
      console.log(`admin user: ${config.SEED_ADMIN_EMAIL} (password from SEED_ADMIN_PASSWORD; unchanged if the user already existed)`);
    } else {
      console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no admin user created');
    }

    console.log(`seeded ${seed.accounts.length} accounts, ${seed.sources.length} sources, ${seed.products.length} products, ${listings} listings`);
  });
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
