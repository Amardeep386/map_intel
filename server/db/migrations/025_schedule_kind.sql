-- MAP Intel · Amazon LG slice · M2: what a schedule runs. 'both' (default) re-collects listings and
-- runs discovery; 'monitoring' only re-collects listings; 'discovery' only runs terms. A schedule
-- whose cadence is 'manual' never fires by itself (the scheduler CLI fires it by name).
ALTER TABLE schedule ADD COLUMN kind text NOT NULL DEFAULT 'both' CHECK (kind IN ('both', 'monitoring', 'discovery'));
