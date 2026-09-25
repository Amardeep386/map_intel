// Mapping Center: KPIs, the review queue (lowest confidence x deepest discount first), listings
// per state, a listing's history, decisions (include / exclude with reason + scope / restore /
// retire), rules, suppressions, and importing candidate listings from a file.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { extractRows, guessMapping, IMPORT_FIELDS, parseMoney, readTable, type ColumnMapping, type Problem, type RawRow } from '../../lib/catalogueImport.js';
import { withTenant, type Db } from '../../lib/db.js';
import {
  applyRules, decideListings, EXCLUSION_REASONS, EXCLUSION_SCOPES, LISTING_STATES, loadMatchContext, MappingError, revokeSuppression,
  stageCandidate, upsertListing, type Actor,
} from '../../lib/mapping.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';
import { importCode } from './catalogue.js';

type Params = { accountId: string };

const decisionBody = z.object({
  listingIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['include', 'exclude', 'restore', 'retire']),
  productId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(200).optional(),
  scope: z.enum(EXCLUSION_SCOPES).optional(),
  urlPattern: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});

const importBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1),
  mapping: z.record(z.string(), z.number().int().min(0).nullable()).optional(),
  dryRun: z.boolean().default(true),
});

const SCOPE_LABEL: Record<string, string> = { listing: 'This listing', seller_product: 'Seller + product', url_pattern: 'URL pattern', source: 'Source' };

function audit(db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  return recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });
}

function userActor(req: FastifyRequest): Actor {
  return { type: 'user', id: req.user!.sub, label: req.user!.email };
}

// One row per listing with what the Mapping Center shows.
const LISTING_SELECT = `
  SELECT l.id, l.url, l.origin, l.channel_sku, s.code AS source_code, s.display_name AS source,
         coalesce(sl.name, c.seller_name) AS seller, l.seller_id,
         m.state, m.confidence, m.priority, m.decided_by, m.reason, m.scope, m.state_since, m.suppression_id,
         coalesce(u.email, CASE m.decided_by WHEN 'auto' THEN 'Matcher' WHEN 'rule' THEN 'Auto Rule' WHEN 'suppression' THEN 'Suppression'
                                           WHEN 'seed' THEN 'Seed' ELSE NULL END) AS decided_label,
         r.code AS rule_code,
         p.id AS product_id, p.product_code, p.name AS product_name,
         c.id AS candidate_id, c.title, c.price, c.condition, c.listing_format, c.image_url, c.created_at AS seen_at
    FROM listing_match m
    JOIN listing l ON l.id = m.listing_id
    JOIN source s ON s.id = l.source_id
    LEFT JOIN seller sl ON sl.id = l.seller_id
    LEFT JOIN match_candidate c ON c.id = m.candidate_id
    LEFT JOIN product p ON p.id = m.product_id
    LEFT JOIN match_rule r ON r.id = m.rule_id
    LEFT JOIN app_user u ON u.id = m.decided_user`;

