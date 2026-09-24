-- MAP Intel · Phase 1 · M4: credential vault.
-- Source logins and delivery credentials (SFTP, Slack, SMTP, API keys), encrypted by the
-- application with AES-256-GCM (src/lib/vault.ts). Postgres only ever holds ciphertext.
-- The API returns metadata and a short hint, never the secret.

CREATE TABLE credential (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid REFERENCES account(id) ON DELETE CASCADE,   -- NULL = platform-level credential
  kind          text NOT NULL CHECK (kind IN ('source_login', 'sftp', 'slack', 'smtp', 'api_key')),
  label         text NOT NULL,
  source_id     uuid REFERENCES source(id),
  username      text,
  ciphertext    bytea NOT NULL,
  iv            bytea NOT NULL,
  auth_tag      bytea NOT NULL,
  key_id        text NOT NULL,
  hint          text NOT NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_by    uuid,
  rotated_at    timestamptz
);
CREATE UNIQUE INDEX credential_label_uq ON credential (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(label));

ALTER TABLE credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential FORCE ROW LEVEL SECURITY;
-- Account credentials belong to their tenant; platform credentials are reached outside any account
-- (platform routes are administrator-only).
CREATE POLICY credential_tenant ON credential
  USING (app_is_system() OR account_id = app_current_account() OR (account_id IS NULL AND app_current_account() IS NULL))
  WITH CHECK (app_is_system() OR account_id = app_current_account() OR (account_id IS NULL AND app_current_account() IS NULL));
