// Source health per source × account × run (Data Health). The pure part computes the numbers and
// the band; recordRunHealth reads a finished run and writes one snapshot per subscribed source.
import type { FailureClass } from '../collector/types.js';
import { withSystem, type Db } from './db.js';
import { retireListings } from './mapping.js';

export type Health = 'Healthy' | 'Degraded' | 'Failing' | 'Blocked' | 'Idle';

export interface JobFact {
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  skipReason: string | null;
  failureClass: FailureClass | null;
  found: number | null;
}

export interface ObservationFact {
  status: string;
  priced: boolean;
  evidenceComplete: boolean;
}

export interface HealthInput {
  jobs: JobFact[];
  observations: ObservationFact[];
  expectedListings: number;
  observedListings: number;
  lastSuccessAt: Date | null;
  previousStreak: number;
  now: Date;
}

export interface HealthNumbers {
  jobsPlanned: number;
  jobsExecuted: number;
  jobsSkipped: Record<string, number>;
  fetchTotal: number;
  fetchOk: number;
  extractTotal: number;
  extractOk: number;
  held: number;
  evidenceTotal: number;
  evidenceOk: number;
  expectedListings: number;
  observedListings: number;
  discovered: number;
  failureCounts: Record<string, number>;
  mainFailure: string | null;
  health: Health;
  lastSuccessAt: Date | null;
  failureStreak: number;
}

// Failures that mean we never got a real page.
const FETCH_FAILURES = new Set<FailureClass>(['blocked', 'timeout', 'network', 'auth']);

export const THRESHOLDS = { blocked: 0.5, fetch: 0.5, extract: 0.9, coverage: 0.8, freshnessHours: 24, streak: 3 } as const;

