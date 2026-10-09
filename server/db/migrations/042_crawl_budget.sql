-- MAP Intel · Phase 5 · M3: org-wide crawl budget.
--   * crawl_budget: daily request caps set by Mirethos platform administrators, across all
--     accounts: one per source (source_id) and one for the whole organisation (source_id NULL).
--     No row = no cap. Each account's own request_budget (per run) still applies first.
--   * crawl_job.cost: the requests a job was planned to make (pages), so queued work counts
--     against today's budget before it runs. Done jobs count what they actually made (requests).
--   * crawl_job.skip_reason 'org_budget': skipped because a source's or the organisation's daily
--     cap was reached (shown in Data Health).
--   * app_crawl_usage: requests per day, account and source across accounts, for the platform
--     dashboard (crawl_job is tenant-scoped, so the API reads it through this function).

SELECT set_config('app.role', 'system', true);

ALTER TABLE crawl_job ADD COLUMN cost integer NOT NULL DEFAULT 1 CHECK (cost >= 0);
ALTER TABLE crawl_job DROP CONSTRAINT crawl_job_skip_reason_check;
ALTER TABLE crawl_job ADD CONSTRAINT crawl_job_skip_reason_check
  CHECK (skip_reason IN ('robots', 'budget', 'org_budget', 'no_collector', 'not_executable', 'not_carried', 'cancelled'));
CREATE INDEX crawl_job_queued_day_idx ON crawl_job (queued_at, source_id);

CREATE TABLE crawl_budget (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid REFERENCES source(id) ON DELETE CASCADE,   -- NULL = the whole organisation
  daily_requests  integer NOT NULL CHECK (daily_requests > 0),
  note            text,
  updated_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (source_id)
);
-- Platform configuration: written by the API role only (platform routes), never by a tenant.
REVOKE INSERT, UPDATE, DELETE ON crawl_budget FROM mapintel_tenant;

-- Requests per UTC day, account and source. Done / failed jobs count the requests they made;
-- queued / running jobs count their planned cost; skipped jobs count nothing (budget skips are
-- counted separately).
CREATE OR REPLACE FUNCTION app_crawl_usage(p_from date, p_to date)
RETURNS TABLE (day date, account_id uuid, source_id uuid, requests bigint, jobs bigint, budget_skips bigint, org_budget_skips bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (j.queued_at AT TIME ZONE 'UTC')::date, j.account_id, j.source_id,
         coalesce(sum(CASE WHEN j.status IN ('queued', 'running') THEN j.cost WHEN j.status IN ('done', 'failed') THEN j.requests ELSE 0 END), 0),
         count(*) FILTER (WHERE j.status <> 'skipped'),
         count(*) FILTER (WHERE j.skip_reason = 'budget'),
         count(*) FILTER (WHERE j.skip_reason = 'org_budget')
    FROM crawl_job j
   WHERE j.queued_at >= p_from::timestamp AT TIME ZONE 'UTC' AND j.queued_at < (p_to + 1)::timestamp AT TIME ZONE 'UTC'
   GROUP BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION app_crawl_usage(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_crawl_usage(date, date) TO mapintel_api;
