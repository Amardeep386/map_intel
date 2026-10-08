-- MAP Intel · Phase 4 · M1: enforcement.
--   * enforcement_case: one seller's violations grouped for enforcement (C-00001 per account).
--     Owner and response due date change in place (audited); the state lives only in case_event.
--   * case_violation: which violations a case covers. A violation belongs to one case at most.
--   * case_event: the case's state history, append-only. Open → Notice sent → Awaiting response →
--     Contested / Escalated → Resolved → Recurred. Resolved needs the compliant observation that
--     re-verified it (verdict_id) or, when a person closes it, a reason.
--   * notice_template: per account letter templates with {{placeholders}}; three defaults.
--   * notice: one letter for a case, rendered and frozen when it leaves Draft. Brand approval
--     (account setting brand_approval_required) sits between Draft and Approved. "Sent" means
--     logged until an email provider is configured (decision 42).
--   * communication: the case's communications log (notices out, responses and contests in).
--   * marketplace_report: the IP track (Amazon RAV, eBay VeRO, Walmart Brand Portal), only on
--     cases a person has marked as an IP issue, with a reason. Never a pricing case.
-- An eBay account deletion also redacts that seller's notices and communications.

SELECT set_config('app.role', 'system', true);

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------
CREATE TABLE enforcement_case (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seq            integer NOT NULL,                         -- C-00001 per account
  seller_id      uuid NOT NULL REFERENCES seller(id),
  source_id      uuid NOT NULL REFERENCES source(id),
  owner          uuid,                                     -- app_user id; NULL = unassigned
  response_due   date,
  ip_issue       boolean NOT NULL DEFAULT false,           -- opens the IP track; a person decides
  ip_reason      text,
  recurred_from  uuid REFERENCES enforcement_case(id),     -- the resolved case this one repeats
  opened_at      timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq),
  CHECK (NOT ip_issue OR coalesce(btrim(ip_reason), '') <> '')
);
CREATE INDEX enforcement_case_seller_idx ON enforcement_case (account_id, seller_id, opened_at DESC);
CREATE TRIGGER enforcement_case_touch BEFORE UPDATE ON enforcement_case FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- What a case is about never changes: only owner, due date and the IP flag do.
CREATE OR REPLACE FUNCTION enforcement_case_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'enforcement_case cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'owner' - 'response_due' - 'ip_issue' - 'ip_reason' - 'updated_at')
     = (to_jsonb(OLD) - 'owner' - 'response_due' - 'ip_issue' - 'ip_reason' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enforcement_case: only owner, response_due and the IP flag change' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER enforcement_case_guard BEFORE UPDATE OR DELETE ON enforcement_case FOR EACH ROW EXECUTE FUNCTION enforcement_case_guard();

CREATE TABLE case_violation (
  case_id       uuid NOT NULL REFERENCES enforcement_case(id) ON DELETE CASCADE,
  violation_id  uuid NOT NULL REFERENCES violation(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  added_by      uuid,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, violation_id)
);
CREATE UNIQUE INDEX case_violation_violation_uq ON case_violation (violation_id);
CREATE TRIGGER case_violation_append_only BEFORE UPDATE OR DELETE ON case_violation
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- A case covers one seller: every violation in it must be that seller's, in the same account.
CREATE OR REPLACE FUNCTION case_violation_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  SELECT c.account_id = NEW.account_id AND v.account_id = NEW.account_id AND v.seller_id = c.seller_id
    INTO ok
    FROM enforcement_case c, violation v
   WHERE c.id = NEW.case_id AND v.id = NEW.violation_id;
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'a case covers violations of its own seller and account only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER case_violation_check BEFORE INSERT ON case_violation FOR EACH ROW EXECUTE FUNCTION case_violation_check();

CREATE TABLE case_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  case_id     uuid NOT NULL REFERENCES enforcement_case(id) ON DELETE CASCADE,
  state       text NOT NULL CHECK (state IN ('Open', 'Notice sent', 'Awaiting response', 'Contested', 'Escalated', 'Resolved', 'Recurred')),
  reason      text,
  actor       uuid,                              -- NULL = system (judge / re-check)
  verdict_id  uuid REFERENCES verdict(id),       -- the compliant observation that re-verified it
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (state <> 'Resolved' OR verdict_id IS NOT NULL OR coalesce(btrim(reason), '') <> '')
);
CREATE INDEX case_event_idx ON case_event (case_id, created_at DESC);
CREATE TRIGGER case_event_append_only BEFORE UPDATE OR DELETE ON case_event
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Current state of every case. closed: Resolved or Recurred (a Recurred case was resolved, then
-- its seller offended again and a new case opened for that).
CREATE VIEW case_current WITH (security_invoker = true) AS
SELECT c.*,
       ls.state,
       ls.created_at                                         AS state_at,
       ls.state IN ('Resolved', 'Recurred')                  AS closed,
       (SELECT count(*)::int FROM case_violation cv WHERE cv.case_id = c.id) AS violations
  FROM enforcement_case c
  JOIN LATERAL (SELECT e.state, e.created_at FROM case_event e
                 WHERE e.case_id = c.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) ls ON true;

