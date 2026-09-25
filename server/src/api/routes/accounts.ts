import type { FastifyInstance } from 'fastify';
import { withApi, withTenant } from '../../lib/db.js';
import { signedUrl } from '../../lib/storage.js';
import { HttpError, requireAccountAction } from '../app.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/accounts', { config: { permission: 'user' } }, async (req) => {
    const user = req.user!;
    return withApi(async (db) => {
      const { rows } = await db.query('SELECT * FROM app_accounts_for_user($1, $2)', [user.sub, user.role === 'admin']);
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        status: r.status,
        accent: { light: r.accent_light, dark: r.accent_dark },
        role: r.role,
        skus: r.skus,
        merchants: r.sources,
      }));
    });
  });

  app.get<{ Params: { accountId: string }; Querystring: { product?: string; limit?: string } }>(
    '/accounts/:accountId/observations',
    { config: { permission: 'observations.read' } },
    async (req) => {
      const { accountId } = req.params;
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

  app.get<{ Params: { evidenceId: string } }>('/evidence/:evidenceId', { config: { permission: 'user' } }, async (req) => {
    const { evidenceId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) throw new HttpError(404, 'evidence not found');
    // Find the owning account first, check access, then read the evidence as that tenant.
    const accountId = await withApi(async (db) => {
      const { rows } = await db.query<{ account_id: string | null }>('SELECT app_evidence_account($1) AS account_id', [evidenceId]);
      return rows[0]?.account_id ?? null;
    });
    if (!accountId) throw new HttpError(404, 'evidence not found');
    await requireAccountAction(req.user!, accountId, 'observations.read');
    const row = await withTenant(accountId, async (db) => {
      const { rows } = await db.query(
        `SELECT e.*, o.advertised_price, o.seller_name_raw, l.url
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
