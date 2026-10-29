-- no-transaction
-- Near-copies and same-moment footage: the 'near_copy' clip status, a blank flag per segment
-- thumbnail, clip_links, the 'similar' backfill job kind, and in-flight ingest jobs moved onto the
-- new step order (embed now runs right after segments).
--
-- SQLite cannot change a CHECK constraint in place, so clips and jobs are rebuilt with SQLite's
-- documented procedure. Other tables reference clips with ON DELETE CASCADE, so foreign keys are
-- switched off while the old table is dropped (otherwise the drop would delete every segment,
-- transcript and face track); the rebuild runs in one transaction, and foreign keys are switched
-- back on afterwards.

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
        CHECK (status IN ('uploading', 'uploaded', 'processing', 'ready', 'failed', 'duplicate',
                          'near_copy')),
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
                       title, last_viewed_at, content_sha256, duplicate_of)
    SELECT id, user_id, filename, ext, size_bytes, duration_s, width, height, fps, rotation, codec,
           recorded_at, status, error_code, created_at, has_audio, title, last_viewed_at,
           content_sha256, duplicate_of
    FROM clips;

DROP TABLE clips;
ALTER TABLE clips_new RENAME TO clips;
CREATE INDEX clips_by_user ON clips (user_id, created_at);
CREATE INDEX clips_by_hash ON clips (user_id, content_sha256);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors', 'faces',
                        'guide', 'read', 'similar')),
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

-- An unfinished ingest job past 'segments' under the old order has not embedded yet: it goes back
-- to just after 'segments' (embed, similar, then the paid steps again, whose model answers are
-- cached). One that finished the old 'embed' only has 'index' and 'ready' left, which in the new
-- order follow 'faces'.
UPDATE jobs SET step = 'segments'
    WHERE kind = 'ingest' AND status != 'done'
      AND step IN ('transcribe', 'describe', 'title', 'faces');
UPDATE jobs SET step = 'faces'
    WHERE kind = 'ingest' AND status != 'done' AND step = 'embed';

-- 1 when the thumbnail is blank, 0 when not; NULL for segments embedded before this check (the
-- similar backfill embeds those again).
ALTER TABLE segments ADD COLUMN blank INTEGER;

CREATE TABLE clip_links (
    user_id    TEXT NOT NULL REFERENCES users (id),
    clip_id    TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    other_id   TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('near_copy_of', 'same_moment', 'kept')),
    score      REAL NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (clip_id, other_id),
    CHECK (clip_id != other_id)
);
CREATE INDEX clip_links_by_user ON clip_links (user_id);
CREATE INDEX clip_links_by_other ON clip_links (other_id);

COMMIT;

PRAGMA foreign_keys = ON;
