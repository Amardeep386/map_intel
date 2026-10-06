// Rules (Phase 3): versioned verdict rules. A draft is edited, dry-run over a date range and only
// then published (closing the previous version); any version can be replayed into a shadow set.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit, type AuditEntry } from '../../lib/audit.js';
import { withTenant, type Db } from '../../lib/db.js';
import { dryRun, publish, replay, RuleError } from '../../lib/ruleAdmin.js';
import { contentHash } from '../../lib/rules.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };

const CLASSES = ['MAP Authorised', 'Unauthorised', 'Brand Direct', 'Unknown'] as const;
const ids = z.array(z.string().trim().min(1).max(100)).max(500).optional();
const versionBody = z.object({
  scope: z.object({ products: ids, categories: ids, sources: ids, sourceCategories: ids }).strict().default({}),
  condition: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('below_map'),
      tolerancePct: z.number().min(0).max(90).nullable().optional(),
      minDepth: z.number().min(0).max(100000).nullable().optional(),
    }).strict(),
    z.object({ type: z.literal('seller_class'), classes: z.array(z.enum(CLASSES)).min(1) }).strict(),
  ]),
  verdict: z.enum(['violation', 'exempt', 'needs_review']),
  severity: z.object({ minorBelowPct: z.number().min(0).max(100), severeAbovePct: z.number().min(0).max(100) })
    .refine((s) => s.minorBelowPct <= s.severeAbovePct, 'Minor must start below Severe')
    .default({ minorBelowPct: 5, severeAbovePct: 15 }),
  priority: z.number().int().min(0).max(10000).default(100),
  note: z.string().trim().max(500).optional(),
});
const rangeBody = z.object({ from: z.coerce.date(), to: z.coerce.date() });

function audit(db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<AuditEntry, 'accountId' | 'actor' | 'requestId'>) {
  return recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });
}

const mapRuleError = (err: unknown) => {
  if (err instanceof RuleError) throw new HttpError(err.statusCode, err.message);
  throw err;
};

async function draftOf(db: Db, ruleId: string) {
  return (await db.query('SELECT * FROM rule_version WHERE rule_id = $1 AND status = $2', [ruleId, 'Draft'])).rows[0] ?? null;
}

