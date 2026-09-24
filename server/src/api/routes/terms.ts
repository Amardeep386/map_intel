// Terms and term groups: list, add, edit, generate from the catalogue, bulk import from CSV.
// Generate and import both run as a dry run first (dryRun: true) and only write on commit.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TERM_TYPES, type TermType } from '../../collector/catalogue.js';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant, type Db } from '../../lib/db.js';
import { parseTermImport, planGeneratedTerms, splitExisting, unknownTokens, type CatalogueProduct } from '../../lib/terms.js';
import { HttpError } from '../app.js';
import { loadGroups } from '../configData.js';
import { isUniqueViolation, parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
const termType = z.enum(TERM_TYPES as [TermType, ...TermType[]]);

const groupBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional() });
const groupPatch = groupBody.partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');

const termBody = z.object({
  type: termType,
  value: z.string().trim().min(1).max(500),
  groupId: z.string().uuid(),
  productCode: z.string().trim().max(64).optional(),
});
const termPatch = z
  .object({
    value: z.string().trim().min(1).max(500),
    active: z.boolean(),
    groupId: z.string().uuid(),
    productCode: z.string().trim().max(64).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

const listQuery = z.object({
  group: z.string().uuid().optional(),
  type: termType.optional(),
  q: z.string().trim().max(200).optional(),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const generateBody = z.object({
  dryRun: z.boolean().default(true),
  products: z.object({ category: z.string().trim().max(100).optional() }).default({}),
  template: z.string().trim().max(200).nullable().default('{Brand} {Product Name}'),
  identifierTypes: z.array(z.enum(['MPN', 'UPC', 'EAN', 'ASIN', 'BESTBUY_SKU', 'WALMART_ID'])).max(6).default([]),
  group: z.string().trim().min(1).max(120), // batch label = group name
});

const importBody = z.object({
  dryRun: z.boolean().default(true),
  csv: z.string().min(1).max(2_000_000),
  defaultGroup: z.string().trim().max(120).default('Imported terms'),
  batchLabel: z.string().trim().max(120).optional(),
});

async function groupByName(db: Db, accountId: string, name: string, userId: string): Promise<{ id: string; created: boolean }> {
  const found = await db.query<{ id: string }>('SELECT id FROM term_group WHERE lower(name) = lower($1)', [name]);
  if (found.rows[0]) return { id: found.rows[0].id, created: false };
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO term_group (account_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [accountId, name, userId],
  );
  return { id: rows[0].id, created: true };
}

async function productIdsByCode(db: Db): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; product_code: string }>('SELECT id, product_code FROM product');
  return new Map(rows.map((r) => [r.product_code.toLowerCase(), r.id]));
}

async function existingTerms(db: Db): Promise<{ type: string; value: string }[]> {
  return (await db.query<{ type: string; value: string }>('SELECT type, value FROM term')).rows;
}

interface NewTerm {
  groupId: string;
  type: TermType;
  value: string;
  productId: string | null;
}

/** Insert many terms in one statement; returns how many were created (duplicates are skipped). */
async function insertTerms(db: Db, accountId: string, terms: NewTerm[], batchLabel: string | null, userId: string): Promise<number> {
  if (!terms.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO term (account_id, group_id, type, value, product_id, batch_label, created_by)
     SELECT $1, g, t, v, p, $2, $3
       FROM unnest($4::uuid[], $5::text[], $6::text[], $7::uuid[]) AS x(g, t, v, p)
     ON CONFLICT (account_id, type, lower(value)) DO NOTHING`,
    [accountId, batchLabel, userId, terms.map((t) => t.groupId), terms.map((t) => t.type), terms.map((t) => t.value), terms.map((t) => t.productId)],
  );
  return rowCount ?? 0;
}

const TERM_SELECT = `
  SELECT t.id, t.type, t.value, t.active, t.batch_label, t.created_at, t.updated_at,
         g.id AS group_id, g.name AS group_name, p.product_code,
         coalesce(y.found_30d, 0) AS found_30d, coalesce(y.survived_30d, 0) AS survived_30d,
         coalesce(y.survived_90d, 0) AS survived_90d, coalesce(y.violations_30d, 0) AS violations_30d
    FROM term t
    JOIN term_group g ON g.id = t.group_id
    LEFT JOIN product p ON p.id = t.product_id
    LEFT JOIN term_yield y ON y.term_id = t.id`;

const termView = (r: Record<string, unknown>) => ({
  id: r.id,
  type: r.type,
  value: r.value,
  active: r.active,
  batchLabel: r.batch_label,
  group: { id: r.group_id, name: r.group_name },
  productCode: r.product_code ?? null,
  yield: {
    found30d: r.found_30d,
    survived30d: r.survived_30d,
    survivedPct: (r.found_30d as number) > 0 ? Math.round(((r.survived_30d as number) / (r.found_30d as number)) * 100) : null,
    violations30d: r.violations_30d,
    // A term that has run for 90 days without one surviving listing is a candidate to retire.
    retireCandidate: (r.survived_90d as number) === 0 && Date.now() - new Date(r.created_at as string).getTime() > 90 * 86_400_000,
  },
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function loadTerm(db: Db, termId: string) {
  const { rows } = await db.query(`${TERM_SELECT} WHERE t.id = $1`, [uuidOr404(termId, 'term')]);
  if (!rows[0]) throw new HttpError(404, 'term not found');
  return termView(rows[0]);
}

const audit = (db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<Parameters<typeof recordAudit>[1], 'accountId' | 'actor' | 'requestId'>) =>
  recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });

export async function termRoutes(app: FastifyInstance): Promise<void> {
  // ---- groups ----
  app.get<{ Params: Params }>('/accounts/:accountId/term-groups', { config: { permission: 'terms.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (await loadGroups(db)).map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        terms: g.terms,
        activeTerms: g.activeTerms,
        batchLabels: g.batchLabels,
        lastChanged: g.lastChanged,
        found30d: g.found30d,
        survived30d: g.survived30d,
      })),
    ),
  );

  app.post<{ Params: Params }>('/accounts/:accountId/term-groups', { config: { permission: 'terms.write' } }, async (req, reply) => {
    const b = parse(groupBody, req.body);
    const created = await withTenant(req.params.accountId, async (db) => {
      try {
        const { rows } = await db.query<{ id: string }>(
          'INSERT INTO term_group (account_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
          [req.params.accountId, b.name, b.description ?? null, req.user!.sub],
        );
        await audit(db, req, { action: 'term_group.created', entityType: 'term_group', entityId: rows[0].id, summary: `Created term group "${b.name}"`, after: b });
        return { id: rows[0].id, ...b };
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, `a term group named "${b.name}" already exists`);
        throw err;
      }
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: Params & { groupId: string } }>(
    '/accounts/:accountId/term-groups/:groupId',
    { config: { permission: 'terms.write' } },
    async (req) => {
      const b = parse(groupPatch, req.body);
      return withTenant(req.params.accountId, async (db) => {
        const id = uuidOr404(req.params.groupId, 'term group');
        const before = (await db.query('SELECT name, description FROM term_group WHERE id = $1', [id])).rows[0];
        if (!before) throw new HttpError(404, 'term group not found');
        const after = { name: b.name ?? before.name, description: b.description ?? before.description };
        try {
          await db.query('UPDATE term_group SET name = $2, description = $3 WHERE id = $1', [id, after.name, after.description]);
        } catch (err) {
          if (isUniqueViolation(err)) throw new HttpError(409, `a term group named "${after.name}" already exists`);
          throw err;
        }
        await audit(db, req, { action: 'term_group.updated', entityType: 'term_group', entityId: id, summary: `Changed term group "${after.name}"`, before, after });
        return { id, ...after };
      });
    },
  );

  app.delete<{ Params: Params & { groupId: string } }>(
    '/accounts/:accountId/term-groups/:groupId',
    { config: { permission: 'terms.write' } },
    async (req, reply) => {
      await withTenant(req.params.accountId, async (db) => {
        const id = uuidOr404(req.params.groupId, 'term group');
        const before = (
          await db.query('SELECT g.name, (SELECT count(*)::int FROM term t WHERE t.group_id = g.id) AS terms FROM term_group g WHERE g.id = $1', [id])
        ).rows[0];
        if (!before) throw new HttpError(404, 'term group not found');
        await db.query('DELETE FROM term_group WHERE id = $1', [id]);
        await audit(db, req, {
          action: 'term_group.deleted',
          entityType: 'term_group',
          entityId: id,
          summary: `Deleted term group "${before.name}" and its ${before.terms} terms`,
          before,
        });
      });
      return reply.code(204).send();
    },
  );

  // ---- terms ----
  app.get<{ Params: Params; Querystring: Record<string, string> }>('/accounts/:accountId/terms', { config: { permission: 'terms.read' } }, async (req) => {
    const q = parse(listQuery, req.query);
    return withTenant(req.params.accountId, async (db) => {
      const where = `WHERE ($1::uuid IS NULL OR t.group_id = $1)
                       AND ($2::text IS NULL OR t.type = $2)
                       AND ($3::text IS NULL OR t.value ILIKE '%' || $3 || '%' OR p.product_code ILIKE '%' || $3 || '%')
                       AND ($4::boolean IS NULL OR t.active = $4)`;
      const params = [q.group ?? null, q.type ?? null, q.q ?? null, q.active === undefined ? null : q.active === 'true'];
      const { rows } = await db.query(`${TERM_SELECT} ${where} ORDER BY lower(g.name), t.type, lower(t.value) LIMIT $5 OFFSET $6`, [
        ...params,
        q.limit,
        q.offset,
      ]);
      const total = (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM term t LEFT JOIN product p ON p.id = t.product_id ${where}`,
          params,
        )
      ).rows[0].n;
      return { terms: rows.map(termView), total, limit: q.limit, offset: q.offset };
    });
  });

  app.post<{ Params: Params }>('/accounts/:accountId/terms', { config: { permission: 'terms.write' } }, async (req, reply) => {
    const b = parse(termBody, req.body);
    const term = await withTenant(req.params.accountId, async (db) => {
      const group = (await db.query('SELECT id FROM term_group WHERE id = $1', [b.groupId])).rows[0];
      if (!group) throw new HttpError(400, 'term group not found');
      let productId: string | null = null;
      if (b.productCode) {
        productId = (await productIdsByCode(db)).get(b.productCode.toLowerCase()) ?? null;
        if (!productId) throw new HttpError(400, `unknown product ${b.productCode}`);
      }
      try {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO term (account_id, group_id, type, value, product_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [req.params.accountId, b.groupId, b.type, b.value, productId, req.user!.sub],
        );
        await audit(db, req, { action: 'term.created', entityType: 'term', entityId: rows[0].id, summary: `Added ${b.type} term "${b.value}"`, after: b });
        return loadTerm(db, rows[0].id);
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, `the ${b.type} term "${b.value}" already exists`);
        throw err;
      }
    });
    return reply.code(201).send(term);
  });

  app.patch<{ Params: Params & { termId: string } }>('/accounts/:accountId/terms/:termId', { config: { permission: 'terms.write' } }, async (req) => {
    const b = parse(termPatch, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const before = await loadTerm(db, req.params.termId);
      let productId: string | null | undefined;
      if (b.productCode !== undefined) {
        productId = b.productCode === null ? null : ((await productIdsByCode(db)).get(b.productCode.toLowerCase()) ?? undefined);
        if (productId === undefined) throw new HttpError(400, `unknown product ${b.productCode}`);
      }
      if (b.groupId && !(await db.query('SELECT 1 FROM term_group WHERE id = $1', [b.groupId])).rowCount) throw new HttpError(400, 'term group not found');
      try {
        await db.query(
          `UPDATE term SET value = coalesce($2, value), active = coalesce($3, active), group_id = coalesce($4, group_id),
                  product_id = CASE WHEN $5 THEN $6::uuid ELSE product_id END
            WHERE id = $1`,
          [before.id, b.value ?? null, b.active ?? null, b.groupId ?? null, productId !== undefined, productId ?? null],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, `the ${before.type} term "${b.value}" already exists`);
        throw err;
      }
      const after = await loadTerm(db, before.id as string);
      const change =
        b.active !== undefined && Object.keys(b).length === 1 ? `${b.active ? 'Activated' : 'Deactivated'} term "${before.value}"` : `Changed term "${before.value}"`;
      await audit(db, req, {
        action: 'term.updated',
        entityType: 'term',
        entityId: before.id as string,
        summary: change,
        before: { value: before.value, active: before.active, group: before.group.name, productCode: before.productCode },
        after: { value: after.value, active: after.active, group: after.group.name, productCode: after.productCode },
      });
      return after;
    });
  });

  app.delete<{ Params: Params & { termId: string } }>(
    '/accounts/:accountId/terms/:termId',
    { config: { permission: 'terms.write' } },
    async (req, reply) => {
      await withTenant(req.params.accountId, async (db) => {
        const before = await loadTerm(db, req.params.termId);
        await db.query('DELETE FROM term WHERE id = $1', [before.id]);
        await audit(db, req, {
          action: 'term.deleted',
          entityType: 'term',
          entityId: before.id as string,
          summary: `Deleted ${before.type} term "${before.value}"`,
          before: { type: before.type, value: before.value, group: before.group.name, productCode: before.productCode },
        });
      });
      return reply.code(204).send();
    },
  );

  // ---- generate from catalogue ----
  app.post<{ Params: Params }>('/accounts/:accountId/terms/generate', { config: { permission: 'terms.write' } }, async (req) => {
    const b = parse(generateBody, req.body);
    if (!b.template && !b.identifierTypes.length) throw new HttpError(400, 'choose a naming template, identifier types, or both');
    const bad = b.template ? unknownTokens(b.template) : [];
    if (bad.length) throw new HttpError(400, `unknown template tokens: ${bad.join(', ')}`);

    return withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.product_code, p.name, p.brand, p.model_number, p.category,
                coalesce(json_agg(json_build_object('type', i.type, 'value', i.value)) FILTER (WHERE i.id IS NOT NULL), '[]') AS identifiers
           FROM product p
           LEFT JOIN product_identifier i ON i.product_id = p.id
          WHERE p.status = 'Active' AND ($1::text IS NULL OR lower(p.category) = lower($1))
          GROUP BY p.id
          ORDER BY p.product_code`,
        [b.products.category ?? null],
      );
      const products: CatalogueProduct[] = rows.map((r) => ({
        id: r.id,
        code: r.product_code,
        name: r.name,
        brand: r.brand,
        model: r.model_number,
        category: r.category,
        identifiers: r.identifiers,
      }));
      const planned = planGeneratedTerms(products, { template: b.template, identifierTypes: b.identifierTypes });
      const { create, skipped } = splitExisting(planned, await existingTerms(db));
      const preview = {
        products: products.length,
        toCreate: create.length,
        alreadyExist: skipped.length,
        sample: create.slice(0, 25).map((t) => ({ type: t.type, value: t.value, productCode: t.productCode })),
        skippedSample: skipped.slice(0, 10).map((t) => ({ type: t.type, value: t.value, productCode: t.productCode })),
        group: b.group,
      };
      if (b.dryRun) return { dryRun: true, ...preview };

      const group = await groupByName(db, req.params.accountId, b.group, req.user!.sub);
      const created = await insertTerms(
        db,
        req.params.accountId,
        create.map((t) => ({ groupId: group.id, type: t.type, value: t.value, productId: t.productId })),
        b.group,
        req.user!.sub,
      );
      await audit(db, req, {
        action: 'terms.generated',
        entityType: 'term_group',
        entityId: group.id,
        summary: `Generated ${created} terms from the catalogue into "${b.group}"`,
        after: {
          group: b.group,
          groupCreated: group.created,
          template: b.template,
          identifierTypes: b.identifierTypes,
          category: b.products.category ?? 'all active',
          created,
          skipped: skipped.length,
        },
      });
      return { dryRun: false, ...preview, created, groupId: group.id };
    });
  });

  // ---- bulk import (CSV: type,value,product_code,group) ----
  app.post<{ Params: Params }>('/accounts/:accountId/terms/import', { config: { permission: 'terms.write' } }, async (req) => {
    const b = parse(importBody, req.body);
    const { rows, problems } = parseTermImport(b.csv, b.defaultGroup);
    const dataRows = rows.length + problems.length;
    return withTenant(req.params.accountId, async (db) => {
      const products = await productIdsByCode(db);
      const valid: typeof rows = [];
      for (const r of rows) {
        if (r.productCode && !products.has(r.productCode.toLowerCase())) problems.push({ line: r.line, reason: `unknown product ${r.productCode}`, raw: '' });
        else valid.push(r);
      }
      const { create, skipped } = splitExisting(valid, await existingTerms(db));
      const groups = [...new Set(create.map((r) => r.group))];
      const existingGroups = new Set((await db.query<{ name: string }>('SELECT lower(name) AS name FROM term_group')).rows.map((g) => g.name));
      const report = {
        rows: dataRows,
        toCreate: create.length,
        alreadyExist: skipped.map((r) => ({ line: r.line, type: r.type, value: r.value })),
        problems: problems.sort((a, c) => a.line - c.line),
        newGroups: groups.filter((g) => !existingGroups.has(g.toLowerCase())),
        perGroup: Object.fromEntries(groups.map((g) => [g, create.filter((r) => r.group === g).length])),
      };
      if (b.dryRun) return { dryRun: true, ...report };

      const groupIds = new Map<string, string>();
      for (const g of groups) groupIds.set(g, (await groupByName(db, req.params.accountId, g, req.user!.sub)).id);
      const batch = b.batchLabel ?? `Import ${new Date().toISOString().slice(0, 10)}`;
      const created = await insertTerms(
        db,
        req.params.accountId,
        create.map((r) => ({
          groupId: groupIds.get(r.group)!,
          type: r.type,
          value: r.value,
          productId: r.productCode ? (products.get(r.productCode.toLowerCase()) ?? null) : null,
        })),
        batch,
        req.user!.sub,
      );
      await audit(db, req, {
        action: 'terms.imported',
        entityType: 'term',
        summary: `Imported ${created} terms (${report.problems.length} rows with problems, ${skipped.length} already existed)`,
        after: { batch, created, perGroup: report.perGroup, newGroups: report.newGroups, problems: report.problems.length, alreadyExisted: skipped.length },
      });
      return { dryRun: false, ...report, created, batchLabel: batch };
    });
  });
}
