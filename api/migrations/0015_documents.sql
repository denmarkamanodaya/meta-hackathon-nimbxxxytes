-- iRead: a photo of a letter or a PDF becomes up to 10 page images plus the text Muse Spark read
-- from them, asked about and read aloud. New tables only; jobs is rebuilt exactly as in 0014 to
-- allow the 'read' kind. No table references jobs.

CREATE TABLE documents (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users (id),
    filename          TEXT NOT NULL,
    content_type      TEXT NOT NULL
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0),
    status            TEXT NOT NULL CHECK (status IN ('uploading', 'reading', 'ready', 'failed')),
    title             TEXT NOT NULL DEFAULT '',
    kind              TEXT NOT NULL DEFAULT 'other'
        CHECK (kind IN ('letter', 'bill', 'form', 'notice', 'label', 'other')),
    sender            TEXT NOT NULL DEFAULT '',
    date              TEXT NOT NULL DEFAULT '',
    text              TEXT NOT NULL DEFAULT '',
    summary           TEXT NOT NULL DEFAULT '',
    page_count        INTEGER NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 10),
    summary_audio_key TEXT,
    error             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX documents_user ON documents (user_id, created_at);

-- One row per page image, numbered from 1.
CREATE TABLE document_pages (
    document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    n           INTEGER NOT NULL CHECK (n BETWEEN 1 AND 10),
    image_key   TEXT NOT NULL,
    PRIMARY KEY (document_id, n)
);

-- Every voice file made for a document (summary, answers, parts), so Delete removes them all.
CREATE TABLE document_voices (
    document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    PRIMARY KEY (document_id, key)
);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors', 'faces',
                        'guide', 'read')),
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
