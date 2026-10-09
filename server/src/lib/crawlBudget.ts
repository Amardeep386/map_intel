// Org-wide crawl budget (Phase 5 · M3). Mirethos sets daily request caps per source and for the
// whole organisation (crawl_budget); every firing gets what is left today (UTC) and skips the rest
// as 'org_budget'. The platform dashboard shows caps, usage per day / account / source, and a
// forecast of each account's daily requests from its schedules.
import cronParser from 'cron-parser';
import { adapters } from '../collector/sources.js';
import { expandFiring, type DailyRemaining } from '../scheduler/expand.js';
import { loadAccountWork } from '../scheduler/work.js';
import type { Db } from './db.js';
import { isManual } from './schedules.js';

export interface Cap {
  sourceId: string | null; // null = organisation
  dailyRequests: number;
  note: string | null;
  updatedAt: string;
}

export interface UsageRow {
  day: string; // YYYY-MM-DD (UTC)
  accountId: string;
  sourceId: string;
  requests: number;
  jobs: number;
  budgetSkips: number;
  orgBudgetSkips: number;
}

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export async function loadCaps(db: Db): Promise<Cap[]> {
  const { rows } = await db.query('SELECT source_id, daily_requests, note, updated_at FROM crawl_budget ORDER BY source_id NULLS FIRST');
  return rows.map((r) => ({ sourceId: r.source_id, dailyRequests: r.daily_requests, note: r.note, updatedAt: r.updated_at }));
}

export async function loadUsage(db: Db, from: string, to: string): Promise<UsageRow[]> {
  // day as text: pg turns a date into a local-midnight Date, which shifts the day east of UTC.
  const { rows } = await db.query(
    'SELECT day::text AS day, account_id, source_id, requests, jobs, budget_skips, org_budget_skips FROM app_crawl_usage($1::date, $2::date) ORDER BY 1, 2, 3',
    [from, to],
  );
  return rows.map((r) => ({
    day: r.day,
    accountId: r.account_id,
    sourceId: r.source_id,
    requests: Number(r.requests),
    jobs: Number(r.jobs),
    budgetSkips: Number(r.budget_skips),
    orgBudgetSkips: Number(r.org_budget_skips),
  }));
}

/** Pure: caps minus today's usage, never below zero. */
export function remaining(caps: Cap[], todayUsage: Pick<UsageRow, 'sourceId' | 'requests'>[]): DailyRemaining {
  const bySource = new Map<string, number>();
  let total = 0;
  for (const u of todayUsage) {
    bySource.set(u.sourceId, (bySource.get(u.sourceId) ?? 0) + u.requests);
    total += u.requests;
  }
  const org = caps.find((c) => c.sourceId === null);
  const sources: Record<string, number> = {};
  for (const c of caps) if (c.sourceId) sources[c.sourceId] = Math.max(0, c.dailyRequests - (bySource.get(c.sourceId) ?? 0));
  return { org: org ? Math.max(0, org.dailyRequests - total) : null, sources };
}

/** What is left today under the caps (for a firing). Undefined when no caps are set. */
export async function dailyRemaining(db: Db, now: Date = new Date()): Promise<DailyRemaining | undefined> {
  const caps = await loadCaps(db);
  if (!caps.length) return undefined;
  const day = utcDay(now);
  return remaining(caps, await loadUsage(db, day, day));
}

/** How many times a cron schedule fires in the 24 hours after `now`. */
export function firesPerDay(cadence: string, timezone: string, now: Date = new Date()): number {
  if (isManual(cadence)) return 0;
  try {
    const it = cronParser.parseExpression(cadence, { currentDate: now, endDate: new Date(now.getTime() + 86_400_000), tz: timezone });
    let n = 0;
    while (it.hasNext() && n < 1440) {
      it.next();
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Requests per day per source this account's schedules would make (its own budget applied, no org caps). */
export async function forecastAccount(db: Db, accountId: string, now: Date = new Date()): Promise<Record<string, number>> {
  const work = await loadAccountWork(db, accountId);
  const out: Record<string, number> = {};
  for (const firing of work.schedules) {
    const fires = firesPerDay(firing.cadence, firing.timezone, now);
    if (!fires) continue;
    for (const j of expandFiring({ ...work, firing, adapters })) {
      if (j.skipReason) continue;
      out[j.sourceId] = (out[j.sourceId] ?? 0) + j.cost * fires;
    }
  }
  return out;
}