export async function ruleRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/rules';

  app.get<{ Params: Params }>(base, { config: { permission: 'rules.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (await db.query(
        `SELECT r.id, r.code, r.name, r.kind, r.is_default,
                to_jsonb(p) - 'account_id' AS published,
                (SELECT to_jsonb(d) - 'account_id' FROM rule_version d WHERE d.rule_id = r.id AND d.status = 'Draft') AS draft,
                (SELECT count(*)::int FROM verdict v JOIN rule_version x ON x.id = v.rule_version_id
                  WHERE x.rule_id = r.id AND v.observed_at > now() - interval '30 days') AS hits_30d
           FROM rule r
           LEFT JOIN rule_version p ON p.rule_id = r.id AND p.status = 'Published'
          ORDER BY coalesce(p.priority, 1000), r.code`,
      )).rows,
    ),
  );

  app.get<{ Params: Params & { ruleId: string } }>(`${base}/:ruleId`, { config: { permission: 'rules.read' } }, async (req) => {
    const ruleId = uuidOr404(req.params.ruleId, 'rule');
    return withTenant(req.params.accountId, async (db) => {
      const rule = (await db.query('SELECT id, code, name, kind, is_default, created_at FROM rule WHERE id = $1', [ruleId])).rows[0];
      if (!rule) throw new HttpError(404, 'rule not found');
      const versions = (await db.query(
        `SELECT rv.*, u.email AS published_by_email,
                (SELECT to_jsonb(d) - 'account_id' FROM dry_run d WHERE d.rule_version_id = rv.id ORDER BY d.created_at DESC LIMIT 1) AS last_dry_run
           FROM rule_version rv LEFT JOIN app_user u ON u.id = rv.published_by
          WHERE rv.rule_id = $1 ORDER BY rv.version DESC`,
        [ruleId],
      )).rows;
      const replays = (await db.query(
        `SELECT rr.id, rr.rule_version_id, rv.version, rr.range_from, rr.range_to, rr.status, rr.summary, rr.created_at
           FROM replay_run rr JOIN rule_version rv ON rv.id = rr.rule_version_id
          WHERE rv.rule_id = $1 ORDER BY rr.created_at DESC LIMIT 20`,
        [ruleId],
      )).rows;
      return { ...rule, versions, replays };
    });
  });

  /** A new rule starts as a draft v1. */
  app.post<{ Params: Params }>(base, { config: { permission: 'rules.write' } }, async (req) => {
    const b = parse(versionBody.extend({ name: z.string().trim().min(1).max(120) }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const n = (await db.query<{ n: number }>(
        "SELECT coalesce(max(substring(code from 3)::int), 0) + 1 AS n FROM rule WHERE code ~ '^R-[0-9]+$'",
      )).rows[0].n;
      const code = `R-${String(n).padStart(2, '0')}`;
      const rule = (await db.query<{ id: string }>(
        'INSERT INTO rule (account_id, code, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [req.params.accountId, code, b.name, req.user?.sub ?? null],
      )).rows[0];
      const v = await insertDraft(db, req.params.accountId, rule.id, 1, b, req.user?.sub ?? null);
      await audit(db, req, { action: 'rule.created', entityType: 'rule', entityId: rule.id, summary: `Created rule ${code} (draft v1)`, after: b });
      return { id: rule.id, code, draft: v };
    });
  });

  /** Create or replace the rule's draft (the next version number). */
  app.put<{ Params: Params & { ruleId: string } }>(`${base}/:ruleId/draft`, { config: { permission: 'rules.write' } }, async (req) => {
    const ruleId = uuidOr404(req.params.ruleId, 'rule');
    const b = parse(versionBody, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const rule = (await db.query<{ code: string }>('SELECT code FROM rule WHERE id = $1', [ruleId])).rows[0];
      if (!rule) throw new HttpError(404, 'rule not found');
      const existing = await draftOf(db, ruleId);
      let draft;
      if (existing) {
        draft = (await db.query(
          `UPDATE rule_version SET scope = $2, condition = $3, verdict = $4, severity = $5, priority = $6, note = $7, content_hash = $8
            WHERE id = $1 RETURNING *`,
          [existing.id, b.scope, b.condition, b.verdict, b.severity, b.priority, b.note ?? null, contentHash(b)],
        )).rows[0];
      } else {
        const next = (await db.query<{ n: number }>('SELECT coalesce(max(version), 0) + 1 AS n FROM rule_version WHERE rule_id = $1', [ruleId])).rows[0].n;
        draft = await insertDraft(db, req.params.accountId, ruleId, next, b, req.user?.sub ?? null);
      }
      await audit(db, req, {
        action: 'rule.draft_saved', entityType: 'rule', entityId: ruleId,
        summary: `Saved draft v${draft.version} of ${rule.code}`, before: existing ?? undefined, after: b,
      });
      return draft;
    });
  });

  app.delete<{ Params: Params & { ruleId: string } }>(`${base}/:ruleId/draft`, { config: { permission: 'rules.write' } }, async (req) => {
    const ruleId = uuidOr404(req.params.ruleId, 'rule');
    return withTenant(req.params.accountId, async (db) => {
      const d = await draftOf(db, ruleId);
      if (!d) throw new HttpError(404, 'no draft');
      await db.query('DELETE FROM dry_run WHERE rule_version_id = $1', [d.id]);
      await db.query('DELETE FROM rule_version WHERE id = $1', [d.id]);
      await audit(db, req, { action: 'rule.draft_discarded', entityType: 'rule', entityId: ruleId, summary: `Discarded draft v${d.version}`, before: d });
      return { ok: true };
    });
  });

  app.post<{ Params: Params & { ruleId: string } }>(`${base}/:ruleId/draft/dry-run`, { config: { permission: 'rules.write' } }, async (req) => {
    const ruleId = uuidOr404(req.params.ruleId, 'rule');
    const b = parse(rangeBody, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const d = await draftOf(db, ruleId);
      if (!d) throw new HttpError(404, 'no draft to dry-run');
      const r = await dryRun(db, req.params.accountId, d.id, b.from, b.to, req.user?.sub ?? null).catch(mapRuleError);
      await audit(db, req, {
        action: 'rule.dry_run', entityType: 'rule', entityId: ruleId,
        summary: `Dry run of draft v${d.version}: ${r.result.newlyViolating} newly violating, ${r.result.noLongerViolating} no longer`, after: r,
      });
      return r;
    });
  });

  app.post<{ Params: Params & { ruleId: string } }>(`${base}/:ruleId/draft/publish`, { config: { permission: 'rules.write' } }, async (req) => {
    const ruleId = uuidOr404(req.params.ruleId, 'rule');
    return withTenant(req.params.accountId, async (db) => {
      const d = await draftOf(db, ruleId);
      if (!d) throw new HttpError(404, 'no draft to publish');
      const r = await publish(db, d.id, req.user?.sub ?? null).catch(mapRuleError);
      await audit(db, req, {
        action: 'rule.published', entityType: 'rule', entityId: ruleId,
        summary: `Published v${r.published.version}${r.closed ? `; v${r.closed.version} closed, not deleted` : ''}`, after: r,
      });
      return r;
    });
  });

  app.post<{ Params: Params & { versionId: string } }>(`${base}/versions/:versionId/replay`, { config: { permission: 'rules.write' } }, async (req) => {
    const versionId = uuidOr404(req.params.versionId, 'rule version');
    const b = parse(rangeBody, req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await replay(db, req.params.accountId, versionId, b.from, b.to, req.user?.sub ?? null).catch(mapRuleError);
      await audit(db, req, { action: 'rule.replayed', entityType: 'rule_version', entityId: versionId, summary: 'Replayed into a shadow result set', after: r.summary });
      return r;
    });
  });
}

async function insertDraft(db: Db, accountId: string, ruleId: string, version: number, b: z.infer<typeof versionBody>, userId: string | null) {
  return (await db.query(
    `INSERT INTO rule_version (account_id, rule_id, version, scope, condition, verdict, severity, priority, note, content_hash, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [accountId, ruleId, version, b.scope, b.condition, b.verdict, b.severity, b.priority, b.note ?? null, contentHash(b), userId],
  )).rows[0];
}
