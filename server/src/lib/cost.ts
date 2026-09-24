// Request-cost estimate for the subscription matrix: how many requests one collection cycle of an
// account's configuration would make, per term group and in total, against the account's budget.
import type { SourceCategory, TermType } from '../collector/catalogue.js';
import { resolveOptions, termCost, type OptionsSchema } from './sourceOptions.js';

export const DEFAULT_REQUEST_BUDGET = 3000;

export interface CostSource {
  id: string;
  code: string;
  category: SourceCategory;
  collectorStatus: string;
  schema: OptionsSchema;
  /** The account's subscription, or null when not subscribed. */
  subscription: { active: boolean; options: Record<string, unknown> } | null;
}

export interface CostGroup {
  id: string;
  name: string;
  /** Active terms in the group, by type. */
  termCounts: Partial<Record<TermType, number>>;
  cells: Partial<Record<SourceCategory, { mode: 'All' | 'Some' | 'None'; sourceIds: string[] }>>;
}

export interface GroupEstimate {
  groupId: string;
  requests: number;
  /** Requests that go to sources whose collector is not built yet (counted, not crawled until P2b). */
  plannedRequests: number;
  sources: string[];
}

export interface Estimate {
  groups: GroupEstimate[];
  total: number;
  budget: number;
  overBudget: boolean;
}

/** The subscribed, active sources a matrix cell sends a group's terms to. */
export function sourcesForCell(sources: CostSource[], category: SourceCategory, cell: CostGroup['cells'][SourceCategory]): CostSource[] {
  if (!cell || cell.mode === 'None') return [];
  return sources.filter(
    (s) =>
      s.category === category &&
      s.subscription?.active === true &&
      (cell.mode === 'All' || cell.sourceIds.includes(s.id)),
  );
}

export function estimate(groups: CostGroup[], sources: CostSource[], budget: number = DEFAULT_REQUEST_BUDGET): Estimate {
  const out: GroupEstimate[] = groups.map((g) => {
    let requests = 0;
    let plannedRequests = 0;
    const used = new Set<string>();
    for (const [category, cell] of Object.entries(g.cells) as [SourceCategory, CostGroup['cells'][SourceCategory]][]) {
      for (const s of sourcesForCell(sources, category, cell)) {
        const values = resolveOptions(s.schema, s.subscription?.options ?? {}).values;
        let r = 0;
        for (const [type, n] of Object.entries(g.termCounts) as [TermType, number][]) r += n * termCost(s.schema, values, type);
        requests += r;
        if (s.collectorStatus !== 'live') plannedRequests += r;
        if (r > 0) used.add(s.code);
      }
    }
    return { groupId: g.id, requests, plannedRequests, sources: [...used].sort() };
  });
  const total = out.reduce((a, g) => a + g.requests, 0);
  return { groups: out, total, budget, overBudget: total > budget };
}
