-- Phase 2: probe audio flag, segments, transcript, speakers, and the model call ledger + cache.

ALTER TABLE clips ADD COLUMN has_audio INTEGER;

CREATE TABLE segments (
    id           TEXT PRIMARY KEY,
    clip_id      TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    start_s      REAL NOT NULL,
    end_s        REAL NOT NULL,
    description  TEXT,
    actions      TEXT NOT NULL DEFAULT '[]',
    objects      TEXT NOT NULL DEFAULT '[]',
    place        TEXT,
    mood         TEXT,
    quality      INTEGER CHECK (quality BETWEEN 0 AND 10),
    hook_score   INTEGER CHECK (hook_score BETWEEN 0 AND 10),
    facts_status TEXT CHECK (facts_status IN ('ok', 'fallback')),
    UNIQUE (clip_id, idx)
);

CREATE TABLE speakers (
    id           TEXT PRIMARY KEY,
    clip_id      TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    label        TEXT NOT NULL,
    display_name TEXT,
    UNIQUE (clip_id, label)
);

CREATE TABLE transcript_turns (
    id         TEXT PRIMARY KEY,
    clip_id    TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    turn_no    INTEGER NOT NULL,
    start_s    REAL NOT NULL,
    end_s      REAL NOT NULL,
    text       TEXT NOT NULL,
    speaker_id TEXT REFERENCES speakers (id) ON DELETE SET NULL
);
CREATE INDEX turns_by_clip ON transcript_turns (clip_id, start_s);

CREATE TABLE segment_turns (
    segment_id TEXT NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
    turn_id    TEXT NOT NULL REFERENCES transcript_turns (id) ON DELETE CASCADE,
    PRIMARY KEY (segment_id, turn_id)
);

CREATE TABLE model_calls (
    id            TEXT PRIMARY KEY,
    at            TEXT NOT NULL,
    model         TEXT NOT NULL,
    purpose       TEXT NOT NULL,
    input_hash    TEXT NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    frames        INTEGER,
    audio_s       REAL,
    cost_usd      REAL NOT NULL,
    latency_ms    INTEGER NOT NULL,
    cache_hit     INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error         TEXT
);
CREATE INDEX model_calls_by_time ON model_calls (at);

CREATE TABLE model_cache (
    input_hash TEXT PRIMARY KEY,
    model      TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_at TEXT NOT NULL
);
