// Catalogue: products with identifiers (UPC, EAN, MPN, ASIN, alt SKU 1–6), product detail with
// MAP history and included listings, and file imports (products, MAP) that run as a dry run
// first and write only on commit.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import {
  extractRows, guessMapping, IMPORT_FIELDS, planMap, planProducts, readTable,
  type ColumnMapping, type ExistingProduct, type IdentifierOwners, type MapVersion, type ProductChange,
} from '../../lib/catalogueImport.js';
import { withTenant, type Db } from '../../lib/db.js';
import { HttpError } from '../app.js';
import { isUniqueViolation, parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };

const CATALOGUE_IMPORTS = ['products', 'map'] as const;

// Latest observation per included listing, looking back 30 days (keeps partition pruning effective).
const LATEST_OFFERS_SQL = `
  SELECT DISTINCT ON (o.listing_id)
         m.product_id, s.code AS source, s.display_name AS source_name, l.url, o.id AS observation_id,
         o.observed_at, o.status, o.advertised_price, o.list_price, o.availability, o.seller_name_raw
    FROM listing_match m
    JOIN listing l ON l.id = m.listing_id
    JOIN source s ON s.id = l.source_id
    JOIN observation o ON o.listing_id = l.id AND o.observed_at > now() - interval '30 days'
   WHERE m.state = 'Included' AND m.product_id = ANY($1::uuid[])
   ORDER BY o.listing_id, o.observed_at DESC`;

// MAP in force now (no region = the default MAP).
const MAP_NOW_SQL = `(SELECT mp.amount FROM map_price mp
    WHERE mp.product_id = p.id AND mp.region IS NULL AND mp.effective_from <= now()
      AND (mp.effective_to IS NULL OR mp.effective_to > now())
    ORDER BY mp.effective_from DESC LIMIT 1)`;

interface ProductRow {
  id: string;
  product_code: string;
  name: string;
  model_number: string | null;
  category: string | null;
  product_group: string | null;
  standard_price: number | null;
  status: string;
  map_amount: number | null;
  listings: number;
  identifiers: { type: string; value: string; slot: number | null }[];
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

const optionalText = (max: number) => z.string().trim().max(max).optional();
const identifiersBody = {
  upc: optionalText(14),
  ean: optionalText(14),
  asin: optionalText(10),
  // Alt SKU slots 1–6 in order: a value sets the slot, null or "" clears it, missing slots are left alone.
  alts: z.array(z.string().trim().max(64).nullable()).max(6).optional(),
};

const newProduct = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(300),
  model: z.string().trim().min(1).max(100),
  category: z.string().trim().max(100).optional().default(''),
  group: optionalText(100),
  map: z.coerce.number().positive().max(10_000_000).optional(),
  msrp: z.coerce.number().positive().max(10_000_000).optional(),
  ...identifiersBody,
});

const productPatch = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().max(100).optional(),
  group: z.string().trim().max(100).optional(),
  msrp: z.coerce.number().positive().max(10_000_000).nullable().optional(),
  status: z.enum(['Active', 'Paused', 'Retired']).optional(),
  ...identifiersBody,
});

const importBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1), // base64
  mapping: z.record(z.string(), z.number().int().min(0).nullable()).optional(),
  dryRun: z.boolean().default(true),
});

function audit(db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  return recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });
}

