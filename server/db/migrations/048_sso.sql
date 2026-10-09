-- MAP Intel · Phase 5 · M8: single sign-on with Google and Microsoft (OpenID Connect).
--   * user_identity: a provider account (provider + its stable subject id) linked to a user. The
--     first SSO sign-in links by verified email; later ones by the subject only.
--   * sso_login: a one-time, one-minute code the API hands the portal after the provider's
--     redirect (the session token never travels in a URL). Stored hashed.
--   * app_sso_join: who an SSO sign-in is, in this order:
--       1. an identity already linked to an active user;
--       2. an active user with that email (linked now);
--       3. an invited user with that email: activated, every open invite accepted (as with an
--          invite link, but the provider proves the email instead of a password being chosen);
--       4. an email domain an account allows (account.settings.sso_domains): a new user joins those
--          accounts with the account's sso_default_role (default Brand user).
--     Otherwise nobody: no account can be opened by signing in with a random Google account.
--     Disabled users never come back this way. Joins and accepted invites are audited.

SELECT set_config('app.role', 'system', true);

CREATE TABLE user_identity (
  provider      text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,30}$'),
  subject       text NOT NULL,
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  email         text NOT NULL,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identity_user_idx ON user_identity (user_id);

CREATE TABLE sso_login (
  code_hash   char(64) PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
REVOKE ALL ON user_identity, sso_login FROM mapintel_tenant;

CREATE OR REPLACE FUNCTION app_sso_join(p_provider text, p_subject text, p_email text, p_full_name text, p_unusable_hash text)
RETURNS TABLE (user_id uuid, how text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
  usr app_user%ROWTYPE;
  inv record;
  acc record;
  v_how text;
BEGIN
  PERFORM set_config('app.role', 'system', true);
  -- 1. Linked before.
  SELECT u.* INTO usr FROM user_identity i JOIN app_user u ON u.id = i.user_id WHERE i.provider = p_provider AND i.subject = p_subject;
  IF FOUND THEN
    IF usr.status <> 'Active' THEN RETURN; END IF;
    UPDATE user_identity SET last_used_at = now(), email = v_email WHERE provider = p_provider AND subject = p_subject;
    RETURN QUERY SELECT usr.id, 'linked'::text;
    RETURN;
  END IF;

  SELECT * INTO usr FROM app_user WHERE lower(email) = v_email FOR UPDATE;
  IF FOUND AND usr.status = 'Disabled' THEN RETURN; END IF;

  IF FOUND AND usr.status = 'Active' THEN
    v_how := 'email';
  ELSIF FOUND AND usr.status = 'Invited' THEN
    -- 3. Invited: accept every open invite.
    IF NOT EXISTS (SELECT 1 FROM user_invite WHERE user_id = usr.id AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) THEN
      RETURN;  -- the invites expired or were revoked
    END IF;
    UPDATE app_user SET status = 'Active', full_name = CASE WHEN coalesce(p_full_name, '') <> '' THEN p_full_name ELSE full_name END
     WHERE id = usr.id RETURNING * INTO usr;
    FOR inv IN SELECT * FROM user_invite WHERE user_id = usr.id AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE LOOP
      INSERT INTO account_membership (account_id, user_id, role) VALUES (inv.account_id, usr.id, inv.role)
      ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role;
      UPDATE user_invite SET used_at = now() WHERE id = inv.id;
      INSERT INTO audit_event (account_id, actor_type, actor_id, actor_label, action, entity_type, entity_id, summary, after)
      VALUES (inv.account_id, 'user', usr.id::text, usr.email, 'invite.accepted', 'app_user', usr.id::text,
              format('%s accepted the invite with %s sign-in and joined as %s', usr.email, p_provider, inv.role),
              jsonb_build_object('role', inv.role, 'via', p_provider));
    END LOOP;
    v_how := 'invite';
  ELSE
    -- 4. An allowed email domain.
    IF v_domain = '' OR NOT EXISTS (
      SELECT 1 FROM account a WHERE a.status <> 'Closed' AND coalesce(a.settings->'sso_domains', '[]'::jsonb) ? v_domain) THEN
      RETURN;
    END IF;
    INSERT INTO app_user (email, full_name, password_hash, status)
    VALUES (v_email, coalesce(nullif(btrim(p_full_name), ''), v_email), p_unusable_hash, 'Active')
    RETURNING * INTO usr;
    FOR acc IN SELECT a.id, coalesce(a.settings->>'sso_default_role', 'Brand user') AS role FROM account a
                WHERE a.status <> 'Closed' AND coalesce(a.settings->'sso_domains', '[]'::jsonb) ? v_domain LOOP
      INSERT INTO account_membership (account_id, user_id, role) VALUES (acc.id, usr.id, acc.role) ON CONFLICT DO NOTHING;
      INSERT INTO audit_event (account_id, actor_type, actor_id, actor_label, action, entity_type, entity_id, summary, after)
      VALUES (acc.id, 'user', usr.id::text, usr.email, 'member.sso_joined', 'app_user', usr.id::text,
              format('%s joined as %s by signing in with %s (allowed domain %s)', usr.email, acc.role, p_provider, v_domain),
              jsonb_build_object('role', acc.role, 'via', p_provider, 'domain', v_domain));
    END LOOP;
    v_how := 'domain';
  END IF;

  INSERT INTO user_identity (provider, subject, user_id, email) VALUES (p_provider, p_subject, usr.id, v_email);
  RETURN QUERY SELECT usr.id, v_how;
END
$$;
REVOKE ALL ON FUNCTION app_sso_join(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_sso_join(text, text, text, text, text) TO mapintel_api;
