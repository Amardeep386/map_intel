// The shared source catalogue (Mirethos administrators edit it) and each account's subscriptions.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SOURCE_CATEGORIES, optionsSchema } from '../../collector/catalogue.js';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withApi, withTenant } from '../../lib/db.js';
import { resolveOptions } from '../../lib/sourceOptions.js';
import { HttpError } from '../app.js';
import { accountEstimate, loadSources, sourceView } from '../configData.js';
import { isUniqueViolation, parse } from '../validate.js';

// A source added by hand has no collector yet: a generic option set until one is built.
const GENERIC_SCHEMA = optionsSchema({
  options: [{ key: 'search_pages', label: 'Search result pages per keyword', type: 'integer', default: 1, min: 1, max: 3 }],
  costs: { keyword: 'search_pages', brand: 'search_pages', identifier: 1, url: 1, seller: 1 },
});

const newSource = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,64}$/, 'lowercase letters, digits and _ only'),
  displayName: z.string().trim().min(1).max(120),
  internalName: z.string().trim().min(1).max(200),
  category: z.enum(SOURCE_CATEGORIES as [string, ...string[]]),
  country: z.string().trim().length(2).toUpperCase().default('US'),
  baseUrl: z.string().url().max(300),
  family: z.object({ code: z.string().trim().regex(/^[a-z0-9_]{2,64}$/), name: z.string().trim().min(1).max(120) }),
});

const sourcePatch = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    category: z.enum(SOURCE_CATEGORIES as [string, ...string[]]),
    country: z.string().trim().length(2).toUpperCase(),
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

const subscriptionBody = z.object({
  active: z.boolean(),
  options: z.record(z.unknown()).optional(),
});

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  // The catalogue, for everyone signed in (no account-specific data).
  app.get('/sources', { config: { permission: 'user' } }, async () => withApi(async (db) => (await loadSources(db)).map(sourceView)));

  app.post('/sources', { config: { permission: 'platform' } }, async (req, reply) => {
    const b = parse(newSource, req.body);
    const created = await withApi(async (db) => {
      const fam = await db.query<{ id: string }>(
        `INSERT INTO source_family (code, name) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET name = source_family.name RETURNING id`,
        [b.family.code, b.family.name],
      );
      try {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO source (code, internal_name, display_name, category, country, base_url, options_schema, family_id, collector_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned') RETURNING id`,
          [b.code, b.internalName, b.displayName, b.category, b.country, b.baseUrl, JSON.stringify(GENERIC_SCHEMA), fam.rows[0].id],
        );
        await recordAudit(db, {
          accountId: null,
          actor: actorFrom(req),
          action: 'source.created',
          entityType: 'source',
          entityId: b.code,
          summary: `Added ${b.displayName} to the source catalogue`,
          after: b,
          requestId: req.id,
        });
        return rows[0].id;
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, `source ${b.code} already exists`);
        throw err;
      }
    });
    return reply.code(201).send({ id: created, code: b.code });
  });

  app.patch<{ Params: { code: string } }>('/sources/:code', { config: { permission: 'platform' } }, async (req) => {
    const b = parse(sourcePatch, req.body);
    return withApi(async (db) => {
      const before = (await db.query('SELECT display_name, category, country, active FROM source WHERE code = $1', [req.params.code])).rows[0];
      if (!before) throw new HttpError(404, 'source not found');
      const after = {
        display_name: b.displayName ?? before.display_name,
        category: b.category ?? before.category,
        country: b.country ?? before.country,
        active: b.active ?? before.active,
      };
      await db.query('UPDATE source SET display_name = $2, category = $3, country = $4, active = $5 WHERE code = $1', [
        req.params.code,
        after.display_name,
        after.category,
        after.country,
        after.active,
      ]);
      await recordAudit(db, {
        accountId: null,
        actor: actorFrom(req),
        action: 'source.updated',
        entityType: 'source',
        entityId: req.params.code,
        summary: `Changed ${after.display_name} in the source catalogue`,
        before,
        after,
        requestId: req.id,
      });
      return { code: req.params.code, ...after };
    });
  });

  // The catalogue with this account's subscription state, plus the account's cost estimate.
  app.get<{ Params: { accountId: string } }>('/accounts/:accountId/subscriptions', { config: { permission: 'sources.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const { estimate, sources } = await accountEstimate(db, req.params.accountId);
      return { sources: sources.map(sourceView), estimate: { total: estimate.total, budget: estimate.budget, overBudget: estimate.overBudget } };
    }),
  );

  // Subscribe / unsubscribe / change options. Options are checked against what the collector declared.
  app.put<{ Params: { accountId: string; code: string } }>(
    '/accounts/:accountId/subscriptions/:code',
    { config: { permission: 'sources.write' } },
    async (req) => {
      const b = parse(subscriptionBody, req.body);
      const { accountId, code } = req.params;
      return withTenant(accountId, async (db) => {
        const source = (await loadSources(db)).find((s) => s.code === code);
        if (!source) throw new HttpError(404, 'source not found');
        if (!source.active) throw new HttpError(409, `${source.name} is switched off in the catalogue`);
        const overrides = b.options ?? source.subscription?.options ?? {};
        const { errors } = resolveOptions(source.schema, overrides);
        if (errors.length) throw new HttpError(400, errors.join('; '));
        await db.query(
          `INSERT INTO account_source (account_id, source_id, active, options, created_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (account_id, source_id) DO UPDATE SET active = EXCLUDED.active, options = EXCLUDED.options`,
          [accountId, source.id, b.active, JSON.stringify(overrides), req.user!.sub],
        );
        const before = source.subscription;
        await recordAudit(db, {
          accountId,
          actor: actorFrom(req),
          action: before ? 'subscription.updated' : 'subscription.created',
          entityType: 'account_source',
          entityId: code,
          summary: !before
            ? `Subscribed to ${source.name}`
            : before.active !== b.active
              ? `${b.active ? 'Resumed' : 'Paused'} ${source.name}`
              : `Changed ${source.name} options`,
          before: before ?? undefined,
          after: { active: b.active, options: overrides },
          requestId: req.id,
        });
        const { estimate, sources } = await accountEstimate(db, accountId);
        return {
          source: sourceView(sources.find((s) => s.code === code)!),
          estimate: { total: estimate.total, budget: estimate.budget, overBudget: estimate.overBudget },
        };
      });
    },
  );
}
