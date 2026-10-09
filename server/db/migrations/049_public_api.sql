-- MAP Intel · Phase 5 · M9: read-only public API for the brands' BI teams.
--   * api_key: one account's key. The key is shown once ("mik_<prefix>_<secret>"); only its
--     SHA-256 is stored, and the prefix finds it. Read-only by design (the /v1 routes only read).
--     Revoked or expired keys stop at once.
--   * api_request_log: every /v1 call (key, path, status, rows, time), per account; the daily
--     retention run removes entries older than 90 days. Creating and revoking keys goes to the
--     tamper-evident audit log; single calls do not (they would drown it).
--   * app_api_key_lookup: the API finds a key before it knows the account (SECURITY DEFINER).

SELECT set_config('app.role', 'system', true);

CREATE TABLE api_key (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  prefix        text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{8}$'),
  key_hash      char(64) NOT NULL,
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES app_user(id) ON DELETE SET NULL
);
CREATE INDEX api_key_account_idx ON api_key (account_id);

CREATE TABLE api_request_log (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  api_key_id  uuid NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  method      text NOT NULL,
  path        text NOT NULL,
  status      integer NOT NULL,
  rows        integer,
  ip          text
);
CREATE INDEX api_request_log_key_idx ON api_request_log (api_key_id, at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_key', 'api_request_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())', t || '_tenant', t);
  END LOOP;
END
$$;

-- Find a key by its prefix (before the account is known). Returns nothing for unknown, revoked or
-- expired keys, or keys of a closed account.
CREATE OR REPLACE FUNCTION app_api_key_lookup(p_prefix text)
RETURNS TABLE (id uuid, account_id uuid, key_hash char(64), name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.id, k.account_id, k.key_hash, k.name
    FROM api_key k JOIN account a ON a.id = k.account_id
   WHERE k.prefix = p_prefix AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()) AND a.status <> 'Closed'
$$;
REVOKE ALL ON FUNCTION app_api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api_key_lookup(text) TO mapintel_api;
