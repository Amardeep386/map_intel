-- MAP Intel · Phase 2a · M1: catalogue and policy.
--   * product: product group; identifiers UPC, EAN, MPN, ASIN and alternate SKUs in slots 1–6.
--   * map_price: effective-dated per product and region, no overlaps, closed but never rewritten.
--   * promo_window (+ products): below-MAP inside a window is an authorised promotion.
--   * policy_document: versioned MAP policy files (stored in S3 with their SHA-256).
--   * catalogue_import: every committed import (products, MAP, listings) with its column mapping.
-- Migrations 007–019 belong to Phase 2a; Phase 2b starts at 020.

SELECT set_config('app.role', 'system', true);

-- ---------------------------------------------------------------------------
-- Guards shared by the effective-dated and append-only tables
-- ---------------------------------------------------------------------------

-- Effective-dated rows are never rewritten. The one allowed update closes an open row
-- (effective_to NULL -> a date after effective_from). Deletes only through an account or
-- product cascade (one trigger level deeper), like audit_event.
CREATE OR REPLACE FUNCTION effective_dated_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION '% is effective-dated: rows are closed, never deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
     AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is effective-dated: only closing an open row is allowed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;

-- Append-only history tables: no updates, deletes only through a cascade.
CREATE OR REPLACE FUNCTION append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Products and identifiers
-- ---------------------------------------------------------------------------
ALTER TABLE product ADD COLUMN product_group text;
ALTER TABLE product ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER product_touch BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Alternate SKUs (ALT) sit in numbered slots 1–6; other identifier types have no slot.
ALTER TABLE product_identifier ADD COLUMN slot smallint;
ALTER TABLE product_identifier ADD CONSTRAINT product_identifier_slot_ck
  CHECK ((type = 'ALT' AND slot BETWEEN 1 AND 6) OR (type <> 'ALT' AND slot IS NULL));
CREATE UNIQUE INDEX product_identifier_alt_slot_uq ON product_identifier (product_id, slot) WHERE type = 'ALT';
-- Matching looks identifiers up by value within an account.
CREATE INDEX product_identifier_lookup_idx ON product_identifier (account_id, type, upper(value));

-- ---------------------------------------------------------------------------
-- Committed imports (dry runs are not stored)
-- ---------------------------------------------------------------------------
CREATE TABLE catalogue_import (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seq           integer NOT NULL,                        -- IMP-001, IMP-002, ... per account
  kind          text NOT NULL CHECK (kind IN ('products', 'map', 'listings')),
  file_name     text NOT NULL,
  mapping       jsonb NOT NULL,                          -- target field -> file column
  summary       jsonb NOT NULL,                          -- counts: new, changed, unchanged, skipped, errors
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq)
);

-- ---------------------------------------------------------------------------
-- MAP history
-- ---------------------------------------------------------------------------
ALTER TABLE map_price ADD COLUMN import_id uuid REFERENCES catalogue_import(id);
ALTER TABLE map_price ADD COLUMN note text;
-- One MAP in force per product and region at any moment ([from, to) intervals).
ALTER TABLE map_price ADD CONSTRAINT map_price_no_overlap EXCLUDE USING gist (
  product_id WITH =,
  (coalesce(region, '')) WITH =,
  tstzrange(effective_from, coalesce(effective_to, 'infinity'), '[)') WITH &&
);
DROP TRIGGER IF EXISTS map_price_no_delete ON map_price;
CREATE TRIGGER map_price_effective_dated
  BEFORE UPDATE OR DELETE ON map_price
  FOR EACH ROW EXECUTE FUNCTION effective_dated_guard();

-- ---------------------------------------------------------------------------
-- Promotion windows
-- ---------------------------------------------------------------------------
CREATE TABLE promo_window (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seq           integer NOT NULL,                        -- PW-001, ... per account
  name          text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to  timestamptz NOT NULL,
  note          text,
  cancelled_at  timestamptz,                             -- a cancelled window no longer applies
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, seq),
  CHECK (effective_to > effective_from)
);

-- Products in a window, each with its promotional MAP.
CREATE TABLE promo_window_product (
  promo_id      uuid NOT NULL REFERENCES promo_window(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  promo_amount  numeric(12,2) NOT NULL CHECK (promo_amount > 0),
  PRIMARY KEY (promo_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Policy documents (versioned per name)
-- ---------------------------------------------------------------------------
CREATE TABLE policy_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name            text NOT NULL,
  version         integer NOT NULL,
  effective_from  timestamptz NOT NULL,
  effective_to    timestamptz,
  file_name       text NOT NULL,
  content_type    text NOT NULL,
  bytes           integer NOT NULL,
  storage_key     text NOT NULL,
  sha256          char(64) NOT NULL,
  note            text,
  uploaded_by     uuid,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TRIGGER policy_document_effective_dated
  BEFORE UPDATE OR DELETE ON policy_document
  FOR EACH ROW EXECUTE FUNCTION effective_dated_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catalogue_import', 'promo_window', 'promo_window_product', 'policy_document'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;
