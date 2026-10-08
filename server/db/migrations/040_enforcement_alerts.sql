-- MAP Intel · Phase 4 · M8: enforcement alerts (in-app inbox; email logged until a provider is set).
--   A-04 Notice waiting for brand approval   once per notice
--   A-05 Seller response overdue              once per case and response date
--   A-06 Seller re-offended                   once per violation opened within 60 days of the seller's resolved case
--   A-07 Case resolved                        once per case
-- alert_event.case_id links an alert to its case.

SELECT set_config('app.role', 'system', true);

ALTER TABLE alert_rule DROP CONSTRAINT alert_rule_trigger_check;
ALTER TABLE alert_rule ADD CONSTRAINT alert_rule_trigger_check CHECK (trigger IN (
  'new_violating_seller', 'severe_violation', 'source_degraded_before_report',
  'notice_awaiting_approval', 'response_overdue', 'seller_reoffended', 'case_resolved'));

ALTER TABLE alert_event ADD COLUMN case_id uuid REFERENCES enforcement_case(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION app_seed_alert_rules(p_account_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO alert_rule (account_id, code, name, trigger, config, is_default) VALUES
    (p_account_id, 'A-01', 'New violating seller', 'new_violating_seller', '{}', true),
    (p_account_id, 'A-02', 'Severe violation', 'severe_violation', '{"severity": "Severe"}', true),
    (p_account_id, 'A-03', 'Source degraded before a scheduled report', 'source_degraded_before_report', '{"hoursBefore": 24}', true),
    (p_account_id, 'A-04', 'Notice waiting for brand approval', 'notice_awaiting_approval', '{}', true),
    (p_account_id, 'A-05', 'Seller response overdue', 'response_overdue', '{}', true),
    (p_account_id, 'A-06', 'Seller re-offended', 'seller_reoffended', '{"days": 60}', true),
    (p_account_id, 'A-07', 'Case resolved', 'case_resolved', '{}', true)
  ON CONFLICT (account_id, code) DO NOTHING
$$;

SELECT app_seed_alert_rules(id) FROM account;
