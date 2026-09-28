-- MAP Intel · Phase 2b · M1: source health per source × account × run (Data Health screen).
-- Written once when a run finishes; later runs add new rows (a history, never edited).

CREATE TABLE source_health_snapshot (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  source_id          uuid NOT NULL REFERENCES source(id),
  crawl_run_id       uuid NOT NULL REFERENCES crawl_run(id) ON DELETE CASCADE,
  egress_label       text,
  jobs_planned       integer NOT NULL DEFAULT 0,   -- executable jobs (after robots / budget skips)
  jobs_executed      integer NOT NULL DEFAULT 0,   -- reached a result (done or failed)
  jobs_skipped       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { robots: n, budget: n, not_executable: n, ... }
  fetch_total        integer NOT NULL DEFAULT 0,
  fetch_ok           integer NOT NULL DEFAULT 0,   -- got a real page (not blocked / network / timeout)
  extract_total      integer NOT NULL DEFAULT 0,   -- real product pages
  extract_ok         integer NOT NULL DEFAULT 0,   -- ... with a price read
  held               integer NOT NULL DEFAULT 0,   -- suspicious prices held by the validator
  evidence_total     integer NOT NULL DEFAULT 0,   -- observations with a price
  evidence_ok        integer NOT NULL DEFAULT 0,   -- ... with HTML + screenshot stored
  expected_listings  integer NOT NULL DEFAULT 0,   -- included listings of the account on this source
  observed_listings  integer NOT NULL DEFAULT 0,   -- ... with a priced observation in this run
  discovered         integer NOT NULL DEFAULT 0,   -- listings found by discover jobs
  failure_counts     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { blocked: n, timeout: n, ... }
  main_failure       text,                         -- the most common failure class
  health             text NOT NULL CHECK (health IN ('Healthy', 'Degraded', 'Failing', 'Blocked', 'Idle')),
  last_success_at    timestamptz,                  -- latest priced observation on this source for the account
  failure_streak     integer NOT NULL DEFAULT 0,   -- consecutive runs not Healthy
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crawl_run_id, source_id)
);
CREATE INDEX source_health_latest_idx ON source_health_snapshot (account_id, source_id, created_at DESC);

CREATE TRIGGER source_health_snapshot_append_only
  BEFORE UPDATE OR DELETE ON source_health_snapshot
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

ALTER TABLE source_health_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_health_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY source_health_snapshot_tenant ON source_health_snapshot
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());
