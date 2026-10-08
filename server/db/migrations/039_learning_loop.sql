-- MAP Intel · Phase 4 · M7: learning loop.
--   * match_candidate.matcher_version: which version of the matcher scored the candidate
--     (lib/matching.ts MATCHER_VERSION). Every candidate so far was scored by "m1".
--   * qa_sample: each week a random share (account setting qa_sample_pct) of the previous week's
--     automatic includes and, separately, automatic excludes, for a person to check. A verdict is
--     given once; "wrong" also corrects the listing (a person's decision, so a training label).
--     Reviewed samples give the precision of automatic decisions per confidence band and version.

SELECT set_config('app.role', 'system', true);

ALTER TABLE match_candidate ADD COLUMN matcher_version text NOT NULL DEFAULT 'm1';

CREATE TABLE qa_sample (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  week             date NOT NULL,                 -- Monday (UTC) of the week the sample was drawn; decisions of the week before
  listing_id       uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  candidate_id     uuid REFERENCES match_candidate(id) ON DELETE SET NULL,
  product_id       uuid REFERENCES product(id) ON DELETE SET NULL,
  state            text NOT NULL CHECK (state IN ('Included', 'Excluded')),
  decided_by       text NOT NULL CHECK (decided_by IN ('auto', 'rule', 'suppression')),
  confidence       numeric(5,2),
  matcher_version  text,
  drawn_at         timestamptz NOT NULL DEFAULT now(),
  verdict          text CHECK (verdict IN ('correct', 'wrong')),
  note             text,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  UNIQUE (account_id, week, listing_id),
  CHECK ((verdict IS NULL) = (reviewed_at IS NULL)),
  CHECK (verdict IS DISTINCT FROM 'wrong' OR coalesce(btrim(note), '') <> '')
);
CREATE INDEX qa_sample_week_idx ON qa_sample (account_id, week DESC);

-- What was sampled never changes; the verdict is given once.
CREATE OR REPLACE FUNCTION qa_sample_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'qa_sample cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.verdict IS NOT NULL THEN
    RAISE EXCEPTION 'this sample already has a verdict' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'verdict' - 'note' - 'reviewed_by' - 'reviewed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'verdict' - 'note' - 'reviewed_by' - 'reviewed_at') THEN
    RAISE EXCEPTION 'qa_sample: only the verdict is given' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER qa_sample_guard BEFORE UPDATE OR DELETE ON qa_sample FOR EACH ROW EXECUTE FUNCTION qa_sample_guard();

ALTER TABLE qa_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_sample FORCE ROW LEVEL SECURITY;
CREATE POLICY qa_sample_tenant ON qa_sample
  USING (app_is_system() OR account_id = app_current_account())
  WITH CHECK (app_is_system() OR account_id = app_current_account());
