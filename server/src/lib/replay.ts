// Replay at scale (Phase 5 · M5). A replay is a background run worked in batches of BATCH
// observations; each batch is evaluated, stored in replay_result and moves the run's cursor in its
// own transaction, so a run survives restarts and the hourly job resumes it (resumeReplays).
//   mode 'version'  one rule version in place of every version of its rule, over the whole range,
//                   against the live rule set (the P3 replay). live_outcome = the live rule set's outcome.
//   mode 'ruleset'  the account's rules as in force at each observation, evaluated now, against the
//                   verdict stored at the time. live_outcome = the stored verdict (NULL = never judged).
// A lease (lease_until) keeps two workers off the same run; each batch renews it.
import type { Db } from './db.js';
import { judgeOne, loadContext, loadObservations, loadRules, rulesAt, type ObservationRow } from './judge.js';
import { asDated, FAR_PAST, loadVersion, RuleError } from './ruleAdmin.js';
import type { Outcome } from './rules.js';

export const BATCH = 2000;
export const LEASE_SECONDS = 120;
const VIOLATING = "('violation', 'needs_review')";

export interface ReplayRun {
  id: string;
  account_id: string;
  rule_version_id: string | null;
  mode: 'version' | 'ruleset';
  range_from: Date;
  range_to: Date;
  status: 'queued' | 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  cursor_at: Date | null;
  cursor_id: string | null;
  lease_until: Date | null;
}

/** Queue a run. The total is the number of observations in range now (progress only). */
export async function startReplay(
  db: Db,
  accountId: string,
  target: { mode: 'version'; versionId: string } | { mode: 'ruleset' },
  from: Date,
  to: Date,
  userId: string | null,
  batchId: string | null = null,
): Promise<{ id: string; total: number }> {
  if (!(to > from)) throw new RuleError(400, 'the range must end after it starts');
  const versionId = target.mode === 'version' ? (await loadVersion(db, target.versionId)).id : null;
  const total = Number((await db.query(
    `SELECT count(*) FROM observation o
       JOIN listing l ON l.id = o.listing_id
       JOIN listing_match m ON m.listing_id = l.id AND m.account_id = $1 AND m.state = 'Included' AND m.product_id IS NOT NULL
      WHERE o.status = 'ok' AND o.advertised_price IS NOT NULL AND l.origin <> 'synthetic' AND o.observed_at >= $2 AND o.observed_at < $3`,
    [accountId, from, to],
  )).rows[0].count);
  const id = (await db.query<{ id: string }>(
    `INSERT INTO replay_run (account_id, rule_version_id, mode, range_from, range_to, status, total, created_by, batch_id)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8) RETURNING id`,
    [accountId, versionId, target.mode, from, to, total, userId, batchId],
  )).rows[0].id;
  return { id, total };
}

/** Take the run if nobody holds it. Returns the run with a fresh lease, or null. */
export async function claim(db: Db, runId: string): Promise<ReplayRun | null> {
  return (await db.query<ReplayRun>(
    `UPDATE replay_run SET status = 'running', started_at = coalesce(started_at, now()),
            lease_until = date_trunc('milliseconds', now() + make_interval(secs => $2))
      WHERE id = $1 AND status IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < now())
      RETURNING *`,
    [runId, LEASE_SECONDS],
  )).rows[0] ?? null;
}

/** Pure: which comparisons count as newly / no longer violating. */
export function isViolatingOutcome(o: string | null): boolean {
  return o === 'violation' || o === 'needs_review';
}

interface ResultRow {
  observation_id: string;
  observed_at: Date;
  listing_id: string;
  seller_id: string | null;
  outcome: Outcome;
  severity: string | null;
  depth_pct: number | null;
  live_outcome: string | null;
}

