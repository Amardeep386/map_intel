-- MAP Intel · Phase 5 · M4: internal tickets.
--   Mirethos's own tracker for operational issues (a source failing, a mapping backlog, a data
--   problem, onboarding follow-ups), separate from enforcement cases. Internal: only platform
--   administrators read or write them, through the API role; tenants (and Brand users) never see
--   them. A ticket may point at an account and a source, but belongs to Mirethos, so it has no
--   tenant row-level policy: the tenant role has no access at all.
--   * ticket: the current state (status, priority, assignee).
--   * ticket_event: append-only history (opened, comment, status, assignee, priority, auto notes).
--   * Automatic tickets (lib/tickets.ts syncTickets, hourly) carry a dedupe_key: at most one
--     unresolved ticket per key, so the sync never opens the same issue twice.

SELECT set_config('app.role', 'system', true);

CREATE SEQUENCE ticket_seq;

CREATE TABLE ticket (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE DEFAULT 'T-' || lpad(nextval('ticket_seq')::text, 5, '0'),
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description  text,
  kind         text NOT NULL CHECK (kind IN ('source', 'mapping', 'data_quality', 'onboarding', 'other')),
  priority     text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  status       text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In progress', 'Waiting', 'Resolved')),
  account_id   uuid REFERENCES account(id) ON DELETE CASCADE,
  source_id    uuid REFERENCES source(id) ON DELETE SET NULL,
  assignee_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  origin       text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'auto')),
  dedupe_key   text,
  links        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- e.g. { "crawlRunId": ..., "view": "health" }
  created_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  CHECK ((status = 'Resolved') = (resolved_at IS NOT NULL)),
  CHECK (origin = 'manual' OR dedupe_key IS NOT NULL)
);
CREATE UNIQUE INDEX ticket_open_dedupe_uq ON ticket (dedupe_key) WHERE status <> 'Resolved' AND dedupe_key IS NOT NULL;
CREATE INDEX ticket_status_idx ON ticket (status, updated_at DESC);
CREATE INDEX ticket_account_idx ON ticket (account_id);

CREATE TABLE ticket_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('opened', 'comment', 'status', 'assignee', 'priority', 'auto')),
  body        text,
  before      jsonb,
  after       jsonb,
  actor_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,   -- NULL = system
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_event_ticket_idx ON ticket_event (ticket_id, created_at);

CREATE OR REPLACE FUNCTION ticket_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN coalesce(NEW, OLD); END IF;  -- cascades from a deleted ticket / account
  RAISE EXCEPTION 'ticket_event is append-only' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER ticket_event_append_only BEFORE UPDATE OR DELETE ON ticket_event FOR EACH ROW EXECUTE FUNCTION ticket_event_append_only();

-- Internal to Mirethos: the tenant role never reads or writes tickets; the API role cannot delete them.
REVOKE ALL ON ticket, ticket_event FROM mapintel_tenant;
REVOKE DELETE ON ticket, ticket_event FROM mapintel_api;
REVOKE UPDATE ON ticket_event FROM mapintel_api;
