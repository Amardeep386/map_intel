-- MAP Intel · Phase 1 · M3: audit log.
-- One row per change: who (a person, a rule, a model version or the system), when, what,
-- and the entity before and after. Append-only. Written in the same transaction as the change.
-- No foreign key to app_user, so the history survives when a user is removed.

CREATE TABLE audit_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid REFERENCES account(id) ON DELETE CASCADE,   -- NULL = platform-level change
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_type    text NOT NULL CHECK (actor_type IN ('user', 'rule', 'system', 'model')),
  actor_id      text,                                            -- user id, rule id + version, model version
  actor_label   text NOT NULL,                                   -- shown in the portal (email, "Rule AI-01 v2")
  action        text NOT NULL,                                   -- e.g. 'product.created', 'term_group.generated'
  entity_type   text NOT NULL,
  entity_id     text,
  summary       text,                                            -- one readable line for the Audit Log screen
  before        jsonb,
  after         jsonb,
  request_id    text
);
CREATE INDEX audit_event_account_idx ON audit_event (account_id, occurred_at DESC);
CREATE INDEX audit_event_entity_idx ON audit_event (entity_type, entity_id);

-- Append-only. The one exception: deleting a whole account (an owner-only operation) removes
-- its events through the foreign-key cascade, which runs one trigger level deeper.
CREATE OR REPLACE FUNCTION audit_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_event is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_guard();

-- The API never deletes accounts.
REVOKE DELETE ON account FROM mapintel_api, mapintel_tenant;

-- A tenant sees and writes only its own events. Platform events (account_id NULL) can be
-- written by the API outside any account; they are read by the platform (system) only.
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_read ON audit_event FOR SELECT
  USING (app_is_system() OR account_id = app_current_account());
CREATE POLICY audit_event_write ON audit_event FOR INSERT
  WITH CHECK (
    app_is_system()
    OR account_id = app_current_account()
    OR (account_id IS NULL AND app_current_account() IS NULL)
  );