async function evaluateBatch(db: Db, run: ReplayRun, obs: ObservationRow[]): Promise<ResultRow[]> {
  const live = await loadRules(db, run.account_id);
  const ctx = await loadContext(db, run.account_id, obs, live);
  const row = (o: ObservationRow, c: ReturnType<typeof judgeOne>['evaluation'], liveOutcome: string | null): ResultRow => ({
    observation_id: o.id, observed_at: o.observed_at, listing_id: o.listing_id, seller_id: o.seller_id,
    outcome: c.outcome, severity: c.severity, depth_pct: c.depthPct, live_outcome: liveOutcome,
  });
  if (run.mode === 'version') {
    const v = await loadVersion(db, run.rule_version_id!);
    const others = live.filter((r) => r.ruleId !== v.rule_id);
    const cand = asDated(v, FAR_PAST, null);
    return obs.map((o) => row(o, judgeOne(ctx, o, [...rulesAt(others, o.observed_at), cand]).evaluation, judgeOne(ctx, o, live).evaluation.outcome));
  }
  const stored = new Map(
    (await db.query<{ observation_id: string; outcome: string }>(
      'SELECT observation_id, outcome FROM verdict WHERE account_id = $1 AND observation_id = ANY($2::uuid[])',
      [run.account_id, obs.map((o) => o.id)],
    )).rows.map((r) => [r.observation_id, r.outcome]),
  );
  return obs.map((o) => row(o, judgeOne(ctx, o, live).evaluation, stored.get(o.id) ?? null));
}

/**
 * One batch: evaluate the next BATCH observations after the cursor, store them, move the cursor and
 * renew the lease. When none are left, write the summary and finish. Returns true when finished.
 * Refuses (returns null) if the lease is no longer this worker's.
 */
export async function step(db: Db, runId: string, lease: Date, batchSize = BATCH): Promise<{ done: boolean; lease: Date } | null> {
  const run = (await db.query<ReplayRun>('SELECT * FROM replay_run WHERE id = $1 AND lease_until = $2 FOR UPDATE', [runId, lease])).rows[0];
  if (!run || run.status !== 'running') return null;
  const obs = await loadObservations(db, run.account_id, {
    from: run.range_from, to: run.range_to, limit: batchSize,
    after: run.cursor_at && run.cursor_id ? { at: run.cursor_at, id: run.cursor_id } : undefined,
  });
  if (!obs.length) {
    const summary = await summariseRun(db, run);
    await db.query("UPDATE replay_run SET status = 'done', summary = $2, finished_at = now(), lease_until = NULL WHERE id = $1", [runId, JSON.stringify(summary)]);
    return { done: true, lease };
  }
  const rows = await evaluateBatch(db, run, obs);
  await db.query(
    `INSERT INTO replay_result (replay_run_id, account_id, observation_id, observed_at, listing_id, seller_id, outcome, severity, depth_pct, live_outcome)
     SELECT $1, $2, x.observation_id, x.observed_at, x.listing_id, x.seller_id, x.outcome, x.severity, x.depth_pct, x.live_outcome
       FROM jsonb_to_recordset($3::jsonb) AS x(observation_id uuid, observed_at timestamptz, listing_id uuid, seller_id uuid,
                                                outcome text, severity text, depth_pct numeric, live_outcome text)
     ON CONFLICT DO NOTHING`,
    [runId, run.account_id, JSON.stringify(rows)],
  );
  const last = obs[obs.length - 1];
  const next = (await db.query<{ lease_until: Date }>(
    `UPDATE replay_run SET cursor_at = $2, cursor_id = $3, processed = processed + $4, lease_until = date_trunc('milliseconds', now() + make_interval(secs => $5))
      WHERE id = $1 RETURNING lease_until`,
    [runId, last.observed_at, last.id, obs.length, LEASE_SECONDS],
  )).rows[0].lease_until;
  return { done: false, lease: next };
}

