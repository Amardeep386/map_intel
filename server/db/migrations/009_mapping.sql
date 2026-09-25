-- MAP Intel · Phase 2a · M1: mapping (which collected listings are the brand's products).
--   * listing stays shared core; it gains origin, seller and image.
--   * listing_match: each account's current decision on a listing (Staged / Included /
--     Excluded / Retired), the matched product and confidence.
--   * listing_state_event: append-only history of those decisions. Decisions made by a person
--     (is_label) are the training labels for the "prior decisions" signal.
--   * match_candidate + match_signal: what the matcher saw and the score of each of the six
--     signals (identifier, title, image, price, attributes, prior), append-only.
--   * suppression: standing exclusions (listing, seller + product, URL pattern, source).
--   * match_rule: inclusion / exclusion rules per account, seeded with defaults.

SELECT set_config('app.role', 'system', true);

-- ---------------------------------------------------------------------------
-- listing (shared core)
-- ---------------------------------------------------------------------------
ALTER TABLE listing ADD COLUMN origin text NOT NULL DEFAULT 'collector'
  CHECK (origin IN ('collector', 'import', 'synthetic', 'seed'));
ALTER TABLE listing ADD COLUMN seller_id uuid REFERENCES seller(id);
ALTER TABLE listing ADD COLUMN image_url text;
UPDATE listing SET origin = 'seed';
CREATE INDEX listing_origin_idx ON listing (origin) WHERE origin = 'synthetic';

-- ---------------------------------------------------------------------------
-- Candidates and their signals
-- ---------------------------------------------------------------------------
CREATE TABLE match_candidate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  listing_id    uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES product(id) ON DELETE SET NULL,   -- proposed match (NULL = none)
  title         text,
  price         numeric(12,2),
  currency      char(3),
  seller_name   text,
  seller_id     uuid REFERENCES seller(id),
  image_url     text,
  condition     text,                                             -- as shown: new, used, refurbished, open box...
  listing_format text,                                            -- fixed price / auction
  found         jsonb NOT NULL DEFAULT '{}'::jsonb,               -- identifiers and attributes detected
  confidence    numeric(5,2) NOT NULL,
  band          text NOT NULL CHECK (band IN ('include', 'review', 'exclude')),
  origin        text NOT NULL CHECK (origin IN ('collector', 'import', 'synthetic', 'rescore')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_candidate_listing_idx ON match_candidate (account_id, listing_id, created_at DESC);

CREATE TABLE match_signal (
  candidate_id  uuid NOT NULL REFERENCES match_candidate(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  signal        text NOT NULL CHECK (signal IN ('identifier', 'title', 'image', 'price', 'attributes', 'prior')),
  score         numeric(4,3) CHECK (score BETWEEN 0 AND 1),       -- NULL = not available
  weight        numeric(5,2) NOT NULL,                            -- share of the confidence actually used
  passed        boolean,
  detail        text NOT NULL,
  PRIMARY KEY (candidate_id, signal)
);

CREATE TRIGGER match_candidate_append_only BEFORE UPDATE OR DELETE ON match_candidate
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER match_signal_append_only BEFORE UPDATE OR DELETE ON match_signal
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- ---------------------------------------------------------------------------
-- Rules and suppressions
-- ---------------------------------------------------------------------------
CREATE TABLE match_rule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('include', 'exclude')),
  condition     jsonb NOT NULL,                                   -- evaluated by lib/matchRules.ts
  reason        text,                                             -- exclusion reason recorded on hits
  priority      integer NOT NULL DEFAULT 100,                     -- lower runs first
  active        boolean NOT NULL DEFAULT true,
  is_default    boolean NOT NULL DEFAULT false,
  hits          integer NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, code)
);
CREATE TRIGGER match_rule_touch BEFORE UPDATE ON match_rule FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE suppression (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seq           integer NOT NULL,                                 -- SUP-001, ... per account
  reason        text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('listing', 'seller_product', 'url_pattern', 'source')),
  listing_id    uuid REFERENCES listing(id) ON DELETE CASCADE,
  seller_id     uuid REFERENCES seller(id),
  seller_name   text,                                             -- when the seller is only known by name
  product_id    uuid REFERENCES product(id) ON DELETE CASCADE,
  source_id     uuid REFERENCES source(id),
  url_pattern   text,
  note          text,
  hits          integer NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  UNIQUE (account_id, seq),
  CHECK (
    (scope = 'listing' AND listing_id IS NOT NULL) OR
    (scope = 'seller_product' AND (seller_id IS NOT NULL OR seller_name IS NOT NULL) AND product_id IS NOT NULL) OR
    (scope = 'url_pattern' AND url_pattern IS NOT NULL) OR
    (scope = 'source' AND source_id IS NOT NULL)
  )
);
CREATE INDEX suppression_active_idx ON suppression (account_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Current decision per account and its history
-- ---------------------------------------------------------------------------
CREATE TABLE listing_match (
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  listing_id      uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES product(id) ON DELETE SET NULL,
  state           text NOT NULL CHECK (state IN ('Staged', 'Included', 'Excluded', 'Retired')),
  confidence      numeric(5,2),
  priority        numeric(8,3) NOT NULL DEFAULT 0,                -- review order: higher first
  candidate_id    uuid REFERENCES match_candidate(id),
  decided_by      text NOT NULL CHECK (decided_by IN ('pending', 'auto', 'rule', 'suppression', 'user', 'seed', 'system')),
  rule_id         uuid REFERENCES match_rule(id) ON DELETE SET NULL,
  suppression_id  uuid REFERENCES suppression(id) ON DELETE SET NULL,
  reason          text,
  scope           text,
  decided_user    uuid,
  state_since     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, listing_id)
);
CREATE INDEX listing_match_state_idx ON listing_match (account_id, state, priority DESC);
CREATE INDEX listing_match_product_idx ON listing_match (product_id);

