-- MAP Intel · Phase 3 · M4: expiring, scoped evidence links.
-- A link is never an open URL: only the SHA-256 of its token is stored, it has one scope, an expiry,
-- and can be revoked. 'violation:view' opens one violation's evidence page; 'report:view' opens one
-- hosted report run (report_run arrives in migration 033). Views are counted.

SELECT set_config('app.role', 'system', true);

CREATE TABLE evidence_link (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  token_hash      char(64) NOT NULL UNIQUE,
  scope           text NOT NULL CHECK (scope IN ('violation:view', 'report:view')),
  violation_id    uuid REFERENCES violation(id) ON DELETE CASCADE,
  report_run_id   uuid,                                  -- FK added with report_run (033)
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  views           integer NOT NULL DEFAULT 0,
  last_viewed_at  timestamptz,
  created_by      uuid,                                  -- NULL = system (report run)
  created_via     text NOT NULL DEFAULT 'portal' CHECK (created_via IN ('portal', 'report', 'alert', 'test')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'violation:view' AND violation_id IS NOT NULL) OR (scope = 'report:view' AND report_run_id IS NOT NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX evidence_link_violation_idx ON evidence_link (violation_id);

ALTER TABLE evidence_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_link FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_link_tenant ON evidence_link
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

-- The public page knows only the token. This resolves its hash to the link (any state, so the page
-- can say "expired" or "revoked") and counts a view when the link is usable.
CREATE OR REPLACE FUNCTION app_open_evidence_link(p_token_hash text)
RETURNS TABLE (link_id uuid, account_id uuid, scope text, violation_id uuid, report_run_id uuid, expires_at timestamptz, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  l evidence_link%ROWTYPE;
  st text;
BEGIN
  SELECT * INTO l FROM evidence_link WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  st := CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at <= now() THEN 'expired' ELSE 'open' END;
  IF st = 'open' THEN
    UPDATE evidence_link SET views = views + 1, last_viewed_at = now() WHERE id = l.id;
  END IF;
  RETURN QUERY SELECT l.id, l.account_id, l.scope, l.violation_id, l.report_run_id, l.expires_at, st;
END
$$;
REVOKE ALL ON FUNCTION app_open_evidence_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_open_evidence_link(text) TO mapintel_api;
