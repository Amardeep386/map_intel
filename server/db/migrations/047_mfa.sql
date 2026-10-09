-- MAP Intel · Phase 5 · M7: multi-factor sign-in (authenticator app codes, RFC 6238 TOTP).
--   * app_user.mfa_secret: the shared secret, sealed with AES-256-GCM in the API (lib/mfa.ts; the
--     key is MFA_KEY, or derived from JWT_SECRET). NULL = MFA off. mfa_pending_secret holds a
--     secret during set-up until the first code confirms it. mfa_last_step: the last accepted
--     30-second step, so a code is never accepted twice.
--   * mfa_recovery_code: ten one-time codes per user, stored as SHA-256 hashes.
--   * An account's settings.mfa_required makes every session in that account need MFA.

SELECT set_config('app.role', 'system', true);

ALTER TABLE app_user ADD COLUMN mfa_secret text;
ALTER TABLE app_user ADD COLUMN mfa_pending_secret text;
ALTER TABLE app_user ADD COLUMN mfa_enabled_at timestamptz;
ALTER TABLE app_user ADD COLUMN mfa_last_step bigint;
ALTER TABLE app_user ADD CONSTRAINT app_user_mfa_check CHECK ((mfa_secret IS NULL) = (mfa_enabled_at IS NULL));

CREATE TABLE mfa_recovery_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  code_hash   char(64) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  UNIQUE (user_id, code_hash)
);
-- Sign-in data: the API role only (as for app_user's password hash); never a tenant.
REVOKE ALL ON mfa_recovery_code FROM mapintel_tenant;
