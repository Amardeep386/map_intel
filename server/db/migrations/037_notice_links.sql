-- MAP Intel · Phase 4 · M3: evidence links can be created for a notice (the letter's secure links).
SELECT set_config('app.role', 'system', true);

ALTER TABLE evidence_link DROP CONSTRAINT evidence_link_created_via_check;
ALTER TABLE evidence_link ADD CONSTRAINT evidence_link_created_via_check
  CHECK (created_via IN ('portal', 'report', 'alert', 'test', 'notice'));
