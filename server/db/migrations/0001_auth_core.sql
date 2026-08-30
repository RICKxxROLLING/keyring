-- 0001_auth_core.sql — identity, sessions, invites, MFA, rate limiting, audit.

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  handle           TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('owner','manager')),
  password_hash    TEXT NOT NULL,
  totp_secret      TEXT,
  totp_enrolled_at TEXT,
  avatar_color     TEXT NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_users_email  ON users (lower(email));
CREATE UNIQUE INDEX ux_users_handle ON users (lower(handle));
CREATE INDEX ix_users_active ON users (is_active);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  revoked_at   TEXT
);
CREATE UNIQUE INDEX ux_sessions_token ON sessions (token_hash);
CREATE INDEX ix_sessions_user    ON sessions (user_id);
CREATE INDEX ix_sessions_expires ON sessions (expires_at);

-- Short-lived token issued after password success, consumed by the TOTP step.
CREATE TABLE mfa_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('login','enroll')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_mfa_token ON mfa_challenges (token_hash);
CREATE INDEX ix_mfa_expires ON mfa_challenges (expires_at);

CREATE TABLE recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX ix_recovery_user ON recovery_codes (user_id, used_at);

CREATE TABLE invites (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('owner','manager')),
  token_hash       TEXT NOT NULL,
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  accepted_at      TEXT,
  accepted_user_id TEXT REFERENCES users(id),
  revoked_at       TEXT
);
CREATE UNIQUE INDEX ux_invites_token ON invites (token_hash);
CREATE INDEX ix_invites_open ON invites (accepted_at, revoked_at, expires_at);

-- One-time bootstrap token. Exactly one row, id = 1.
CREATE TABLE setup_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash   TEXT,
  created_at   TEXT NOT NULL,
  consumed_at  TEXT
);

-- Auth throttling. `key` is 'ip:1.2.3.4' or 'user:usr_x' or 'email:a@b.c'.
CREATE TABLE auth_attempts (
  id       TEXT PRIMARY KEY,
  key      TEXT NOT NULL,
  kind     TEXT NOT NULL,
  at       TEXT NOT NULL,
  success  INTEGER NOT NULL CHECK (success IN (0,1)),
  ip       TEXT
);
CREATE INDEX ix_auth_attempts_key ON auth_attempts (key, at);

CREATE TABLE lockouts (
  key        TEXT PRIMARY KEY,
  until      TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  at            TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  property_id   TEXT,
  summary       TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  ip            TEXT,
  request_id    TEXT
);
CREATE INDEX ix_audit_at       ON audit_log (at DESC);
CREATE INDEX ix_audit_entity   ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX ix_audit_property ON audit_log (property_id, at DESC);
CREATE INDEX ix_audit_actor    ON audit_log (actor_user_id, at DESC);

INSERT INTO app_meta (key, value) VALUES ('schema_owner', 'stoop');
