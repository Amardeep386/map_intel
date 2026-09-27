-- MAP Intel · Phase 2b · M1: scheduled runs and their jobs.
-- A crawl_run is one firing of one account's schedule (or a manual / recheck run). A crawl_job is
-- one unit of work in it: discover (a term on a source: search or browse page), collect (one
-- listing's product page) or recheck (a held observation read again). Jobs are the ledger that
-- coverage, source health and "Re-run failed" are computed from.

ALTER TABLE crawl_run
  ADD COLUMN account_id  uuid REFERENCES account(id) ON DELETE CASCADE,
  ADD COLUMN schedule_id uuid REFERENCES schedule(id) ON DELETE SET NULL,
  ADD COLUMN fired_for   timestamptz,                    -- the cron slot this run is for
  ADD COLUMN planned     jsonb NOT NULL DEFAULT '{}'::jsonb; -- per source: jobs planned / skipped and why

-- One run per schedule slot, however many scheduler ticks see it.
CREATE UNIQUE INDEX crawl_run_fire_uq ON crawl_run (schedule_id, fired_for) WHERE schedule_id IS NOT NULL;
CREATE INDEX crawl_run_account_idx ON crawl_run (account_id, started_at DESC);

CREATE TABLE crawl_job (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_run_id    uuid NOT NULL REFERENCES crawl_run(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  source_id       uuid NOT NULL REFERENCES source(id),
  kind            text NOT NULL CHECK (kind IN ('discover', 'collect', 'recheck')),
  term_id         uuid REFERENCES term(id) ON DELETE SET NULL,
  listing_id      uuid REFERENCES listing(id),
  url             text,                                   -- page to fetch (search, browse or product page)
  page            integer NOT NULL DEFAULT 1,             -- result page for discover jobs
  priority        integer NOT NULL DEFAULT 10,            -- 0..100, higher first (schedule priority)
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  skip_reason     text CHECK (skip_reason IN ('robots', 'budget', 'no_collector', 'not_executable', 'not_carried')),
  attempts        integer NOT NULL DEFAULT 0,
  failure_class   text CHECK (failure_class IN ('blocked', 'layout_changed', 'timeout', 'empty', 'auth', 'robots', 'network', 'not_found')),
  method          text,                                   -- http | browser | api
  requests        integer NOT NULL DEFAULT 0,             -- requests actually made (budget)
  found           integer,                                -- discover: listings on the page
  observation_id  uuid,                                   -- collect / recheck: what it stored
  error           text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX crawl_job_run_idx ON crawl_job (crawl_run_id, status);
CREATE INDEX crawl_job_source_idx ON crawl_job (account_id, source_id, queued_at DESC);
CREATE INDEX crawl_job_listing_idx ON crawl_job (listing_id, queued_at DESC) WHERE listing_id IS NOT NULL;

ALTER TABLE crawl_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_job FORCE ROW LEVEL SECURITY;
CREATE POLICY crawl_job_tenant ON crawl_job
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());
