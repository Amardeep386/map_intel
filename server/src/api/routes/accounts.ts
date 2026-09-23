import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withSystem, withTenant } from '../../lib/db.js';
import { signedUrl } from '../../lib/storage.js';
import { HttpError, assertAccountAccess } from '../app.js';

// Latest observation per listing, looking back 30 days (keeps partition pruning effective).
const LATEST_OFFERS_SQL = `
  SELECT DISTINCT ON (o.listing_id)
         l.product_id, s.code AS source, s.display_name AS source_name, l.url, o.id AS observation_id,
         o.observed_at, o.status, o.advertised_price, o.list_price, o.availability, o.seller_name_raw
    FROM listing l
    JOIN source s ON s.id = l.source_id
    JOIN observation o ON o.listing_id = l.id AND o.observed_at > now() - interval '30 days'
   WHERE l.product_id = ANY($1::uuid[])
   ORDER BY o.listing_id, o.observed_at DESC`;

interface ProductRow {
  id: string;
  product_code: string;
  name: string;
  model_number: string | null;
  category: string | null;
  standard_price: number | null;
  status: string;
  map_amount: number | null;
}

interface OfferRow {
  product_id: string;
  source: string;
  source_name: string;
  url: string;
  observation_id: string;
  observed_at: Date;
  status: string;
  advertised_price: number | null;
  list_price: number | null;
  availability: string | null;
  seller_name_raw: string | null;
}

