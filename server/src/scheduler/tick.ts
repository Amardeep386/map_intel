// The scheduler: every tick, fire each active schedule whose cron slot is due, once per slot.
// A firing creates a crawl_run, expands it into crawl_job rows (the ledger) and puts the runnable
// jobs on their source's queue. Runs as the system (worker / scripts), never from the API.
import { adapters } from '../collector/sources.js';
import { config } from '../lib/config.js';
import { withSystem } from '../lib/db.js';
import { dailyRemaining } from '../lib/crawlBudget.js';
import { enqueueCrawlJobs } from '../lib/queue.js';
import { dueSlot } from './due.js';
import { expandFiring, type PlannedJob } from './expand.js';
import { loadAccountWork, toFiring, type ScheduleRow } from './work.js';

export { loadAccountWork };


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
        `INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind, term_id, listing_id, url, priority, status, skip_reason, cost)
         SELECT $1, $2, j.source_id, j.kind, j.term_id, j.listing_id, j.url, $3,
                CASE WHEN j.skip_reason IS NULL THEN 'queued' ELSE 'skipped' END, j.skip_reason, coalesce(j.cost, 1)
           FROM jsonb_to_recordset($4::jsonb) AS j(source_id uuid, kind text, term_id uuid, listing_id uuid, url text, skip_reason text, cost int)
         RETURNING id, (SELECT code FROM source WHERE id = crawl_job.source_id) AS source_code, kind, status`,
        [
          runId,
          accountId,
          schedulePriority,
          JSON.stringify(jobs.map((j) => ({ source_id: j.sourceId, kind: kind ?? j.kind, term_id: j.termId, listing_id: j.listingId, url: j.url, skip_reason: j.skipReason, cost: j.cost }))),
        ],
      )
    ).rows;
    const queued = inserted.filter((r) => r.status === 'queued').length;
    await db.query(`UPDATE crawl_run SET jobs_total = jobs_total + $2, status = CASE WHEN $2 > 0 THEN 'running' ELSE status END WHERE id = $1`, [runId, queued]);
    return inserted;
  });

  // Inline runs (CLI) leave the jobs in the table for the caller to run; workers take them from Redis.
  if (opts.enqueue === false || inlineRuns.has(runId)) return rows.filter((r) => r.status === 'queued').length;
  await enqueueCrawlJobs(rows.filter((r) => r.status === 'queued'), schedulePriority);
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
        `SELECT id, account_id, name, selector, priority, active, cadence, timezone, kind, listing_scope, listing_status, takedown_status, NULL AS last_fired
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
    const daily = await dailyRemaining(db);
    return { s, runId: run.id, work, daily };
  });
  if (!prepared) return null;

  const { s, runId, work, daily } = prepared;
  const jobs = expandFiring({ ...work, firing: toFiring(s), adapters, dailyRemaining: daily });
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

/**
 * Baseline crawls (Phase 5 · M1): an account that went live through guided onboarding gets one
 * manual run of each active schedule, once. Onboarding accounts are not crawled before that.
 */
export async function fireBaselines(now: Date = new Date(), opts: { enqueue?: boolean } = {}): Promise<FiredRun[]> {
  const due = await withSystem(
    async (db) =>
      (
        await db.query<{ account_id: string; schedule_ids: string[] }>(
          `SELECT o.account_id, coalesce(array_agg(s.id ORDER BY s.priority DESC) FILTER (WHERE s.id IS NOT NULL), '{}') AS schedule_ids
             FROM account_onboarding o
             JOIN account a ON a.id = o.account_id AND a.status = 'Active'
             LEFT JOIN schedule s ON s.account_id = o.account_id AND s.active
            WHERE o.baseline_requested_at IS NOT NULL AND o.baseline_fired_at IS NULL
            GROUP BY o.account_id`,
        )
      ).rows,
  );
  const fired: FiredRun[] = [];
  for (const d of due) {
    const runIds: string[] = [];
    for (const id of d.schedule_ids) {
      try {
        const r = await fireSchedule(id, now, 'manual', opts);
        if (r) {
          fired.push(r);
          runIds.push(r.crawlRunId);
        }
      } catch (err) {
        console.error(`[scheduler] baseline ${id} (${d.account_id}) failed to fire: ${(err as Error).message}`);
      }
    }
    await withSystem((db) =>
      db.query('UPDATE account_onboarding SET baseline_fired_at = now(), baseline_run_ids = baseline_run_ids || $2::uuid[] WHERE account_id = $1', [d.account_id, runIds]),
    );
  }
  return fired;
}

/** One scheduler tick: fire the baseline crawls asked for at go-live, then every due schedule. */
export async function schedulerTick(now: Date = new Date()): Promise<FiredRun[]> {
  const schedules = await withSystem(
    async (db) =>
      (
        await db.query<ScheduleRow>(
          `SELECT s.id, s.account_id, s.name, s.selector, s.priority, s.active, s.cadence, s.timezone, s.kind, s.listing_scope,
                  s.listing_status, s.takedown_status, (SELECT max(fired_for) FROM crawl_run r WHERE r.schedule_id = s.id AND r.trigger = 'schedule') AS last_fired
             FROM schedule s JOIN account a ON a.id = s.account_id
            WHERE s.active AND a.status IN ('Sandbox', 'Active')`,
        )
      ).rows,
  );
  const fired: FiredRun[] = await fireBaselines(now);
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
