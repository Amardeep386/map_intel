-- MAP Intel · Phase 3 · M1: detection.
--   * rule + rule_version: versioned verdict rules. A draft is edited freely; publishing needs a
--     dry run of that exact content (content_hash) and closes the previous published version.
--   * verdict: one judgement per (account, observation), append-only. Stores the MAP version or
--     promo window, the rule version and the seller class in force at observed_at.
--   * violation: one breach episode of a listing (first violating verdict -> compliant observation).
--     violation_observation links its verdicts; violation_event holds its status history.
--   * judge_run, dry_run, replay_run + replay_result (the shadow result set).
-- Migrations 031– belong to Phase 3.

SELECT set_config('app.role', 'system', true);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
CREATE TABLE rule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  code        text NOT NULL,                      -- R-00, R-01, ...
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'Verdict' CHECK (kind IN ('Verdict')),
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, code)
);

-- scope:     { products: [id], categories: [text], sources: [code], sourceCategories: [text] } (empty = all)
-- condition: { type: 'below_map', tolerancePct?: n, minDepth?: n }   (null = account settings)
--            { type: 'seller_class', classes: [text] }
-- verdict:   what a hit means: 'violation' | 'exempt' | 'needs_review'
-- severity:  { minorBelowPct: 5, severeAbovePct: 15 }
CREATE TABLE rule_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  rule_id       uuid NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version > 0),
  scope         jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition     jsonb NOT NULL,
  verdict       text NOT NULL CHECK (verdict IN ('violation', 'exempt', 'needs_review')),
  severity      jsonb NOT NULL DEFAULT '{"minorBelowPct": 5, "severeAbovePct": 15}'::jsonb,
  priority      integer NOT NULL DEFAULT 100,     -- lower runs first
  status        text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published', 'Closed')),
  content_hash  char(64) NOT NULL,                -- sha256 of scope + condition + verdict + severity + priority
  dry_run_id    uuid,                             -- the dry run that allowed publishing (NULL for seeded v1)
  valid_from    timestamptz,                      -- set on publish
  valid_to      timestamptz,                      -- set when a newer version is published
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_by  uuid,
  published_at  timestamptz,
  UNIQUE (rule_id, version),
  CHECK (status = 'Draft' OR valid_from IS NOT NULL),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX rule_version_one_published ON rule_version (rule_id) WHERE status = 'Published';
CREATE UNIQUE INDEX rule_version_one_draft ON rule_version (rule_id) WHERE status = 'Draft';

-- A draft can be edited or deleted. Once published its content is frozen: the only allowed changes
-- are Draft -> Published and Published -> Closed (valid_to set).
CREATE OR REPLACE FUNCTION rule_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Draft' OR pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'rule_version: a published version is never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'Draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'Published' AND NEW.status = 'Closed' AND NEW.valid_to IS NOT NULL
     AND (to_jsonb(NEW) - 'status' - 'valid_to') = (to_jsonb(OLD) - 'status' - 'valid_to') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rule_version: published content is frozen; edit creates a new version' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER rule_version_guard BEFORE UPDATE OR DELETE ON rule_version
  FOR EACH ROW EXECUTE FUNCTION rule_version_guard();

