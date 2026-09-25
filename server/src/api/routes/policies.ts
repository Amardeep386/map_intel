// MAP Policies screen: MAP price history (effective-dated, per region), a manual new MAP
// version, promotion windows (products, optional sellers, dates) and versioned policy documents.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { planMap } from '../../lib/catalogueImport.js';
import { withTenant, type Db } from '../../lib/db.js';
import { putObject, signedUrl } from '../../lib/storage.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';
import { DAY_START_SQL, importCode } from './catalogue.js';

type Params = { accountId: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const newMap = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  from: isoDate,
  region: z.string().trim().max(10).optional(),
  note: z.string().trim().max(500).optional(),
});

const newPromo = z.object({
  name: z.string().trim().min(1).max(200),
  from: isoDate,
  to: isoDate,
  products: z.array(z.object({ productId: z.string().uuid(), promoAmount: z.coerce.number().positive().max(10_000_000) })).min(1).max(5000),
  sellerIds: z.array(z.string().uuid()).max(500).default([]),
  note: z.string().trim().max(1000).optional(),
});

const ALLOWED_DOC_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/png', 'image/jpeg'];
const newPolicy = z.object({
  name: z.string().trim().min(1).max(200),
  effectiveFrom: isoDate,
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().refine((t) => ALLOWED_DOC_TYPES.includes(t), 'upload a PDF, Word (.docx), text or image file'),
  content: z.string().min(1), // base64
  note: z.string().trim().max(500).optional(),
});

function audit(db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  return recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });
}

const promoCode = (seq: number) => `PW-${String(seq).padStart(3, '0')}`;

