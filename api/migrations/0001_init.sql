-- Phase 1 tables: users, clips, uploads, jobs. Ids are UUIDv7 text; wall-clock times are
-- ISO-8601 UTC text (fixed width, so text order is time order); media times are REAL seconds.

CREATE TABLE users (
    id         TEXT PRIMARY KEY,
    email      TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE clips (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users (id),
    filename    TEXT NOT NULL,
    ext         TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    duration_s  REAL,
    width       INTEGER,
    height      INTEGER,
    fps         REAL,
    rotation    INTEGER,
    codec       TEXT,
    recorded_at TEXT,
    status      TEXT NOT NULL
        CHECK (status IN ('uploading', 'uploaded', 'processing', 'ready', 'failed')),
    error_code  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX clips_by_user ON clips (user_id, created_at);

CREATE TABLE uploads (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users (id),
    clip_id      TEXT NOT NULL UNIQUE REFERENCES clips (id),
    s3_upload_id TEXT NOT NULL,
    key          TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    part_size    INTEGER NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('open', 'completed')),
    created_at   TEXT NOT NULL
);

CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('ingest', 'render', 'agent')),
    subject_id  TEXT NOT NULL,
    step        TEXT,
    status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    run_after   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (kind, subject_id)
);
CREATE INDEX jobs_runnable ON jobs (status, run_after);