CREATE TABLE listing_state_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  listing_id      uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  from_state      text,
  to_state        text NOT NULL,
  product_id      uuid,
  confidence      numeric(5,2),
  actor_type      text NOT NULL CHECK (actor_type IN ('user', 'rule', 'auto', 'suppression', 'system')),
  actor_id        text,
  actor_label     text NOT NULL,
  reason          text,
  scope           text,
  rule_id         uuid,
  suppression_id  uuid,
  candidate_id    uuid,
  is_label        boolean NOT NULL DEFAULT false,                 -- a person's decision: a training label
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_state_event_listing_idx ON listing_state_event (account_id, listing_id, created_at DESC);
CREATE INDEX listing_state_event_label_idx ON listing_state_event (account_id, product_id) WHERE is_label;
CREATE TRIGGER listing_state_event_append_only BEFORE UPDATE OR DELETE ON listing_state_event
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['match_candidate', 'match_signal', 'match_rule', 'suppression', 'listing_match', 'listing_state_event'] LOOP
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
-- Default rules for every account (existing ones now, new ones on creation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_seed_match_rules(p_account_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO match_rule (account_id, code, name, kind, condition, reason, priority, is_default) VALUES
    (p_account_id, 'EXC-CONDITION', 'Used, refurbished, renewed or open box', 'exclude',
     '{"type": "condition", "values": ["used", "refurbished", "renewed", "open box", "pre-owned", "for parts"]}', 'Used or refurbished', 10, true),
    (p_account_id, 'EXC-WAREHOUSE', 'Warehouse deals and resale programmes', 'exclude',
     '{"type": "seller_or_title", "patterns": ["amazon warehouse", "warehouse deal", "amazon resale", "renewed premium"]}', 'Used or refurbished', 20, true),
    (p_account_id, 'EXC-AUCTION', 'Auctions', 'exclude',
     '{"type": "listing_format", "values": ["auction"]}', 'Not a purchasable offer', 30, true),
    (p_account_id, 'INC-ASIN-URL', 'ASIN in the URL is the product''s ASIN', 'include',
     '{"type": "identifier_in_url", "identifier": "ASIN"}', NULL, 50, true),
    (p_account_id, 'INC-MPN', 'Model number (MPN) in the URL or title', 'include',
     '{"type": "identifier_in_url_or_title", "identifier": "MPN"}', NULL, 60, true),
    (p_account_id, 'INC-ATTRIBUTES', 'Identifier found and attributes match (new, single unit, same variant)', 'include',
     '{"type": "attribute_match", "minTitle": 0.5}', NULL, 70, true)
  ON CONFLICT (account_id, code) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION account_seed_match_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_seed_match_rules(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER account_default_match_rules AFTER INSERT ON account
  FOR EACH ROW EXECUTE FUNCTION account_seed_match_rules();

SELECT app_seed_match_rules(id) FROM account;

-- ---------------------------------------------------------------------------
-- Backfill: the seeded pilot listings become each account's matches
-- ---------------------------------------------------------------------------
INSERT INTO listing_match (account_id, listing_id, product_id, state, confidence, priority, decided_by, reason, state_since)
SELECT p.account_id, l.id, l.product_id, l.state, coalesce(l.match_confidence, 100), 0, 'seed',
       'Pilot listing from the seed catalogue', coalesce(l.first_seen, l.created_at)
  FROM listing l JOIN product p ON p.id = l.product_id
ON CONFLICT DO NOTHING;

INSERT INTO listing_state_event (account_id, listing_id, from_state, to_state, product_id, confidence, actor_type, actor_label, reason)
SELECT m.account_id, m.listing_id, NULL, m.state, m.product_id, m.confidence, 'system', 'Seed', m.reason
  FROM listing_match m;
