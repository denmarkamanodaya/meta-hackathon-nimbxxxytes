-- no-transaction
-- iListen covers: a Muse Image cover drawn once per listen (`cover_key`) and the new `cover` job
-- step, which the listens.step CHECK must allow.
--
-- SQLite cannot change a CHECK constraint in place, so listens is rebuilt with SQLite's documented
-- procedure. listen_turns, listen_versions and listen_voices reference listens with ON DELETE
-- CASCADE, so foreign keys are switched off while the old table is dropped (otherwise the drop
-- would delete every turn, version and voice row); the rebuild runs in one transaction, and
-- foreign keys are switched back on afterwards.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE listens_new (
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
        CHECK (step IN ('audio', 'transcribe', 'understand', 'check', 'cover', 'voice')),
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
    -- Muse Image cover drawn once from the summary; kept across language changes.
    cover_key         TEXT,
    error             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

INSERT INTO listens_new (id, user_id, source, clip_id, source_name, content_type, ext, size_bytes,
                         status, step, version, target, title, summary, key_points, languages,
                         duration_ms, speakers, heard_by, confidence, passed, summary_audio_key,
                         error, created_at, updated_at)
    SELECT id, user_id, source, clip_id, source_name, content_type, ext, size_bytes, status, step,
           version, target, title, summary, key_points, languages, duration_ms, speakers, heard_by,
           confidence, passed, summary_audio_key, error, created_at, updated_at
    FROM listens;

DROP TABLE listens;
ALTER TABLE listens_new RENAME TO listens;
CREATE INDEX listens_user ON listens (user_id, created_at);
CREATE INDEX listens_clip ON listens (clip_id);

COMMIT;

PRAGMA foreign_keys = ON;
