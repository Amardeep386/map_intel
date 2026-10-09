// What the scheduler needs to know about one account's work: its schedules, subscribed sources,
// matrix cells, terms, listings and request budget. Reads through the given connection only, so the
// API (as the tenant) can use it for forecasts and the scheduler (as the system) for firings.
import type { SourceCategory } from '../collector/catalogue.js';
import { DEFAULT_REQUEST_BUDGET, type CostGroup } from '../lib/cost.js';
import type { Db } from '../lib/db.js';
import type { ScheduleSelector } from '../lib/schedules.js';
import type { OptionsSchema } from '../lib/sourceOptions.js';
import type { ExpandInput, FiringSchedule } from './expand.js';

export interface ScheduleRow {
  id: string;
  account_id: string;
  name: string;
  selector: ScheduleSelector;
  priority: number;
  active: boolean;
  cadence: string;
  timezone: string;
  kind: FiringSchedule['kind'];
  listing_scope: FiringSchedule['listingScope'];
  listing_status: FiringSchedule['listingStatus'];
  takedown_status: FiringSchedule['takedownStatus'];
  last_fired: Date | null;
}

export const toFiring = (r: ScheduleRow): FiringSchedule => ({
  id: r.id,
  name: r.name,
  selector: r.selector ?? {},
  priority: r.priority,
  active: r.active,
  cadence: r.cadence,
  timezone: r.timezone,
  kind: r.kind,
  listingScope: r.listing_scope,
  listingStatus: r.listing_status,
  takedownStatus: r.takedown_status,
});

/** Everything expandFiring needs about one account. */
export async function loadAccountWork(db: Db, accountId: string): Promise<Omit<ExpandInput, 'firing' | 'adapters'>> {
  const schedules = (
    await db.query<ScheduleRow>(
      `SELECT id, account_id, name, selector, priority, active, cadence, timezone, kind, listing_scope, listing_status, takedown_status, NULL AS last_fired
         FROM schedule WHERE account_id = $1 AND active`,
      [accountId],
    )
  ).rows.map(toFiring);

  const sources = (
    await db.query<{ id: string; code: string; category: SourceCategory; collector_status: string; options_schema: OptionsSchema; family: string | null; active: boolean; options: Record<string, unknown> }>(
      `SELECT s.id, s.code, s.category, s.collector_status, s.options_schema, f.code AS family, a.active, a.options
         FROM account_source a JOIN source s ON s.id = a.source_id LEFT JOIN source_family f ON f.id = s.family_id
        WHERE a.account_id = $1 AND s.active`,
      [accountId],
    )
  ).rows.map((r) => ({
    id: r.id,
    code: r.code,
    category: r.category,
    family: r.family,
    // A source whose collector is not built is kept (its jobs are recorded as skipped: no_collector).
    collectorStatus: r.collector_status,
    schema: r.options_schema,
    subscription: { active: r.active, options: r.options ?? {} },
  }));

  const cells = (
    await db.query<{ group_id: string; source_category: SourceCategory; mode: 'All' | 'Some' | 'None'; source_ids: string[] }>(
      'SELECT group_id, source_category, mode, source_ids FROM term_group_subscription WHERE account_id = $1',
      [accountId],
    )
  ).rows;
  const groupMap = new Map<string, Pick<CostGroup, 'id' | 'cells'>>();
  for (const c of cells) {
    const g = groupMap.get(c.group_id) ?? { id: c.group_id, cells: {} };
    g.cells[c.source_category] = { mode: c.mode, sourceIds: c.source_ids };
    groupMap.set(c.group_id, g);
  }

  const terms = (
    await db.query<{ id: string; group_id: string; type: ExpandInput['terms'][number]['type']; value: string }>(
      'SELECT id, group_id, type, value FROM term WHERE account_id = $1 AND active ORDER BY type, value',
      [accountId],
    )
  ).rows.map((t) => ({ id: t.id, groupId: t.group_id, type: t.type, value: t.value }));

  const listings = (
    await db.query<{ id: string; source_id: string; url: string; state: ExpandInput['listings'][number]['state']; under_notice: boolean }>(
      `SELECT l.id, l.source_id, l.url, m.state,
              EXISTS (SELECT 1 FROM violation_current v
                       WHERE v.account_id = m.account_id AND v.listing_id = l.id AND NOT v.episode_closed AND v.status = 'Under notice') AS under_notice
         FROM listing_match m JOIN listing l ON l.id = m.listing_id
        WHERE m.account_id = $1 AND l.origin <> 'synthetic' ORDER BY l.source_id, l.url`,
      [accountId],
    )
  ).rows.map((l) => ({ id: l.id, sourceId: l.source_id, url: l.url, state: l.state, underNotice: l.under_notice }));

  const settings = (await db.query<{ settings: Record<string, unknown> }>('SELECT settings FROM account WHERE id = $1', [accountId])).rows[0]?.settings ?? {};
  const budget = Number(settings.request_budget ?? DEFAULT_REQUEST_BUDGET) || DEFAULT_REQUEST_BUDGET;

  return { schedules, sources, groups: [...groupMap.values()], terms, listings, budget };
}
