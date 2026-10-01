// Data Health: per-source health of the account's latest collection runs, recent failures with
// their evidence, and "Re-run failed". Reads source_health_snapshot and crawl_job (RLS by account).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant } from '../../lib/db.js';
import { enqueueCrawlJobs } from '../../lib/queue.js';
import { signedUrl } from '../../lib/storage.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };

const FRESH_HOURS = 24;

interface SnapshotRow {
  source_id: string;
  code: string;
  name: string;
  subscribed: boolean;
  crawl_run_id: string | null;
  created_at: Date | null;
  egress_label: string | null;
  jobs_planned: number;
  jobs_executed: number;
  jobs_skipped: Record<string, number>;
  fetch_total: number;
  fetch_ok: number;
  extract_total: number;
  extract_ok: number;
  held: number;
  evidence_total: number;
  evidence_ok: number;
  expected_listings: number;
  observed_listings: number;
  discovered: number;
  failure_counts: Record<string, number>;
  main_failure: string | null;
  health: string | null;
  last_success_at: Date | null;
  failure_streak: number;
  stopped: { reason: string; after: number; cancelled: number; at: string } | null;
}

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

const rerunBody = z.object({ source: z.string().trim().max(64).optional() });

export async function dataHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Params }>('/accounts/:accountId/health', { config: { permission: 'health.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      // The latest snapshot per source, for every source the account subscribes to (or had a snapshot for).
      const rows = (
        await db.query<SnapshotRow>(
          `WITH latest AS (
             SELECT DISTINCT ON (source_id) * FROM source_health_snapshot WHERE account_id = $1 ORDER BY source_id, created_at DESC)
           SELECT s.id AS source_id, s.code, s.display_name AS name, (a.source_id IS NOT NULL AND a.active) AS subscribed,
                  l.crawl_run_id, l.created_at, l.egress_label, coalesce(l.jobs_planned, 0) AS jobs_planned,
                  coalesce(l.jobs_executed, 0) AS jobs_executed, coalesce(l.jobs_skipped, '{}') AS jobs_skipped,
                  coalesce(l.fetch_total, 0) AS fetch_total, coalesce(l.fetch_ok, 0) AS fetch_ok,
                  coalesce(l.extract_total, 0) AS extract_total, coalesce(l.extract_ok, 0) AS extract_ok, coalesce(l.held, 0) AS held,
                  coalesce(l.evidence_total, 0) AS evidence_total, coalesce(l.evidence_ok, 0) AS evidence_ok,
                  coalesce(l.expected_listings, 0) AS expected_listings, coalesce(l.observed_listings, 0) AS observed_listings,
                  coalesce(l.discovered, 0) AS discovered, coalesce(l.failure_counts, '{}') AS failure_counts, l.main_failure,
                  l.health, l.last_success_at, coalesce(l.failure_streak, 0) AS failure_streak,
                  (SELECT cr.stopped -> s.code FROM crawl_run cr WHERE cr.id = l.crawl_run_id) AS stopped
             FROM source s
             LEFT JOIN account_source a ON a.source_id = s.id AND a.account_id = $1
             LEFT JOIN latest l ON l.source_id = s.id
            WHERE (a.source_id IS NOT NULL AND a.active) OR l.source_id IS NOT NULL
            ORDER BY s.display_name`,
          [req.params.accountId],
        )
      ).rows;

      const now = Date.now();
      const sum = (k: keyof SnapshotRow) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
      const skippedTotal = rows.reduce((n, r) => n + Object.values(r.jobs_skipped).reduce((a, b) => a + b, 0), 0);
      const withListings = rows.filter((r) => r.subscribed && r.expected_listings > 0);
      const fresh = withListings.filter((r) => r.last_success_at && now - new Date(r.last_success_at).getTime() <= FRESH_HOURS * 3_600_000);
      const lastRun = (
        await db.query<{ id: string; started_at: Date; finished_at: Date | null; status: string; egress_label: string | null; trigger: string }>(
          `SELECT r.id, r.started_at, r.finished_at, r.status, r.egress_label, r.trigger FROM crawl_run r
            WHERE r.account_id = $1 AND EXISTS (SELECT 1 FROM crawl_job j WHERE j.crawl_run_id = r.id)
            ORDER BY r.started_at DESC LIMIT 1`,
          [req.params.accountId],
        )
      ).rows[0];

      return {
        kpis: {
          // Work done / work wanted (planned + skipped for robots, budget, no collector ...).
          coverage: ratio(sum('jobs_executed'), sum('jobs_planned') + skippedTotal),
          freshness: { met: fresh.length, total: withListings.length, hours: FRESH_HOURS },
          extraction: ratio(sum('extract_ok'), sum('extract_total')),
          evidence: ratio(sum('evidence_ok'), sum('evidence_total')),
          held: sum('held'),
        },
        lastRun: lastRun
          ? { id: lastRun.id, startedAt: lastRun.started_at, finishedAt: lastRun.finished_at, status: lastRun.status, egress: lastRun.egress_label, trigger: lastRun.trigger }
          : null,
        sources: rows.map((r) => ({
          code: r.code,
          name: r.name,
          subscribed: r.subscribed,
          health: r.health ?? 'No data',
          checkedAt: r.created_at,
          egress: r.egress_label,
          lastSuccessAt: r.last_success_at,
          failureStreak: r.failure_streak,
          observed: r.observed_listings,
          expected: r.expected_listings,
          discovered: r.discovered,
          fetch: { ok: r.fetch_ok, total: r.fetch_total },
          extraction: { ok: r.extract_ok, total: r.extract_total },
          evidence: { ok: r.evidence_ok, total: r.evidence_total },
          held: r.held,
          jobs: { planned: r.jobs_planned, executed: r.jobs_executed, skipped: r.jobs_skipped },
          failures: r.failure_counts,
          mainFailure: r.main_failure,
          // M5: the run stopped this source after consecutive blocked pages.
          stopped: r.stopped ?? null,
        })),
      };
    }),
  );

  app.get<{ Params: Params & { source: string }; Querystring: { limit?: string } }>(
    '/accounts/:accountId/health/:source/failures',
    { config: { permission: 'health.read' } },
    async (req) =>
      withTenant(req.params.accountId, async (db) => {
        const limit = Math.min(Number.parseInt(req.query.limit ?? '50', 10) || 50, 200);
        const { rows } = await db.query(
          `SELECT j.id, j.kind, j.failure_class, j.skip_reason, j.status, j.error, j.url, j.attempts, j.method,
                  coalesce(j.finished_at, j.queued_at) AS at, j.crawl_run_id, l.title AS listing_title, t.value AS term,
                  e.id AS evidence_id, rp.results_page_id, rp.results_pages
             FROM crawl_job j
             JOIN source s ON s.id = j.source_id
             LEFT JOIN listing l ON l.id = j.listing_id
             LEFT JOIN term t ON t.id = j.term_id
             LEFT JOIN evidence e ON e.observation_id = j.observation_id
             -- A discover job's results pages (M4): the last one read is the one that failed.
             LEFT JOIN LATERAL (
               SELECT (array_agg(p.id ORDER BY p.page_no DESC))[1] AS results_page_id, count(*)::int AS results_pages
                 FROM results_page p WHERE p.crawl_job_id = j.id) rp ON true
            WHERE j.account_id = $1 AND s.code = $2
              AND (j.status = 'failed' OR (j.status = 'skipped' AND j.skip_reason IN ('robots', 'not_executable', 'no_collector', 'cancelled')))
            ORDER BY coalesce(j.finished_at, j.queued_at) DESC
            LIMIT $3`,
          [req.params.accountId, req.params.source, limit],
        );
        return rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          failureClass: r.status === 'skipped' ? r.skip_reason : r.failure_class,
          skipped: r.status === 'skipped',
          error: r.error,
          url: r.url,
          attempts: r.attempts,
          method: r.method,
          at: r.at,
          runId: r.crawl_run_id,
          listingTitle: r.listing_title,
          term: r.term,
          evidenceId: r.evidence_id,
          resultsPageId: r.results_page_id,
          resultsPages: r.results_pages ?? 0,
        }));
      }),
  );

  // One search / browse results page as it was read (M4): HTML + screenshot with their hashes.
  app.get<{ Params: Params & { pageId: string } }>(
    '/accounts/:accountId/results-pages/:pageId',
    { config: { permission: 'observations.read' } },
    async (req) =>
      withTenant(req.params.accountId, async (db) => {
        const r = (
          await db.query(
            `SELECT p.*, s.code AS source, (SELECT count(*)::int FROM results_page_listing x WHERE x.results_page_id = p.id) AS listings
               FROM results_page p JOIN source s ON s.id = p.source_id WHERE p.id = $1`,
            [uuidOr404(req.params.pageId, 'results page')],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'results page not found');
        return {
          id: r.id,
          source: r.source,
          term: r.term_value,
          pageNo: r.page_no,
          url: r.url,
          finalUrl: r.final_url,
          fetchedAt: r.fetched_at,
          method: r.method,
          httpStatus: r.http_status,
          block: r.block,
          failureClass: r.failure_class,
          itemsFound: r.items_found,
          listings: r.listings,
          lock: r.lock_mode ? { mode: r.lock_mode, until: r.lock_until } : null,
          html: r.html_uri ? { sha256: r.html_sha256, bytes: r.html_bytes, url: await signedUrl(r.html_uri) } : null,
          screenshot: r.screenshot_uri ? { sha256: r.screenshot_sha256, bytes: r.screenshot_bytes, url: await signedUrl(r.screenshot_uri) } : null,
          api: r.api_uri ? { sha256: r.api_sha256, bytes: r.api_bytes, url: await signedUrl(r.api_uri) } : null,
        };
      }),
  );

  // Re-run the failed jobs of the latest finished run as a new manual run (optionally one source).
  app.post<{ Params: Params }>('/accounts/:accountId/health/rerun', { config: { permission: 'collection.run' } }, async (req, reply) => {
    const body = parse(rerunBody, req.body ?? {});
    const accountId = req.params.accountId;
    const result = await withTenant(accountId, async (db) => {
      const last = (
        await db.query<{ id: string }>(
          `SELECT id FROM crawl_run WHERE account_id = $1 AND status = 'finished' ORDER BY started_at DESC LIMIT 1`,
          [accountId],
        )
      ).rows[0];
      if (!last) throw new HttpError(404, 'no finished collection run yet');
      const run = (
        await db.query<{ id: string }>(
          `INSERT INTO crawl_run (trigger, account_id, scope, status, jobs_total) VALUES ('manual', $1, $2, 'queued', 0) RETURNING id`,
          [accountId, JSON.stringify({ rerunOf: last.id, source: body.source ?? null })],
        )
      ).rows[0];
      const jobs = (
        await db.query<{ id: string; source_code: string; kind: 'discover' | 'collect' | 'recheck' }>(
          `INSERT INTO crawl_job (crawl_run_id, account_id, source_id, kind, term_id, listing_id, url, priority)
           SELECT $2, j.account_id, j.source_id, j.kind, j.term_id, j.listing_id, j.url, j.priority
             FROM crawl_job j JOIN source s ON s.id = j.source_id
            WHERE j.crawl_run_id = $1 AND j.status = 'failed' AND ($3::text IS NULL OR s.code = $3)
           RETURNING id, (SELECT code FROM source WHERE id = crawl_job.source_id) AS source_code, kind`,
          [last.id, run.id, body.source ?? null],
        )
      ).rows;
      await db.query(
        `UPDATE crawl_run SET jobs_total = $2, status = CASE WHEN $2 > 0 THEN 'running' ELSE 'finished' END,
                finished_at = CASE WHEN $2 > 0 THEN NULL ELSE now() END WHERE id = $1`,
        [run.id, jobs.length],
      );
      await recordAudit(db, {
        accountId,
        actor: actorFrom(req),
        action: 'crawl_run.rerun',
        entityType: 'crawl_run',
        entityId: run.id,
        summary: `Re-ran ${jobs.length} failed collection jobs${body.source ? ` on ${body.source}` : ''}`,
        after: { rerunOf: last.id, jobs: jobs.length, source: body.source ?? null },
        requestId: req.id,
      });
      return { crawlRunId: run.id, jobs };
    });
    // Queued after the commit, so a worker never picks up a job whose row is not visible yet.
    if (result.jobs.length) await enqueueCrawlJobs(result.jobs, 50);
    return reply.code(202).send({ crawlRunId: result.crawlRunId, jobs: result.jobs.length });
  });
}
