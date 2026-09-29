-- =============================================================================
-- NEXORA schema
--
-- Replaces the hand-rolled JSON files in server/data/ (alerts.json,
-- incidents.json, sos.json) plus officers.json. Those had three problems this
-- fixes: a read-modify-write of the whole file per change, no locking (two
-- writers could interleave and corrupt the file), and no way to query history.
--
-- Design notes
--   • `payload jsonb` carries the record as the app already models it, so the
--     React store and the API keep their exact shapes. Columns are promoted out
--     of it only where the database genuinely needs to filter or sort on them
--     (status, timestamps, severity). That keeps the migration lossless and
--     avoids a brittle column-per-field rewrite of the frontend.
--   • Every table is timestamped. `sensor_readings` is pre-shaped for the
--     hardware work: BRIN on recorded_at, because gauge data arrives in time
--     order and BRIN is a fraction of the size of a btree for that.
--   • `otp_challenges` and `sessions` replace two in-memory Maps, so a restart no
--     longer wipes pending logins.
--
-- Idempotent: safe to run repeatedly.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- officers --
-- The roster. Was officers.json, hand-edited and tracked in git because
-- server/data/ is gitignored. Kept as a table so a role change is an UPDATE
-- rather than a file edit, but still seeded from the same values.
CREATE TABLE IF NOT EXISTS officers (
  phone        text PRIMARY KEY,
  name         text        NOT NULL,
  role         text        NOT NULL
              CHECK (role IN ('CITIZEN','DDMO_OFFICER','FIELD_RESPONDER','SHELTER_MANAGER')),
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS officers_role_idx ON officers (role) WHERE active;

-- ------------------------------------------------------------------ alerts --
-- CAP bulletins. `active` is the single source of truth for BOTH the "N Active"
-- pill and the top-bar bell — the two disagreed in the client because the bell
-- was a separately-maintained integer. One column, one truth.
CREATE TABLE IF NOT EXISTS alerts (
  id                    text PRIMARY KEY,
  type                  text        NOT NULL DEFAULT 'CAP_BULLETIN',
  title                 text        NOT NULL,
  severity              text        NOT NULL
                        CHECK (severity IN ('CRITICAL','SEVERE','MODERATE','ADVISORY')),
  zone                  text,
  location_name         text,
  reason                text,
  recommended_action    text,
  channels              text[]      NOT NULL DEFAULT '{}',
  affected_population   integer     NOT NULL DEFAULT 0,
  lat                   double precision,
  lng                   double precision,
  active                boolean     NOT NULL DEFAULT true,
  issued_by_role        text,
  issued_by_phone       text,
  display_timestamp     text,          -- the app's human string, e.g. "Just now"
  resolved_at           timestamptz,
  resolved_by           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  payload               jsonb        NOT NULL DEFAULT '{}'::jsonb
);

-- The active feed: newest first, active only. Partial, so it stays small.
CREATE INDEX IF NOT EXISTS alerts_active_idx
  ON alerts (created_at DESC) WHERE active;
-- The 24h history sweep runs on resolved_at; needs a plain index.
CREATE INDEX IF NOT EXISTS alerts_resolved_at_idx
  ON alerts (resolved_at) WHERE resolved_at IS NOT NULL;

-- -------------------------------------------------------------- incidents --
CREATE TABLE IF NOT EXISTS incidents (
  id                 text PRIMARY KEY,
  title              text        NOT NULL,
  description        text,
  category           text,
  severity           text,
  status             text        NOT NULL DEFAULT 'PENDING',
  zone               text,
  location_name      text,
  lat                double precision,
  lng                double precision,
  reported_by        text,
  reported_by_role   text,
  assigned_team      text,
  display_timestamp  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  payload            jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS incidents_status_idx  ON incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_created_idx ON incidents (created_at DESC);

-- ------------------------------------------------------------ sos_reports --
CREATE TABLE IF NOT EXISTS sos_reports (
  id                 text PRIMARY KEY,
  phone              text,
  name               text,
  lat                double precision,
  lng                double precision,
  accuracy           double precision,
  message            text,
  place_label        text,
  category           text,
  priority           text        NOT NULL DEFAULT 'NORMAL',
  status             text        NOT NULL DEFAULT 'NEW',
  verified           boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  payload            jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sos_status_idx   ON sos_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS sos_created_idx  ON sos_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS sos_phone_idx    ON sos_reports (phone, created_at DESC);

-- ------------------------------------------------------- sensor_readings --
-- Pre-shaped for the hardware work. A gauge posts a row every 30-60s, so the
-- table is narrow and the time index is BRIN (a few KB per million rows for
-- time-ordered inserts, versus a much larger btree).
CREATE TABLE IF NOT EXISTS sensor_readings (
  id            bigserial   PRIMARY KEY,
  station_id    text        NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  water_level_cm numeric(7,2),
  rainfall_mm   numeric(7,2),
  battery_pct   numeric(5,2),
  rssi_dbm      integer,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sensor_readings_brin_idx
  ON sensor_readings USING BRIN (recorded_at);
CREATE INDEX IF NOT EXISTS sensor_station_time_idx
  ON sensor_readings (station_id, recorded_at DESC);

-- --------------------------------------------------------------- thresholds --
-- Danger level per station. Kept in the database rather than in the client
-- store, because the alert decision must be made server-side — a browser can be
-- closed, edited, or disagreeing with itself.
CREATE TABLE IF NOT EXISTS sensor_thresholds (
  station_id             text PRIMARY KEY,
  name                   text,
  water_level_normal_cm  numeric(7,2),
  water_level_danger_cm  numeric(7,2),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------- otp --
-- Replaces the in-memory Map, so a server restart no longer invalidates every
-- pending login. The code itself is still only ever stored hashed.
CREATE TABLE IF NOT EXISTS otp_challenges (
  phone         text PRIMARY KEY,
  code_hash     text        NOT NULL,
  code_salt     text        NOT NULL,
  attempts      integer     NOT NULL DEFAULT 0,
  consumed      boolean     NOT NULL DEFAULT false,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_sent_at  timestamptz,
  send_count    integer     NOT NULL DEFAULT 0,
  requested_role text
);
CREATE INDEX IF NOT EXISTS otp_expires_idx ON otp_challenges (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    text PRIMARY KEY,
  phone         text        NOT NULL,
  role          text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked       boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_phone_idx   ON sessions (phone);

-- --------------------------------------------------- notification_targets --
-- Who gets messaged when a threshold is crossed. A table, not a constant, so a
-- number can be added without a code change or a redeploy.
CREATE TABLE IF NOT EXISTS notification_targets (
  id            bigserial   PRIMARY KEY,
  phone         text        NOT NULL,
  name          text,
  station_id    text,                      -- NULL = all stations
  min_severity  text        NOT NULL DEFAULT 'ADVISORY',
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone, station_id)
);
