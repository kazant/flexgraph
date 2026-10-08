-- FlexGraph license server schema (Cloudflare D1 / SQLite).
-- Apply: wrangler d1 execute flexgraph-license --file=schema.sql

CREATE TABLE IF NOT EXISTS customers (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  company              TEXT,
  provider_customer_id TEXT,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       TEXT PRIMARY KEY,
  customer_id              TEXT NOT NULL REFERENCES customers(id),
  provider                 TEXT NOT NULL,              -- lemonsqueezy | stripe
  provider_subscription_id TEXT NOT NULL UNIQUE,
  plan                     TEXT NOT NULL DEFAULT 'monthly', -- monthly | annual
  status                   TEXT NOT NULL,              -- active | past_due | canceling | canceled
  quantity                 INTEGER NOT NULL DEFAULT 1, -- number of project licenses
  offline_addon            INTEGER NOT NULL DEFAULT 0,
  current_period_end       INTEGER,                    -- ms
  billing_portal_url       TEXT,
  updated_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES customers(id),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  name            TEXT,
  license_key     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL,          -- active | past_due | canceled
  paid_until      INTEGER,                -- ms
  grace_until     INTEGER,                -- ms; null = paid_until + 14 days
  wildcard        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS projects_subscription ON projects(subscription_id);

CREATE TABLE IF NOT EXISTS domains (
  project_id TEXT NOT NULL REFERENCES projects(id),
  hostname   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('production', 'staging')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, hostname)
);

CREATE TABLE IF NOT EXISTS domain_changes (
  project_id TEXT NOT NULL,
  hostname   TEXT NOT NULL,
  action     TEXT NOT NULL,   -- add | remove
  counted    INTEGER NOT NULL DEFAULT 1,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS domain_changes_project ON domain_changes(project_id, at);

CREATE TABLE IF NOT EXISTS registry_tokens (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  token_hash   TEXT NOT NULL UNIQUE,  -- sha256 hex; the token itself is shown once
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Aggregated per day: no end-user IPs or personal data are stored.
CREATE TABLE IF NOT EXISTS validations (
  project_id  TEXT NOT NULL,
  hostname    TEXT NOT NULL,
  day         TEXT NOT NULL,          -- YYYY-MM-DD
  lib_version TEXT NOT NULL,
  registered  INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, hostname, day, lib_version)
);

CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  kind       TEXT NOT NULL,           -- key-sharing | unregistered-domain
  detail     TEXT,
  day        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, kind, day)
);

CREATE TABLE IF NOT EXISTS reminders (
  project_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  tarball_key  TEXT NOT NULL,
  integrity    TEXT NOT NULL,
  shasum       TEXT NOT NULL,
  manifest     TEXT NOT NULL,         -- package.json (JSON)
  published_at INTEGER NOT NULL,
  PRIMARY KEY (name, version)
);
