-- Memory Lane: a session of moments of one named person (or of one clip, a day) for a named
-- viewer, each moment with a gentle line and question written and checked by Muse Spark. The
-- moments are kept as one JSON array on the row (they are always read and written together).
-- New table only; jobs is rebuilt exactly as in 0019 to allow the 'memory' kind. No table
-- references jobs.

CREATE TABLE memories (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users (id),
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('person', 'clip')),
    -- The person or clip remembered; the session keeps its moments when either is deleted.
    person_id    TEXT REFERENCES people (id) ON DELETE SET NULL,
    clip_id      TEXT REFERENCES clips (id) ON DELETE SET NULL,
    subject_name TEXT NOT NULL,
    viewer_id    TEXT REFERENCES people (id) ON DELETE SET NULL,
    viewer_name  TEXT,
    title        TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL CHECK (status IN ('making', 'ready', 'failed')),
    step         TEXT CHECK (step IN ('find', 'write', 'check', 'cover')),
    -- JSON array of moments, in session order.
    moments      TEXT NOT NULL DEFAULT '[]',
    fixed_count  INTEGER NOT NULL DEFAULT 0 CHECK (fixed_count >= 0),
    cover_key    TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX memories_user ON memories (user_id, created_at);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors', 'faces',
                        'guide', 'read', 'similar', 'listen', 'photo', 'memory')),
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
