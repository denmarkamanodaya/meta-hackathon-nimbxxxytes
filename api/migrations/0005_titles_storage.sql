-- Redesign: clip titles, last-viewed time for the storage tiers, and the `title` job kind.

ALTER TABLE clips ADD COLUMN title TEXT;
ALTER TABLE clips ADD COLUMN last_viewed_at TEXT;

-- SQLite cannot change a CHECK constraint in place, so jobs is rebuilt with the new kind.
CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('ingest', 'render', 'agent', 'title')),
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
