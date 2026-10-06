-- MAP Intel · Phase 3 · M6: the Reports screen reads template adoption inside an account
-- (withTenant switches to mapintel_tenant), so that role may call the count function too.
GRANT EXECUTE ON FUNCTION app_report_template_adoption() TO mapintel_tenant;
