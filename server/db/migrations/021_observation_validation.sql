-- MAP Intel · Phase 2b · M1: validation, failure classes and Object Lock details.
-- Observations stay append-only. A suspicious reading is stored with status 'held' and the checks
-- that held it; it is never published, and a recheck job reads the page again.

ALTER TABLE observation DROP CONSTRAINT observation_status_check;
ALTER TABLE observation ADD CONSTRAINT observation_status_check
  CHECK (status IN ('ok', 'partial', 'held', 'blocked', 'not_found', 'failed', 'skipped_robots'));

ALTER TABLE observation
  ADD COLUMN failure_class text CHECK (failure_class IN ('blocked', 'layout_changed', 'timeout', 'empty', 'auth', 'robots', 'network', 'not_found')),
  ADD COLUMN validation    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { checks: [...], reference: {kind, amount}, held: [...] }
  ADD COLUMN crawl_job_id  uuid,
  ADD COLUMN seller_id     uuid,                              -- seller_name_raw normalised to a seller
  ADD COLUMN condition     text,                              -- new | used | refurbished | open_box
  ADD COLUMN offer_rank    smallint;                          -- 1 = buy box / main offer
CREATE INDEX observation_job_idx ON observation (crawl_job_id);

ALTER TABLE evidence
  ADD COLUMN lock_mode  text CHECK (lock_mode IN ('GOVERNANCE', 'COMPLIANCE')),
  ADD COLUMN lock_until timestamptz;

-- Which accounts may see a piece of evidence: the P0 owner of the listing's product, plus every
-- account that has the (shared) listing in its Mapping Center.
CREATE OR REPLACE FUNCTION app_evidence_accounts(p_evidence_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT a), '{}')
    FROM (
      SELECT p.account_id AS a
        FROM evidence e
        JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
        JOIN listing l ON l.id = o.listing_id
        JOIN product p ON p.id = l.product_id
       WHERE e.id = p_evidence_id
      UNION
      SELECT m.account_id
        FROM evidence e
        JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
        JOIN listing_match m ON m.listing_id = o.listing_id
       WHERE e.id = p_evidence_id
    ) x
$$;
REVOKE ALL ON FUNCTION app_evidence_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_evidence_accounts(uuid) TO mapintel_api;