-- Dry runs: a draft evaluated over a date range without writing verdicts.
CREATE TABLE dry_run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  rule_version_id  uuid NOT NULL REFERENCES rule_version(id) ON DELETE CASCADE,
  content_hash     char(64) NOT NULL,
  range_from       timestamptz NOT NULL,
  range_to         timestamptz NOT NULL,
  result           jsonb NOT NULL,              -- counts + blast radius by seller
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (range_to > range_from)
);
CREATE INDEX dry_run_version_idx ON dry_run (rule_version_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Judging
-- ---------------------------------------------------------------------------
CREATE TABLE judge_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  trigger       text NOT NULL CHECK (trigger IN ('crawl', 'cli', 'api', 'backfill', 'test')),
  crawl_run_id  uuid REFERENCES crawl_run(id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  observations  integer NOT NULL DEFAULT 0,
  verdicts      integer NOT NULL DEFAULT 0,
  opened        integer NOT NULL DEFAULT 0,
  resolved      integer NOT NULL DEFAULT 0,
  error         text
);
CREATE INDEX judge_run_account_idx ON judge_run (account_id, started_at DESC);

CREATE TABLE verdict (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  judge_run_id      uuid REFERENCES judge_run(id) ON DELETE SET NULL,
  observation_id    uuid NOT NULL,
  observed_at       timestamptz NOT NULL,
  listing_id        uuid NOT NULL REFERENCES listing(id),
  product_id        uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  seller_id         uuid REFERENCES seller(id),
  source_id         uuid NOT NULL REFERENCES source(id),
  outcome           text NOT NULL CHECK (outcome IN ('violation', 'needs_review', 'authorised_promo', 'compliant', 'exempt', 'no_map')),
  severity          text CHECK (severity IN ('Minor', 'Standard', 'Severe')),
  rule_version_id   uuid REFERENCES rule_version(id),   -- the rule that decided (NULL = no rule hit: compliant / no_map)
  map_price_id      uuid REFERENCES map_price(id),
  promo_id          uuid REFERENCES promo_window(id),
  map_amount        numeric(12,2),
  promo_amount      numeric(12,2),
  observed_price    numeric(12,2) NOT NULL,
  currency          char(3),
  depth_abs         numeric(12,2),                     -- MAP in force − price (positive = below)
  depth_pct         numeric(7,3),
  class_at_capture  text NOT NULL CHECK (class_at_capture IN ('MAP Authorised', 'Unauthorised', 'Brand Direct', 'Unknown')),
  rule_set          jsonb NOT NULL DEFAULT '[]'::jsonb, -- published rule_version ids evaluated
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, observation_id)
);
CREATE INDEX verdict_listing_idx ON verdict (account_id, listing_id, observed_at DESC);
CREATE INDEX verdict_time_idx ON verdict (account_id, observed_at DESC);
CREATE TRIGGER verdict_append_only BEFORE UPDATE OR DELETE ON verdict
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- ---------------------------------------------------------------------------
-- Violations (episodes) and their status history
-- ---------------------------------------------------------------------------
CREATE TABLE violation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seq               integer NOT NULL,                  -- V-00001 per account
  listing_id        uuid NOT NULL REFERENCES listing(id),
  product_id        uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  seller_id         uuid REFERENCES seller(id),
  source_id         uuid NOT NULL REFERENCES source(id),
  first_verdict_id  uuid NOT NULL REFERENCES verdict(id),
  opened_at         timestamptz NOT NULL,              -- observed_at of the first violating observation
  class_at_capture  text NOT NULL,
  map_price_id      uuid REFERENCES map_price(id),
  rule_version_id   uuid REFERENCES rule_version(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq)
);
CREATE INDEX violation_listing_idx ON violation (account_id, listing_id, opened_at DESC);
CREATE TRIGGER violation_append_only BEFORE UPDATE OR DELETE ON violation
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

CREATE TABLE violation_observation (
  violation_id  uuid NOT NULL REFERENCES violation(id) ON DELETE CASCADE,
  verdict_id    uuid NOT NULL REFERENCES verdict(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  observed_at   timestamptz NOT NULL,
  PRIMARY KEY (violation_id, verdict_id)
);
CREATE UNIQUE INDEX violation_observation_verdict_uq ON violation_observation (verdict_id);
CREATE TRIGGER violation_observation_append_only BEFORE UPDATE OR DELETE ON violation_observation
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- episode_closed: the episode has ended (a compliant / promo observation arrived). A later
-- violating observation of the listing then opens a new episode.
CREATE TABLE violation_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  violation_id    uuid NOT NULL REFERENCES violation(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('Open', 'Needs review', 'Under notice', 'Authorised promo', 'Resolved', 'Dismissed')),
  episode_closed  boolean NOT NULL DEFAULT false,
  reason          text,
  actor           uuid,                            -- NULL = system (judge)
  verdict_id      uuid REFERENCES verdict(id),     -- the observation that caused it, for system events
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),  -- orders events written in one transaction
  CHECK (status <> 'Dismissed' OR coalesce(btrim(reason), '') <> '')
);
CREATE INDEX violation_event_idx ON violation_event (violation_id, created_at DESC);
CREATE TRIGGER violation_event_append_only BEFORE UPDATE OR DELETE ON violation_event
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Current state of every violation, derived from the facts above.
CREATE VIEW violation_current WITH (security_invoker = true) AS
SELECT v.*,
       ls.status,
       ls.created_at                                   AS status_at,
       ls.reason                                       AS status_reason,
       ce.created_at                                   AS closed_at,
       (ce.id IS NOT NULL)                             AS episode_closed,
       agg.last_seen, agg.observations, agg.max_depth_pct,
       lv.observed_price                               AS last_price,
       lv.map_amount                                   AS last_map,
       lv.depth_abs                                    AS last_depth_abs,
       lv.depth_pct                                    AS last_depth_pct,
       lv.severity                                     AS last_severity,
       worst.severity                                  AS severity
FROM violation v
JOIN LATERAL (SELECT e.status, e.created_at, e.reason FROM violation_event e
              WHERE e.violation_id = v.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) ls ON true
