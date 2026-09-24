// Reads shared by the configuration routes: the source catalogue with an account's subscriptions,
// the term groups with their matrix cells and term counts, and the resulting cost estimate.
import { SOURCE_CATEGORIES, type SourceCategory, type TermType } from '../collector/catalogue.js';
import { DEFAULT_REQUEST_BUDGET, estimate, type CostGroup, type CostSource, type Estimate } from '../lib/cost.js';
import type { Db } from '../lib/db.js';
import { resolveOptions, type OptionsSchema } from '../lib/sourceOptions.js';

export interface CatalogueSource extends CostSource {
  name: string;
  internalName: string;
  family: { code: string; name: string } | null;
  country: string;
  baseUrl: string;
  active: boolean;
  capability: Record<string, unknown>;
}

/** Every catalogue source, with this account's subscription (RLS limits account_source to the tenant). */
export async function loadSources(db: Db): Promise<CatalogueSource[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.code, s.display_name, s.internal_name, s.category, s.country, s.base_url, s.active, s.capability,
            s.options_schema, s.collector_status, f.code AS family_code, f.name AS family_name,
            a.active AS sub_active, a.options AS sub_options
       FROM source s
       LEFT JOIN source_family f ON f.id = s.family_id
       LEFT JOIN account_source a ON a.source_id = s.id
      ORDER BY s.category, s.display_name`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.display_name,
    internalName: r.internal_name,
    category: r.category,
    country: r.country,
    baseUrl: r.base_url,
    active: r.active,
    capability: r.capability,
    family: r.family_code ? { code: r.family_code, name: r.family_name } : null,
    collectorStatus: r.collector_status,
    schema: normaliseSchema(r.options_schema),
    subscription: r.sub_active === null ? null : { active: r.sub_active, options: r.sub_options ?? {} },
  }));
}

function normaliseSchema(raw: unknown): OptionsSchema {
  const s = (raw ?? {}) as Partial<OptionsSchema>;
  return {
    options: Array.isArray(s.options) ? s.options : [],
    costs: s.costs ?? { keyword: 1, brand: 1, identifier: 1, url: 1, seller: 1 },
  };
}

/** A source as the portal sees it, with resolved option values for the subscription. */
export function sourceView(s: CatalogueSource) {
  const values = resolveOptions(s.schema, s.subscription?.options ?? {}).values;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    internalName: s.internalName,
    family: s.family,
    category: s.category,
    country: s.country,
    baseUrl: s.baseUrl,
    collectorStatus: s.collectorStatus,
    active: s.active,
    capability: s.capability,
    options: s.schema.options,
    subscription: s.subscription ? { active: s.subscription.active, overrides: s.subscription.options, values } : null,
  };
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  terms: number;
  activeTerms: number;
  batchLabels: string[];
  lastChanged: Date;
  found30d: number;
  survived30d: number;
  survived90d: number;
  termCounts: Partial<Record<TermType, number>>;
  cells: Partial<Record<SourceCategory, { mode: 'All' | 'Some' | 'None'; sourceIds: string[] }>>;
}

export async function loadGroups(db: Db): Promise<GroupRow[]> {
  const groups = (
    await db.query(
      `SELECT g.id, g.name, g.description, g.updated_at,
              count(t.id)::int AS terms,
              count(t.id) FILTER (WHERE t.active)::int AS active_terms,
              coalesce(array_agg(DISTINCT t.batch_label) FILTER (WHERE t.batch_label IS NOT NULL), '{}') AS batch_labels,
              coalesce(max(t.updated_at), g.updated_at) AS last_changed,
              coalesce(sum(y.found_30d), 0)::int AS found_30d,
              coalesce(sum(y.survived_30d), 0)::int AS survived_30d,
              coalesce(sum(y.survived_90d), 0)::int AS survived_90d
         FROM term_group g
         LEFT JOIN term t ON t.group_id = g.id
         LEFT JOIN term_yield y ON y.term_id = t.id
        GROUP BY g.id
        ORDER BY lower(g.name)`,
    )
  ).rows;
  const counts = (
    await db.query<{ group_id: string; type: TermType; n: number }>(
      `SELECT group_id, type, count(*)::int AS n FROM term WHERE active GROUP BY group_id, type`,
    )
  ).rows;
  const cells = (
    await db.query<{ group_id: string; source_category: SourceCategory; mode: 'All' | 'Some' | 'None'; source_ids: string[] }>(
      'SELECT group_id, source_category, mode, source_ids FROM term_group_subscription',
    )
  ).rows;
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    terms: g.terms,
    activeTerms: g.active_terms,
    batchLabels: g.batch_labels,
    lastChanged: g.last_changed,
    found30d: g.found_30d,
    survived30d: g.survived_30d,
    survived90d: g.survived_90d,
    termCounts: Object.fromEntries(counts.filter((c) => c.group_id === g.id).map((c) => [c.type, c.n])),
    cells: Object.fromEntries(
      SOURCE_CATEGORIES.map((cat) => {
        const c = cells.find((x) => x.group_id === g.id && x.source_category === cat);
        return [cat, { mode: c?.mode ?? 'None', sourceIds: c?.source_ids ?? [] }];
      }),
    ),
  }));
}

export async function requestBudget(db: Db, accountId: string): Promise<number> {
  const { rows } = await db.query<{ budget: number | null }>(
    "SELECT (settings->>'request_budget')::int AS budget FROM account WHERE id = $1",
    [accountId],
  );
  return rows[0]?.budget ?? DEFAULT_REQUEST_BUDGET;
}

export async function accountEstimate(db: Db, accountId: string): Promise<{ estimate: Estimate; groups: GroupRow[]; sources: CatalogueSource[] }> {
  const [sources, groups, budget] = await Promise.all([loadSources(db), loadGroups(db), requestBudget(db, accountId)]);
  const costGroups: CostGroup[] = groups.map((g) => ({ id: g.id, name: g.name, termCounts: g.termCounts, cells: g.cells }));
  return { estimate: estimate(costGroups, sources, budget), groups, sources };
}
