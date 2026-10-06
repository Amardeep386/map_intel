-- MAP Intel · Phase 3 · M6: reports.
--   * report_template: shared, versioned templates with typed parameters (the only path to a report).
--   * report_definition: an account's scheduled (or manual) report: template + parameters,
--     cadence, recipients, destinations.
--   * report_run: one generated report. Its data snapshot is frozen at generation (with the rule set
--     and a data-quality note); files (PDF, CSV) go to S3 with their SHA-256.
--   * report_delivery: each delivery attempt (email, hosted link, SFTP).
--   * notification: outgoing messages. With no email provider configured they are only logged.

SELECT set_config('app.role', 'system', true);

CREATE TABLE report_template (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('MAP', 'Trend', 'Seller', 'Enforcement', 'Other')),
  version       integer NOT NULL DEFAULT 1,
  params        jsonb NOT NULL,           -- what the parameters are, for the portal (validated in lib/reports.ts)
  description   text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO report_template (code, name, type, params, description) VALUES
  ('listing_map', 'Listing MAP Report', 'MAP',
   '[{"key": "timeframe", "label": "Timeframe", "type": "enum", "values": ["previous_week", "last_7_days", "last_30_days", "previous_month"], "default": "previous_week"},
     {"key": "statuses", "label": "Violation statuses", "type": "multi", "values": ["Open", "Needs review", "Under notice", "Authorised promo", "Resolved", "Dismissed"], "default": ["Open", "Needs review", "Under notice", "Resolved"]},
     {"key": "rowCap", "label": "Row cap", "type": "int", "min": 1, "max": 5000, "default": 1000}]',
   'Every violation active in the period with MAP, price, gap, seller class and an evidence link per row.'),
  ('monthly_trend', 'Monthly Trend', 'Trend',
   '[{"key": "month", "label": "Month", "type": "month", "default": "previous"},
     {"key": "splitByClass", "label": "Split by seller classification", "type": "bool", "default": true}]',
   'Compliance, violations per day by seller class, severity, top sellers and time to compliance for one month.'),
  ('seller_detail', 'Seller Detail', 'Seller',
   '[{"key": "sellerIds", "label": "Sellers", "type": "sellers", "default": []},
     {"key": "timeframe", "label": "Timeframe", "type": "enum", "values": ["previous_week", "last_7_days", "last_30_days", "previous_month"], "default": "last_30_days"}]',
   'One or more sellers: their violations in the period, depth and status, with evidence links.');

CREATE TABLE report_definition (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name             text NOT NULL,
  template_id      uuid NOT NULL REFERENCES report_template(id),
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  cadence          text NOT NULL,                       -- cron ('0 8 * * 1') or 'manual'
  timezone         text NOT NULL DEFAULT 'America/New_York',
  recipients       text[] NOT NULL DEFAULT '{}',        -- email addresses
  destinations     jsonb NOT NULL DEFAULT '{"email": true, "hosted": true}'::jsonb, -- + "sftp": {credentialId, folder}
  visibility       text NOT NULL DEFAULT 'Account' CHECK (visibility IN ('Account', 'Brand users')),
  active           boolean NOT NULL DEFAULT true,
  last_fired_slot  timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);
CREATE TRIGGER report_definition_touch BEFORE UPDATE ON report_definition FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE report_run (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seq               integer NOT NULL,                   -- RPT-0001 per account
  definition_id     uuid REFERENCES report_definition(id) ON DELETE SET NULL,
  template_id       uuid NOT NULL REFERENCES report_template(id),
  template_version  integer NOT NULL,
  name              text NOT NULL,
  params            jsonb NOT NULL,
  trigger           text NOT NULL CHECK (trigger IN ('schedule', 'manual', 'test')),
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'awaiting_pdf', 'done', 'failed')),
  period_from       timestamptz NOT NULL,
  period_to         timestamptz NOT NULL,
  snapshot          jsonb,                              -- frozen data the files and hosted page are made from
  rows              integer,
  rule_set          jsonb,                              -- [{code, version}] published at period end
  quality_note      text,                               -- NULL = every source healthy
  files             jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{kind, key, uri, sha256, bytes, contentType}]
  error             text,
  requested_by      uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  generated_at      timestamptz,
  finished_at       timestamptz,
  UNIQUE (account_id, seq),
  CHECK (period_to > period_from)
);
CREATE INDEX report_run_account_idx ON report_run (account_id, created_at DESC);
CREATE INDEX report_run_pending_idx ON report_run (status) WHERE status IN ('queued', 'awaiting_pdf');

-- The frozen snapshot never changes once written.
CREATE OR REPLACE FUNCTION report_run_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.snapshot IS NOT NULL AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'report_run: the snapshot is frozen once generated' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_run_guard BEFORE UPDATE ON report_run FOR EACH ROW EXECUTE FUNCTION report_run_guard();

ALTER TABLE evidence_link ADD CONSTRAINT evidence_link_report_run_fk FOREIGN KEY (report_run_id) REFERENCES report_run(id) ON DELETE CASCADE;
CREATE INDEX evidence_link_report_run_idx ON evidence_link (report_run_id);

CREATE TABLE report_delivery (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  report_run_id  uuid NOT NULL REFERENCES report_run(id) ON DELETE CASCADE,
  channel        text NOT NULL CHECK (channel IN ('email', 'hosted', 'sftp')),
  target         text NOT NULL,                       -- recipients, link expiry, host:folder
  status         text NOT NULL CHECK (status IN ('logged', 'sent', 'delivered', 'failed')),
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_delivery_run_idx ON report_delivery (report_run_id);

CREATE TABLE notification (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid REFERENCES account(id) ON DELETE CASCADE,
  channel        text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  recipients     text[] NOT NULL,
  subject        text NOT NULL,
  body           text NOT NULL,
  status         text NOT NULL CHECK (status IN ('logged', 'sent', 'failed')),
  provider       text NOT NULL,                       -- 'log' until an email provider is configured
  error          text,
  report_run_id  uuid REFERENCES report_run(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_account_idx ON notification (account_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_definition', 'report_run', 'report_delivery', 'notification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- Templates are shared and read-only for the API.
REVOKE INSERT, UPDATE, DELETE ON report_template FROM mapintel_api, mapintel_tenant;

-- Adoption counts across accounts (no account data beyond counts).
CREATE OR REPLACE FUNCTION app_report_template_adoption()
RETURNS TABLE (template_id uuid, accounts integer, definitions integer, last_used timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id,
         (SELECT count(DISTINCT d.account_id)::int FROM report_definition d WHERE d.template_id = t.id AND d.active),
         (SELECT count(*)::int FROM report_definition d WHERE d.template_id = t.id AND d.active),
         (SELECT max(r.created_at) FROM report_run r WHERE r.template_id = t.id)
    FROM report_template t
$$;
REVOKE ALL ON FUNCTION app_report_template_adoption() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_report_template_adoption() TO mapintel_api;
