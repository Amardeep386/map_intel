-- MAP Intel · Amazon LG slice · M5: a run stops a source after consecutive blocked pages. The
-- remaining queued jobs of that source are cancelled (skip reason 'cancelled', class 'blocked') and
-- the run records why: { "<source code>": { "reason": "blocked", "after": 2, "cancelled": n, "at": ... } }.
ALTER TABLE crawl_run ADD COLUMN stopped jsonb NOT NULL DEFAULT '{}'::jsonb;
