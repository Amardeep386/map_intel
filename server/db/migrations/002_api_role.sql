-- MAP Intel · Phase 1 · M1: the API gets its own database role.
--
-- The API used to connect as the database owner and switch to `mapintel_tenant` per request.
-- On Neon the owner role has BYPASSRLS, so tenant isolation relied on application code.
-- From here the API connects as `mapintel_api`: a plain role without BYPASSRLS whose
-- `app.role = 'system'` setting is ignored, so row-level security is enforced by Postgres.
--
-- The role is created without LOGIN. Enable it yourself in the Neon SQL editor (the password
-- never goes through this repo):   ALTER ROLE mapintel_api LOGIN PASSWORD '...';
-- Do not create it in the Neon console: console roles join neon_superuser, which has BYPASSRLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mapintel_api') THEN
    CREATE ROLE mapintel_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- withTenant() still does SET LOCAL ROLE mapintel_tenant, so the API role must be able to.
GRANT mapintel_tenant TO mapintel_api;
GRANT USAGE ON SCHEMA public TO mapintel_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mapintel_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mapintel_api;
-- Tables created later by the owner (new migrations, monthly observation partitions).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mapintel_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mapintel_api;

-- 'system' is only honoured for the owner connection (migrations, seed, collector worker).
-- session_user is the login role and does not change with SET ROLE, so the API cannot opt out of RLS.
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.role', true), '') = 'system'
     AND session_user <> 'mapintel_api'
$$;

-- ---------------------------------------------------------------------------
-- Narrow cross-account reads for the API (SECURITY DEFINER: run as the owner).
-- Each returns only what its caller needs; none returns another tenant's catalogue rows.
-- ---------------------------------------------------------------------------

-- The account list for the account picker, with per-account counts.
CREATE OR REPLACE FUNCTION app_accounts_for_user(p_user_id uuid, p_is_admin boolean)
RETURNS TABLE (id uuid, slug text, name text, brand text, status text, accent_light text, accent_dark text,
               role text, skus integer, sources integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.slug, a.name, a.brand, a.status, a.accent_light, a.accent_dark,
         coalesce(m.role, CASE WHEN p_is_admin THEN 'Administrator' END),
         (SELECT count(*) FROM product p WHERE p.account_id = a.id AND p.status <> 'Retired')::int,
         (SELECT count(DISTINCT l.source_id) FROM listing l JOIN product p ON p.id = l.product_id
           WHERE p.account_id = a.id)::int
    FROM account a
    LEFT JOIN account_membership m ON m.account_id = a.id AND m.user_id = p_user_id
   WHERE p_is_admin OR m.user_id IS NOT NULL
   ORDER BY a.name
$$;

-- The user's role in one account (NULL = no access).
CREATE OR REPLACE FUNCTION app_account_role(p_account_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT role FROM account_membership WHERE account_id = p_account_id AND user_id = p_user_id
$$;

-- All memberships of one user (for /auth/me).
CREATE OR REPLACE FUNCTION app_user_memberships(p_user_id uuid)
RETURNS TABLE (account_id uuid, account_slug text, account_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.slug, a.name, m.role
    FROM account_membership m JOIN account a ON a.id = m.account_id
   WHERE m.user_id = p_user_id
   ORDER BY a.name
$$;

-- Which account owns a piece of evidence (the caller then checks access and reads it as that tenant).
CREATE OR REPLACE FUNCTION app_evidence_account(p_evidence_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.account_id
    FROM evidence e
    JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
    JOIN listing l ON l.id = o.listing_id
    JOIN product p ON p.id = l.product_id
   WHERE e.id = p_evidence_id
$$;

-- Listings to collect for a run scope (used by the API's admin "queue a run" and the CLI).
CREATE OR REPLACE FUNCTION app_select_listings(p_account text, p_source text, p_product text, p_limit integer)
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id
    FROM listing l
    JOIN source s ON s.id = l.source_id AND s.active
    JOIN product p ON p.id = l.product_id AND p.status = 'Active'
    JOIN account a ON a.id = p.account_id
   WHERE l.state = 'Included'
     AND (p_account IS NULL OR a.slug = p_account)
     AND (p_source IS NULL OR s.code = p_source)
     AND (p_product IS NULL OR p.product_code = p_product)
   ORDER BY a.slug, p.product_code, s.code
   LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION app_accounts_for_user(uuid, boolean), app_account_role(uuid, uuid),
  app_user_memberships(uuid), app_evidence_account(uuid), app_select_listings(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_accounts_for_user(uuid, boolean), app_account_role(uuid, uuid),
  app_user_memberships(uuid), app_evidence_account(uuid), app_select_listings(text, text, text, integer)
  TO mapintel_api;
