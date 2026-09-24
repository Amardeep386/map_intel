-- MAP Intel · Phase 1 · M5–M8: collection configuration.
-- Shared: source_family, source (catalogue). Per account (RLS): subscriptions, term groups, terms,
-- the subscription matrix and schedules. Configuration rows are edited in place; every change is
-- recorded in audit_event with before/after.

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Shared source catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE source_family (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE source
  ADD COLUMN family_id uuid REFERENCES source_family(id),
  ADD COLUMN collector_status text NOT NULL DEFAULT 'planned' CHECK (collector_status IN ('live', 'planned', 'retired'));

-- ---------------------------------------------------------------------------
-- Per-account subscriptions to catalogue sources
-- ---------------------------------------------------------------------------
CREATE TABLE account_source (
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  source_id   uuid NOT NULL REFERENCES source(id),
  active      boolean NOT NULL DEFAULT true,
  options     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- validated against source.options_schema
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, source_id)
);
CREATE TRIGGER account_source_touch BEFORE UPDATE ON account_source FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Terms: what we search for
-- ---------------------------------------------------------------------------
CREATE TABLE term_group (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX term_group_name_uq ON term_group (account_id, lower(name));
CREATE TRIGGER term_group_touch BEFORE UPDATE ON term_group FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE term (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES term_group(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('keyword', 'brand', 'identifier', 'url', 'seller')),
  value        text NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
  product_id   uuid REFERENCES product(id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  batch_label  text,                                  -- which import / generation created it
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX term_value_uq ON term (account_id, type, lower(value));
CREATE INDEX term_group_idx ON term (group_id);
CREATE INDEX term_product_idx ON term (product_id);
CREATE TRIGGER term_touch BEFORE UPDATE ON term FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Which term found which listing (filled by the Phase 2b collectors). Drives term yield.
CREATE TABLE listing_discovery (
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  term_id         uuid NOT NULL REFERENCES term(id) ON DELETE CASCADE,
  listing_id      uuid NOT NULL REFERENCES listing(id),
  first_found_at  timestamptz NOT NULL DEFAULT now(),
  last_found_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (term_id, listing_id)
);

-- Term yield: listings found in the last 30 days and how many survived cleansing (Included).
-- Violations produced arrive with Phase 3. security_invoker keeps RLS in force.
CREATE VIEW term_yield WITH (security_invoker = true) AS
SELECT t.id AS term_id,
       count(d.listing_id) FILTER (WHERE d.last_found_at > now() - interval '30 days')::int AS found_30d,
       count(d.listing_id) FILTER (WHERE d.last_found_at > now() - interval '30 days' AND l.state = 'Included')::int AS survived_30d,
       count(d.listing_id) FILTER (WHERE d.last_found_at > now() - interval '90 days' AND l.state = 'Included')::int AS survived_90d,
       0 AS violations_30d
  FROM term t
  LEFT JOIN listing_discovery d ON d.term_id = t.id
  LEFT JOIN listing l ON l.id = d.listing_id
 GROUP BY t.id;

-- ---------------------------------------------------------------------------
-- Subscription matrix: term group × source category
-- ---------------------------------------------------------------------------
CREATE TABLE term_group_subscription (
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES term_group(id) ON DELETE CASCADE,
  source_category  text NOT NULL CHECK (source_category IN ('Marketplace', 'Online Seller', 'Price Comparison')),
  mode             text NOT NULL DEFAULT 'None' CHECK (mode IN ('All', 'Some', 'None')),
  source_ids       uuid[] NOT NULL DEFAULT '{}',       -- used when mode = 'Some'
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, source_category)
);
CREATE TRIGGER term_group_subscription_touch BEFORE UPDATE ON term_group_subscription FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Named, reusable schedules (run by the Phase 2b scheduler)
-- ---------------------------------------------------------------------------
CREATE TABLE schedule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name             text NOT NULL,
  -- Which work it applies to; empty arrays match everything:
  -- { sources: [code], categories: [..], families: [code], termGroups: [id], terms: [id] }
  selector         jsonb NOT NULL DEFAULT '{}'::jsonb,
  listing_scope    text NOT NULL DEFAULT 'Included and Staged' CHECK (listing_scope IN ('Included only', 'Included and Staged', 'All')),
  listing_status   text NOT NULL DEFAULT 'Active only' CHECK (listing_status IN ('Active only', 'Inactive only', 'All')),
  takedown_status  text NOT NULL DEFAULT 'All' CHECK (takedown_status IN ('All', 'Under notice', 'Not under notice')),
  cadence          text NOT NULL,                      -- cron expression, e.g. '0 6 * * *'
  timezone         text NOT NULL DEFAULT 'UTC',
  priority         integer NOT NULL DEFAULT 10 CHECK (priority BETWEEN 0 AND 100),
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX schedule_name_uq ON schedule (account_id, lower(name));
CREATE TRIGGER schedule_touch BEFORE UPDATE ON schedule FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security on the new account-owned tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_source', 'term_group', 'term', 'listing_discovery', 'term_group_subscription', 'schedule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- Source subscriptions per account, for the account list (sources count) and health views.
CREATE OR REPLACE FUNCTION app_accounts_for_user(p_user_id uuid, p_is_admin boolean)
RETURNS TABLE (id uuid, slug text, name text, brand text, status text, accent_light text, accent_dark text,
               role text, skus integer, sources integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.slug, a.name, a.brand, a.status, a.accent_light, a.accent_dark,
         coalesce(m.role, CASE WHEN p_is_admin THEN 'Administrator' END),
         (SELECT count(*) FROM product p WHERE p.account_id = a.id AND p.status <> 'Retired')::int,
         (SELECT count(*) FROM account_source s WHERE s.account_id = a.id AND s.active)::int
    FROM account a
    LEFT JOIN account_membership m ON m.account_id = a.id AND m.user_id = p_user_id
   WHERE p_is_admin OR m.user_id IS NOT NULL
   ORDER BY a.name
$$;
