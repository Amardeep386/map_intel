-- MAP Intel · Phase 5 · M9: the public API logs each call as the tenant (inside the account's
-- row-level security), which needs the log's id sequence. Default privileges cover the API role only.
SELECT set_config('app.role', 'system', true);
GRANT USAGE ON SEQUENCE api_request_log_id_seq TO mapintel_tenant;
