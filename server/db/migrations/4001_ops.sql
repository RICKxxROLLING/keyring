-- 4001_ops.sql — backup run history.

CREATE TABLE backup_runs (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('scheduled','manual')),
  status            TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  archive_name      TEXT,
  size_bytes        INTEGER,
  sha256            TEXT,
  db_bytes          INTEGER,
  uploads_bytes     INTEGER,
  file_count        INTEGER,
  retention_deleted INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);
CREATE INDEX ix_backup_runs_at ON backup_runs (started_at DESC);