/** API shape of a product (the Product Summary row). */
function productView(p: ProductRow, offers: OfferRow[]) {
  const mine = offers.filter((o) => o.product_id === p.id);
  const priced = mine.filter((o) => o.advertised_price !== null).map((o) => o.advertised_price as number);
  const ids = (type: string) => p.identifiers.filter((i) => i.type === type).map((i) => i.value);
  const alts = Array.from({ length: 6 }, (_, i) => p.identifiers.find((x) => x.type === 'ALT' && x.slot === i + 1)?.value ?? null);
  return {
    id: p.id,
    code: p.product_code,
    name: p.name,
    model: p.model_number,
    category: p.category,
    group: p.product_group,
    map: p.map_amount,
    msrp: p.standard_price,
    current: priced.length ? Math.min(...priced) : null,
    violations: 0, // violations are computed from Phase 3
    status: p.status,
    listings: p.listings,
    upc: ids('UPC')[0] ?? null,
    ean: ids('EAN')[0] ?? null,
    asin: ids('ASIN')[0] ?? null,
    alts,
    identifiers: p.identifiers,
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
}

async function loadProducts(db: Db, where: string, params: unknown[]): Promise<ProductRow[]> {
  return (
    await db.query<ProductRow>(
      `SELECT p.id, p.product_code, p.name, p.model_number, p.category, p.product_group, p.standard_price, p.status,
              ${MAP_NOW_SQL} AS map_amount,
              (SELECT count(*) FROM listing_match m WHERE m.product_id = p.id AND m.state = 'Included')::int AS listings,
              coalesce((SELECT json_agg(json_build_object('type', i.type, 'value', i.value, 'slot', i.slot) ORDER BY i.type, i.slot, i.value)
                          FROM product_identifier i WHERE i.product_id = p.id), '[]') AS identifiers
         FROM product p
        WHERE ${where}
        ORDER BY p.product_code`,
      params,
    )
  ).rows;
}

/** Set a product's identifiers from a form or import. UPC / EAN / ASIN add a value; alt slots are replaced. */
async function writeIdentifiers(
  db: Db,
  accountId: string,
  productId: string,
  ids: { upc?: string | null; ean?: string | null; asin?: string | null; model?: string | null; alts?: (string | null | undefined)[] },
): Promise<void> {
  const add = async (type: string, value: string, slot: number | null = null) => {
    try {
      await db.query('SAVEPOINT ident');
      await db.query(
        `INSERT INTO product_identifier (account_id, product_id, type, value, slot) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [accountId, productId, type, value, slot],
      );
      await db.query('RELEASE SAVEPOINT ident');
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT ident');
      throw err;
    }
  };
  for (const [type, value] of [['UPC', ids.upc], ['EAN', ids.ean], ['ASIN', ids.asin?.toUpperCase()], ['MPN', ids.model]] as const) {
    if (value) await add(type, value);
  }
  for (const [i, value] of (ids.alts ?? []).entries()) {
    if (value === undefined) continue;
    await db.query(`DELETE FROM product_identifier WHERE product_id = $1 AND type = 'ALT' AND slot = $2`, [productId, i + 1]);
    if (value) await add('ALT', value, i + 1);
  }
}

/** Identifier values in the account and the SKU that owns each (for conflict checks). */
async function identifierOwners(db: Db): Promise<IdentifierOwners> {
  const { rows } = await db.query<{ type: string; value: string; code: string }>(
    `SELECT i.type, upper(i.value) AS value, p.product_code AS code FROM product_identifier i JOIN product p ON p.id = i.product_id`,
  );
  return new Map(rows.map((r) => [`${r.type}:${r.value}`, r.code]));
}

async function existingProducts(db: Db): Promise<ExistingProduct[]> {
  const rows = await loadProducts(db, 'true', []);
  return rows.map((p) => {
    const identifiers: Record<string, string[]> = {};
    for (const i of p.identifiers) {
      const key = i.type === 'ALT' ? `alt${i.slot}` : i.type.toLowerCase();
      (identifiers[key] ??= []).push(i.value);
    }
    return {
      id: p.id, code: p.product_code, name: p.name, model: p.model_number, category: p.category,
      group: p.product_group, msrp: p.standard_price, status: p.status, identifiers,
    };
  });
}

async function nextImportSeq(db: Db): Promise<number> {
  return (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM catalogue_import')).rows[0].n;
}

export const importCode = (seq: number) => `IMP-${String(seq).padStart(3, '0')}`;

async function applyProductChange(db: Db, accountId: string, brand: string, c: ProductChange): Promise<void> {
  const f = (k: string) => (c.fields[k] ? c.fields[k][1] : undefined);
  let productId = c.productId;
  if (c.kind === 'new') {
    productId = (
      await db.query<{ id: string }>(
        `INSERT INTO product (account_id, product_code, name, brand, category, model_number, product_group, standard_price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, 'Active')) RETURNING id`,
        [accountId, c.code, f('name'), brand, f('category') ?? null, f('model') ?? null, f('group') ?? null, f('msrp') ?? null, f('status') ?? null],
      )
    ).rows[0].id;
  } else {
    await db.query(
      `UPDATE product SET name = coalesce($2, name), model_number = coalesce($3, model_number), category = coalesce($4, category),
              product_group = coalesce($5, product_group), standard_price = coalesce($6, standard_price), status = coalesce($7, status)
        WHERE id = $1`,
      [productId, f('name') ?? null, f('model') ?? null, f('category') ?? null, f('group') ?? null, f('msrp') ?? null, f('status') ?? null],
    );
  }
  const alts = Array.from({ length: 6 }, (_, i) => f(`alt${i + 1}`) as string | undefined);
  await writeIdentifiers(db, accountId, productId!, {
    upc: f('upc') as string | undefined, ean: f('ean') as string | undefined, asin: f('asin') as string | undefined,
    model: f('model') as string | undefined, alts,
  });
}

/** MAP versions with dates in the account's time zone (YYYY-MM-DD). */
async function mapVersions(db: Db): Promise<MapVersion[]> {
  const { rows } = await db.query<{ id: string; product_id: string; region: string | null; amount: number; from: string; to: string | null }>(
    `SELECT mp.id, mp.product_id, mp.region, mp.amount,
            to_char(mp.effective_from AT TIME ZONE a.timezone, 'YYYY-MM-DD') AS from,
            to_char(mp.effective_to AT TIME ZONE a.timezone, 'YYYY-MM-DD') AS to
       FROM map_price mp JOIN account a ON a.id = mp.account_id`,
  );
  return rows.map((r) => ({ id: r.id, productId: r.product_id, region: r.region, amount: r.amount, from: r.from, to: r.to }));
}

/** A date (YYYY-MM-DD) as the start of that day in the account's time zone. */
export const DAY_START_SQL = (param: string) => `(${param}::date)::timestamp AT TIME ZONE (SELECT timezone FROM account WHERE id = app_current_account())`;

export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  // ---- products ----
  app.get<{ Params: Params; Querystring: { retired?: string } }>('/accounts/:accountId/products', { config: { permission: 'catalogue.read' } }, async (req) => {
    const showRetired = req.query.retired === '1' || req.query.retired === 'true';
    return withTenant(req.params.accountId, async (db) => {
      const products = await loadProducts(db, showRetired ? 'true' : "p.status <> 'Retired'", []);
      const offers = (await db.query<OfferRow>(LATEST_OFFERS_SQL, [products.map((p) => p.id)])).rows;
      return products.map((p) => productView(p, offers));
    });
  });

  app.get<{ Params: Params & { productId: string } }>('/accounts/:accountId/products/:productId', { config: { permission: 'catalogue.read' } }, async (req) => {
    const productId = uuidOr404(req.params.productId, 'product');
    return withTenant(req.params.accountId, async (db) => {
      const [p] = await loadProducts(db, 'p.id = $1', [productId]);
      if (!p) throw new HttpError(404, 'product not found');
      const offers = (await db.query<OfferRow>(LATEST_OFFERS_SQL, [[p.id]])).rows;
      const mapHistory = (
        await db.query(
          `SELECT mp.id, mp.amount, mp.currency, mp.region, mp.effective_from AS "from", mp.effective_to AS "to", mp.source, mp.note,
                  ci.seq AS import_seq, row_number() OVER (PARTITION BY coalesce(mp.region, '') ORDER BY mp.effective_from)::int AS version
             FROM map_price mp LEFT JOIN catalogue_import ci ON ci.id = mp.import_id
            WHERE mp.product_id = $1
            ORDER BY mp.region NULLS FIRST, mp.effective_from DESC`,
          [p.id],
        )
      ).rows.map((m) => ({ ...m, importCode: m.import_seq ? importCode(m.import_seq) : null }));
      const listings = (
        await db.query(
          `SELECT l.id, l.url, s.display_name AS source, coalesce(sl.name, c.seller_name) AS seller, m.state, m.confidence, m.state_since,
                  c.price AS candidate_price
             FROM listing_match m
             JOIN listing l ON l.id = m.listing_id
             JOIN source s ON s.id = l.source_id
             LEFT JOIN seller sl ON sl.id = l.seller_id
             LEFT JOIN match_candidate c ON c.id = m.candidate_id
            WHERE m.product_id = $1 AND m.state = 'Included'
            ORDER BY s.display_name, l.url`,
          [p.id],
        )
      ).rows;
      return { ...productView(p, offers), mapHistory, includedListings: listings };
    });
  });

  app.post<{ Params: Params }>('/accounts/:accountId/products', { config: { permission: 'catalogue.write' } }, async (req, reply) => {
    const { accountId } = req.params;
    const b = parse(newProduct, req.body);
    const created = await withTenant(accountId, async (db) => {
      const brand = (await db.query<{ brand: string }>('SELECT brand FROM account WHERE id = $1', [accountId])).rows[0]?.brand;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO product (account_id, product_code, name, brand, category, model_number, standard_price, product_group)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (account_id, product_code) DO NOTHING
         RETURNING id`,
        [accountId, b.code, b.name, brand ?? '', b.category || null, b.model, b.msrp ?? null, b.group || null],
      );
      if (!rows[0]) throw new HttpError(409, `SKU ${b.code} already exists`);
      try {
        await writeIdentifiers(db, accountId, rows[0].id, { upc: b.upc, ean: b.ean, asin: b.asin, model: b.model, alts: b.alts });
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, 'an identifier is already used by this product');
        throw err;
      }
      if (b.map) {
        await db.query(
          `INSERT INTO map_price (account_id, product_id, amount, source, created_by) VALUES ($1, $2, $3, 'manual', $4)`,
          [accountId, rows[0].id, b.map, req.user!.sub],
        );
      }
      await audit(db, req, {
        action: 'product.created',
        entityType: 'product',
        entityId: rows[0].id,
        summary: `Added SKU ${b.code}`,
        after: { code: b.code, name: b.name, model: b.model, category: b.category || null, group: b.group ?? null, msrp: b.msrp ?? null, map: b.map ?? null, upc: b.upc ?? null, ean: b.ean ?? null, asin: b.asin ?? null, alts: b.alts ?? [] },
      });
      const [p] = await loadProducts(db, 'p.id = $1', [rows[0].id]);
      return productView(p, []);
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: Params & { productId: string } }>('/accounts/:accountId/products/:productId', { config: { permission: 'catalogue.write' } }, async (req) => {
    const productId = uuidOr404(req.params.productId, 'product');
    const b = parse(productPatch, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const [before] = await loadProducts(db, 'p.id = $1', [productId]);
      if (!before) throw new HttpError(404, 'product not found');
      await db.query(
        `UPDATE product SET name = coalesce($2, name), model_number = coalesce($3, model_number),
                category = CASE WHEN $4::text IS NULL THEN category ELSE nullif($4, '') END,
                product_group = CASE WHEN $5::text IS NULL THEN product_group ELSE nullif($5, '') END,
                standard_price = CASE WHEN $6::boolean THEN $7 ELSE standard_price END,
                status = coalesce($8, status)
          WHERE id = $1`,
        [productId, b.name ?? null, b.model ?? null, b.category ?? null, b.group ?? null, b.msrp !== undefined, b.msrp ?? null, b.status ?? null],
      );
      await writeIdentifiers(db, req.params.accountId, productId, { upc: b.upc, ean: b.ean, asin: b.asin, model: b.model, alts: b.alts });
      const [after] = await loadProducts(db, 'p.id = $1', [productId]);
      const view = (p: ProductRow) => {
        const v = productView(p, []);
        return { name: v.name, model: v.model, category: v.category, group: v.group, msrp: v.msrp, status: v.status, upc: v.upc, ean: v.ean, asin: v.asin, alts: v.alts };
      };
      await audit(db, req, {
        action: 'product.updated',
        entityType: 'product',
        entityId: productId,
        summary: `Edited SKU ${before.product_code}`,
        before: view(before),
        after: view(after),
      });
      return productView(after, []);
    });
  });

  // ---- imports ----
  app.get<{ Params: Params }>('/accounts/:accountId/imports', { config: { permission: 'catalogue.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (
        await db.query(
          `SELECT id, seq, kind, file_name, summary, created_at FROM catalogue_import ORDER BY seq DESC LIMIT 200`,
        )
      ).rows.map((r) => ({ ...r, code: importCode(r.seq) })),
    ),
  );

  app.post<{ Params: Params & { kind: string } }>(
    '/accounts/:accountId/imports/:kind',
    { config: { permission: 'catalogue.write' }, bodyLimit: 15 * 1024 * 1024 },
    async (req) => {
      // Listing candidates are imported through the Mapping Center (mapping.write).
      const kind = CATALOGUE_IMPORTS.find((k) => k === req.params.kind);
      if (!kind) throw new HttpError(404, 'unknown import kind');
      const b = parse(importBody, req.body);
      let table: string[][];
      try {
        table = await readTable(b.fileName, b.content);
      } catch (err) {
        throw new HttpError(400, `could not read ${b.fileName}: ${(err as Error).message}`);
      }
      if (table.length < 2) throw new HttpError(400, 'the file has no data rows under its header');
      if (table.length > 20_001) throw new HttpError(400, 'the file has more than 20,000 rows: split it');
      const header = table[0];
      const mapping: ColumnMapping = b.mapping ? { ...guessMapping(kind, header), ...b.mapping } : guessMapping(kind, header);
      for (const [field, idx] of Object.entries(mapping)) {
        if (idx !== null && (idx < 0 || idx >= header.length)) throw new HttpError(400, `column ${idx} for ${field} is not in the file`);
      }
      const { rows, problems } = extractRows(kind, table, mapping);
      const meta = {
        fileName: b.fileName,
        header,
        fields: IMPORT_FIELDS[kind].map((f) => ({ key: f.key, label: f.label, required: f.required })),
        mapping,
        rows: table.length - 1,
        preview: table.slice(1, 6),
      };

      return withTenant(req.params.accountId, async (db) => {
        const accountId = req.params.accountId;
        if (kind === 'products') {
          const plan = planProducts(rows, await existingProducts(db), await identifierOwners(db));
          const allProblems = [...problems, ...plan.problems].sort((a, c) => a.line - c.line);
          const summary = {
            new: plan.changes.filter((c) => c.kind === 'new').length,
            changed: plan.changes.filter((c) => c.kind === 'changed').length,
            unchanged: plan.unchanged,
            errors: allProblems.length,
          };
          const result = { ...meta, dryRun: b.dryRun, summary, changes: plan.changes, problems: allProblems };
          if (b.dryRun || !plan.changes.length) return result;
          const brand = (await db.query<{ brand: string }>('SELECT brand FROM account WHERE id = $1', [accountId])).rows[0].brand;
          for (const c of plan.changes) await applyProductChange(db, accountId, brand, c);
          const seq = await nextImportSeq(db);
          const id = (
            await db.query<{ id: string }>(
              `INSERT INTO catalogue_import (account_id, seq, kind, file_name, mapping, summary, created_by) VALUES ($1, $2, 'products', $3, $4, $5, $6) RETURNING id`,
              [accountId, seq, b.fileName, JSON.stringify(mapping), JSON.stringify(summary), req.user!.sub],
            )
          ).rows[0].id;
          await audit(db, req, {
            action: 'catalogue.imported',
            entityType: 'catalogue_import',
            entityId: id,
            summary: `Import ${importCode(seq)} (${b.fileName}): ${summary.new} new SKUs, ${summary.changed} changed, ${summary.errors} rows skipped`,
            after: { ...summary, codes: plan.changes.map((c) => c.code).slice(0, 500) },
          });
          return { ...result, importId: id, importCode: importCode(seq) };
        }

        if (kind === 'map') {
          const products = new Map(
            (await db.query<{ code: string; id: string }>('SELECT lower(product_code) AS code, id FROM product')).rows.map((r) => [r.code, r.id]),
          );
          const plan = planMap(rows, products, await mapVersions(db));
          const allProblems = [...problems, ...plan.problems].sort((a, c) => a.line - c.line);
          const summary = { newVersions: plan.changes.length, unchanged: plan.unchanged, unknownSkus: plan.unknown.length, errors: allProblems.length };
          const result = { ...meta, dryRun: b.dryRun, summary, changes: plan.changes, unknown: plan.unknown, problems: allProblems };
          if (b.dryRun || !plan.changes.length) return result;
          const seq = await nextImportSeq(db);
          const importId = (
            await db.query<{ id: string }>(
              `INSERT INTO catalogue_import (account_id, seq, kind, file_name, mapping, summary, created_by) VALUES ($1, $2, 'map', $3, $4, $5, $6) RETURNING id`,
              [accountId, seq, b.fileName, JSON.stringify(mapping), JSON.stringify(summary), req.user!.sub],
            )
          ).rows[0].id;
          for (const c of plan.changes) {
            if (c.closes) {
              await db.query(`UPDATE map_price SET effective_to = ${DAY_START_SQL('$2')} WHERE id = $1 AND effective_to IS NULL`, [c.closes.id, c.from]);
            }
            await db.query(
              `INSERT INTO map_price (account_id, product_id, amount, region, effective_from, effective_to, source, import_id, note, created_by)
               VALUES ($1, $2, $3, $4, ${DAY_START_SQL('$5')}, CASE WHEN $6::text IS NULL THEN NULL ELSE ${DAY_START_SQL('$6')} END, 'import', $7, $8, $9)`,
              [accountId, c.productId, c.amount, c.region, c.from, c.to, importId, c.note, req.user!.sub],
            );
          }
          await audit(db, req, {
            action: 'map.imported',
            entityType: 'catalogue_import',
            entityId: importId,
            summary: `Import ${importCode(seq)} (${b.fileName}): ${summary.newVersions} new MAP versions, ${summary.unknownSkus} unknown SKUs, ${summary.errors} rows skipped`,
            after: { ...summary, versions: plan.changes.map((c) => ({ code: c.code, region: c.region, amount: c.amount, from: c.from, closes: c.closes?.amount ?? null })).slice(0, 500) },
          });
          return { ...result, importId, importCode: importCode(seq) };
        }

        throw new HttpError(404, 'unknown import kind');
      });
    },
  );

}
