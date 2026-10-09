-- MAP Intel · Phase 5 · M5: replay at scale.
--   A replay run is now a background job worked in batches (lib/replay.ts): queued -> running ->
--   done | failed. Each batch of observations is evaluated and stored in its own transaction and
--   moves the cursor (observed_at, observation id), so a run survives an API restart: the hourly
--   job (npm run replays) resumes any run whose lease has expired. The lease stops two workers
--   taking the same run.
--   * mode 'version'  (P3): one rule version against the live rule set, as before.
--   * mode 'ruleset' (P5): the account's rule set as it was in force at each observation,
--     re-evaluated now, against the verdict stored at the time. Finds drift after an engine or
--     data change. rule_version_id is NULL.
--   * batch_id groups the runs a platform administrator started together across accounts.

SELECT set_config('app.role', 'system', true);

ALTER TABLE replay_run ALTER COLUMN rule_version_id DROP NOT NULL;
ALTER TABLE replay_run ADD COLUMN mode text NOT NULL DEFAULT 'version' CHECK (mode IN ('version', 'ruleset'));
ALTER TABLE replay_run ADD CONSTRAINT replay_run_mode_version CHECK ((mode = 'version') = (rule_version_id IS NOT NULL));
ALTER TABLE replay_run DROP CONSTRAINT replay_run_status_check;
ALTER TABLE replay_run ADD CONSTRAINT replay_run_status_check CHECK (status IN ('queued', 'running', 'done', 'failed'));
ALTER TABLE replay_run ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE replay_run ADD COLUMN total integer NOT NULL DEFAULT 0;        -- observations in range when queued
ALTER TABLE replay_run ADD COLUMN processed integer NOT NULL DEFAULT 0;
ALTER TABLE replay_run ADD COLUMN cursor_at timestamptz;                   -- last observation done (observed_at, id)
ALTER TABLE replay_run ADD COLUMN cursor_id uuid;
ALTER TABLE replay_run ADD COLUMN lease_until timestamptz;
ALTER TABLE replay_run ADD COLUMN started_at timestamptz;
ALTER TABLE replay_run ADD COLUMN batch_id uuid;
CREATE INDEX replay_run_pending_idx ON replay_run (status, lease_until) WHERE status IN ('queued', 'running');
CREATE INDEX replay_run_batch_idx ON replay_run (batch_id) WHERE batch_id IS NOT NULL;

-- For the platform screen: every account's runs of one batch, read across accounts.
CREATE OR REPLACE FUNCTION app_replay_batches(p_limit integer)
RETURNS TABLE (batch_id uuid, account_id uuid, account text, run_id uuid, status text, total integer, processed integer,
               range_from timestamptz, range_to timestamptz, summary jsonb, error text, created_at timestamptz, finished_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH b AS (SELECT r.batch_id, max(r.created_at) AS at FROM replay_run r WHERE r.batch_id IS NOT NULL GROUP BY r.batch_id ORDER BY at DESC LIMIT p_limit)
  SELECT r.batch_id, r.account_id, a.name, r.id, r.status, r.total, r.processed, r.range_from, r.range_to, r.summary, r.error, r.created_at, r.finished_at
    FROM replay_run r JOIN b ON b.batch_id = r.batch_id JOIN account a ON a.id = r.account_id
   ORDER BY b.at DESC, a.name
$$;
REVOKE ALL ON FUNCTION app_replay_batches(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_replay_batches(integer) TO mapintel_api;
