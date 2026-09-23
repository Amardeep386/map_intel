-- MAP Intel · Phase 0 schema
-- Tables: account, app_user, account_membership, source, product, product_identifier,
--         map_price, listing, crawl_run, observation (partitioned by month), evidence.
-- Rules (from the MAP Intel Blueprint):
--   * account_id on every account-owned row, enforced with row-level security (RLS).
--   * source, listing, observation and evidence are the shared core (no account_id).
--   * observation, evidence and map_price are append-only: corrections are new rows.
--   * All timestamps are timestamptz (stored in UTC).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Tenant context. The API sets these per transaction with SET LOCAL / set_config(..., true).
--   app.account_id  -> the account the current request works in
--   app.role        -> 'system' for migrations, seeds, the collector worker and admin tooling
CREATE OR REPLACE FUNCTION app_current_account() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.account_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.role', true), '') = 'system'
$$;

CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- ---------------------------------------------------------------------------
-- Tenancy & access
-- ---------------------------------------------------------------------------

CREATE TABLE account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  brand           text NOT NULL,
  status          text NOT NULL DEFAULT 'Sandbox' CHECK (status IN ('Sandbox', 'Active', 'Paused', 'Closed')),
  regions         text[] NOT NULL DEFAULT ARRAY['US'],
  currency        char(3) NOT NULL DEFAULT 'USD',
  timezone        text NOT NULL DEFAULT 'America/New_York',
  accent_light    text,
  accent_dark     text,
  contract_from   date,
  contract_to     date,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- tolerance, min_depth, grace, thresholds
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  full_name       text NOT NULL,
  password_hash   text NOT NULL,
  platform_role   text NOT NULL DEFAULT 'member' CHECK (platform_role IN ('admin', 'member')),
  status          text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE UNIQUE INDEX app_user_email_uq ON app_user (lower(email));

-- Which accounts a (non-admin) user can open, and with which role.
CREATE TABLE account_membership (
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('Administrator', 'Account manager', 'Analyst', 'Brand user')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Collection config (shared core)
-- ---------------------------------------------------------------------------

CREATE TABLE source (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,                 -- e.g. amazon_us, bestbuy_us, walmart_us
  internal_name   text NOT NULL,
  display_name    text NOT NULL,
  category        text NOT NULL CHECK (category IN ('Marketplace', 'Online Seller', 'Price Comparison')),
  country         char(2) NOT NULL DEFAULT 'US',
  base_url        text NOT NULL,
  logo_url        text,                                 -- stored per source (no third-party logo lookups)
  capability      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- what the collector can do (api, http, browser)
  options_schema  jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Catalogue & policy (account-owned)
-- ---------------------------------------------------------------------------

CREATE TABLE product (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  product_code    text NOT NULL,                        -- the brand's SKU code shown in the portal
  name            text NOT NULL,
  brand           text NOT NULL,
  category        text,
  model_number    text,                                 -- MPN / manufacturer part number
  standard_price  numeric(12,2),                        -- MSRP
  status          text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Paused', 'Retired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, product_code)
);
CREATE INDEX product_account_idx ON product (account_id);

CREATE TABLE product_identifier (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('UPC', 'EAN', 'MPN', 'ASIN', 'BESTBUY_SKU', 'WALMART_ID', 'ALT')),
  value           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, type, value)
);

-- MAP as an effective-dated series. Rows are never overwritten; a change closes the old row
-- (effective_to) by inserting a new row. Kept here because the Add SKU form already captures MAP.
CREATE TABLE map_price (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  currency        char(3) NOT NULL DEFAULT 'USD',
  region          text,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('import', 'manual', 'policy')),
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX map_price_product_idx ON map_price (product_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Observations (shared core)
-- ---------------------------------------------------------------------------

-- A stable identity for "this offer page on this source", observed many times.
-- Phase 0 shortcut: product_id links the listing to a pilot SKU directly. Phase 2a replaces this
-- with match_candidate / match_decision (per account, with confidence).
CREATE TABLE listing (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid NOT NULL REFERENCES source(id),
  product_id        uuid REFERENCES product(id) ON DELETE SET NULL,
  url               text NOT NULL,
  channel_sku       text,                               -- ASIN, Best Buy SKU, Walmart item id
  title             text,
  state             text NOT NULL DEFAULT 'Included' CHECK (state IN ('Staged', 'Included', 'Excluded', 'Retired')),
  match_confidence  numeric(5,2),
  first_seen        timestamptz,
  last_seen         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, url)
);
CREATE INDEX listing_product_idx ON listing (product_id);

