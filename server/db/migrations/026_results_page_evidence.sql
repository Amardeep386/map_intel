-- MAP Intel · Amazon LG slice · M4: evidence for every search / browse results page a discover job
-- reads (HTML + screenshot + SHA-256, S3 Object Lock), and which listings each page showed, so a
-- listing's history can say "found on search page N for term X". Append-only, like evidence.

CREATE TABLE results_page (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  crawl_run_id       uuid NOT NULL REFERENCES crawl_run(id) ON DELETE CASCADE,
  crawl_job_id       uuid NOT NULL REFERENCES crawl_job(id) ON DELETE CASCADE,
  source_id          uuid NOT NULL REFERENCES source(id),
  term_id            uuid REFERENCES term(id) ON DELETE SET NULL,
  term_value         text,                          -- kept: the term may be edited or deleted later
  page_no            integer NOT NULL CHECK (page_no >= 1),
  url                text NOT NULL,
  final_url          text,
  fetched_at         timestamptz NOT NULL,
  method             text CHECK (method IN ('http', 'browser')),
  http_status        integer,
  block              text,                          -- captcha, access_denied, ... (a blocked page is evidence too)
  failure_class      text,
  items_found        integer NOT NULL DEFAULT 0,
  html_uri           text,
  html_sha256        text,
  html_bytes         integer,
  screenshot_uri     text,
  screenshot_sha256  text,
  screenshot_bytes   integer,
  lock_mode          text,
  lock_until         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX results_page_job_idx ON results_page (crawl_job_id, page_no);
CREATE INDEX results_page_run_idx ON results_page (crawl_run_id, source_id);

CREATE TABLE results_page_listing (
  results_page_id    uuid NOT NULL REFERENCES results_page(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  listing_id         uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  position           integer NOT NULL,              -- 1-based position on the page
  sponsored          boolean NOT NULL DEFAULT false,
  PRIMARY KEY (results_page_id, listing_id)
);
CREATE INDEX results_page_listing_listing_idx ON results_page_listing (account_id, listing_id);

CREATE TRIGGER results_page_append_only BEFORE UPDATE OR DELETE ON results_page
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER results_page_listing_append_only BEFORE UPDATE OR DELETE ON results_page_listing
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

ALTER TABLE results_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE results_page FORCE ROW LEVEL SECURITY;
CREATE POLICY results_page_tenant ON results_page
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());

ALTER TABLE results_page_listing ENABLE ROW LEVEL SECURITY;
ALTER TABLE results_page_listing FORCE ROW LEVEL SECURITY;
CREATE POLICY results_page_listing_tenant ON results_page_listing
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());
