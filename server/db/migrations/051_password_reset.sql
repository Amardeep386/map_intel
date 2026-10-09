-- MAP Intel: password reset links (9 Oct 2026, after P5). There is no email provider yet, so a
-- reset link is created by an account Administrator / Account manager (for their members) or by
-- Mirethos (anyone), copied and sent by hand, as invite links are. "Forgot password?" on the
-- sign-in page opens an internal ticket for Mirethos instead of sending mail.
--   * password_reset: single-use, one hour, stored as the SHA-256 of the token.

SELECT set_config('app.role', 'system', true);

CREATE TABLE password_reset (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  char(64) NOT NULL UNIQUE,
  created_by  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX password_reset_user_idx ON password_reset (user_id);
REVOKE ALL ON password_reset FROM mapintel_tenant;
