// Sellers screen: storefronts seen on the account's listings, with effective-dated
// classification (a change is a new record), aliases, linked sellers and notice contacts.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { withTenant, type Db } from '../../lib/db.js';
import { addAlias, ensureClassification, resolveSeller, SELLER_CLASSES } from '../../lib/sellers.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
type SellerParams = Params & { sellerId: string };

const newSeller = z.object({
  source: z.string().trim().min(1).max(64), // source code, e.g. amazon_us
  name: z.string().trim().min(1).max(200),
  platformSellerId: z.string().trim().max(100).optional(),
  storefrontUrl: z.string().trim().url().max(1000).optional(),
  class: z.enum(SELLER_CLASSES).default('Unknown'),
  note: z.string().trim().max(500).optional(),
});

const classify = z.object({
  class: z.enum(SELLER_CLASSES),
  note: z.string().trim().min(1, 'say why (e.g. "Not on the authorised list v9")').max(500),
  from: z.string().datetime({ offset: true }).optional(), // default: now
});

const alias = z.object({ alias: z.string().trim().min(1).max(200) });
const link = z.object({
  otherSellerId: z.string().uuid(),
  reason: z.string().trim().min(1).max(300),
  confidence: z.coerce.number().int().min(0).max(100).default(50),
});
const contact = z.object({
  kind: z.enum(['email', 'phone', 'address', 'web form', 'other']),
  value: z.string().trim().min(1).max(500),
  label: z.string().trim().max(100).optional(),
});

function audit(db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  return recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });
}

// Classification in force now for one seller in the current account.
const CURRENT_CLASS = `LEFT JOIN LATERAL (
    SELECT c.class, c.effective_from FROM seller_classification c
     WHERE c.seller_id = s.id AND c.effective_from <= now() AND (c.effective_to IS NULL OR c.effective_to > now())
     ORDER BY c.effective_from DESC LIMIT 1) cur ON true`;

async function sellerName(db: Db, sellerId: string): Promise<string> {
  const row = (await db.query<{ name: string; source: string }>(
    'SELECT s.name, src.display_name AS source FROM seller s JOIN source src ON src.id = s.source_id WHERE s.id = $1',
    [sellerId],
  )).rows[0];
  if (!row) throw new HttpError(404, 'seller not found');
  return `${row.name} (${row.source})`;
}

