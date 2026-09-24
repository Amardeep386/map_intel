// Named, reusable schedules: which schedule applies to a piece of work, and when it runs next.
// Phase 1 stores and resolves schedules; the Phase 2b scheduler runs them.
import cronParser from 'cron-parser';

export interface ScheduleSelector {
  sources?: string[]; // source codes
  categories?: string[];
  families?: string[]; // family codes
  termGroups?: string[]; // term group ids
  terms?: string[]; // term ids
}

export interface ScheduleDef {
  id: string;
  name: string;
  selector: ScheduleSelector;
  priority: number;
  active: boolean;
  cadence: string;
  timezone: string;
}

/** One unit of work: a term on a source. */
export interface WorkTarget {
  source: string;
  category: string;
  family: string | null;
  termGroup: string | null;
  term: string | null;
}

const matchesList = (list: string[] | undefined, value: string | null) => !list || list.length === 0 || (value !== null && list.includes(value));

export function scheduleMatches(s: ScheduleSelector, t: WorkTarget): boolean {
  return (
    matchesList(s.sources, t.source) &&
    matchesList(s.categories, t.category) &&
    matchesList(s.families, t.family) &&
    matchesList(s.termGroups, t.termGroup) &&
    matchesList(s.terms, t.term)
  );
}

/** How narrow a selector is: more specific selectors win ties on priority. */
function specificity(s: ScheduleSelector): number {
  return (s.terms?.length ? 16 : 0) + (s.termGroups?.length ? 8 : 0) + (s.sources?.length ? 4 : 0) + (s.families?.length ? 2 : 0) + (s.categories?.length ? 1 : 0);
}

/** The active schedule that applies to `target`: highest priority, then most specific, then name. */
export function resolveSchedule<T extends ScheduleDef>(schedules: T[], target: WorkTarget): T | null {
  const hits = schedules.filter((s) => s.active && scheduleMatches(s.selector, target));
  hits.sort((a, b) => b.priority - a.priority || specificity(b.selector) - specificity(a.selector) || a.name.localeCompare(b.name));
  return hits[0] ?? null;
}

/** Validate a cron expression + IANA timezone; returns the next run or an error message. */
export function nextRun(cadence: string, timezone: string, from: Date = new Date()): { next: Date } | { error: string } {
  if (cadence.trim().split(/\s+/).length !== 5) return { error: 'cadence must be a 5-field cron expression, e.g. "0 6 * * *"' };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return { error: `unknown timezone "${timezone}"` };
  }
  try {
    const it = cronParser.parseExpression(cadence, { currentDate: from, tz: timezone });
    return { next: it.next().toDate() };
  } catch (err) {
    return { error: `invalid cadence: ${(err as Error).message}` };
  }
}
