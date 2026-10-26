-- Phase 3/4: people, face tracks and their segment links, and segment image vectors.
-- segment_vectors needs the sqlite-vec extension, registered before any connection opens.

CREATE TABLE people (
    id      TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    name    TEXT NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE face_tracks (
    id        TEXT PRIMARY KEY,
    clip_id   TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    ordinal   INTEGER NOT NULL,
    first_s   REAL NOT NULL,
    last_s    REAL NOT NULL,
    crop_key  TEXT,
    max_area  REAL NOT NULL,
    person_id TEXT REFERENCES people (id) ON DELETE SET NULL,
    hidden    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (clip_id, ordinal)
);

CREATE TABLE track_segments (
    track_id   TEXT NOT NULL REFERENCES face_tracks (id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
    PRIMARY KEY (track_id, segment_id)
);

CREATE VIRTUAL TABLE segment_vectors USING vec0(
    segment_id TEXT PRIMARY KEY,
    user_id TEXT PARTITION KEY,
    embedding FLOAT[1024] distance_metric=cosine
);