/** The run's summary from its stored results (no observations held in memory). */
export async function summariseRun(db: Db, run: Pick<ReplayRun, 'id' | 'mode'>) {
  const t = (await db.query(
    `SELECT count(*)::int AS observations, count(DISTINCT listing_id)::int AS listings,
            count(*) FILTER (WHERE live_outcome IN ${VIOLATING})::int AS violations_live,
            count(*) FILTER (WHERE outcome IN ${VIOLATING})::int AS violations_candidate,
            count(*) FILTER (WHERE outcome IN ${VIOLATING} AND live_outcome IS DISTINCT FROM 'violation' AND live_outcome IS DISTINCT FROM 'needs_review')::int AS newly,
            count(*) FILTER (WHERE live_outcome IN ${VIOLATING} AND outcome NOT IN ${VIOLATING})::int AS no_longer,
            count(*) FILTER (WHERE outcome IS DISTINCT FROM live_outcome)::int AS changed,
            count(*) FILTER (WHERE live_outcome IS NULL)::int AS not_judged
       FROM replay_result WHERE replay_run_id = $1`,
    [run.id],
  )).rows[0];
  const bySeller = (await db.query(
    `SELECT r.seller_id AS "sellerId", coalesce(s.name, CASE WHEN r.seller_id IS NULL THEN 'No seller' ELSE 'Unknown seller' END) AS seller,
            count(*) FILTER (WHERE r.outcome IN ${VIOLATING} AND r.live_outcome IS DISTINCT FROM 'violation' AND r.live_outcome IS DISTINCT FROM 'needs_review')::int AS newly,
            count(*) FILTER (WHERE r.live_outcome IN ${VIOLATING} AND r.outcome NOT IN ${VIOLATING})::int AS "noLonger"
       FROM replay_result r LEFT JOIN seller s ON s.id = r.seller_id
      WHERE r.replay_run_id = $1
      GROUP BY r.seller_id, s.name
     HAVING count(*) FILTER (WHERE (r.outcome IN ${VIOLATING}) IS DISTINCT FROM (r.live_outcome IN ${VIOLATING})) > 0
      ORDER BY 3 DESC, 4 DESC LIMIT 50`,
    [run.id],
  )).rows;
  return {
    mode: run.mode,
    observations: t.observations,
    listings: t.listings,
    violationsLive: t.violations_live,
    violationsCandidate: t.violations_candidate,
    newlyViolating: t.newly,
    noLongerViolating: t.no_longer,
    changed: t.changed,
    notJudged: t.not_judged,
    bySeller,
  };
}

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/**
 * Work a run to the end, one transaction per batch. Safe to call from several places: only the
 * holder of the lease works it. Marks the run failed on an error (the cursor is kept).
 */
export async function runReplay(runId: string, withDb: WithDb, opts: { maxBatches?: number; batchSize?: number } = {}): Promise<'done' | 'busy' | 'paused' | 'failed'> {
  const claimed = await withDb((db) => claim(db, runId));
  if (!claimed) return 'busy';
  let lease = claimed.lease_until!;
  try {
    for (let i = 0; i < (opts.maxBatches ?? Infinity); i++) {
      const r = await withDb((db) => step(db, runId, lease, opts.batchSize));
      if (!r) return 'busy';
      if (r.done) return 'done';
      lease = r.lease;
    }
    // Stopped early on purpose (tests): free the lease so another worker can carry on.
    await withDb((db) => db.query('UPDATE replay_run SET lease_until = NULL WHERE id = $1 AND lease_until = $2', [runId, lease]));
    return 'paused';
  } catch (err) {
    await withDb((db) =>
      db.query("UPDATE replay_run SET status = 'failed', error = $2, finished_at = now(), lease_until = NULL WHERE id = $1", [runId, (err as Error).message.slice(0, 500)]),
    ).catch(() => undefined);
    return 'failed';
  }
}

/** Runs to pick up: queued or running with no live lease (the API stopped mid-run). System only. */
export async function pendingReplays(db: Db): Promise<{ id: string; account_id: string }[]> {
  return (await db.query<{ id: string; account_id: string }>(
    `SELECT id, account_id FROM replay_run
      WHERE status IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < now())
        AND created_at < now() - interval '1 minute'
      ORDER BY created_at`,
  )).rows;
}

/** Queue and work a run to the end on this connection (one transaction): tests and small inline runs. */
export async function replayNow(
  db: Db,
  accountId: string,
  target: { mode: 'version'; versionId: string } | { mode: 'ruleset' },
  from: Date,
  to: Date,
  userId: string | null,
) {
  const { id } = await startReplay(db, accountId, target, from, to, userId);
  const run = await claim(db, id);
  let lease = run!.lease_until!;
  for (;;) {
    const r = await step(db, id, lease);
    if (!r) throw new Error('replay lease lost');
    if (r.done) break;
    lease = r.lease;
  }
  const done = (await db.query<{ summary: Awaited<ReturnType<typeof summariseRun>> }>('SELECT summary FROM replay_run WHERE id = $1', [id])).rows[0];
  return { id, summary: done.summary };
}