-- ---------------------------------------------------------------------------
-- Letters
-- ---------------------------------------------------------------------------
CREATE TABLE notice_template (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  code             text NOT NULL,                  -- T-1
  name             text NOT NULL,
  used_for         text,
  subject          text NOT NULL,
  body             text NOT NULL,                  -- {{placeholders}}, filled in lib/notices.ts
  attaches_policy  boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1,     -- +1 on every edit; a notice records the one it used
  active           boolean NOT NULL DEFAULT true,
  is_default       boolean NOT NULL DEFAULT false,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, code)
);
CREATE TRIGGER notice_template_touch BEFORE UPDATE ON notice_template FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE notice (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  case_id             uuid NOT NULL REFERENCES enforcement_case(id) ON DELETE CASCADE,
  seq                 integer NOT NULL,            -- N-00001 per account
  template_id         uuid REFERENCES notice_template(id) ON DELETE SET NULL,
  template_version    integer,
  recipients          text[] NOT NULL DEFAULT '{}',
  subject             text NOT NULL,
  body                text NOT NULL,
  evidence            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{violationId, linkId, url}] frozen with the letter
  policy_document_id  uuid REFERENCES policy_document(id),
  status              text NOT NULL DEFAULT 'Draft'
                        CHECK (status IN ('Draft', 'Awaiting approval', 'Approved', 'Rejected', 'Sent', 'Cancelled')),
  needs_approval      boolean NOT NULL,            -- brand_approval_required when it was drafted
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text,
  sent_by             uuid,
  sent_at             timestamptz,
  notification_id     uuid REFERENCES notification(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq),
  CHECK (status <> 'Rejected' OR coalesce(btrim(decision_note), '') <> '')
);
CREATE INDEX notice_case_idx ON notice (case_id, created_at DESC);
CREATE INDEX notice_status_idx ON notice (account_id, status);
CREATE TRIGGER notice_touch BEFORE UPDATE ON notice FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- A notice's letter is frozen once it leaves Draft, and its status only moves forward:
-- Draft → Awaiting approval → Approved / Rejected; Draft or Approved → Sent (Draft only when no
-- approval is needed); Draft / Awaiting approval / Approved → Cancelled. An eBay account deletion
-- may still redact it (app.redacting).
CREATE OR REPLACE FUNCTION notice_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  content_cols text[] := ARRAY['recipients', 'subject', 'body', 'evidence', 'policy_document_id', 'template_id', 'template_version'];
  allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'notice cannot be deleted: cancel it' USING ERRCODE = 'restrict_violation';
  END IF;
  IF current_setting('app.redacting', true) = 'on' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'status' - 'decided_by' - 'decided_at' - 'decision_note' - 'sent_by' - 'sent_at'
                    - 'notification_id' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'decided_by' - 'decided_at' - 'decision_note' - 'sent_by' - 'sent_at'
                    - 'notification_id' - 'updated_at') THEN
    IF OLD.status <> 'Draft' OR NEW.status <> 'Draft'
       OR (to_jsonb(NEW) - content_cols - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - content_cols - 'updated_at') THEN
      RAISE EXCEPTION 'notice: the letter is frozen once it leaves Draft' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  allowed := NEW.status = OLD.status
    OR (OLD.status = 'Draft' AND NEW.status = 'Awaiting approval' AND OLD.needs_approval)
    OR (OLD.status = 'Awaiting approval' AND NEW.status IN ('Approved', 'Rejected'))
    OR (OLD.status = 'Draft' AND NEW.status = 'Sent' AND NOT OLD.needs_approval)
    OR (OLD.status = 'Approved' AND NEW.status = 'Sent')
    OR (OLD.status IN ('Draft', 'Awaiting approval', 'Approved') AND NEW.status = 'Cancelled');
  IF NOT allowed THEN
    RAISE EXCEPTION 'notice: % → % is not allowed', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER notice_guard BEFORE UPDATE OR DELETE ON notice FOR EACH ROW EXECUTE FUNCTION notice_guard();

