// Loads the pilot accounts (LG, Apple, Samsung), the shared source catalogue (from the collector
// declarations in src/collector/catalogue.ts), the pilot SKUs and their retailer listings, each pilot
// account's starting subscriptions and schedule, and the first admin user. Safe to run more than once:
// it never overwrites an account's own subscription or schedule changes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_CATALOGUE, optionsSchema } from '../collector/catalogue.js';
import { SYSTEM_ACTOR, recordAudit } from '../lib/audit.js';
import { hashPassword } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { channelSkuFromUrl } from '../collector/sources.js';

interface SeedFile {
  accounts: { slug: string; name: string; brand: string; status: string; accentLight: string; accentDark: string }[];
  products: {
    account: string;
    code: string;
    name: string;
    category: string;
    model: string;
    msrp?: number;
    urls: Record<string, string | null>;
    // Listings found to be wrong: kept (their observations and evidence stay) but set to Retired.
    retired?: Record<string, { url: string; reason: string }>;
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

    const familyIds = new Map<string, string>();
    for (const f of new Map(SOURCE_CATALOGUE.map((d) => [d.family.code, d.family])).values()) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO source_family (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [f.code, f.name],
      );
      familyIds.set(f.code, rows[0].id);
    }

    const sourceIds = new Map<string, string>();
    for (const s of SOURCE_CATALOGUE) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO source (code, internal_name, display_name, category, country, base_url, capability, options_schema, family_id, collector_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (code) DO UPDATE SET internal_name = EXCLUDED.internal_name, display_name = EXCLUDED.display_name,
           category = EXCLUDED.category, country = EXCLUDED.country, base_url = EXCLUDED.base_url, capability = EXCLUDED.capability,
           options_schema = EXCLUDED.options_schema, family_id = EXCLUDED.family_id, collector_status = EXCLUDED.collector_status
         RETURNING id`,
        [s.code, s.internalName, s.displayName, s.category, s.country, s.baseUrl, JSON.stringify(s.capability),
          JSON.stringify(optionsSchema(s)), familyIds.get(s.family.code), s.collectorStatus],
      );
      sourceIds.set(s.code, rows[0].id);
    }

    let listings = 0;
    let retired = 0;
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
        const { rows: listingRows } = await db.query<{ id: string }>(
          `INSERT INTO listing (source_id, product_id, url, channel_sku, state, match_confidence, origin)
           VALUES ($1, $2, $3, $4, 'Included', 100, 'seed')
           ON CONFLICT (source_id, url) DO UPDATE SET product_id = EXCLUDED.product_id, channel_sku = EXCLUDED.channel_sku
           RETURNING id`,
          [sourceId, productId, url, channelSku],
        );
        // The account's own decision on the listing (Phase 2a); kept if it already exists.
        await db.query(
          `INSERT INTO listing_match (account_id, listing_id, product_id, state, confidence, decided_by, reason)
           VALUES ($1, $2, $3, 'Included', 100, 'seed', 'Pilot listing from the seed catalogue')
           ON CONFLICT (account_id, listing_id) DO NOTHING`,
          [accountId, listingRows[0].id, productId],
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

      for (const [sourceCode, { url }] of Object.entries(p.retired ?? {})) {
        const sourceId = sourceIds.get(sourceCode);
        if (!sourceId) throw new Error(`unknown source ${sourceCode}`);
        const { rowCount } = await db.query(
          `UPDATE listing SET state = 'Retired' WHERE source_id = $1 AND url = $2 AND product_id = $3 AND state <> 'Retired'`,
          [sourceId, url, productId],
        );
        retired += rowCount ?? 0;
        await db.query(
          `UPDATE listing_match m SET state = 'Retired', decided_by = 'seed', reason = 'Retired in the seed catalogue', state_since = now()
             FROM listing l
            WHERE l.id = m.listing_id AND m.account_id = $1 AND l.source_id = $2 AND l.url = $3 AND m.state <> 'Retired'`,
          [accountId, sourceId, url],
        );

        // The retired listing's retailer id (e.g. a dead ASIN) no longer identifies the product:
        // remove it, and switch off any identifier term generated from it.
        const channelSku = channelSkuFromUrl(sourceCode, url);
        if (channelSku) {
          const type = sourceCode === 'amazon_us' ? 'ASIN' : sourceCode === 'bestbuy_us' ? 'BESTBUY_SKU' : 'WALMART_ID';
          await db.query('DELETE FROM product_identifier WHERE product_id = $1 AND type = $2 AND value = $3', [productId, type, channelSku]);
          const { rows: stale } = await db.query<{ id: string }>(
            `UPDATE term SET active = false WHERE product_id = $1 AND type = 'identifier' AND lower(value) = lower($2) AND active RETURNING id`,
            [productId, channelSku],
          );
          for (const t of stale) {
            await recordAudit(db, {
              accountId,
              actor: { ...SYSTEM_ACTOR, label: 'Seed' },
              action: 'term.updated',
              entityType: 'term',
              entityId: t.id,
              summary: `Deactivated identifier term "${channelSku}": its ${sourceCode} listing was retired`,
              before: { active: true },
              after: { active: false },
            });
          }
        }
      }
    }

    // Starting configuration per pilot account: subscribed to the sources its listings are on, and
    // a daily marketplace sweep. Only created when missing, so account changes are never undone.
    let subscriptions = 0;
    let schedules = 0;
    for (const [slug, accountId] of accountIds) {
      const liveSources = [...new Set(seed.products.filter((p) => p.account === slug).flatMap((p) => Object.keys(p.urls).filter((k) => p.urls[k])))];
      for (const code of liveSources) {
        const { rowCount } = await db.query(
          `INSERT INTO account_source (account_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [accountId, sourceIds.get(code)],
        );
        if (rowCount) {
          subscriptions++;
          await recordAudit(db, {
            accountId,
            actor: { ...SYSTEM_ACTOR, label: 'Seed' },
            action: 'subscription.created',
            entityType: 'account_source',
            entityId: code,
            summary: `Subscribed to ${code} (starting configuration)`,
            after: { source: code, active: true, options: {} },
          });
        }
      }
      const { rows: sched } = await db.query<{ id: string }>(
        `INSERT INTO schedule (account_id, name, selector, listing_scope, listing_status, takedown_status, cadence, timezone, priority)
         VALUES ($1, 'Daily marketplace sweep', '{}'::jsonb, 'Included and Staged', 'Active only', 'All', '0 6 * * *', 'UTC', 10)
         ON CONFLICT (account_id, lower(name)) DO NOTHING RETURNING id`,
        [accountId],
      );
      if (sched[0]) {
        schedules++;
        await recordAudit(db, {
          accountId,
          actor: { ...SYSTEM_ACTOR, label: 'Seed' },
          action: 'schedule.created',
          entityType: 'schedule',
          entityId: sched[0].id,
          summary: 'Created schedule "Daily marketplace sweep" (starting configuration)',
          after: { name: 'Daily marketplace sweep', cadence: '0 6 * * *', timezone: 'UTC', priority: 10 },
        });
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

    console.log(`seeded ${seed.accounts.length} accounts, ${SOURCE_CATALOGUE.length} sources, ${subscriptions} new subscriptions, ${schedules} new schedules, ${seed.products.length} products, ${listings} listings, ${retired} listings retired`);
  });
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
