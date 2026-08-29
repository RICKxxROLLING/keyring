-- 1001_realtime.sql — notification inbox. Presence, locks and drafts are in-memory only.

CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN
                  ('mention','assignment','work_order_status','compliance_due',
                   'lease_expiring','system')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  property_id   TEXT,
  entity_type   TEXT,
  entity_id     TEXT,
  url           TEXT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  read_at       TEXT
);
CREATE INDEX ix_notifications_inbox  ON notifications (user_id, created_at DESC);
CREATE INDEX ix_notifications_unread ON notifications (user_id, read_at, created_at DESC);
-- Guards against an edit re-notifying the same handle for the same entity.
CREATE UNIQUE INDEX ux_notifications_mention
  ON notifications (user_id, entity_type, entity_id, type)
  WHERE type = 'mention';
