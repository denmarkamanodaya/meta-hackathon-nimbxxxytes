-- Phase 6: shorts, their picked moments, versions and the step log.

CREATE TABLE shorts (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users (id),
    prompt         TEXT NOT NULL,
    aspect         TEXT NOT NULL CHECK (aspect IN ('4:5', '1:1')),
    target_s       REAL NOT NULL,
    status         TEXT NOT NULL
        CHECK (status IN ('planning', 'rendering', 'critiquing', 'revising', 'ready', 'failed')),
    best_version   INTEGER,
    render_key     TEXT,
    render_version INTEGER,
    created_at     TEXT NOT NULL
);
CREATE INDEX shorts_by_user ON shorts (user_id, created_at);

-- Picked moments in pick order.
CREATE TABLE short_segments (
    short_id   TEXT NOT NULL REFERENCES shorts (id) ON DELETE CASCADE,
    ord        INTEGER NOT NULL,
    segment_id TEXT NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
    PRIMARY KEY (short_id, ord),
    UNIQUE (short_id, segment_id)
);

CREATE TABLE short_versions (
    id          TEXT PRIMARY KEY,
    short_id    TEXT NOT NULL REFERENCES shorts (id) ON DELETE CASCADE,
    n           INTEGER NOT NULL CHECK (n >= 1),
    timeline    TEXT NOT NULL,
    preview_key TEXT,
    critique    TEXT,
    score_total REAL,
    UNIQUE (short_id, n)
);

CREATE TABLE agent_steps (
    id       TEXT PRIMARY KEY,
    short_id TEXT NOT NULL REFERENCES shorts (id) ON DELETE CASCADE,
    seq      INTEGER NOT NULL,
    kind     TEXT NOT NULL
        CHECK (kind IN ('plan', 'tool_call', 'tool_result', 'critique', 'revise', 'final')),
    tool     TEXT,
    version  INTEGER,
    args     TEXT,
    summary  TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    at       TEXT NOT NULL,
    UNIQUE (short_id, seq)
);