LEFT JOIN LATERAL (SELECT e.id, e.created_at FROM violation_event e
                   WHERE e.violation_id = v.id AND e.episode_closed ORDER BY e.created_at LIMIT 1) ce ON true
JOIN LATERAL (SELECT max(vo.observed_at) AS last_seen, count(*)::int AS observations, max(vd.depth_pct) AS max_depth_pct
              FROM violation_observation vo JOIN verdict vd ON vd.id = vo.verdict_id
              WHERE vo.violation_id = v.id) agg ON true
JOIN LATERAL (SELECT vd.* FROM violation_observation vo JOIN verdict vd ON vd.id = vo.verdict_id
              WHERE vo.violation_id = v.id ORDER BY vo.observed_at DESC LIMIT 1) lv ON true
JOIN LATERAL (SELECT vd.severity FROM violation_observation vo JOIN verdict vd ON vd.id = vo.verdict_id
              WHERE vo.violation_id = v.id ORDER BY vd.depth_pct DESC NULLS LAST LIMIT 1) worst ON true;

-- ---------------------------------------------------------------------------
-- Replay: a rule version re-evaluated over history into a shadow result set
-- ---------------------------------------------------------------------------
CREATE TABLE replay_run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  rule_version_id  uuid NOT NULL REFERENCES rule_version(id) ON DELETE CASCADE,
  range_from       timestamptz NOT NULL,
  range_to         timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  error            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  CHECK (range_to > range_from)
);

CREATE TABLE replay_result (
  replay_run_id   uuid NOT NULL REFERENCES replay_run(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  observation_id  uuid NOT NULL,
  observed_at     timestamptz NOT NULL,
  listing_id      uuid NOT NULL,
  seller_id       uuid,
  outcome         text NOT NULL,
  severity        text,
  depth_pct       numeric(7,3),
  live_outcome    text,                          -- the stored verdict's outcome, NULL if never judged
  PRIMARY KEY (replay_run_id, observation_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rule', 'rule_version', 'dry_run', 'judge_run', 'verdict', 'violation',
                           'violation_observation', 'violation_event', 'replay_run', 'replay_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- Verdicts and episodes are written by the judge (system); the API only reads them and adds
-- status events.
REVOKE INSERT, UPDATE, DELETE ON verdict, violation, violation_observation, judge_run FROM mapintel_api, mapintel_tenant;

-- ---------------------------------------------------------------------------
-- Default rules for every account (existing ones now, new ones on creation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_verdict_rules(p_account_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r00 uuid;
  r01 uuid;
  s00 jsonb := '{}';
  c00 jsonb := '{"type": "seller_class", "classes": ["Brand Direct"]}';
  c01 jsonb := '{"type": "below_map"}';
  sev jsonb := '{"minorBelowPct": 5, "severeAbovePct": 15}';
BEGIN
  INSERT INTO rule (account_id, code, name, is_default)
  VALUES (p_account_id, 'R-00', 'Brand Direct is never a violation', true)
  ON CONFLICT (account_id, code) DO NOTHING RETURNING id INTO r00;
  IF r00 IS NOT NULL THEN
    INSERT INTO rule_version (account_id, rule_id, version, scope, condition, verdict, severity, priority,
                              status, content_hash, valid_from, published_at, note)
    VALUES (p_account_id, r00, 1, s00, c00, 'exempt', sev, 10, 'Published',
            encode(sha256(convert_to(jsonb_build_object('scope', s00, 'condition', c00, 'verdict', 'exempt',
                                                        'severity', sev, 'priority', 10)::text, 'UTF8')), 'hex'),
            '2000-01-01', now(), 'Default template');
  END IF;

  INSERT INTO rule (account_id, code, name, is_default)
  VALUES (p_account_id, 'R-01', 'Below MAP by more than tolerance', true)
  ON CONFLICT (account_id, code) DO NOTHING RETURNING id INTO r01;
  IF r01 IS NOT NULL THEN
    INSERT INTO rule_version (account_id, rule_id, version, scope, condition, verdict, severity, priority,
                              status, content_hash, valid_from, published_at, note)
    VALUES (p_account_id, r01, 1, s00, c01, 'violation', sev, 100, 'Published',
            encode(sha256(convert_to(jsonb_build_object('scope', s00, 'condition', c01, 'verdict', 'violation',
                                                        'severity', sev, 'priority', 100)::text, 'UTF8')), 'hex'),
            '2000-01-01', now(), 'Default template: tolerance and minimum depth from account settings');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION account_seed_verdict_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_seed_verdict_rules(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER account_default_verdict_rules AFTER INSERT ON account
  FOR EACH ROW EXECUTE FUNCTION account_seed_verdict_rules();

SELECT app_seed_verdict_rules(id) FROM account;
