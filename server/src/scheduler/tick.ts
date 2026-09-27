// The scheduler: every tick, fire each active schedule whose cron slot is due, once per slot.
// A firing creates a crawl_run, expands it into crawl_job rows (the ledger) and puts the runnable
// jobs on their source's queue. Runs as the system (worker / scripts), never from the API.
import type { SourceCategory } from '../collector/catalogue.js';
import { adapters } from '../collector/sources.js';
import { config } from '../lib/config.js';
import { DEFAULT_REQUEST_BUDGET, type CostGroup } from '../lib/cost.js';
import { withSystem, type Db } from '../lib/db.js';
import { sourceQueue } from '../lib/queue.js';
import type { ScheduleSelector } from '../lib/schedules.js';
import type { OptionsSchema } from '../lib/sourceOptions.js';
import { dueSlot } from './due.js';
import { expandFiring, queuePriority, type ExpandInput, type FiringSchedule, type PlannedJob } from './expand.js';

interface ScheduleRow {
  id: string;
  account_id: string;
  name: string;
  selector: ScheduleSelector;
  priority: number;
  active: boolean;
  cadence: string;
  timezone: string;
  listing_scope: FiringSchedule['listingScope'];
  listing_status: FiringSchedule['listingStatus'];
  takedown_status: FiringSchedule['takedownStatus'];
  last_fired: Date | null;
}

const toFiring = (r: ScheduleRow): FiringSchedule => ({
  id: r.id,
  name: r.name,
  selector: r.selector ?? {},
  priority: r.priority,
  active: r.active,
  cadence: r.cadence,
  timezone: r.timezone,
  listingScope: r.listing_scope,
  listingStatus: r.listing_status,
  takedownStatus: r.takedown_status,
});