CREATE TABLE crawl_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger         text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule', 'recheck')),
  scope           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- filters used (brand, source, limit)
  egress_label    text,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('queued', 'running', 'finished', 'failed')),
  jobs_total      integer NOT NULL DEFAULT 0,
  jobs_done       integer NOT NULL DEFAULT 0,
  stats           jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- One row per look at a listing. Never updated or deleted. Never carries an old price forward:
-- if a value could not be read it is NULL and status says why.
CREATE TABLE observation (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  observed_at       timestamptz NOT NULL,
  listing_id        uuid NOT NULL REFERENCES listing(id),
  crawl_run_id      uuid REFERENCES crawl_run(id),
  status            text NOT NULL CHECK (status IN ('ok', 'partial', 'blocked', 'not_found', 'failed', 'skipped_robots')),
  advertised_price  numeric(12,2),
  list_price        numeric(12,2),
  currency          char(3),
  availability      text CHECK (availability IN ('in_stock', 'limited', 'out_of_stock', 'preorder', 'unknown')),
  qty               integer,
  seller_name_raw   text,
  seller_id_raw     text,
  fulfilled_by_raw  text,
  promo_text        text,
  coupon_text       text,
  title_raw         text,
  model_match       boolean,                            -- page mentions the product's model number
  fetch_method      text CHECK (fetch_method IN ('http', 'browser', 'api')),
  http_status       integer,
  final_url         text,
  error             text,
  extract           jsonb NOT NULL DEFAULT '{}'::jsonb, -- extractor diagnostics (which selectors hit)
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, observed_at)
) PARTITION BY RANGE (observed_at);

CREATE INDEX observation_listing_idx ON observation (listing_id, observed_at DESC);
CREATE INDEX observation_run_idx ON observation (crawl_run_id);

-- Monthly partitions. Later months are added by `ensure_observation_partitions` (called by migrate).
CREATE OR REPLACE FUNCTION ensure_observation_partitions(from_month date, months integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  m date := date_trunc('month', from_month)::date;
  i integer;
  pname text;
BEGIN
  FOR i IN 0 .. months - 1 LOOP
    pname := format('observation_%s', to_char(m + (i || ' month')::interval, 'YYYY_MM'));
    IF to_regclass(pname) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF observation FOR VALUES FROM (%L) TO (%L)',
        pname, m + (i || ' month')::interval, m + ((i + 1) || ' month')::interval
      );
    END IF;
  END LOOP;
END
$$;

SELECT ensure_observation_partitions(date '2026-09-01', 16);
CREATE TABLE observation_default PARTITION OF observation DEFAULT;

CREATE TRIGGER observation_append_only
  BEFORE UPDATE OR DELETE ON observation
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Evidence captured at collection time: object-storage keys plus SHA-256 of each stored file.
CREATE TABLE evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id      uuid NOT NULL,
  observed_at         timestamptz NOT NULL,
  screenshot_uri      text,
  screenshot_sha256   char(64),
  screenshot_bytes    integer,
  html_uri            text,
  html_sha256         char(64),
  html_bytes          integer,
  pdf_uri             text,
  pdf_sha256          char(64),
  method              text NOT NULL,                    -- 'http+render' | 'browser' | 'api+http+render'
  captured_at         timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (observation_id, observed_at) REFERENCES observation (id, observed_at)
);
CREATE INDEX evidence_observation_idx ON evidence (observation_id);

CREATE TRIGGER evidence_append_only
  BEFORE UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER map_price_no_delete
  BEFORE DELETE ON map_price
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Row-level security on account-owned tables
-- ---------------------------------------------------------------------------
-- FORCE makes the policies apply to the table owner too, so a query that forgets its
-- WHERE account_id = ... still cannot read another brand's rows.
-- Phase 1 note: move the API to a separate non-owner database role as well.

ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product FORCE ROW LEVEL SECURITY;
CREATE POLICY product_tenant ON product
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

ALTER TABLE product_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_identifier FORCE ROW LEVEL SECURITY;
CREATE POLICY product_identifier_tenant ON product_identifier
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

ALTER TABLE map_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_price FORCE ROW LEVEL SECURITY;
CREATE POLICY map_price_tenant ON map_price
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

ALTER TABLE account_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY account_membership_tenant ON account_membership
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

-- ---------------------------------------------------------------------------
-- Tenant role
-- ---------------------------------------------------------------------------
-- Superusers (the default user in the local Docker Postgres) bypass RLS even with FORCE.
-- Tenant-scoped API queries therefore run under this non-superuser role via
-- `SET LOCAL ROLE mapintel_tenant` inside their transaction (see src/lib/db.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mapintel_tenant') THEN
    CREATE ROLE mapintel_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT mapintel_tenant TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO mapintel_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mapintel_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mapintel_tenant;
