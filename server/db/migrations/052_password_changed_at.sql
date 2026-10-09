-- MAP Intel: sessions opened before a password reset stop working (the API compares the session's
-- issue time with this on every request). NULL = never reset.
SELECT set_config('app.role', 'system', true);
ALTER TABLE app_user ADD COLUMN password_changed_at timestamptz;
