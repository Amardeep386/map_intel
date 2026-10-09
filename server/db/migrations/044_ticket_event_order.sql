-- MAP Intel · Phase 5 · M4: ticket events written in one transaction (a status change and a note)
-- keep the order they were made in: now() is the same for the whole transaction.
SELECT set_config('app.role', 'system', true);
ALTER TABLE ticket_event ALTER COLUMN created_at SET DEFAULT clock_timestamp();