export function computeHealth(i: HealthInput): HealthNumbers {
  const skipped = i.jobs.filter((j) => j.status === 'skipped');
  const planned = i.jobs.filter((j) => j.status !== 'skipped');
  const executed = planned.filter((j) => j.status === 'done' || j.status === 'failed');
  const jobsSkipped: Record<string, number> = {};
  for (const j of skipped) jobsSkipped[j.skipReason ?? 'other'] = (jobsSkipped[j.skipReason ?? 'other'] ?? 0) + 1;
  const failureCounts: Record<string, number> = {};
  for (const j of executed) if (j.failureClass) failureCounts[j.failureClass] = (failureCounts[j.failureClass] ?? 0) + 1;
  const mainFailure = Object.entries(failureCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const fetched = executed.filter((j) => j.failureClass !== 'robots');
  const fetchOk = fetched.filter((j) => !j.failureClass || !FETCH_FAILURES.has(j.failureClass)).length;
  // Of the real pages, how many we could read (a sold-out page or "no results" is read correctly).
  const extractOk = fetched.filter((j) => (!j.failureClass || !FETCH_FAILURES.has(j.failureClass)) && j.failureClass !== 'layout_changed').length;
  const priced = i.observations.filter((o) => o.priced);

  const n: Omit<HealthNumbers, 'health' | 'failureStreak'> = {
    jobsPlanned: planned.length,
    jobsExecuted: executed.length,
    jobsSkipped,
    fetchTotal: fetched.length,
    fetchOk,
    extractTotal: fetchOk,
    extractOk,
    held: i.observations.filter((o) => o.status === 'held').length,
    evidenceTotal: priced.length,
    evidenceOk: priced.filter((o) => o.evidenceComplete).length,
    expectedListings: i.expectedListings,
    observedListings: i.observedListings,
    discovered: executed.reduce((s, j) => s + (j.found ?? 0), 0),
    failureCounts,
    mainFailure,
    lastSuccessAt: i.lastSuccessAt,
  };

  let health: Health;
  if (planned.length === 0) health = 'Idle';
  else if (fetched.length > 0 && (failureCounts.blocked ?? 0) / fetched.length >= THRESHOLDS.blocked) health = 'Blocked';
  else if (fetched.length === 0 || fetchOk / fetched.length < THRESHOLDS.fetch) health = 'Failing';
  else {
    const extractRate = n.extractTotal ? extractOk / n.extractTotal : 1;
    const coverage = i.expectedListings ? i.observedListings / i.expectedListings : 1;
    const stale = !i.lastSuccessAt || i.now.getTime() - i.lastSuccessAt.getTime() > THRESHOLDS.freshnessHours * 3_600_000;
    health = extractRate < THRESHOLDS.extract || coverage < THRESHOLDS.coverage || (stale && i.expectedListings > 0) ? 'Degraded' : 'Healthy';
  }
  const failureStreak = health === 'Healthy' || health === 'Idle' ? 0 : i.previousStreak + 1;
  if (health === 'Degraded' && failureStreak >= THRESHOLDS.streak) health = 'Failing';
  return { ...n, health, failureStreak };
}

/** Listings whose page was "not found" on the last 3 collections are retired for the account. */
async function retireGoneListings(db: Db, accountId: string): Promise<number> {
  const ids = (
    await db.query<{ listing_id: string }>(
      `SELECT m.listing_id FROM listing_match m
        WHERE m.account_id = $1 AND m.state IN ('Included', 'Staged')
          AND (SELECT count(*) FILTER (WHERE o.status = 'not_found') = 3 AND count(*) = 3
                 FROM (SELECT status FROM observation o WHERE o.listing_id = m.listing_id ORDER BY observed_at DESC LIMIT 3) o)`,
      [accountId],
    )
  ).rows.map((r) => r.listing_id);
  return ids.length ? retireListings(db, accountId, ids, 'Not found on 3 consecutive collections') : 0;
}

/** Write the health snapshots of a finished run (one per source the account subscribes to). */
export async function recordRunHealth(crawlRunId: string, now: Date = new Date()): Promise<void> {
  await withSystem(async (db) => {
    const run = (await db.query<{ account_id: string | null; egress_label: string | null }>('SELECT account_id, egress_label FROM crawl_run WHERE id = $1', [crawlRunId])).rows[0];
    if (!run?.account_id) return; // P0-style runs without an account have no per-account health
    const accountId = run.account_id;

    const sources = (
      await db.query<{ source_id: string }>(
        `SELECT source_id FROM account_source WHERE account_id = $1 AND active
         UNION SELECT DISTINCT source_id FROM crawl_job WHERE crawl_run_id = $2`,
        [accountId, crawlRunId],
      )
    ).rows.map((r) => r.source_id);

    for (const sourceId of sources) {
      const jobs = (
        await db.query<{ status: JobFact['status']; skip_reason: string | null; failure_class: FailureClass | null; found: number | null }>(
          'SELECT status, skip_reason, failure_class, found FROM crawl_job WHERE crawl_run_id = $1 AND source_id = $2',
          [crawlRunId, sourceId],
        )
      ).rows.map((j) => ({ status: j.status, skipReason: j.skip_reason, failureClass: j.failure_class, found: j.found }));

      const observations = (
        await db.query<{ status: string; priced: boolean; complete: boolean }>(
          `SELECT o.status, o.advertised_price IS NOT NULL AS priced,
                  EXISTS (SELECT 1 FROM evidence e WHERE e.observation_id = o.id AND e.html_uri IS NOT NULL AND e.screenshot_uri IS NOT NULL) AS complete
             FROM observation o JOIN crawl_job j ON j.id = o.crawl_job_id
            WHERE j.crawl_run_id = $1 AND j.source_id = $2`,
          [crawlRunId, sourceId],
        )
      ).rows.map((o) => ({ status: o.status, priced: o.priced, evidenceComplete: o.complete }));

      const cov = (
        await db.query<{ expected: number; observed: number; last_success: Date | null }>(
          `WITH inc AS (
             SELECT m.listing_id FROM listing_match m JOIN listing l ON l.id = m.listing_id
              WHERE m.account_id = $1 AND l.source_id = $2 AND m.state = 'Included' AND l.origin <> 'synthetic')
           SELECT (SELECT count(*) FROM inc)::int AS expected,
                  (SELECT count(DISTINCT o.listing_id) FROM observation o
                    WHERE o.crawl_run_id = $3 AND o.listing_id IN (SELECT listing_id FROM inc)
                      AND o.status IN ('ok', 'partial', 'held'))::int AS observed,
                  (SELECT max(o.observed_at) FROM observation o
                    WHERE o.listing_id IN (SELECT m.listing_id FROM listing_match m JOIN listing l ON l.id = m.listing_id
                                             WHERE m.account_id = $1 AND l.source_id = $2)
                      AND o.status IN ('ok', 'partial')) AS last_success`,
          [accountId, sourceId, crawlRunId],
        )
      ).rows[0];

      const previousStreak =
        (
          await db.query<{ failure_streak: number }>(
            'SELECT failure_streak FROM source_health_snapshot WHERE account_id = $1 AND source_id = $2 ORDER BY created_at DESC LIMIT 1',
            [accountId, sourceId],
          )
        ).rows[0]?.failure_streak ?? 0;

      const h = computeHealth({ jobs, observations, expectedListings: cov.expected, observedListings: cov.observed, lastSuccessAt: cov.last_success, previousStreak, now });
      await db.query(
        `INSERT INTO source_health_snapshot (account_id, source_id, crawl_run_id, egress_label, jobs_planned, jobs_executed, jobs_skipped,
           fetch_total, fetch_ok, extract_total, extract_ok, held, evidence_total, evidence_ok, expected_listings, observed_listings,
           discovered, failure_counts, main_failure, health, last_success_at, failure_streak)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (crawl_run_id, source_id) DO NOTHING`,
        [accountId, sourceId, crawlRunId, run.egress_label, h.jobsPlanned, h.jobsExecuted, JSON.stringify(h.jobsSkipped), h.fetchTotal, h.fetchOk,
          h.extractTotal, h.extractOk, h.held, h.evidenceTotal, h.evidenceOk, h.expectedListings, h.observedListings, h.discovered,
          JSON.stringify(h.failureCounts), h.mainFailure, h.health, h.lastSuccessAt, h.failureStreak],
      );
    }
    await retireGoneListings(db, accountId);
  });
}
