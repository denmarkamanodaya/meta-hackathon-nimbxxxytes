-- Photos: a still image analysed once (Muse Spark facts, Perception Encoder vector) and found by
-- search next to video moments. New tables only; jobs is rebuilt exactly as in 0017 to allow the
-- 'photo' kind. No table references jobs.

CREATE TABLE photos (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users (id),
    filename      TEXT NOT NULL,
    content_type  TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    size_bytes    INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 41943040),
    -- The file's time on the device (ISO-8601 UTC), the date taken when the photo has none.
    last_modified TEXT,
    status        TEXT NOT NULL CHECK (status IN ('uploading', 'analysing', 'ready', 'failed')),
    title         TEXT NOT NULL DEFAULT '',
    -- 1 when the owner named the photo (Spark's title then never replaces it).
    title_by_owner INTEGER NOT NULL DEFAULT 0 CHECK (title_by_owner IN (0, 1)),
    description   TEXT NOT NULL DEFAULT '',
    -- JSON array of strings, at most 8.
    things        TEXT NOT NULL DEFAULT '[]',
    place         TEXT NOT NULL DEFAULT '',
    mood          TEXT NOT NULL DEFAULT '',
    width         INTEGER CHECK (width > 0),
    height        INTEGER CHECK (height > 0),
    taken_at      TEXT,
    camera        TEXT,
    error         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX photos_user ON photos (user_id, taken_at);

-- PE image embedding of each photo's viewing copy, keyed by its search key (photo_{id}).
CREATE VIRTUAL TABLE photo_vectors USING vec0(
    segment_id TEXT PRIMARY KEY,
    user_id TEXT PARTITION KEY,
    embedding FLOAT[1024] distance_metric=cosine
);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors', 'faces',
                        'guide', 'read', 'similar', 'listen', 'photo')),
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
