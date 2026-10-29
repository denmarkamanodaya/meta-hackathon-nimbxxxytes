-- MyWay guides: one clip turned into numbered steps (a frame with the control circled, a spoken
-- instruction and a replay clip per step). New tables only; jobs is rebuilt exactly as in 0008 to
-- allow the 'guide' kind. No table references jobs.

CREATE TABLE guides (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users (id),
    clip_id       TEXT NOT NULL UNIQUE REFERENCES clips (id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL
        CHECK (status IN ('queued', 'running', 'ready', 'failed', 'refused')),
    stage         TEXT CHECK (stage IN ('steps', 'frames', 'highlight', 'voice', 'ready')),
    safety        TEXT CHECK (safety IN ('everyday', 'caution', 'not_supported')),
    safety_reason TEXT,
    language      TEXT NOT NULL DEFAULT 'en',
    error         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX guides_user ON guides (user_id, created_at);

-- One row per step, numbered from 1. Object keys are NULL until that file was made; audio_text is
-- the sentence the stored WAV speaks, so an edit only regenerates the voice when it changes.
CREATE TABLE guide_steps (
    guide_id    TEXT NOT NULL REFERENCES guides (id) ON DELETE CASCADE,
    n           INTEGER NOT NULL CHECK (n >= 1),
    title       TEXT NOT NULL,
    instruction TEXT NOT NULL,
    start_s     REAL NOT NULL,
    end_s       REAL NOT NULL,
    key_s       REAL NOT NULL,
    control     TEXT,
    highlight   TEXT,
    image_key   TEXT,
    audio_key   TEXT,
    audio_text  TEXT,
    clip_key    TEXT,
    PRIMARY KEY (guide_id, n)
);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors', 'faces',
                        'guide')),
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
