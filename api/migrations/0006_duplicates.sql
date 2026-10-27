-- no-transaction
-- Duplicates: each original's SHA-256, the clip it copies, and the 'duplicate' status; job kinds
-- 'hash' (hash backfill) and 'face_vectors' (face match backfill).
--
-- SQLite cannot change a CHECK constraint in place, so clips is rebuilt with SQLite's documented
-- procedure. Other tables reference clips with ON DELETE CASCADE, so foreign keys are switched off
-- while the old table is dropped (otherwise the drop would delete every segment, transcript and
-- face track); the rebuild itself runs in one transaction, and foreign keys are checked and
-- switched back on afterwards.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE clips_new (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users (id),
    filename       TEXT NOT NULL,
    ext            TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL,
    duration_s     REAL,
    width          INTEGER,
    height         INTEGER,
    fps            REAL,
    rotation       INTEGER,
    codec          TEXT,
    recorded_at    TEXT,
    status         TEXT NOT NULL
        CHECK (status IN ('uploading', 'uploaded', 'processing', 'ready', 'failed', 'duplicate')),
    error_code     TEXT,
    created_at     TEXT NOT NULL,
    has_audio      INTEGER,
    title          TEXT,
    last_viewed_at TEXT,
    content_sha256 TEXT,
    duplicate_of   TEXT
);

INSERT INTO clips_new (id, user_id, filename, ext, size_bytes, duration_s, width, height, fps,
                       rotation, codec, recorded_at, status, error_code, created_at, has_audio,
                       title, last_viewed_at)
    SELECT id, user_id, filename, ext, size_bytes, duration_s, width, height, fps, rotation, codec,
           recorded_at, status, error_code, created_at, has_audio, title, last_viewed_at
    FROM clips;

DROP TABLE clips;
ALTER TABLE clips_new RENAME TO clips;
CREATE INDEX clips_by_user ON clips (user_id, created_at);
CREATE INDEX clips_by_hash ON clips (user_id, content_sha256);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors')),
    subject_id  TEXT NOT NULL,
    step        TEXT,
    status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    run_after   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (kind, subject_id)
);
INSERT INTO jobs_new (id, kind, subject_id, step, status, attempts, last_error, run_after, updated_at)
    SELECT id, kind, subject_id, step, status, attempts, last_error, run_after, updated_at FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX jobs_runnable ON jobs (status, run_after);

COMMIT;

PRAGMA foreign_keys = ON;
