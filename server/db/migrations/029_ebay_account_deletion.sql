-- MAP Intel · eBay Marketplace Account Deletion (decision 39). eBay tells every API user when an eBay
-- account is deleted; we must stop holding that user's personal data. What we do:
--   * log the request (hashes only: the username itself is not kept), once per notification;
--   * anonymise the seller (shared core): name and key replaced, storefront URL cleared, aliases
--     and every account's contacts for it deleted. Classifications, listings and violations keep
--     pointing at the (now anonymous) seller, so history still adds up;
--   * append-only facts (observations, match candidates) and evidence files under Object Lock keep
--     the raw name: they are evidence of an advertised price, retained for enforcement (legal review).
-- The API calls app_ebay_account_deletion() as mapintel_api (SECURITY DEFINER: the seller table is
-- shared core, contacts are per account; the owner role bypasses row security).

CREATE TABLE ebay_account_deletion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     text NOT NULL UNIQUE,
  username_sha256     char(64) NOT NULL,
  user_id_sha256      char(64),
  event_date          timestamptz,
  received_at         timestamptz NOT NULL DEFAULT now(),
  sellers_anonymised  integer NOT NULL DEFAULT 0
);
CREATE TRIGGER ebay_account_deletion_append_only BEFORE UPDATE OR DELETE ON ebay_account_deletion
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

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
  INSERT INTO ebay_account_deletion (notification_id, username_sha256, user_id_sha256, event_date, sellers_anonymised)
  VALUES (p_notification_id, encode(sha256(convert_to(lower(p_username), 'UTF8')), 'hex'),
          CASE WHEN p_user_id IS NULL THEN NULL ELSE encode(sha256(convert_to(p_user_id, 'UTF8')), 'hex') END,
          p_event_date, coalesce(array_length(v_ids, 1), 0));
  RETURN coalesce(array_length(v_ids, 1), 0);
END
$$;
REVOKE ALL ON FUNCTION app_ebay_account_deletion(text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ebay_account_deletion(text, text, text, text, timestamptz) TO mapintel_api;
