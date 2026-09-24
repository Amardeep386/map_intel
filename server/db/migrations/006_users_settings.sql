-- MAP Intel · Phase 1 · M9: invites, and account settings edited through the API.

-- ---------------------------------------------------------------------------
-- Invites: a single-use link (72 h) that lets a new user set their own password.
-- Only the SHA-256 of the token is stored.
-- ---------------------------------------------------------------------------
ALTER TABLE app_user DROP CONSTRAINT app_user_status_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_status_check CHECK (status IN ('Invited', 'Active', 'Disabled'));

CREATE TABLE user_invite (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('Administrator', 'Account manager', 'Analyst', 'Brand user')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz
);
CREATE INDEX user_invite_account_idx ON user_invite (account_id);

ALTER TABLE user_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invite FORCE ROW LEVEL SECURITY;
CREATE POLICY user_invite_tenant ON user_invite
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

-- What the accept-invite page shows. Anyone holding the token may see this, nobody else.
CREATE OR REPLACE FUNCTION app_invite_info(p_token_hash text)
RETURNS TABLE (email text, full_name text, account_name text, role text, expires_at timestamptz, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.email, u.full_name, a.name, i.role, i.expires_at,
         CASE WHEN i.used_at IS NOT NULL THEN 'used'
              WHEN i.revoked_at IS NOT NULL THEN 'revoked'
              WHEN i.expires_at <= now() THEN 'expired'
              ELSE 'open' END
    FROM user_invite i
    JOIN app_user u ON u.id = i.user_id
    JOIN account a ON a.id = i.account_id
   WHERE i.token_hash = p_token_hash
$$;

-- Accept an invite: set the password, activate the user, add the membership, mark the invite used,
-- and record it in the audit log — all or nothing. Returns the user, or no row if the invite is
-- not open.
CREATE OR REPLACE FUNCTION app_accept_invite(p_token_hash text, p_password_hash text, p_full_name text)
RETURNS TABLE (user_id uuid, email text, platform_role text, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  inv user_invite%ROWTYPE;
  usr app_user%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM user_invite
   WHERE token_hash = p_token_hash AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE app_user
     SET password_hash = CASE WHEN status = 'Invited' THEN p_password_hash ELSE password_hash END,
         full_name = CASE WHEN status = 'Invited' AND coalesce(p_full_name, '') <> '' THEN p_full_name ELSE full_name END,
         status = CASE WHEN status = 'Invited' THEN 'Active' ELSE status END
   WHERE id = inv.user_id
  RETURNING * INTO usr;
  IF usr.status <> 'Active' THEN
    RETURN;  -- a disabled user cannot come back through an old invite
  END IF;
  INSERT INTO account_membership (account_id, user_id, role) VALUES (inv.account_id, inv.user_id, inv.role)
  ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  UPDATE user_invite SET used_at = now() WHERE id = inv.id;
  INSERT INTO audit_event (account_id, actor_type, actor_id, actor_label, action, entity_type, entity_id, summary, after)
  VALUES (inv.account_id, 'user', usr.id::text, usr.email, 'invite.accepted', 'app_user', usr.id::text,
          format('%s accepted the invite and joined as %s', usr.email, inv.role),
          jsonb_build_object('role', inv.role));
  RETURN QUERY SELECT usr.id, usr.email, usr.platform_role, inv.account_id;
END
$$;

REVOKE ALL ON FUNCTION app_invite_info(text), app_accept_invite(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_invite_info(text), app_accept_invite(text, text, text) TO mapintel_api;

-- ---------------------------------------------------------------------------
-- The account row: readable by the API, changeable only within the account being worked on.
-- ---------------------------------------------------------------------------
ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;
CREATE POLICY account_read ON account FOR SELECT USING (true);
CREATE POLICY account_update ON account FOR UPDATE
  USING (app_is_system() OR id = app_current_account())
  WITH CHECK (app_is_system() OR id = app_current_account());
CREATE POLICY account_insert ON account FOR INSERT WITH CHECK (app_is_system());
CREATE POLICY account_delete ON account FOR DELETE USING (app_is_system());
