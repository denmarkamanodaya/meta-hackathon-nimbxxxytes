-- iListen: a sound file, a video or a clip, transcribed, each line's language named and translated
-- into the output language, summarised and checked line by line (up to 3 versions). New tables
-- only; jobs is rebuilt exactly as in 0015 to allow the 'listen' kind. No table references jobs.

CREATE TABLE listens (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users (id),
    source            TEXT NOT NULL CHECK (source IN ('file', 'clip')),
    -- The clip listened to; the listen keeps its transcript when the clip is deleted.
    clip_id           TEXT REFERENCES clips (id) ON DELETE SET NULL,
    source_name       TEXT NOT NULL,
    content_type      TEXT NOT NULL DEFAULT '',
    ext               TEXT NOT NULL DEFAULT ''
        CHECK (ext IN ('', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'webm', 'mp4', 'mov',
                       'm4v')),
    size_bytes        INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes BETWEEN 0 AND 314572800),
    status            TEXT NOT NULL
        CHECK (status IN ('uploading', 'listening', 'ready', 'failed')),
    step              TEXT
        CHECK (step IN ('audio', 'transcribe', 'understand', 'check', 'voice')),
    version           INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 3),
    target            TEXT NOT NULL
        CHECK (target IN ('en', 'zh', 'ja', 'ko', 'tl', 'es', 'fr', 'de', 'id', 'vi', 'th',
                          'hi')),
    title             TEXT NOT NULL DEFAULT '',
    summary           TEXT NOT NULL DEFAULT '',
    -- JSON array of strings.
    key_points        TEXT NOT NULL DEFAULT '[]',
    -- JSON array of {code, share}, largest share first.
    languages         TEXT NOT NULL DEFAULT '[]',
    duration_ms       INTEGER CHECK (duration_ms BETWEEN 1 AND 7200000),
    speakers          INTEGER NOT NULL DEFAULT 0,
    -- Where the transcript came from: the clip's own, the full pass or the window pass.
    heard_by          TEXT CHECK (heard_by IN ('clip', 'full', 'windows')),
    confidence        INTEGER CHECK (confidence BETWEEN 0 AND 100),
    passed            INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
    summary_audio_key TEXT,
    error             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX listens_user ON listens (user_id, created_at);
CREATE INDEX listens_clip ON listens (clip_id);

-- One row per spoken line, numbered from 0; the translation columns hold the kept version.
CREATE TABLE listen_turns (
    listen_id   TEXT NOT NULL REFERENCES listens (id) ON DELETE CASCADE,
    idx         INTEGER NOT NULL CHECK (idx >= 0),
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    speaker     TEXT,
    text        TEXT NOT NULL,
    lang        TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    score       INTEGER CHECK (score BETWEEN 0 AND 100),
    issue       TEXT NOT NULL DEFAULT '',
    fixed_in    INTEGER NOT NULL DEFAULT 1 CHECK (fixed_in BETWEEN 1 AND 3),
    PRIMARY KEY (listen_id, idx)
);

-- Every version the check loop made: the draft (JSON: title, turns, summary, key points) and,
-- once checked, its check (JSON: line scores, summary score and issues, confidence, passed).
CREATE TABLE listen_versions (
    listen_id TEXT NOT NULL REFERENCES listens (id) ON DELETE CASCADE,
    version   INTEGER NOT NULL CHECK (version BETWEEN 1 AND 3),
    draft     TEXT NOT NULL,
    checked   TEXT,
    PRIMARY KEY (listen_id, version)
);

-- Every voice file made for a listen, so Delete removes them all.
CREATE TABLE listen_voices (
    listen_id TEXT NOT NULL REFERENCES listens (id) ON DELETE CASCADE,
    key       TEXT NOT NULL,
    PRIMARY KEY (listen_id, key)
);

CREATE TABLE jobs_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
        CHECK (kind IN ('ingest', 'render', 'agent', 'title', 'hash', 'face_vectors', 'faces',
                        'guide', 'read', 'similar', 'listen')),
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
