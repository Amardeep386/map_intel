-- MAP Intel · Phase 3 · M8: basic alerts.
--   * alert_rule: per account; three defaults (new violating seller, severe violation, a source
--     degraded within 24 h of a scheduled report). Recipients get email (logged until a provider
--     is configured); every alert also lands in the portal inbox.
--   * alert_event: one per change, never one per crawl: (account, rule, dedup_key) is unique.
--     Append-only apart from marking it read.

SELECT set_config('app.role', 'system', true);

CREATE TABLE alert_rule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  trigger     text NOT NULL CHECK (trigger IN ('new_violating_seller', 'severe_violation', 'source_degraded_before_report')),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  email       boolean NOT NULL DEFAULT true,
  recipients  text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, code)
);
CREATE TRIGGER alert_rule_touch BEFORE UPDATE ON alert_rule FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE alert_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  alert_rule_id  uuid NOT NULL REFERENCES alert_rule(id) ON DELETE CASCADE,
  dedup_key      text NOT NULL,
  level          text NOT NULL CHECK (level IN ('Severe', 'Standard', 'Health', 'Info')),
  title          text NOT NULL,
  body           text NOT NULL,
  violation_id   uuid REFERENCES violation(id) ON DELETE CASCADE,
  seller_id      uuid REFERENCES seller(id),
  source_id      uuid REFERENCES source(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz,
  read_by        uuid,
  UNIQUE (account_id, alert_rule_id, dedup_key)
);
CREATE INDEX alert_event_inbox_idx ON alert_event (account_id, created_at DESC);

-- Only marking read is allowed; deletes only through an account / rule cascade.
CREATE OR REPLACE FUNCTION alert_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'alert_event is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'read_at' - 'read_by') = (to_jsonb(OLD) - 'read_at' - 'read_by') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'alert_event: only read_at / read_by change' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER alert_event_guard BEFORE UPDATE OR DELETE ON alert_event FOR EACH ROW EXECUTE FUNCTION alert_event_guard();

ALTER TABLE notification ADD COLUMN alert_event_id uuid REFERENCES alert_event(id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_rule', 'alert_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;
-- Events are raised by the system; the API only marks them read.
REVOKE INSERT, DELETE ON alert_event FROM mapintel_api, mapintel_tenant;

CREATE OR REPLACE FUNCTION app_seed_alert_rules(p_account_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO alert_rule (account_id, code, name, trigger, config, is_default) VALUES
    (p_account_id, 'A-01', 'New violating seller', 'new_violating_seller', '{}', true),
    (p_account_id, 'A-02', 'Severe violation', 'severe_violation', '{"severity": "Severe"}', true),
    (p_account_id, 'A-03', 'Source degraded before a scheduled report', 'source_degraded_before_report', '{"hoursBefore": 24}', true)
  ON CONFLICT (account_id, code) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION account_seed_alert_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_seed_alert_rules(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER account_default_alert_rules AFTER INSERT ON account
  FOR EACH ROW EXECUTE FUNCTION account_seed_alert_rules();

SELECT app_seed_alert_rules(id) FROM account;
