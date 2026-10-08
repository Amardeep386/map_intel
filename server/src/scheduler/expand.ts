// One schedule firing → the jobs of its run. Pure (no I/O), so it is tested exhaustively.
//   schedules × subscriptions × terms: a term goes to the sources its group's matrix cell selects,
//   and belongs to this firing only if this schedule is the one that resolves for (term, source).
//   Listings: re-collect the account's listings in the schedule's listing scope.
// Collect jobs come first (monitoring known listings matters most), then discovery; jobs beyond
// the account's request budget are kept as skipped ('budget') so Data Health shows them.
import type { SourceCategory, TermType } from '../collector/catalogue.js';
import { planTerm } from '../collector/discovery.js';
import type { SourceAdapter } from '../collector/types.js';
import { sourcesForCell, type CostGroup, type CostSource } from '../lib/cost.js';
import { resolveSchedule, runsDiscovery, runsMonitoring, type ScheduleDef, type WorkTarget } from '../lib/schedules.js';
import { resolveOptions, termCost } from '../lib/sourceOptions.js';

export interface FiringSchedule extends ScheduleDef {
  listingScope: 'Included only' | 'Included and Staged' | 'All';
  listingStatus: 'Active only' | 'Inactive only' | 'All';
  takedownStatus: 'All' | 'Under notice' | 'Not under notice';
}

export interface ExpandSource extends CostSource {
  family: string | null;
}

export interface ExpandTerm {
  id: string;
  groupId: string;
  type: TermType;
  value: string;
}

export interface ExpandListing {
  id: string;
  sourceId: string;
  url: string;
  state: 'Staged' | 'Included' | 'Excluded' | 'Retired';
  /** An active violation of the listing is Under notice (a notice went out in its case). */
  underNotice?: boolean;
}

export interface ExpandInput {
  firing: FiringSchedule;
  /** All active schedules of the account (the firing one included). */
  schedules: FiringSchedule[];
  sources: ExpandSource[];
  groups: Pick<CostGroup, 'id' | 'cells'>[];
  terms: ExpandTerm[];
  listings: ExpandListing[];
  budget: number;
  adapters: Record<string, SourceAdapter>;
}

export type SkipReason = 'robots' | 'budget' | 'no_collector' | 'not_executable' | 'not_carried' | 'cancelled';

export interface PlannedJob {
  kind: 'discover' | 'collect';
  sourceId: string;
  sourceCode: string;
  termId: string | null;
  listingId: string | null;
  url: string | null;
  /** search | browse | product (discover jobs) */
  mode: 'search' | 'browse' | 'product' | null;
  pages: number;
  cost: number;
  priority: number;
  skipReason: SkipReason | null;
}

const LISTING_STATES: Record<FiringSchedule['listingScope'], ExpandListing['state'][]> = {
  'Included only': ['Included'],
  'Included and Staged': ['Included', 'Staged'],
  All: ['Included', 'Staged', 'Excluded'],
};

function listingStates(f: FiringSchedule): ExpandListing['state'][] {
  if (f.listingStatus === 'Inactive only') return ['Retired'];
  const states = LISTING_STATES[f.listingScope];
  return f.listingStatus === 'All' ? [...states, 'Retired'] : states;
}

export function expandFiring(input: ExpandInput): PlannedJob[] {
  const { firing } = input;
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  // Which schedules compete for a piece of work. Discovery belongs to sweep schedules only: an
  // "Under notice" schedule re-checks listings under notice, nothing else. Sweep schedules compete
  // for every listing; the "Under notice" schedules compete among themselves for the listings under
  // notice (Phase 4), which the sweep still collects too: a re-check on top of the daily cadence.
  // A monitoring-only schedule never takes discovery, and a discovery-only one never takes
  // listings: each piece of work goes to the schedules that run that kind of work.
  const recheck = firing.takedownStatus === 'Under notice';
  const competing = input.schedules.filter((s) => s.takedownStatus !== 'Under notice');
  const discoverers = competing.filter(runsDiscovery);
  const monitors = (recheck ? input.schedules.filter((s) => s.takedownStatus === 'Under notice') : competing).filter(runsMonitoring);
  const ownsTerm = (t: WorkTarget) => !recheck && runsDiscovery(firing) && resolveSchedule(discoverers, t)?.id === firing.id;
  const ownsListing = (t: WorkTarget) => runsMonitoring(firing) && resolveSchedule(monitors, t)?.id === firing.id;
  const takedownFits = (l: ExpandListing) =>
    firing.takedownStatus === 'All' || (firing.takedownStatus === 'Under notice') === Boolean(l.underNotice);
  const target = (s: ExpandSource, termGroup: string | null, term: string | null): WorkTarget => ({
    source: s.code,
    category: s.category,
    family: s.family,
    termGroup,
    term,
  });
  const job = (s: ExpandSource, p: Partial<PlannedJob>): PlannedJob => ({
    kind: 'collect',
    sourceId: s.id,
    sourceCode: s.code,
    termId: null,
    listingId: null,
    url: null,
    mode: null,
    pages: 1,
    cost: 1,
    priority: firing.priority,
    skipReason: null,
    ...p,
  });

  // 1. Re-collect known listings.
  const collect: PlannedJob[] = [];
  const states = new Set(listingStates(firing));
  for (const l of input.listings) {
    const s = byId.get(l.sourceId);
    if (!s || s.subscription?.active !== true || !states.has(l.state) || !takedownFits(l) || !ownsListing(target(s, null, null))) continue;
    collect.push(job(s, { listingId: l.id, url: l.url, skipReason: input.adapters[s.code] ? null : 'no_collector' }));
  }

  // 2. Discovery: each term on the sources its group's cell selects.
  const discover: PlannedJob[] = [];
  const groups = new Map(input.groups.map((g) => [g.id, g]));
  for (const term of input.terms) {
    const g = groups.get(term.groupId);
    if (!g) continue;
    const targets = new Set<ExpandSource>();
    for (const [category, cell] of Object.entries(g.cells) as [SourceCategory, CostGroup['cells'][SourceCategory]][])
      for (const s of sourcesForCell(input.sources, category, cell)) targets.add(s as ExpandSource);
    for (const s of targets) {
      if (!ownsTerm(target(s, term.groupId, term.id))) continue;
      const plan = planTerm(input.adapters[s.code], s.code, term);
      if (plan.kind === 'ignore') continue;
      if (plan.kind === 'skip') {
        discover.push(job(s, { kind: 'discover', termId: term.id, cost: 0, skipReason: plan.reason }));
        continue;
      }
      const values = resolveOptions(s.schema, s.subscription?.options ?? {}).values;
      const pages = plan.kind === 'product' ? 1 : Math.max(1, termCost(s.schema, values, term.type));
      discover.push(job(s, { kind: 'discover', termId: term.id, url: plan.url, mode: plan.kind, pages, cost: pages }));
    }
  }

  // 3. One job per URL per source (a listing's page, a shared search), collect jobs winning.
  const seen = new Set<string>();
  const unique = [...collect, ...discover].filter((j) => {
    if (!j.url || j.skipReason) return true;
    const key = `${j.sourceId}|${j.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. Budget, in order.
  let used = 0;
  for (const j of unique) {
    if (j.skipReason) continue;
    if (used + j.cost > input.budget) j.skipReason = 'budget';
    else used += j.cost;
  }
  return unique;
}

export { queuePriority } from '../lib/queue.js';
