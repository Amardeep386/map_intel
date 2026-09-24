// Subscription matrix: which source categories each term group is collected from, with the
// request-cost estimate against the account's budget.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SOURCE_CATEGORIES, type SourceCategory } from '../../collector/catalogue.js';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant, type Db } from '../../lib/db.js';
import { HttpError } from '../app.js';
import { accountEstimate } from '../configData.js';
import { parse, uuidOr404 } from '../validate.js';

const cellBody = z.object({
  mode: z.enum(['All', 'Some', 'None']),
  sourceCodes: z.array(z.string().max(64)).max(200).default([]),
});

async function matrixView(db: Db, accountId: string) {
  const { estimate, groups, sources } = await accountEstimate(db, accountId);
  const codeOf = new Map(sources.map((s) => [s.id, s.code]));
  return {
    categories: SOURCE_CATEGORIES,
    // Subscribed, active sources per category: what "All" means and what "Some" can pick from.
    sources: Object.fromEntries(
      SOURCE_CATEGORIES.map((c) => [
        c,
        sources
          .filter((s) => s.category === c && s.subscription?.active)
          .map((s) => ({ code: s.code, name: s.name, collectorStatus: s.collectorStatus })),
      ]),
    ),
    groups: groups.map((g) => {
      const est = estimate.groups.find((e) => e.groupId === g.id)!;
      return {
        id: g.id,
        name: g.name,
        terms: g.terms,
        activeTerms: g.activeTerms,
        cells: Object.fromEntries(
          Object.entries(g.cells).map(([cat, cell]) => [cat, { mode: cell!.mode, sourceCodes: cell!.sourceIds.map((id) => codeOf.get(id)).filter(Boolean) }]),
        ),
        requests: est.requests,
        plannedRequests: est.plannedRequests,
        sources: est.sources,
        found30d: g.found30d,
        // A group that has been live for 30 days and found almost nothing is worth reviewing.
        lowYield: g.activeTerms > 0 && g.found30d === 0 && Date.now() - new Date(g.lastChanged).getTime() > 30 * 86_400_000,
      };
    }),
    total: estimate.total,
    budget: estimate.budget,
    overBudget: estimate.overBudget,
  };
}

export async function matrixRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { accountId: string } }>('/accounts/:accountId/matrix', { config: { permission: 'sources.read' } }, async (req) =>
    withTenant(req.params.accountId, (db) => matrixView(db, req.params.accountId)),
  );

  app.put<{ Params: { accountId: string; groupId: string; category: string } }>(
    '/accounts/:accountId/matrix/:groupId/:category',
    { config: { permission: 'sources.write' } },
    async (req) => {
      const b = parse(cellBody, req.body);
      const { accountId } = req.params;
      const groupId = uuidOr404(req.params.groupId, 'term group');
      const category = SOURCE_CATEGORIES.find((c) => c.toLowerCase() === decodeURIComponent(req.params.category).toLowerCase()) as
        | SourceCategory
        | undefined;
      if (!category) throw new HttpError(404, `unknown source category (use ${SOURCE_CATEGORIES.join(', ')})`);

      return withTenant(accountId, async (db) => {
        const group = (await db.query<{ name: string }>('SELECT name FROM term_group WHERE id = $1', [groupId])).rows[0];
        if (!group) throw new HttpError(404, 'term group not found');
        let sourceIds: string[] = [];
        if (b.mode === 'Some') {
          if (!b.sourceCodes.length) throw new HttpError(400, 'choose at least one source for "Some"');
          const { rows } = await db.query<{ id: string; code: string }>(
            `SELECT s.id, s.code FROM source s JOIN account_source a ON a.source_id = s.id AND a.active
              WHERE s.category = $1 AND s.code = ANY($2)`,
            [category, b.sourceCodes],
          );
          const missing = b.sourceCodes.filter((c) => !rows.some((r) => r.code === c));
          if (missing.length) throw new HttpError(400, `not subscribed ${category} sources: ${missing.join(', ')}`);
          sourceIds = rows.map((r) => r.id);
        }
        const before = (
          await db.query('SELECT mode, source_ids FROM term_group_subscription WHERE group_id = $1 AND source_category = $2', [groupId, category])
        ).rows[0] ?? { mode: 'None', source_ids: [] };
        await db.query(
          `INSERT INTO term_group_subscription (account_id, group_id, source_category, mode, source_ids, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (group_id, source_category) DO UPDATE SET mode = EXCLUDED.mode, source_ids = EXCLUDED.source_ids, updated_by = EXCLUDED.updated_by`,
          [accountId, groupId, category, b.mode, sourceIds, req.user!.sub],
        );
        await recordAudit(db, {
          accountId,
          actor: actorFrom(req),
          action: 'matrix.updated',
          entityType: 'term_group_subscription',
          entityId: `${groupId}:${category}`,
          summary: `"${group.name}" × ${category}: ${before.mode} → ${b.mode}${b.mode === 'Some' ? ` (${b.sourceCodes.join(', ')})` : ''}`,
          before: { mode: before.mode, sourceIds: before.source_ids },
          after: { mode: b.mode, sourceCodes: b.mode === 'Some' ? b.sourceCodes : [] },
          requestId: req.id,
        });
        return matrixView(db, accountId);
      });
    },
  );
}