async function signalsFor(db: Db, candidateIds: string[]) {
  if (!candidateIds.length) return new Map<string, unknown[]>();
  const { rows } = await db.query<{ candidate_id: string; signal: string; score: number | null; weight: number; passed: boolean | null; detail: string }>(
    `SELECT candidate_id, signal, score, weight, passed, detail FROM match_signal WHERE candidate_id = ANY($1::uuid[])
      ORDER BY array_position(ARRAY['identifier','title','image','price','attributes','prior'], signal)`,
    [candidateIds],
  );
  const out = new Map<string, unknown[]>();
  for (const r of rows) {
    const list = out.get(r.candidate_id) ?? [];
    list.push({ signal: r.signal, score: r.score, weight: r.weight, passed: r.passed, detail: r.detail });
    out.set(r.candidate_id, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Listing import (candidates from a file)
// ---------------------------------------------------------------------------

interface ListingRow {
  line: number;
  url: string;
  sourceId: string;
  sourceCode: string;
  title: string | null;
  price: number | null;
  seller: string | null;
  condition: string | null;
  format: string | null;
  image: string | null;
  channelSku: string | null;
  productId: string | null;
  known: string | null; // current state when the account already has this listing
}

async function planListingImport(db: Db, rows: RawRow[]): Promise<{ changes: ListingRow[]; problems: Problem[]; summary: Record<string, number> }> {
  const sources = (await db.query<{ id: string; code: string; display_name: string; base_url: string }>('SELECT id, code, display_name, base_url FROM source')).rows;
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const products = new Map((await db.query<{ code: string; id: string }>('SELECT lower(product_code) AS code, id FROM product')).rows.map((r) => [r.code, r.id]));
  const problems: Problem[] = [];
  const changes: ListingRow[] = [];
  const seen = new Set<string>();
  for (const { line, values: v } of rows) {
    const errs: string[] = [];
    if (!/^https?:\/\/\S+$/i.test(v.url)) errs.push('the URL must start with http:// or https://');
    let source = v.source
      ? sources.find((s) => s.code.toLowerCase() === v.source.toLowerCase() || s.display_name.toLowerCase() === v.source.toLowerCase())
      : undefined;
    if (v.source && !source) errs.push(`unknown source "${v.source}"`);
    source ??= sources.find((s) => hostOf(s.base_url) && hostOf(v.url).endsWith(hostOf(s.base_url)));
    if (!source && !errs.length) errs.push('no source given and the URL is not on a known source');
    const price = parseMoney(v.price ?? '');
    if (Number.isNaN(price) || (price !== null && price <= 0)) errs.push(`price "${v.price}" is not a positive amount`);
    const productId = v.product ? products.get(v.product.toLowerCase()) ?? null : null;
    if (v.product && !productId) errs.push(`unknown SKU ${v.product}`);
    const key = `${source?.id}|${v.url}`;
    if (seen.has(key)) errs.push('this URL appears more than once in the file');
    seen.add(key);
    if (errs.length) {
      problems.push({ line, reason: errs.join('; ') });
      continue;
    }
    changes.push({
      line, url: v.url, sourceId: source!.id, sourceCode: source!.code, title: v.title || null, price, seller: v.seller || null,
      condition: v.condition || null, format: v.format || null, image: v.image || null, channelSku: v.channelSku || null, productId, known: null,
    });
  }
  if (changes.length) {
    const known = (
      await db.query<{ source_id: string; url: string; state: string }>(
        `SELECT l.source_id, l.url, m.state FROM listing l JOIN listing_match m ON m.listing_id = l.id
          WHERE (l.source_id, l.url) IN (SELECT * FROM unnest($1::uuid[], $2::text[]))`,
        [changes.map((c) => c.sourceId), changes.map((c) => c.url)],
      )
    ).rows;
    for (const k of known) {
      const c = changes.find((x) => x.sourceId === k.source_id && x.url === k.url);
      if (c) c.known = k.state;
    }
  }
  return {
    changes,
    problems,
    summary: { newListings: changes.filter((c) => !c.known).length, alreadyKnown: changes.filter((c) => c.known).length },
  };
}

export async function mappingRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/mapping';

  app.get<{ Params: Params }>(`${base}/summary`, { config: { permission: 'mapping.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const counts = (
        await db.query<{ state: string; n: number }>('SELECT state, count(*)::int AS n FROM listing_match GROUP BY state')
      ).rows;
      const today = (
        await db.query<{ staged_today: number; auto_included: number; auto_excluded: number; decided_today: number }>(
          `SELECT
             (SELECT count(DISTINCT listing_id) FROM match_candidate WHERE created_at >= date_trunc('day', now()) AND origin <> 'rescore')::int AS staged_today,
             (SELECT count(*) FROM listing_state_event WHERE created_at >= date_trunc('day', now()) AND to_state = 'Included' AND actor_type IN ('auto', 'rule'))::int AS auto_included,
             (SELECT count(*) FROM listing_state_event WHERE created_at >= date_trunc('day', now()) AND to_state = 'Excluded' AND actor_type IN ('auto', 'rule', 'suppression'))::int AS auto_excluded,
             (SELECT count(*) FROM listing_state_event WHERE created_at >= date_trunc('day', now()) AND is_label)::int AS decided_today`,
        )
      ).rows[0];
      const settings = (await db.query<{ settings: Record<string, unknown> }>('SELECT settings FROM account WHERE id = $1', [req.params.accountId])).rows[0].settings;
      const suppressions = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM suppression WHERE revoked_at IS NULL')).rows[0].n;
      return {
        states: Object.fromEntries(LISTING_STATES.map((s) => [s, counts.find((c) => c.state === s)?.n ?? 0])),
        today,
        suppressions,
        thresholds: { include: Number(settings.match_include ?? 90), review: Number(settings.match_review ?? 60) },
        reasons: EXCLUSION_REASONS,
        scopes: EXCLUSION_SCOPES.map((s) => ({ id: s, label: SCOPE_LABEL[s] })),
      };
    }),
  );

  // The review queue: Staged listings, highest priority first, with signals and the proposed product.
  app.get<{ Params: Params; Querystring: { limit?: string } }>(`${base}/queue`, { config: { permission: 'mapping.read' } }, async (req) => {
    const limit = Math.min(Number.parseInt(req.query.limit ?? '50', 10) || 50, 200);
    return withTenant(req.params.accountId, async (db) => {
      const rows = (await db.query(`${LISTING_SELECT} WHERE m.state = 'Staged' ORDER BY m.priority DESC, m.confidence ASC, l.id LIMIT $1`, [limit])).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listing_match WHERE state = 'Staged'`)).rows[0].n;
      const signals = await signalsFor(db, rows.map((r) => r.candidate_id).filter(Boolean));
      const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
      const products = new Map(
        (
          await db.query(
            `SELECT p.id, p.product_code AS code, p.name, p.model_number AS model, p.standard_price AS msrp,
                    (SELECT mp.amount FROM map_price mp WHERE mp.product_id = p.id AND mp.region IS NULL AND mp.effective_from <= now()
                        AND (mp.effective_to IS NULL OR mp.effective_to > now()) ORDER BY mp.effective_from DESC LIMIT 1) AS map,
                    (SELECT i.value FROM product_identifier i WHERE i.product_id = p.id AND i.type = 'UPC' LIMIT 1) AS upc,
                    (SELECT i.value FROM product_identifier i WHERE i.product_id = p.id AND i.type = 'ASIN' LIMIT 1) AS asin
               FROM product p WHERE p.id = ANY($1::uuid[])`,
            [productIds],
          )
        ).rows.map((p) => [p.id, p]),
      );
      return {
        total,
        items: rows.map((r) => ({ ...r, signals: signals.get(r.candidate_id) ?? [], proposed: r.product_id ? products.get(r.product_id) : null })),
      };
    });
  });

  app.get<{ Params: Params; Querystring: { state?: string; q?: string; limit?: string; offset?: string } }>(
    `${base}/listings`,
    { config: { permission: 'mapping.read' } },
    async (req) => {
      const state = LISTING_STATES.find((s) => s.toLowerCase() === (req.query.state ?? 'staged').toLowerCase());
      if (!state) throw new HttpError(400, `state must be one of ${LISTING_STATES.join(', ')}`);
      const limit = Math.min(Number.parseInt(req.query.limit ?? '100', 10) || 100, 500);
      const offset = Math.max(Number.parseInt(req.query.offset ?? '0', 10) || 0, 0);
      const q = req.query.q?.trim() ? `%${req.query.q.trim()}%` : null;
      return withTenant(req.params.accountId, async (db) => {
        const where = `WHERE m.state = $1 AND ($2::text IS NULL OR l.url ILIKE $2 OR c.title ILIKE $2 OR coalesce(sl.name, c.seller_name) ILIKE $2
                          OR p.product_code ILIKE $2 OR p.name ILIKE $2)`;
        const order = state === 'Staged' ? 'm.priority DESC, m.confidence ASC' : 'm.state_since DESC';
        const rows = (await db.query(`${LISTING_SELECT} ${where} ORDER BY ${order}, l.id LIMIT $3 OFFSET $4`, [state, q, limit, offset])).rows;
        const total = (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM listing_match m JOIN listing l ON l.id = m.listing_id LEFT JOIN seller sl ON sl.id = l.seller_id
               LEFT JOIN match_candidate c ON c.id = m.candidate_id LEFT JOIN product p ON p.id = m.product_id ${where}`,
            [state, q],
          )
        ).rows[0].n;
        return { total, items: rows };
      });
    },
  );

  app.get<{ Params: Params & { listingId: string } }>(`${base}/listings/:listingId`, { config: { permission: 'mapping.read' } }, async (req) => {
    const listingId = uuidOr404(req.params.listingId, 'listing');
    return withTenant(req.params.accountId, async (db) => {
      const row = (await db.query(`${LISTING_SELECT} WHERE m.listing_id = $1`, [listingId])).rows[0];
      if (!row) throw new HttpError(404, 'listing not found');
      const history = (
        await db.query(
          `SELECT e.from_state, e.to_state, e.actor_type, e.actor_label, e.reason, e.scope, e.confidence, e.is_label, e.created_at,
                  p.product_code
             FROM listing_state_event e LEFT JOIN product p ON p.id = e.product_id
            WHERE e.listing_id = $1 ORDER BY e.created_at DESC`,
          [listingId],
        )
      ).rows;
      const signals = row.candidate_id ? (await signalsFor(db, [row.candidate_id])).get(row.candidate_id) ?? [] : [];
      return { ...row, signals, history };
    });
  });

  app.post<{ Params: Params }>(`${base}/decisions`, { config: { permission: 'mapping.write' } }, async (req) => {
    const b = parse(decisionBody, req.body);
    return withTenant(req.params.accountId, async (db) => {
      let result;
      try {
        result = await decideListings(db, req.params.accountId, { ...b, listingIds: [...new Set(b.listingIds)] }, userActor(req));
      } catch (err) {
        if (err instanceof MappingError) throw new HttpError(err.statusCode, err.message);
        throw err;
      }
      const verb = { include: 'Included', exclude: 'Excluded', restore: 'Restored', retire: 'Retired' }[b.action];
      const detail = b.action === 'exclude' ? ` (${b.reason}, ${SCOPE_LABEL[b.scope ?? 'listing']})` : '';
      await audit(db, req, {
        action: `mapping.${verb.toLowerCase()}`,
        entityType: 'listing',
        entityId: b.listingIds.length === 1 ? b.listingIds[0] : null,
        summary: `${verb} ${result.updated} listing${result.updated === 1 ? '' : 's'}${detail}${result.suppression ? ` → suppression ${result.suppression.code}${result.suppression.alsoExcluded ? `, ${result.suppression.alsoExcluded} more excluded` : ''}` : ''}`,
        after: { ...b, suppression: result.suppression },
      });
      return result;
    });
  });

  app.post<{ Params: Params }>(`${base}/apply-rules`, { config: { permission: 'mapping.write' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const r = await applyRules(db, req.params.accountId);
      await audit(db, req, {
        action: 'mapping.rules_applied',
        entityType: 'match_rule',
        summary: `Applied rules to ${r.checked} staged listings: ${r.included} included, ${r.excluded} excluded, ${r.staged} left for review`,
        after: r,
      });
      return r;
    }),
  );

  app.get<{ Params: Params }>(`${base}/rules`, { config: { permission: 'mapping.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (await db.query('SELECT id, code, name, kind, condition, reason, priority, active, is_default, hits, updated_at FROM match_rule ORDER BY priority')).rows,
    ),
  );

  app.patch<{ Params: Params & { ruleId: string } }>(`${base}/rules/:ruleId`, { config: { permission: 'mapping.write' } }, async (req) => {
    const ruleId = uuidOr404(req.params.ruleId, 'rule');
    const b = parse(z.object({ active: z.boolean() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query<{ code: string }>('UPDATE match_rule SET active = $2 WHERE id = $1 RETURNING code', [ruleId, b.active]);
      if (!rows[0]) throw new HttpError(404, 'rule not found');
      await audit(db, req, {
        action: 'match_rule.updated', entityType: 'match_rule', entityId: ruleId,
        summary: `${b.active ? 'Switched on' : 'Switched off'} rule ${rows[0].code}`, before: { active: !b.active }, after: b,
      });
      return { ok: true };
    });
  });

  app.get<{ Params: Params }>(`${base}/suppressions`, { config: { permission: 'mapping.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const { rows } = await db.query(
        `SELECT x.id, x.seq, x.reason, x.scope, x.url_pattern, x.note, x.hits, x.created_at, x.revoked_at,
                coalesce(u.email, 'System') AS created_by, s.display_name AS source, coalesce(sl.name, x.seller_name) AS seller,
                p.product_code, l.url AS listing_url
           FROM suppression x
           LEFT JOIN app_user u ON u.id = x.created_by
           LEFT JOIN source s ON s.id = x.source_id
           LEFT JOIN seller sl ON sl.id = x.seller_id
           LEFT JOIN product p ON p.id = x.product_id
           LEFT JOIN listing l ON l.id = x.listing_id
          ORDER BY x.revoked_at NULLS FIRST, x.seq DESC`,
      );
      return rows.map((r) => ({
        ...r,
        code: `SUP-${String(r.seq).padStart(3, '0')}`,
        scopeLabel: SCOPE_LABEL[r.scope],
        rule:
          r.scope === 'seller_product' ? `${r.seller} × ${r.product_code}`
          : r.scope === 'url_pattern' ? r.url_pattern
          : r.scope === 'source' ? `Everything on ${r.source}`
          : r.listing_url,
      }));
    }),
  );

  app.post<{ Params: Params & { suppressionId: string } }>(`${base}/suppressions/:suppressionId/revoke`, { config: { permission: 'mapping.write' } }, async (req) => {
    const id = uuidOr404(req.params.suppressionId, 'suppression');
    return withTenant(req.params.accountId, async (db) => {
      const r = await revokeSuppression(db, id, req.user!.sub);
      if (!r) throw new HttpError(404, 'suppression not found or already revoked');
      await audit(db, req, { action: 'suppression.revoked', entityType: 'suppression', entityId: id, summary: `Revoked suppression ${r.code}` });
      return { ok: true };
    });
  });

  // Candidate listings from a file (CSV / XLSX), staged for the matcher. Dry run first.
  app.post<{ Params: Params }>(`${base}/import`, { config: { permission: 'mapping.write' }, bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const b = parse(importBody, req.body);
    let table: string[][];
    try {
      table = await readTable(b.fileName, b.content);
    } catch (err) {
      throw new HttpError(400, `could not read ${b.fileName}: ${(err as Error).message}`);
    }
    if (table.length < 2) throw new HttpError(400, 'the file has no data rows under its header');
    if (table.length > 5001) throw new HttpError(400, 'the file has more than 5,000 listings: split it');
    const mapping: ColumnMapping = b.mapping ? { ...guessMapping('listings', table[0]), ...b.mapping } : guessMapping('listings', table[0]);
    const { rows, problems } = extractRows('listings', table, mapping);
    const meta = {
      fileName: b.fileName, header: table[0], mapping, rows: table.length - 1, preview: table.slice(1, 6),
      fields: IMPORT_FIELDS.listings.map((f) => ({ key: f.key, label: f.label, required: f.required })),
    };
    return withTenant(req.params.accountId, async (db) => {
      const accountId = req.params.accountId;
      const plan = await planListingImport(db, rows);
      const allProblems = [...problems, ...plan.problems].sort((a, c) => a.line - c.line);
      const summary = { ...plan.summary, errors: allProblems.length };
      const result = { ...meta, dryRun: b.dryRun, summary, changes: plan.changes, problems: allProblems };
      if (b.dryRun || !plan.changes.length) return result;

      const ctx = await loadMatchContext(db, accountId);
      const outcome = { Included: 0, Excluded: 0, Staged: 0, Retired: 0 };
      for (const c of plan.changes) {
        const l = await upsertListing(db, { sourceId: c.sourceId, url: c.url, channelSku: c.channelSku, title: c.title, sellerName: c.seller, imageUrl: c.image, origin: 'import' }, ctx);
        const r = await stageCandidate(db, ctx, {
          listingId: l.listingId, sourceId: c.sourceId, sellerId: l.sellerId, url: c.url, title: c.title, price: c.price, channelSku: c.channelSku,
          sellerName: c.seller, condition: c.condition, format: c.format, imageUrl: c.image, origin: 'import', proposedProductId: c.productId,
        });
        outcome[r.state]++;
      }
      const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM catalogue_import')).rows[0].n;
      const importId = (
        await db.query<{ id: string }>(
          `INSERT INTO catalogue_import (account_id, seq, kind, file_name, mapping, summary, created_by) VALUES ($1, $2, 'listings', $3, $4, $5, $6) RETURNING id`,
          [accountId, seq, b.fileName, JSON.stringify(mapping), JSON.stringify({ ...summary, ...outcome }), req.user!.sub],
        )
      ).rows[0].id;
      await audit(db, req, {
        action: 'listings.imported',
        entityType: 'catalogue_import',
        entityId: importId,
        summary: `Import ${importCode(seq)} (${b.fileName}): ${plan.changes.length} listings → ${outcome.Included} included, ${outcome.Excluded} excluded, ${outcome.Staged} to review`,
        after: { ...summary, outcome },
      });
      return { ...result, importId, importCode: importCode(seq), outcome };
    });
  });
}
