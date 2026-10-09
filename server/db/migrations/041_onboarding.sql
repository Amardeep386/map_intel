-- MAP Intel · Phase 5 · M1: guided onboarding.
--   * account.status gains 'Onboarding': a new account is set up through the guided flow and is not
--     crawled on schedule until it goes live ('Active').
--   * account_onboarding: one row per account created through the flow. Where the person is in the
--     flow (current_step), who went live and when, and the baseline crawl asked for at go-live.
--     Whether a step is done is never stored: it is read from the account's real configuration
--     (lib/onboarding.ts), so a step cannot be ticked without the work behind it.
--   * app_create_account: platform administrators create accounts through the API (the API role
--     cannot insert into account). The account's default rules, templates and alerts come from the
--     existing AFTER INSERT triggers.

SELECT set_config('app.role', 'system', true);

ALTER TABLE account DROP CONSTRAINT account_status_check;
ALTER TABLE account ADD CONSTRAINT account_status_check CHECK (status IN ('Onboarding', 'Sandbox', 'Active', 'Paused', 'Closed'));

CREATE TABLE account_onboarding (
  account_id             uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  current_step           text NOT NULL DEFAULT 'account'
                         CHECK (current_step IN ('account', 'catalogue', 'map', 'sellers', 'sources', 'rules', 'reports')),
  created_by             uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  went_live_at           timestamptz,
  went_live_by           uuid REFERENCES app_user(id) ON DELETE SET NULL,
  baseline_requested_at  timestamptz,                -- set at go-live; the scheduler fires the baseline crawl
  baseline_fired_at      timestamptz,                -- when the scheduler fired it
  baseline_run_ids       uuid[] NOT NULL DEFAULT '{}',
  CHECK ((went_live_at IS NULL) = (went_live_by IS NULL) OR went_live_by IS NULL),
  CHECK (baseline_fired_at IS NULL OR baseline_requested_at IS NOT NULL)
);

-- Once live, the go-live facts never change.
CREATE OR REPLACE FUNCTION account_onboarding_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.went_live_at IS NOT NULL AND (NEW.went_live_at IS DISTINCT FROM OLD.went_live_at OR NEW.went_live_by IS DISTINCT FROM OLD.went_live_by
      OR NEW.baseline_requested_at IS DISTINCT FROM OLD.baseline_requested_at) THEN
    RAISE EXCEPTION 'this account already went live' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER account_onboarding_guard BEFORE UPDATE ON account_onboarding FOR EACH ROW EXECUTE FUNCTION account_onboarding_guard();

ALTER TABLE account_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY account_onboarding_tenant ON account_onboarding
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());
REVOKE DELETE ON account_onboarding FROM mapintel_api, mapintel_tenant;

-- A new account in Onboarding, created by a platform administrator. Returns its id.
CREATE OR REPLACE FUNCTION app_create_account(
  p_user_id uuid, p_slug text, p_name text, p_brand text, p_regions text[], p_currency char(3), p_timezone text,
  p_accent_light text, p_accent_dark text, p_contract_from date, p_contract_to date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_user WHERE id = p_user_id AND platform_role = 'admin' AND status = 'Active') THEN
    RAISE EXCEPTION 'only platform administrators create accounts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.role', 'system', true);
  INSERT INTO account (slug, name, brand, status, regions, currency, timezone, accent_light, accent_dark, contract_from, contract_to)
  VALUES (p_slug, p_name, p_brand, 'Onboarding', p_regions, p_currency, p_timezone, p_accent_light, p_accent_dark, p_contract_from, p_contract_to)
  RETURNING id INTO v_id;
  INSERT INTO account_onboarding (account_id, created_by) VALUES (v_id, p_user_id);
  PERFORM set_config('app.role', '', true);
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION app_create_account(uuid, text, text, text, text[], char, text, text, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_account(uuid, text, text, text, text[], char, text, text, text, date, date) TO mapintel_api;