/** Everything expandFiring needs about one account. */
export async function loadAccountWork(db: Db, accountId: string): Promise<Omit<ExpandInput, 'firing' | 'adapters'>> {
  const schedules = (
    await db.query<ScheduleRow>(
      `SELECT id, account_id, name, selector, priority, active, cadence, timezone, listing_scope, listing_status, takedown_status, NULL AS last_fired
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
    await db.query<{ id: string; source_id: string; url: string; state: ExpandInput['listings'][number]['state'] }>(
      `SELECT l.id, l.source_id, l.url, m.state FROM listing_match m JOIN listing l ON l.id = m.listing_id
        WHERE m.account_id = $1 AND l.origin <> 'synthetic' ORDER BY l.source_id, l.url`,
      [accountId],
    )
  ).rows.map((l) => ({ id: l.id, sourceId: l.source_id, url: l.url, state: l.state }));

  const settings = (await db.query<{ settings: Record<string, unknown> }>('SELECT settings FROM account WHERE id = $1', [accountId])).rows[0]?.settings ?? {};
  const budget = Number(settings.request_budget ?? DEFAULT_REQUEST_BUDGET) || DEFAULT_REQUEST_BUDGET;

  return { schedules, sources, groups: [...groupMap.values()], terms, listings, budget };
}

export interface FiredRun {
  crawlRunId: string;
  accountId: string;
  schedule: string;
  slot: Date;
  queued: number;
  skipped: Record<string, number>;
}

/** Runs being executed inline by this process (CLI): jobs they add are not put on Redis. */
export const inlineRuns = new Set<string>();

/** Write jobs for a run and queue the runnable ones. Returns how many were queued. */
export async function addJobs(
  runId: string,
  accountId: string,
  schedulePriority: number,
  jobs: PlannedJob[],
  kind?: 'recheck',
  opts: { enqueue?: boolean } = {},
): Promise<number> {
  if (!jobs.length) return 0;
  const rows = await withSystem(async (db) => {
    const inserted = (
      await db.query<{ id: string; source_code: string; kind: 'discover' | 'collect' | 'recheck'; status: string }>(
        `INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind, term_id, listing_id, url, priority, status, skip_reason)
         SELECT $1, $2, j.source_id, j.kind, j.term_id, j.listing_id, j.url, $3,
                CASE WHEN j.skip_reason IS NULL THEN 'queued' ELSE 'skipped' END, j.skip_reason
           FROM jsonb_to_recordset($4::jsonb) AS j(source_id uuid, kind text, term_id uuid, listing_id uuid, url text, skip_reason text)
         RETURNING id, (SELECT code FROM source WHERE id = crawl_job.source_id) AS source_code, kind, status`,
        [
          runId,
          accountId,
          schedulePriority,
          JSON.stringify(jobs.map((j) => ({ source_id: j.sourceId, kind: kind ?? j.kind, term_id: j.termId, listing_id: j.listingId, url: j.url, skip_reason: j.skipReason }))),
        ],
      )
    ).rows;
    const queued = inserted.filter((r) => r.status === 'queued').length;
    await db.query(`UPDATE crawl_run SET jobs_total = jobs_total + $2, status = CASE WHEN $2 > 0 THEN 'running' ELSE status END WHERE id = $1`, [runId, queued]);
    return inserted;
  });

  // Inline runs (CLI) leave the jobs in the table for the caller to run; workers take them from Redis.
  if (opts.enqueue === false || inlineRuns.has(runId)) return rows.filter((r) => r.status === 'queued').length;
  const bySource = new Map<string, typeof rows>();
  for (const r of rows.filter((x) => x.status === 'queued')) bySource.set(r.source_code, [...(bySource.get(r.source_code) ?? []), r]);
  for (const [code, list] of bySource) {
    await sourceQueue(code).addBulk(
      list.map((r) => ({ name: r.kind, data: { crawlJobId: r.id }, opts: { jobId: r.id, priority: queuePriority(schedulePriority, r.kind) } })),
    );
  }
  return rows.filter((r) => r.status === 'queued').length;
}

/** Fire one schedule for one slot (idempotent per slot). Null when that slot already has a run. */
export async function fireSchedule(
  scheduleId: string,
  slot: Date,
  trigger: 'schedule' | 'manual' = 'schedule',
  opts: { enqueue?: boolean } = {},
): Promise<FiredRun | null> {
  const prepared = await withSystem(async (db) => {
    const s = (
      await db.query<ScheduleRow>(
        `SELECT id, account_id, name, selector, priority, active, cadence, timezone, listing_scope, listing_status, takedown_status, NULL AS last_fired
           FROM schedule WHERE id = $1`,
        [scheduleId],
      )
    ).rows[0];
    if (!s) throw new Error(`schedule ${scheduleId} not found`);
    const run = (
      await db.query<{ id: string }>(
        `INSERT INTO crawl_run (trigger, account_id, schedule_id, fired_for, scope, egress_label, status, jobs_total)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0)
         ON CONFLICT (schedule_id, fired_for) WHERE schedule_id IS NOT NULL DO NOTHING RETURNING id`,
        [trigger, s.account_id, s.id, slot, JSON.stringify({ schedule: s.name }), config.COLLECT_EGRESS_LABEL],
      )
    ).rows[0];
    if (!run) return null;
    const work = await loadAccountWork(db, s.account_id);
    return { s, runId: run.id, work };
  });
  if (!prepared) return null;

  const { s, runId, work } = prepared;
  const jobs = expandFiring({ ...work, firing: toFiring(s), adapters });
  const skipped: Record<string, number> = {};
  for (const j of jobs) if (j.skipReason) skipped[j.skipReason] = (skipped[j.skipReason] ?? 0) + 1;
  const planned = summarizePlan(jobs);
  await withSystem((db) => db.query('UPDATE crawl_run SET planned = $2 WHERE id = $1', [runId, JSON.stringify(planned)]));

  let queued = 0;
  try {
    if (opts.enqueue === false) inlineRuns.add(runId);
    queued = await addJobs(runId, s.account_id, s.priority, jobs, undefined, opts);
  } catch (err) {
    await withSystem((db) => db.query(`UPDATE crawl_run SET status = 'failed', finished_at = now() WHERE id = $1`, [runId])).catch(() => undefined);
    throw err;
  }
  if (queued === 0) {
    // Nothing to do (all skipped): the run is finished now, and its health still gets recorded.
    await withSystem((db) => db.query(`UPDATE crawl_run SET status = 'finished', finished_at = now() WHERE id = $1`, [runId]));
    const { finalizeRun } = await import('../collector/jobs.js');
    await finalizeRun(runId);
  }
  return { crawlRunId: runId, accountId: s.account_id, schedule: s.name, slot, queued, skipped };
}

/** Per source: jobs planned to run and skipped by reason (kept on the run for Data Health). */
export function summarizePlan(jobs: PlannedJob[]): Record<string, { run: number; skipped: Record<string, number> }> {
  const out: Record<string, { run: number; skipped: Record<string, number> }> = {};
  for (const j of jobs) {
    const s = (out[j.sourceCode] ??= { run: 0, skipped: {} });
    if (j.skipReason) s.skipped[j.skipReason] = (s.skipped[j.skipReason] ?? 0) + 1;
    else s.run += 1;
  }
  return out;
}

/** One scheduler tick: fire every due schedule. */
export async function schedulerTick(now: Date = new Date()): Promise<FiredRun[]> {
  const schedules = await withSystem(
    async (db) =>
      (
        await db.query<ScheduleRow>(
          `SELECT s.id, s.account_id, s.name, s.selector, s.priority, s.active, s.cadence, s.timezone, s.listing_scope,
                  s.listing_status, s.takedown_status, (SELECT max(fired_for) FROM crawl_run r WHERE r.schedule_id = s.id AND r.trigger = 'schedule') AS last_fired
             FROM schedule s JOIN account a ON a.id = s.account_id
            WHERE s.active AND a.status <> 'Suspended'`,
        )
      ).rows,
  );
  const fired: FiredRun[] = [];
  for (const s of schedules) {
    const slot = dueSlot(s.cadence, s.timezone, now, s.last_fired);
    if (!slot) continue;
    try {
      const r = await fireSchedule(s.id, slot);
      if (r) fired.push(r);
    } catch (err) {
      console.error(`[scheduler] ${s.name} (${s.account_id}) failed to fire: ${(err as Error).message}`);
    }
  }
  return fired;
}
