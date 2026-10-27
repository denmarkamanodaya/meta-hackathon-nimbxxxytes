-- Production Studio: brand kits, productions and their shot lists, persisted face boxes for the
-- privacy blur, and per-short finish and export settings. New tables only; nothing existing changes.

CREATE TABLE brand_kits (
    user_id    TEXT PRIMARY KEY REFERENCES users (id),
    colors     TEXT NOT NULL,                 -- JSON array of #rrggbb, 1-3, the first is the accent
    title_font TEXT NOT NULL CHECK (title_font IN ('bricolage', 'geist')),
    logo_key   TEXT,
    ref_keys   TEXT NOT NULL DEFAULT '[]',    -- JSON array of object keys, at most 4
    updated_at TEXT NOT NULL
);

CREATE TABLE productions (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users (id),
    title               TEXT NOT NULL,
    brief               TEXT NOT NULL,
    format              TEXT NOT NULL CHECK (format IN ('story', 'short')),
    aspect              TEXT NOT NULL CHECK (aspect IN ('4:5', '1:1')),
    target_s            REAL NOT NULL,
    blur_bystanders     INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL
        CHECK (status IN ('planning', 'shooting', 'cutting', 'ready', 'published', 'failed')),
    short_id            TEXT REFERENCES shorts (id) ON DELETE SET NULL,
    coverage_checked_at TEXT,
    error               TEXT,
    created_at          TEXT NOT NULL
);
CREATE INDEX productions_by_user ON productions (user_id, created_at);

CREATE TABLE production_shots (
    id                 TEXT PRIMARY KEY,
    production_id      TEXT NOT NULL REFERENCES productions (id) ON DELETE CASCADE,
    ord                INTEGER NOT NULL,
    act                TEXT NOT NULL CHECK (act IN ('hook', 'story', 'payoff', 'outro')),
    title              TEXT NOT NULL,
    direction          TEXT NOT NULL,         -- one line: how to film it
    tips               TEXT NOT NULL,         -- JSON array of short tips
    query              TEXT NOT NULL,         -- search phrase used for coverage
    duration_s         REAL NOT NULL,
    board_key          TEXT,                  -- storyboard image
    matched_segment_id TEXT REFERENCES segments (id) ON DELETE SET NULL,
    match_reason       TEXT,
    take_count         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (production_id, ord)
);

CREATE TABLE face_boxes (
    track_id TEXT NOT NULL REFERENCES face_tracks (id) ON DELETE CASCADE,
    t_s      REAL NOT NULL,
    x        REAL NOT NULL,                   -- x, y, w, h: 0-1, relative to the upright frame
    y        REAL NOT NULL,
    w        REAL NOT NULL,
    h        REAL NOT NULL,
    PRIMARY KEY (track_id, t_s)
);

CREATE TABLE short_finish (
    short_id        TEXT PRIMARY KEY REFERENCES shorts (id) ON DELETE CASCADE,
    blur_bystanders INTEGER NOT NULL DEFAULT 1,
    title_text      TEXT,
    speaker_colors  INTEGER NOT NULL DEFAULT 0,
    effect          TEXT NOT NULL DEFAULT 'none' CHECK (effect IN ('none', 'spotlight', 'blur_bg'))
);

CREATE TABLE short_exports (
    id         TEXT PRIMARY KEY,
    short_id   TEXT NOT NULL REFERENCES shorts (id) ON DELETE CASCADE,
    platform   TEXT NOT NULL CHECK (platform IN ('tiktok', 'reels', 'shorts', 'feed')),
    aspect     TEXT NOT NULL CHECK (aspect IN ('9:16', '4:5', '1:1')),
    version_n  INTEGER NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    render_key TEXT,
    caption    TEXT NOT NULL DEFAULT '',
    hashtags   TEXT NOT NULL DEFAULT '[]',
    cover_keys TEXT NOT NULL DEFAULT '[]',
    cover_pick INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE (short_id, platform)
);