const newProduct = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(300),
  model: z.string().trim().min(1).max(100),
  category: z.string().trim().max(100).optional().default(''),
  map: z.coerce.number().positive().max(10_000_000).optional(),
  msrp: z.coerce.number().positive().max(10_000_000).optional(),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/accounts', { preHandler: app.requireUser }, async (req) => {
    const user = req.user!;
    return withSystem(async (db) => {
      const { rows } = await db.query(
        `SELECT a.id, a.slug, a.name, a.brand, a.status, a.accent_light, a.accent_dark,
                m.role,
                (SELECT count(*) FROM product p WHERE p.account_id = a.id AND p.status <> 'Retired')::int AS skus,
                (SELECT count(DISTINCT l.source_id) FROM listing l JOIN product p ON p.id = l.product_id
                  WHERE p.account_id = a.id)::int AS sources
           FROM account a
           LEFT JOIN account_membership m ON m.account_id = a.id AND m.user_id = $1
          WHERE $2 OR m.user_id IS NOT NULL
          ORDER BY a.name`,
        [user.sub, user.role === 'admin'],
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        status: r.status,
        accent: { light: r.accent_light, dark: r.accent_dark },
        role: r.role ?? (user.role === 'admin' ? 'Administrator' : null),
        skus: r.skus,
        merchants: r.sources,
      }));
    });
  });

  app.get<{ Params: { accountId: string } }>('/accounts/:accountId/products', { preHandler: app.requireUser }, async (req) => {
    const { accountId } = req.params;
    await assertAccountAccess(req.user!, accountId);
    return withTenant(accountId, async (db) => {
      const products = (
        await db.query<ProductRow>(
          `SELECT p.id, p.product_code, p.name, p.model_number, p.category, p.standard_price, p.status,
                  (SELECT mp.amount FROM map_price mp
                    WHERE mp.product_id = p.id AND mp.effective_from <= now()
                      AND (mp.effective_to IS NULL OR mp.effective_to > now())
                    ORDER BY mp.effective_from DESC LIMIT 1) AS map_amount
             FROM product p
            ORDER BY p.product_code`,
        )
      ).rows;
      const offers = (await db.query<OfferRow>(LATEST_OFFERS_SQL, [products.map((p) => p.id)])).rows;
      return products.map((p) => {
        const mine = offers.filter((o) => o.product_id === p.id);
        const priced = mine.filter((o) => o.advertised_price !== null).map((o) => o.advertised_price as number);
        return {
          id: p.id,
          code: p.product_code,
          name: p.name,
          model: p.model_number,
          category: p.category,
          map: p.map_amount,
          msrp: p.standard_price,
          current: priced.length ? Math.min(...priced) : null,
          violations: 0, // violations are computed from Phase 3
          status: p.status,
          offers: mine.map((o) => ({
            source: o.source,
            sourceName: o.source_name,
            url: o.url,
            observationId: o.observation_id,
            observedAt: o.observed_at,
            status: o.status,
            price: o.advertised_price,
            listPrice: o.list_price,
            availability: o.availability,
            seller: o.seller_name_raw,
          })),
        };
      });
    });
  });

  app.post<{ Params: { accountId: string } }>('/accounts/:accountId/products', { preHandler: app.requireUser }, async (req, reply) => {
    const { accountId } = req.params;
    const role = await assertAccountAccess(req.user!, accountId);
    if (role === 'Brand user') throw new HttpError(403, 'brand users cannot add products');
    const body = newProduct.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    const b = body.data;

    const created = await withTenant(accountId, async (db) => {
      const brand = (await withSystem((s) => s.query<{ brand: string }>('SELECT brand FROM account WHERE id = $1', [accountId]))).rows[0]
        ?.brand;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO product (account_id, product_code, name, brand, category, model_number, standard_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (account_id, product_code) DO NOTHING
         RETURNING id`,
        [accountId, b.code, b.name, brand ?? '', b.category || null, b.model, b.msrp ?? null],
      );
      if (!rows[0]) throw new HttpError(409, `SKU ${b.code} already exists`);
      await db.query(
        `INSERT INTO product_identifier (account_id, product_id, type, value) VALUES ($1, $2, 'MPN', $3) ON CONFLICT DO NOTHING`,
        [accountId, rows[0].id, b.model],
      );
      if (b.map) {
        await db.query(
          `INSERT INTO map_price (account_id, product_id, amount, source, created_by) VALUES ($1, $2, $3, 'manual', $4)`,
          [accountId, rows[0].id, b.map, req.user!.sub],
        );
      }
      return rows[0].id;
    });
    return reply.code(201).send({
      id: created,
      code: b.code,
      name: b.name,
      model: b.model,
      category: b.category,
      map: b.map ?? null,
      msrp: b.msrp ?? null,
      current: null,
      violations: 0,
      status: 'Active',
      offers: [],
    });
  });

  app.get<{ Params: { accountId: string }; Querystring: { product?: string; limit?: string } }>(
    '/accounts/:accountId/observations',
    { preHandler: app.requireUser },
    async (req) => {
      const { accountId } = req.params;
      await assertAccountAccess(req.user!, accountId);
      const limit = Math.min(Number.parseInt(req.query.limit ?? '100', 10) || 100, 500);
      return withTenant(accountId, async (db) => {
        const { rows } = await db.query(
          `SELECT o.id, o.observed_at, o.status, o.advertised_price AS price, o.list_price, o.currency, o.availability, o.qty,
                  o.seller_name_raw AS seller, o.fetch_method, o.model_match, o.error,
                  p.product_code, p.name AS product_name, s.code AS source, s.display_name AS source_name, l.url,
                  e.id AS evidence_id, e.html_sha256, e.screenshot_sha256
             FROM product p
             JOIN listing l ON l.product_id = p.id
             JOIN source s ON s.id = l.source_id
             JOIN observation o ON o.listing_id = l.id
             LEFT JOIN evidence e ON e.observation_id = o.id AND e.observed_at = o.observed_at
            WHERE ($1::text IS NULL OR p.product_code = $1)
            ORDER BY o.observed_at DESC
            LIMIT $2`,
          [req.query.product ?? null, limit],
        );
        return rows;
      });
    },
  );

  app.get<{ Params: { evidenceId: string } }>('/evidence/:evidenceId', { preHandler: app.requireUser }, async (req) => {
    const { evidenceId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) throw new HttpError(404, 'evidence not found');
    const row = await withSystem(async (db) => {
      const { rows } = await db.query(
        `SELECT e.*, p.account_id, o.advertised_price, o.seller_name_raw, l.url
           FROM evidence e
           JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
           JOIN listing l ON l.id = o.listing_id
           JOIN product p ON p.id = l.product_id
          WHERE e.id = $1`,
        [evidenceId],
      );
      return rows[0];
    });
    if (!row) throw new HttpError(404, 'evidence not found');
    await assertAccountAccess(req.user!, row.account_id);
    return {
      id: row.id,
      observationId: row.observation_id,
      capturedAt: row.captured_at,
      method: row.method,
      listingUrl: row.url,
      price: row.advertised_price,
      seller: row.seller_name_raw,
      html: row.html_uri ? { sha256: row.html_sha256, bytes: row.html_bytes, url: await signedUrl(row.html_uri) } : null,
      screenshot: row.screenshot_uri
        ? { sha256: row.screenshot_sha256, bytes: row.screenshot_bytes, url: await signedUrl(row.screenshot_uri) }
        : null,
    };
  });
}