export async function sellerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Params }>('/accounts/:accountId/sellers', { config: { permission: 'sellers.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query(
        `WITH mine AS (
           SELECT l.seller_id FROM listing_match m JOIN listing l ON l.id = m.listing_id WHERE l.seller_id IS NOT NULL
           UNION SELECT seller_id FROM seller_classification
           UNION SELECT seller_id FROM seller_contact)
         SELECT s.id, s.name, s.platform_seller_id, s.storefront_url, src.code AS source_code, src.display_name AS source,
                coalesce(cur.class, 'Unknown') AS classification, cur.effective_from AS class_since,
                (SELECT count(DISTINCT m.product_id) FROM listing_match m JOIN listing l ON l.id = m.listing_id
                  WHERE l.seller_id = s.id AND m.state = 'Included')::int AS tracked,
                (SELECT count(*) FROM listing_match m JOIN listing l ON l.id = m.listing_id WHERE l.seller_id = s.id)::int AS listings,
                (SELECT count(*) FROM seller_alias a WHERE a.seller_id = s.id)::int AS aliases,
                (SELECT count(*) FROM seller_contact c WHERE c.seller_id = s.id)::int AS contacts
           FROM mine JOIN seller s ON s.id = mine.seller_id
           JOIN source src ON src.id = s.source_id
           ${CURRENT_CLASS}
          ORDER BY s.name, src.display_name`,
      );
      return rows;
    }),
  );

  app.get<{ Params: SellerParams }>('/accounts/:accountId/sellers/:sellerId', { config: { permission: 'sellers.read' } }, async (req) => {
    const sellerId = uuidOr404(req.params.sellerId, 'seller');
    return withTenant(req.params.accountId, async (db) => {
      const s = (
        await db.query(
          `SELECT s.id, s.name, s.platform_seller_id, s.storefront_url, s.first_seen, src.code AS source_code, src.display_name AS source,
                  coalesce(cur.class, 'Unknown') AS classification
             FROM seller s JOIN source src ON src.id = s.source_id ${CURRENT_CLASS} WHERE s.id = $1`,
          [sellerId],
        )
      ).rows[0];
      if (!s) throw new HttpError(404, 'seller not found');
      const [history, aliases, links, contacts, listings] = [
        (await db.query(
          `SELECT c.id, c.class, c.effective_from AS "from", c.effective_to AS "to", c.note, coalesce(u.email, 'System') AS set_by
             FROM seller_classification c LEFT JOIN app_user u ON u.id = c.set_by
            WHERE c.seller_id = $1 ORDER BY c.effective_from DESC`, [sellerId])).rows,
        (await db.query('SELECT id, alias, created_at FROM seller_alias WHERE seller_id = $1 ORDER BY alias', [sellerId])).rows,
        (await db.query(
          `SELECT k.id, k.reason, k.confidence, o.id AS seller_id, o.name, src.display_name AS source
             FROM seller_link k
             JOIN seller o ON o.id = CASE WHEN k.seller_a = $1 THEN k.seller_b ELSE k.seller_a END
             JOIN source src ON src.id = o.source_id
            WHERE $1 IN (k.seller_a, k.seller_b) ORDER BY k.confidence DESC`, [sellerId])).rows,
        (await db.query('SELECT id, kind, value, label, created_at FROM seller_contact WHERE seller_id = $1 ORDER BY created_at', [sellerId])).rows,
        (await db.query(
          `SELECT l.id, l.url, m.state, p.product_code AS code, p.name AS product
             FROM listing_match m JOIN listing l ON l.id = m.listing_id LEFT JOIN product p ON p.id = m.product_id
            WHERE l.seller_id = $1 ORDER BY m.state, p.product_code LIMIT 200`, [sellerId])).rows,
      ];
      return { ...s, history, aliases, links, contacts, listings };
    });
  });

  app.post<{ Params: Params }>('/accounts/:accountId/sellers', { config: { permission: 'sellers.write' } }, async (req, reply) => {
    const b = parse(newSeller, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const source = (await db.query<{ id: string }>('SELECT id FROM source WHERE code = $1', [b.source])).rows[0];
      if (!source) throw new HttpError(400, `unknown source ${b.source}`);
      const sellerId = await resolveSeller(db, source.id, b.name, b.platformSellerId);
      if (!sellerId) throw new HttpError(400, 'the seller name is empty once "Sold by" and punctuation are removed');
      if (b.storefrontUrl) await db.query('UPDATE seller SET storefront_url = coalesce(storefront_url, $2) WHERE id = $1', [sellerId, b.storefrontUrl]);
      const existing = (await db.query('SELECT 1 FROM seller_classification WHERE seller_id = $1', [sellerId])).rowCount;
      if (existing) throw new HttpError(409, 'this seller is already on the list: change its classification instead');
      await db.query(
        `INSERT INTO seller_classification (account_id, seller_id, class, set_by, note) VALUES ($1, $2, $3, $4, $5)`,
        [req.params.accountId, sellerId, b.class, req.user!.sub, b.note ?? 'Added manually'],
      );
      await audit(db, req, {
        action: 'seller.added',
        entityType: 'seller',
        entityId: sellerId,
        summary: `Added seller ${await sellerName(db, sellerId)} as ${b.class}`,
        after: b,
      });
      return reply.code(201).send({ id: sellerId });
    });
  });

  // A classification change is a new effective-dated record; the one in force is closed.
  app.post<{ Params: SellerParams }>('/accounts/:accountId/sellers/:sellerId/classification', { config: { permission: 'sellers.write' } }, async (req, reply) => {
    const sellerId = uuidOr404(req.params.sellerId, 'seller');
    const b = parse(classify, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const label = await sellerName(db, sellerId);
      const from = b.from ? new Date(b.from) : new Date();
      const open = (
        await db.query<{ id: string; class: string; effective_from: Date }>(
          'SELECT id, class, effective_from FROM seller_classification WHERE seller_id = $1 AND effective_to IS NULL',
          [sellerId],
        )
      ).rows[0];
      if (open && from <= open.effective_from) throw new HttpError(409, `the class in force (${open.class}) starts ${open.effective_from.toISOString()}; a change must start after it`);
      if (open?.class === b.class) throw new HttpError(409, `${label} is already ${b.class}`);
      if (open) await db.query('UPDATE seller_classification SET effective_to = $2 WHERE id = $1', [open.id, from]);
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO seller_classification (account_id, seller_id, class, effective_from, set_by, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [req.params.accountId, sellerId, b.class, from, req.user!.sub, b.note],
        )
      ).rows[0].id;
      await audit(db, req, {
        action: 'seller.classified',
        entityType: 'seller',
        entityId: sellerId,
        summary: `${label}: ${open?.class ?? 'none'} → ${b.class} from ${from.toISOString().slice(0, 10)} ("${b.note}")`,
        before: open ? { class: open.class } : null,
        after: { class: b.class, from: from.toISOString(), note: b.note },
      });
      return reply.code(201).send({ id });
    });
  });

  app.post<{ Params: SellerParams }>('/accounts/:accountId/sellers/:sellerId/aliases', { config: { permission: 'sellers.write' } }, async (req, reply) => {
    const sellerId = uuidOr404(req.params.sellerId, 'seller');
    const b = parse(alias, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const label = await sellerName(db, sellerId);
      if (!(await addAlias(db, sellerId, b.alias))) throw new HttpError(409, `"${b.alias}" is another seller's name on this source: link the two sellers instead`);
      await ensureClassification(db, req.params.accountId, sellerId);
      await audit(db, req, { action: 'seller.alias_added', entityType: 'seller', entityId: sellerId, summary: `${label}: alias "${b.alias}"`, after: b });
      return reply.code(201).send({ ok: true });
    });
  });

  app.post<{ Params: SellerParams }>('/accounts/:accountId/sellers/:sellerId/links', { config: { permission: 'sellers.write' } }, async (req, reply) => {
    const sellerId = uuidOr404(req.params.sellerId, 'seller');
    const b = parse(link, req.body);
    if (b.otherSellerId === sellerId) throw new HttpError(400, 'a seller cannot be linked to itself');
    return withTenant(req.params.accountId, async (db) => {
      const [a, c] = [sellerId, b.otherSellerId].sort();
      const labels = [await sellerName(db, sellerId), await sellerName(db, b.otherSellerId)];
      const { rowCount } = await db.query(
        `INSERT INTO seller_link (seller_a, seller_b, reason, confidence, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [a, c, b.reason, b.confidence, req.user!.sub],
      );
      if (!rowCount) throw new HttpError(409, 'these sellers are already linked');
      await ensureClassification(db, req.params.accountId, sellerId);
      await audit(db, req, {
        action: 'seller.linked', entityType: 'seller', entityId: sellerId,
        summary: `Linked ${labels[0]} ↔ ${labels[1]} (${b.confidence}% — ${b.reason})`, after: b,
      });
      return reply.code(201).send({ ok: true });
    });
  });

  app.post<{ Params: SellerParams }>('/accounts/:accountId/sellers/:sellerId/contacts', { config: { permission: 'sellers.write' } }, async (req, reply) => {
    const sellerId = uuidOr404(req.params.sellerId, 'seller');
    const b = parse(contact, req.body);
    if (b.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.value)) throw new HttpError(400, 'that is not an email address');
    return withTenant(req.params.accountId, async (db) => {
      const label = await sellerName(db, sellerId);
      const id = (
        await db.query<{ id: string }>(
          'INSERT INTO seller_contact (account_id, seller_id, kind, value, label, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [req.params.accountId, sellerId, b.kind, b.value, b.label ?? null, req.user!.sub],
        )
      ).rows[0].id;
      await ensureClassification(db, req.params.accountId, sellerId);
      await audit(db, req, { action: 'seller.contact_added', entityType: 'seller', entityId: sellerId, summary: `${label}: ${b.kind} contact added`, after: b });
      return reply.code(201).send({ id });
    });
  });

  app.delete<{ Params: SellerParams & { contactId: string } }>(
    '/accounts/:accountId/sellers/:sellerId/contacts/:contactId',
    { config: { permission: 'sellers.write' } },
    async (req, reply) => {
      const sellerId = uuidOr404(req.params.sellerId, 'seller');
      const contactId = uuidOr404(req.params.contactId, 'contact');
      return withTenant(req.params.accountId, async (db) => {
        const { rows } = await db.query('DELETE FROM seller_contact WHERE id = $1 AND seller_id = $2 RETURNING kind, value, label', [contactId, sellerId]);
        if (!rows[0]) throw new HttpError(404, 'contact not found');
        await audit(db, req, {
          action: 'seller.contact_removed', entityType: 'seller', entityId: sellerId,
          summary: `${await sellerName(db, sellerId)}: ${rows[0].kind} contact removed`, before: rows[0],
        });
        return reply.code(204).send();
      });
    },
  );
}