CREATE TABLE communication (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  case_id      uuid NOT NULL REFERENCES enforcement_case(id) ON DELETE CASCADE,
  notice_id    uuid REFERENCES notice(id) ON DELETE SET NULL,
  direction    text NOT NULL CHECK (direction IN ('outbound', 'inbound', 'internal')),
  kind         text NOT NULL CHECK (kind IN ('notice', 'response', 'contest', 'note')),
  channel      text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'marketplace message', 'phone', 'letter', 'other')),
  summary      text NOT NULL,
  body         text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        uuid,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX communication_case_idx ON communication (case_id, occurred_at DESC);
CREATE INDEX communication_account_idx ON communication (account_id, occurred_at DESC);

-- Append-only, except the redaction an eBay account deletion makes.
CREATE OR REPLACE FUNCTION communication_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND current_setting('app.redacting', true) = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'communication is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER communication_guard BEFORE UPDATE OR DELETE ON communication FOR EACH ROW EXECUTE FUNCTION communication_guard();

-- ---------------------------------------------------------------------------
-- IP track
-- ---------------------------------------------------------------------------
CREATE TABLE marketplace_report (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  case_id       uuid NOT NULL REFERENCES enforcement_case(id) ON DELETE CASCADE,
  seq           integer NOT NULL,                  -- IP-00001 per account
  channel       text NOT NULL CHECK (channel IN ('amazon_rav', 'ebay_vero', 'walmart_brand_portal')),
  ip_basis      text NOT NULL CHECK (ip_basis IN ('trademark', 'copyright', 'counterfeit', 'design_patent', 'utility_patent', 'material_difference')),
  reason        text NOT NULL CHECK (btrim(reason) <> ''),
  status        text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Filed', 'Accepted', 'Rejected', 'Withdrawn')),
  reference     text,                              -- the number the marketplace returned
  filed_by      uuid,
  filed_at      timestamptz,
  outcome_note  text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq),
  CHECK (status = 'Draft' OR status = 'Withdrawn' OR (filed_at IS NOT NULL AND coalesce(btrim(reference), '') <> ''))
);
CREATE INDEX marketplace_report_case_idx ON marketplace_report (case_id);
CREATE TRIGGER marketplace_report_touch BEFORE UPDATE ON marketplace_report FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Only on a case a person has marked as an IP issue: a pricing case is never filed as IP.
CREATE OR REPLACE FUNCTION marketplace_report_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'marketplace_report cannot be deleted: withdraw it' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enforcement_case c WHERE c.id = NEW.case_id AND c.account_id = NEW.account_id AND c.ip_issue) THEN
    RAISE EXCEPTION 'a marketplace report needs a case marked as an IP issue' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.case_id, NEW.channel, NEW.ip_basis, NEW.reason, NEW.created_by, NEW.created_at)
                          IS DISTINCT FROM (OLD.case_id, OLD.channel, OLD.ip_basis, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'marketplace_report: channel, basis and reason are fixed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER marketplace_report_check BEFORE INSERT OR UPDATE OR DELETE ON marketplace_report
  FOR EACH ROW EXECUTE FUNCTION marketplace_report_check();

-- A case marked as an IP issue with reports on file stays one.
CREATE OR REPLACE FUNCTION enforcement_case_ip_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ip_issue AND NOT NEW.ip_issue AND EXISTS (SELECT 1 FROM marketplace_report r WHERE r.case_id = NEW.id) THEN
    RAISE EXCEPTION 'this case has marketplace reports: it stays an IP issue' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enforcement_case_ip_check BEFORE UPDATE ON enforcement_case FOR EACH ROW EXECUTE FUNCTION enforcement_case_ip_check();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['enforcement_case', 'case_violation', 'case_event', 'notice_template', 'notice',
                           'communication', 'marketplace_report'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Default letter templates (existing accounts now, new ones on creation). A starting draft:
-- the wording still needs the legal review (decision 5) before a notice goes to a real seller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_notice_templates(p_account_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO notice_template (account_id, code, name, used_for, subject, body, attaches_policy, is_default) VALUES
    (p_account_id, 'T-1', 'First warning', 'Unauthorised sellers',
     'Advertised prices below the {{brand}} Minimum Advertised Price policy',
     E'To: {{seller}} ({{source}})\n\n'
     'On {{period}} we observed {{violationCount}} listing(s) from your storefront on {{source}} advertised below the Minimum Advertised Price (MAP) that {{brand}} sets for these products:\n\n'
     '{{violationTable}}\n\n'
     'Each listing has a time-stamped record of the page we captured, available at the secure links above.\n\n'
     'Please bring the advertised prices to MAP or above by {{responseDue}} and reply to confirm. {{brand}}''s MAP policy ({{policy}}) is attached.\n\n'
     '{{signature}}',
     true, true),
    (p_account_id, 'T-2', 'MAP reminder (authorised reseller)', 'Authorised resellers',
     'Reminder: {{brand}} Minimum Advertised Price',
     E'To: {{seller}} ({{source}})\n\n'
     'As an authorised {{brand}} reseller you have agreed to advertise at or above the Minimum Advertised Price. On {{period}} we observed {{violationCount}} listing(s) on {{source}} below MAP:\n\n'
     '{{violationTable}}\n\n'
     'Please correct these by {{responseDue}}. The secure links above show the page we captured for each listing.\n\n'
     '{{signature}}',
     false, true),
    (p_account_id, 'T-3', 'Final notice', 'Repeat offenders (3+ in 90 days)',
     'Final notice: {{brand}} Minimum Advertised Price',
     E'To: {{seller}} ({{source}})\n\n'
     'We have written to you before about advertised prices below {{brand}}''s Minimum Advertised Price. On {{period}} we again observed {{violationCount}} listing(s) on {{source}} below MAP:\n\n'
     '{{violationTable}}\n\n'
     'Your history with us: {{sellerHistory}}.\n\n'
     'If the advertised prices are not at MAP or above by {{responseDue}}, {{brand}} will review its options under its MAP policy ({{policy}}, attached).\n\n'
     '{{signature}}',
     true, true)
  ON CONFLICT (account_id, code) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION account_seed_notice_templates() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_seed_notice_templates(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER account_default_notice_templates AFTER INSERT ON account
  FOR EACH ROW EXECUTE FUNCTION account_seed_notice_templates();

SELECT app_seed_notice_templates(id) FROM account;

-- ---------------------------------------------------------------------------
-- eBay account deletion: also redact the seller's notices and communications.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_ebay_account_deletion(
  p_notification_id text, p_username text, p_name_key text, p_user_id text, p_event_date timestamptz
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_source uuid;
  v_ids uuid[];
BEGIN
  -- eBay retries a notification until it gets a 2xx: the second delivery changes nothing.
  IF EXISTS (SELECT 1 FROM ebay_account_deletion WHERE notification_id = p_notification_id) THEN
    RETURN 0;
  END IF;
  SELECT id INTO v_source FROM source WHERE code = 'ebay_us';
  SELECT coalesce(array_agg(DISTINCT s.id), '{}') INTO v_ids
    FROM seller s
    LEFT JOIN seller_alias a ON a.seller_id = s.id
   WHERE s.source_id = v_source
     AND (lower(s.platform_seller_id) = lower(p_username) OR s.name_key = p_name_key OR a.alias_key = p_name_key);
  DELETE FROM seller_alias WHERE seller_id = ANY(v_ids);
  DELETE FROM seller_contact WHERE seller_id = ANY(v_ids);
  UPDATE seller
     SET name = 'Deleted eBay user', name_key = 'deleted ebay user ' || id::text,
         platform_seller_id = CASE WHEN platform_seller_id IS NULL THEN NULL ELSE 'deleted:' || id::text END,
         storefront_url = NULL
   WHERE id = ANY(v_ids);
  PERFORM set_config('app.redacting', 'on', true);
  UPDATE notice n
     SET recipients = '{}', subject = 'Redacted (eBay account deletion)', body = 'Redacted (eBay account deletion)'
    FROM enforcement_case c
   WHERE c.id = n.case_id AND c.seller_id = ANY(v_ids);
  UPDATE communication m
     SET summary = 'Redacted (eBay account deletion)', body = NULL
    FROM enforcement_case c
   WHERE c.id = m.case_id AND c.seller_id = ANY(v_ids);
  PERFORM set_config('app.redacting', 'off', true);
  INSERT INTO ebay_account_deletion (notification_id, username_sha256, user_id_sha256, event_date, sellers_anonymised)
  VALUES (p_notification_id, encode(sha256(convert_to(lower(p_username), 'UTF8')), 'hex'),
          CASE WHEN p_user_id IS NULL THEN NULL ELSE encode(sha256(convert_to(p_user_id, 'UTF8')), 'hex') END,
          p_event_date, coalesce(array_length(v_ids, 1), 0));
  RETURN coalesce(array_length(v_ids, 1), 0);
END
$$;
REVOKE ALL ON FUNCTION app_ebay_account_deletion(text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ebay_account_deletion(text, text, text, text, timestamptz) TO mapintel_api;
