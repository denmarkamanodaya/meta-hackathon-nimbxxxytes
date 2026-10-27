-- Opt-in face match suggestions: the per-user switch (off by default), one Perception Encoder
-- vector per visible face track of users who turned it on, and Muse Spark's verdict per checked
-- pair of tracks (track_a < track_b). Turning the switch off deletes the user's vectors and
-- verdicts; a verdict goes with either of its tracks.
ALTER TABLE users ADD COLUMN face_matching INTEGER NOT NULL DEFAULT 0;

CREATE VIRTUAL TABLE face_vectors USING vec0(
    track_id TEXT PRIMARY KEY,
    user_id TEXT PARTITION KEY,
    embedding FLOAT[1024] distance_metric=cosine
);

CREATE TABLE face_matches (
    track_a    TEXT NOT NULL REFERENCES face_tracks (id) ON DELETE CASCADE,
    track_b    TEXT NOT NULL REFERENCES face_tracks (id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users (id),
    same       INTEGER NOT NULL,
    confidence REAL NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('person', 'pet')),
    PRIMARY KEY (track_a, track_b),
    CHECK (track_a < track_b)
);
CREATE INDEX face_matches_by_user ON face_matches (user_id);
