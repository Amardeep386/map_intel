// Account settings: the account's own process configuration, stored as data (account row +
// account.settings) and audited with before/after.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { DEFAULT_REQUEST_BUDGET } from '../../lib/cost.js';
import { withTenant, type Db } from '../../lib/db.js';
import { HttpError } from '../app.js';
import { parse } from '../validate.js';

/** Defaults for account.settings (snake_case keys in the database). */
export const SETTINGS_DEFAULTS = {
  map_tolerance_pct: 2,
  min_depth: 1,
  grace_hours: 0,
  match_include: 90,
  match_review: 60,
  qa_sample_pct: 5,
  brand_approval_required: true,
  brand_users_see_needs_review: false,
  request_budget: DEFAULT_REQUEST_BUDGET,
};
type Settings = typeof SETTINGS_DEFAULTS;

const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const settingsPatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    regions: z.array(z.string().trim().regex(/^[A-Z]{2}$/, 'two-letter country codes, e.g. US')).min(1).max(50),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, 'a three-letter currency code, e.g. USD'),
    timezone: z.string().trim().max(64).refine(validTimezone, 'unknown timezone'),
    contractFrom: z.string().date().nullable(),
    contractTo: z.string().date().nullable(),
    seats: z.number().int().min(1).max(10_000).nullable(),
    settings: z
      .object({
        mapTolerancePct: z.number().min(0).max(50),
        minDepth: z.number().min(0).max(10_000),
        graceHours: z.number().int().min(0).max(168),
        matchInclude: z.number().int().min(1).max(100),
        matchReview: z.number().int().min(0).max(99),
        qaSamplePct: z.number().min(0).max(100),
        brandApprovalRequired: z.boolean(),
        brandUsersSeeNeedsReview: z.boolean(),
        requestBudget: z.number().int().min(100).max(10_000_000),
      })
      .partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

const toDb: Record<string, keyof Settings> = {
  mapTolerancePct: 'map_tolerance_pct',
  minDepth: 'min_depth',
  graceHours: 'grace_hours',
  matchInclude: 'match_include',
  matchReview: 'match_review',
  qaSamplePct: 'qa_sample_pct',
  brandApprovalRequired: 'brand_approval_required',
  brandUsersSeeNeedsReview: 'brand_users_see_needs_review',
  requestBudget: 'request_budget',
};

interface AccountRow {
  id: string;
  slug: string;
  name: string;
  brand: string;
  status: string;
  regions: string[];
  currency: string;
  timezone: string;
  contract_from: string | null;
  contract_to: string | null;
  settings: Partial<Settings> & { seats?: number | null };
}

async function load(db: Db, accountId: string): Promise<AccountRow> {
  const { rows } = await db.query<AccountRow>(
    `SELECT id, slug, name, brand, status, regions, currency, timezone,
            to_char(contract_from, 'YYYY-MM-DD') AS contract_from, to_char(contract_to, 'YYYY-MM-DD') AS contract_to, settings
       FROM account WHERE id = $1`,
    [accountId],
  );
  if (!rows[0]) throw new HttpError(404, 'account not found');
  return rows[0];
}

function view(a: AccountRow) {
  const s = { ...SETTINGS_DEFAULTS, ...a.settings };
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    brand: a.brand,
    status: a.status,
    regions: a.regions,
    currency: a.currency,
    timezone: a.timezone,
    contractFrom: a.contract_from,
    contractTo: a.contract_to,
    seats: a.settings.seats ?? null,
    settings: Object.fromEntries(Object.entries(toDb).map(([api, dbKey]) => [api, s[dbKey]])),
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { accountId: string } }>('/accounts/:accountId/settings', { config: { permission: 'settings.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => view(await load(db, req.params.accountId))),
  );

  app.patch<{ Params: { accountId: string } }>('/accounts/:accountId/settings', { config: { permission: 'settings.write' } }, async (req) => {
    const b = parse(settingsPatch, req.body);
    const { accountId } = req.params;
    return withTenant(accountId, async (db) => {
      const before = await load(db, accountId);
      const beforeView = view(before);
      const settings: Record<string, unknown> = { ...before.settings };
      for (const [k, v] of Object.entries(b.settings ?? {})) settings[toDb[k]] = v;
      if (b.seats !== undefined) settings.seats = b.seats;
      const merged = { ...SETTINGS_DEFAULTS, ...settings } as Settings;
      if (merged.match_review >= merged.match_include) throw new HttpError(400, 'the review threshold must be below the auto-include threshold');
      const contractFrom = b.contractFrom !== undefined ? b.contractFrom : before.contract_from;
      const contractTo = b.contractTo !== undefined ? b.contractTo : before.contract_to;
      if (contractFrom && contractTo && contractTo < contractFrom) throw new HttpError(400, 'the contract end must be after its start');

      await db.query(
        `UPDATE account SET name = $2, regions = $3, currency = $4, timezone = $5, contract_from = $6, contract_to = $7, settings = $8
          WHERE id = $1`,
        [
          accountId,
          b.name ?? before.name,
          b.regions ?? before.regions,
          b.currency ?? before.currency,
          b.timezone ?? before.timezone,
          contractFrom,
          contractTo,
          JSON.stringify(settings),
        ],
      );
      const after = view(await load(db, accountId));
      const changed = Object.keys(b).flatMap((k) => (k === 'settings' ? Object.keys(b.settings ?? {}) : [k]));
      await recordAudit(db, {
        accountId,
        actor: actorFrom(req),
        action: 'settings.updated',
        entityType: 'account',
        entityId: accountId,
        summary: `Changed settings: ${changed.join(', ')}`,
        before: beforeView,
        after,
        requestId: req.id,
      });
      return after;
    });
  });
}
