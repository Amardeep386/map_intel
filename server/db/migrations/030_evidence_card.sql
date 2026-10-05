-- MAP Intel · evidence cards: a picture drawn from an official API response (eBay), for listings
-- whose web page blocks us. The API response on the evidence row stays the evidence; the card is a
-- readable view of it, drawn at collection time or later from the stored response (source_sha256
-- names the response it was drawn from). Append-only, like evidence. One card per evidence row.

CREATE TABLE evidence_card (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id    uuid NOT NULL UNIQUE REFERENCES evidence(id),
  uri            text NOT NULL,
  sha256         char(64) NOT NULL,
  bytes          integer NOT NULL,
  source_sha256  char(64) NOT NULL,
  lock_mode      text CHECK (lock_mode IN ('GOVERNANCE', 'COMPLIANCE')),
  lock_until     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER evidence_card_append_only
  BEFORE UPDATE OR DELETE ON evidence_card
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
