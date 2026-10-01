-- MAP Intel · LG slice, route D (decision 36): an official API response is evidence. The response is
-- stored verbatim (JSON, SHA-256, S3 Object Lock) next to the page's HTML / screenshot, which may be
-- missing when the website blocks us (eBay). Evidence is complete with a page (HTML + screenshot)
-- or with an API response.

ALTER TABLE evidence
  ADD COLUMN api_uri     text,
  ADD COLUMN api_sha256  char(64),
  ADD COLUMN api_bytes   integer;

ALTER TABLE results_page
  ADD COLUMN api_uri     text,
  ADD COLUMN api_sha256  text,
  ADD COLUMN api_bytes   integer;

ALTER TABLE results_page DROP CONSTRAINT results_page_method_check;
ALTER TABLE results_page ADD CONSTRAINT results_page_method_check CHECK (method IN ('http', 'browser', 'api'));
