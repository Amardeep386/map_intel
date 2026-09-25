-- MAP Intel · Phase 2a · M1: market identity (sellers).
--   * seller, seller_alias, seller_link: shared core (one storefront per source, seen by every
--     account; reused unchanged by Pricing Intel later).
--   * seller_classification: per account, effective-dated, append-only (MAP Authorised,
--     Unauthorised, Brand Direct, Unknown). A violation copies the class in force at capture.
--   * seller_contact: per account (who a notice goes to).
--   * promo_window_seller: a promotion limited to some sellers (none listed = all sellers).

SELECT set_config('app.role', 'system', true);

CREATE TABLE seller (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           uuid NOT NULL REFERENCES source(id),
  platform_seller_id  text,                              -- e.g. Amazon merchant id, when the source exposes one
  name                text NOT NULL,                     -- canonical display name
  name_key            text NOT NULL,                     -- normalised name (lib/sellers.ts normaliseSellerName)
  storefront_url      text,
  first_seen          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX seller_platform_id_uq ON seller (source_id, platform_seller_id) WHERE platform_seller_id IS NOT NULL;
CREATE UNIQUE INDEX seller_name_key_uq ON seller (source_id, name_key) WHERE platform_seller_id IS NULL;

-- Other names the same storefront was seen under (raw names from observations or imports).
CREATE TABLE seller_alias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES seller(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  alias_key   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, alias_key)
);
CREATE INDEX seller_alias_key_idx ON seller_alias (alias_key);

-- Storefronts believed to be the same business (shared address, same phone, same owner...).
CREATE TABLE seller_link (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_a      uuid NOT NULL REFERENCES seller(id) ON DELETE CASCADE,
  seller_b      uuid NOT NULL REFERENCES seller(id) ON DELETE CASCADE,
  reason        text NOT NULL,
  confidence    smallint NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (seller_a < seller_b),
  UNIQUE (seller_a, seller_b)
);

CREATE TABLE seller_classification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seller_id       uuid NOT NULL REFERENCES seller(id) ON DELETE CASCADE,
  class           text NOT NULL CHECK (class IN ('MAP Authorised', 'Unauthorised', 'Brand Direct', 'Unknown')),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  set_by          uuid,                                  -- NULL = system (first seen)
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (
    account_id WITH =, seller_id WITH =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity'), '[)') WITH &&
  )
);
CREATE INDEX seller_classification_seller_idx ON seller_classification (account_id, seller_id, effective_from DESC);
CREATE TRIGGER seller_classification_effective_dated
  BEFORE UPDATE OR DELETE ON seller_classification
  FOR EACH ROW EXECUTE FUNCTION effective_dated_guard();

CREATE TABLE seller_contact (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seller_id   uuid NOT NULL REFERENCES seller(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('email', 'phone', 'address', 'web form', 'other')),
  value       text NOT NULL,
  label       text,                                      -- e.g. "Notices", "Legal"
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_contact_seller_idx ON seller_contact (account_id, seller_id);

CREATE TABLE promo_window_seller (
  promo_id    uuid NOT NULL REFERENCES promo_window(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  seller_id   uuid NOT NULL REFERENCES seller(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_id, seller_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['seller_classification', 'seller_contact', 'promo_window_seller'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_system() OR account_id = app_current_account()) '
      'WITH CHECK (app_is_system() OR account_id = app_current_account())',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- Shared identity rows are created by the collector (system) or by an account's import or
-- manual entry. The API may add sellers, aliases and links but never removes them.
REVOKE DELETE ON seller, seller_alias, seller_link FROM mapintel_api, mapintel_tenant;
