-- MAP Intel · Phase 2b · M6: jobs of a run can be cancelled (an operator stops a run, or a
-- development run is cut short). Cancelled jobs count as skipped; the run then finishes normally.
ALTER TABLE crawl_job DROP CONSTRAINT crawl_job_skip_reason_check;
ALTER TABLE crawl_job ADD CONSTRAINT crawl_job_skip_reason_check
  CHECK (skip_reason IN ('robots', 'budget', 'no_collector', 'not_executable', 'not_carried', 'cancelled'));