/** Status of a promotion window now. */
export function promoStatus(from: Date, to: Date, cancelledAt: Date | null, now = new Date()): string {
  if (cancelledAt) return 'Cancelled';
  if (from > now) return 'Scheduled';
  if (to <= now) return 'Expired';
  return 'Active';
}

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  // ---- MAP history (every version of every product) ----
  app.get<{ Params: Params }>('/accounts/:accountId/map-prices', { config: { permission: 'catalogue.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query(
        `SELECT mp.id, p.id AS product_id, p.product_code AS code, p.name AS product, mp.amount, mp.currency, mp.region,
                mp.effective_from AS "from", mp.effective_to AS "to", mp.source, mp.note, ci.seq AS import_seq,
                row_number() OVER (PARTITION BY mp.product_id, coalesce(mp.region, '') ORDER BY mp.effective_from)::int AS version,
                (mp.effective_from <= now() AND (mp.effective_to IS NULL OR mp.effective_to > now())) AS in_force
           FROM map_price mp
           JOIN product p ON p.id = mp.product_id
           LEFT JOIN catalogue_import ci ON ci.id = mp.import_id
          ORDER BY p.product_code, mp.region NULLS FIRST, mp.effective_from DESC`,
      );
      return rows.map((r) => ({
        ...r,
        status: r.in_force ? 'In force' : r.from > new Date() ? 'Scheduled' : 'Superseded',
        sourceLabel: r.import_seq ? `Import ${importCode(r.import_seq)}` : r.source === 'manual' ? 'Manual' : r.source,
      }));
    }),
  );

  // A new MAP version for one product, from a date (closes the version in force).
  app.post<{ Params: Params & { productId: string } }>('/accounts/:accountId/products/:productId/map', { config: { permission: 'catalogue.write' } }, async (req, reply) => {
    const productId = uuidOr404(req.params.productId, 'product');
    const b = parse(newMap, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const product = (await db.query<{ code: string }>('SELECT product_code AS code FROM product WHERE id = $1', [productId])).rows[0];
      if (!product) throw new HttpError(404, 'product not found');
      const versions = (
        await db.query<{ id: string; product_id: string; region: string | null; amount: number; from: string; to: string | null }>(
          `SELECT mp.id, mp.product_id, mp.region, mp.amount,
                  to_char(mp.effective_from AT TIME ZONE a.timezone, 'YYYY-MM-DD') AS from,
                  to_char(mp.effective_to AT TIME ZONE a.timezone, 'YYYY-MM-DD') AS to
             FROM map_price mp JOIN account a ON a.id = mp.account_id WHERE mp.product_id = $1`,
          [productId],
        )
      ).rows.map((r) => ({ id: r.id, productId: r.product_id, region: r.region, amount: r.amount, from: r.from, to: r.to }));
      const plan = planMap(
        [{ line: 1, values: { code: product.code, amount: String(b.amount), from: b.from, to: '', region: b.region ?? '', note: b.note ?? '' } }],
        new Map([[product.code.toLowerCase(), productId]]),
        versions,
      );
      if (plan.problems.length) throw new HttpError(409, plan.problems[0].reason);
      if (!plan.changes.length) throw new HttpError(409, `the MAP in force is already ${b.amount}`);
      const c = plan.changes[0];
      if (c.closes) await db.query(`UPDATE map_price SET effective_to = ${DAY_START_SQL('$2')} WHERE id = $1 AND effective_to IS NULL`, [c.closes.id, c.from]);
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO map_price (account_id, product_id, amount, region, effective_from, source, note, created_by)
           VALUES ($1, $2, $3, $4, ${DAY_START_SQL('$5')}, 'manual', $6, $7) RETURNING id`,
          [req.params.accountId, productId, c.amount, c.region, c.from, c.note, req.user!.sub],
        )
      ).rows[0].id;
      await audit(db, req, {
        action: 'map.created',
        entityType: 'map_price',
        entityId: id,
        summary: `New MAP for ${product.code}${c.region ? ` (${c.region})` : ''}: ${c.amount} from ${c.from}${c.closes ? ` (was ${c.closes.amount})` : ''}`,
        before: c.closes ? { amount: c.closes.amount, from: c.closes.from } : null,
        after: { amount: c.amount, from: c.from, region: c.region, note: c.note },
      });
      return reply.code(201).send({ id, amount: c.amount, from: c.from, region: c.region, closed: c.closes?.id ?? null });
    });
  });

  // ---- promotion windows ----
  app.get<{ Params: Params }>('/accounts/:accountId/promos', { config: { permission: 'catalogue.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query(
        `SELECT w.id, w.seq, w.name, w.effective_from AS "from", w.effective_to AS "to", w.note, w.cancelled_at, w.created_at,
                coalesce((SELECT json_agg(json_build_object(
                    'productId', p.id, 'code', p.product_code, 'name', p.name, 'promoAmount', wp.promo_amount,
                    'standard', (SELECT mp.amount FROM map_price mp WHERE mp.product_id = p.id AND mp.region IS NULL
                                  AND mp.effective_from <= w.effective_from AND (mp.effective_to IS NULL OR mp.effective_to > w.effective_from)
                                ORDER BY mp.effective_from DESC LIMIT 1),
                    'msrp', p.standard_price) ORDER BY p.product_code)
                   FROM promo_window_product wp JOIN product p ON p.id = wp.product_id WHERE wp.promo_id = w.id), '[]') AS products,
                coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                   FROM promo_window_seller ws JOIN seller s ON s.id = ws.seller_id WHERE ws.promo_id = w.id), '[]') AS sellers
           FROM promo_window w
          ORDER BY w.effective_from DESC`,
      );
      return rows.map((r) => ({
        ...r,
        code: promoCode(r.seq),
        status: promoStatus(new Date(r.from), new Date(r.to), r.cancelled_at),
        appliesTo: r.sellers.length ? r.sellers.map((s: { name: string }) => s.name).join(', ') : 'All sellers',
      }));
    }),
  );

  app.post<{ Params: Params }>('/accounts/:accountId/promos', { config: { permission: 'catalogue.write' } }, async (req, reply) => {
    const b = parse(newPromo, req.body);
    if (b.to <= b.from) throw new HttpError(400, 'the window must end after it starts');
    const productIds = [...new Set(b.products.map((p) => p.productId))];
    if (productIds.length !== b.products.length) throw new HttpError(400, 'a product is listed twice');
    return withTenant(req.params.accountId, async (db) => {
      const found = (await db.query<{ id: string }>('SELECT id FROM product WHERE id = ANY($1::uuid[])', [productIds])).rows.length;
      if (found !== productIds.length) throw new HttpError(400, 'unknown product in the window');
      if (b.sellerIds.length) {
        const sellers = (await db.query('SELECT id FROM seller WHERE id = ANY($1::uuid[])', [b.sellerIds])).rows.length;
        if (sellers !== new Set(b.sellerIds).size) throw new HttpError(400, 'unknown seller in the window');
      }
      const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM promo_window')).rows[0].n;
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO promo_window (account_id, seq, name, effective_from, effective_to, note, created_by)
           VALUES ($1, $2, $3, ${DAY_START_SQL('$4')}, ${DAY_START_SQL('$5')}, $6, $7) RETURNING id`,
          [req.params.accountId, seq, b.name, b.from, b.to, b.note ?? null, req.user!.sub],
        )
      ).rows[0].id;
      for (const p of b.products) {
        await db.query('INSERT INTO promo_window_product (promo_id, account_id, product_id, promo_amount) VALUES ($1, $2, $3, $4)', [
          id, req.params.accountId, p.productId, p.promoAmount,
        ]);
      }
      for (const s of new Set(b.sellerIds)) {
        await db.query('INSERT INTO promo_window_seller (promo_id, account_id, seller_id) VALUES ($1, $2, $3)', [id, req.params.accountId, s]);
      }
      await audit(db, req, {
        action: 'promo.created',
        entityType: 'promo_window',
        entityId: id,
        summary: `Promotion window ${promoCode(seq)} "${b.name}": ${b.products.length} products, ${b.from} to ${b.to}${b.sellerIds.length ? `, ${b.sellerIds.length} sellers` : ', all sellers'}`,
        after: b,
      });
      return reply.code(201).send({ id, code: promoCode(seq) });
    });
  });

  app.post<{ Params: Params & { promoId: string } }>('/accounts/:accountId/promos/:promoId/cancel', { config: { permission: 'catalogue.write' } }, async (req) => {
    const promoId = uuidOr404(req.params.promoId, 'promotion window');
    return withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query<{ seq: number; name: string }>(
        'UPDATE promo_window SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL RETURNING seq, name',
        [promoId],
      );
      if (!rows[0]) throw new HttpError(404, 'promotion window not found or already cancelled');
      await audit(db, req, {
        action: 'promo.cancelled',
        entityType: 'promo_window',
        entityId: promoId,
        summary: `Cancelled promotion window ${promoCode(rows[0].seq)} "${rows[0].name}"`,
      });
      return { ok: true };
    });
  });

  // ---- policy documents ----
  app.get<{ Params: Params }>('/accounts/:accountId/policies', { config: { permission: 'catalogue.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query(
        `SELECT d.id, d.name, d.version, d.effective_from, d.effective_to, d.file_name, d.content_type, d.bytes, d.sha256, d.note,
                d.uploaded_at, u.email AS uploaded_by
           FROM policy_document d LEFT JOIN app_user u ON u.id = d.uploaded_by
          ORDER BY d.name, d.version DESC`,
      );
      const now = new Date();
      return rows.map((d) => ({
        ...d,
        status: d.effective_from > now ? 'Scheduled' : d.effective_to && d.effective_to <= now ? 'Superseded' : 'In force',
      }));
    }),
  );

  app.post<{ Params: Params }>('/accounts/:accountId/policies', { config: { permission: 'catalogue.write' }, bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const b = parse(newPolicy, req.body);
    const body = Buffer.from(b.content, 'base64');
    if (!body.length) throw new HttpError(400, 'the file is empty');
    if (body.length > 10 * 1024 * 1024) throw new HttpError(400, 'policy documents are limited to 10 MB');
    const accountId = req.params.accountId;
    // Check the version can be added before storing the file.
    const prev = await withTenant(accountId, async (db) =>
      (
        await db.query<{ version: number; from: string; open: boolean }>(
          `SELECT version, to_char(effective_from AT TIME ZONE a.timezone, 'YYYY-MM-DD') AS from, effective_to IS NULL AS open
             FROM policy_document d JOIN account a ON a.id = d.account_id
            WHERE lower(d.name) = lower($1) ORDER BY version DESC LIMIT 1`,
          [b.name],
        )
      ).rows[0],
    );
    if (prev && b.effectiveFrom <= prev.from) throw new HttpError(409, `version ${prev.version} starts ${prev.from}; a new version must start after it`);
    const safeName = b.fileName.replace(/[^\w.-]+/g, '_');
    const stored = await putObject(`policies/${accountId}/${randomUUID()}/${safeName}`, body, b.contentType);

    return withTenant(accountId, async (db) => {
      const version = (prev?.version ?? 0) + 1;
      if (prev?.open) {
        await db.query(
          `UPDATE policy_document SET effective_to = ${DAY_START_SQL('$2')} WHERE lower(name) = lower($1) AND effective_to IS NULL`,
          [b.name, b.effectiveFrom],
        );
      }
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO policy_document (account_id, name, version, effective_from, file_name, content_type, bytes, storage_key, sha256, note, uploaded_by)
           VALUES ($1, $2, $3, ${DAY_START_SQL('$4')}, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [accountId, b.name, version, b.effectiveFrom, b.fileName, b.contentType, stored.bytes, stored.uri, stored.sha256, b.note ?? null, req.user!.sub],
        )
      ).rows[0].id;
      await audit(db, req, {
        action: 'policy.uploaded',
        entityType: 'policy_document',
        entityId: id,
        summary: `Policy "${b.name}" v${version} from ${b.effectiveFrom} (${b.fileName}, sha256 ${stored.sha256.slice(0, 12)}…)`,
        after: { name: b.name, version, effectiveFrom: b.effectiveFrom, fileName: b.fileName, bytes: stored.bytes, sha256: stored.sha256 },
      });
      return reply.code(201).send({ id, version, sha256: stored.sha256 });
    });
  });

  app.get<{ Params: Params & { docId: string } }>('/accounts/:accountId/policies/:docId/download', { config: { permission: 'catalogue.read' } }, async (req) => {
    const docId = uuidOr404(req.params.docId, 'policy document');
    const doc = await withTenant(req.params.accountId, async (db) =>
      (await db.query<{ storage_key: string; file_name: string }>('SELECT storage_key, file_name FROM policy_document WHERE id = $1', [docId])).rows[0],
    );
    if (!doc) throw new HttpError(404, 'policy document not found');
    return { url: await signedUrl(doc.storage_key), fileName: doc.file_name };
  });
}
