-- MAP Intel · Phase 5 · M6: retention and audit hardening.
--
-- 1. Tamper-evident audit log. Every audit_event gets a sequence number and a SHA-256 hash of its
--    content chained to the previous event of the same chain (one chain per account, one for
--    platform events). Changing, removing or reordering an event breaks every hash after it;
--    app_audit_verify finds the first break. Inserts take a per-chain advisory lock so the chain
--    is linear. Existing events are chained here, in occurred_at order.
-- 2. Retention (lib/retention.ts, npm run retention). Old evidence files, observations and audit
--    events are deleted per the accounts' retention settings, never anything behind an open
--    violation or an unresolved case. The append-only guards allow a DELETE only when the system
--    sets app.purging = 'on' in its own transaction; the API role can never do that.
--    audit_checkpoint keeps the hash of the last purged event of each chain, so verification
--    starts from it. retention_run logs every run (dry runs too).

SELECT set_config('app.role', 'system', true);

-- ---------------------------------------------------------------------------
-- Purging exception in the append-only guards (system only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_purging() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.purging', true), '') = 'on' AND app_is_system()
$$;

CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND app_purging() THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE OR REPLACE FUNCTION audit_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (pg_trigger_depth() > 1 OR app_purging()) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_event is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

-- ---------------------------------------------------------------------------
-- Audit hash chain
-- ---------------------------------------------------------------------------
CREATE SEQUENCE audit_event_seq;
ALTER TABLE audit_event ADD COLUMN seq bigint;
ALTER TABLE audit_event ADD COLUMN prev_hash char(64);
ALTER TABLE audit_event ADD COLUMN hash char(64);

CREATE TABLE audit_checkpoint (
  account_id      uuid REFERENCES account(id) ON DELETE CASCADE,   -- NULL = the platform chain
  last_seq        bigint NOT NULL,
  last_hash       char(64) NOT NULL,
  purged_before   timestamptz NOT NULL,
  purged_count    bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (account_id)
);
REVOKE ALL ON audit_checkpoint FROM mapintel_tenant;
REVOKE INSERT, UPDATE, DELETE ON audit_checkpoint FROM mapintel_api;

-- The hash of one event: its content as an unambiguous JSON array, after the previous hash.
CREATE OR REPLACE FUNCTION audit_digest(p_prev text, e audit_event) RETURNS char(64)
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    coalesce(p_prev, ''), e.seq, e.id, e.account_id,
    to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    e.actor_type, e.actor_id, e.actor_label, e.action, e.entity_type, e.entity_id, e.summary,
    e.before, e.after, e.request_id
  )::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_event_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(NEW.account_id::text, 'platform'), 0));
  NEW.seq := nextval('audit_event_seq');
  SELECT hash INTO v_prev FROM audit_event
   WHERE account_id IS NOT DISTINCT FROM NEW.account_id ORDER BY seq DESC LIMIT 1;
  IF v_prev IS NULL THEN
    SELECT last_hash INTO v_prev FROM audit_checkpoint WHERE account_id IS NOT DISTINCT FROM NEW.account_id;
  END IF;
  NEW.prev_hash := v_prev;
  NEW.hash := audit_digest(v_prev, NEW);
  RETURN NEW;
END
$$;

-- Chain the events written so far, oldest first, per chain.
ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only;
DO $$
DECLARE
  r audit_event;
  v_prev char(64);
  v_chain text := NULL;
  v_seq bigint;
  v_hash char(64);
BEGIN
  FOR r IN SELECT * FROM audit_event ORDER BY coalesce(account_id::text, ''), occurred_at, id LOOP
    IF v_chain IS DISTINCT FROM coalesce(r.account_id::text, '') THEN
      v_chain := coalesce(r.account_id::text, '');
      v_prev := NULL;
    END IF;
    v_seq := nextval('audit_event_seq');
    r.seq := v_seq;
    v_hash := audit_digest(v_prev, r);
    UPDATE audit_event SET seq = v_seq, prev_hash = v_prev, hash = v_hash WHERE id = r.id;
    v_prev := v_hash;
  END LOOP;
END
$$;
ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only;

ALTER TABLE audit_event ALTER COLUMN seq SET NOT NULL;
ALTER TABLE audit_event ALTER COLUMN hash SET NOT NULL;
CREATE UNIQUE INDEX audit_event_seq_uq ON audit_event (seq);
CREATE INDEX audit_event_chain_idx ON audit_event (account_id, seq);
CREATE TRIGGER audit_event_chain BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_event_chain();

-- Verify one chain: recompute every hash and check each event points at the one before it.
-- Returns how many events were checked and the first broken one (NULL when the chain holds).
CREATE OR REPLACE FUNCTION app_audit_verify(p_account uuid)
RETURNS TABLE (checked bigint, first_seq bigint, last_seq bigint, last_hash char(64), broken_seq bigint, broken_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH anchor AS (SELECT (SELECT last_hash FROM audit_checkpoint WHERE account_id IS NOT DISTINCT FROM p_account) AS h),
  c AS (
    SELECT e.seq, e.prev_hash, e.hash, audit_digest(e.prev_hash, e) AS recomputed,
           lag(e.hash) OVER (ORDER BY e.seq) AS before_hash, row_number() OVER (ORDER BY e.seq) AS n
      FROM audit_event e WHERE e.account_id IS NOT DISTINCT FROM p_account
  ),
  bad AS (
    SELECT c.seq, CASE
             WHEN c.recomputed <> c.hash THEN 'content changed'
             WHEN c.n > 1 AND c.prev_hash IS DISTINCT FROM c.before_hash THEN 'an event before it is missing or was changed'
             ELSE 'the first event does not follow the last purged one'
           END AS reason
      FROM c, anchor
     WHERE c.recomputed <> c.hash
        OR (c.n > 1 AND c.prev_hash IS DISTINCT FROM c.before_hash)
        OR (c.n = 1 AND c.prev_hash IS DISTINCT FROM anchor.h)
     ORDER BY c.seq LIMIT 1
  )
  SELECT (SELECT count(*) FROM c), (SELECT min(seq) FROM c), (SELECT max(seq) FROM c),
         (SELECT hash FROM c ORDER BY seq DESC LIMIT 1), (SELECT seq FROM bad), (SELECT reason FROM bad)
$$;
REVOKE ALL ON FUNCTION app_audit_verify(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_audit_verify(uuid) TO mapintel_api;

-- ---------------------------------------------------------------------------
-- Retention runs (platform log)
-- ---------------------------------------------------------------------------
CREATE TABLE retention_run (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applied      boolean NOT NULL,                  -- false = dry run (counted, nothing deleted)
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text
);
REVOKE ALL ON retention_run FROM mapintel_tenant;
REVOKE INSERT, UPDATE, DELETE ON retention_run FROM mapintel_api;
