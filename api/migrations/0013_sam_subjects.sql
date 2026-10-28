-- SAM 3.1 beyond faces: the screens-and-plates blur switch, keep subject in frame, and objects
-- tapped with Find this. Columns are only added and new tables created; no table is rebuilt or
-- dropped, so no row that references another is touched.

-- Also blur screens and number plates in exports (off by default).
ALTER TABLE users ADD COLUMN blur_objects INTEGER NOT NULL DEFAULT 0;

-- Vertical exports follow each shot's subject (on by default).
ALTER TABLE short_finish ADD COLUMN keep_subject INTEGER NOT NULL DEFAULT 1;

-- How each shot of a short's version was tracked: the subject followed and the camera path
-- (JSON [{t_s, cx, cy}] in clip seconds, centres as shares of the upright source). Upserted per
-- (short, version, moment).
CREATE TABLE short_reframes (
    short_id       TEXT NOT NULL REFERENCES shorts (id) ON DELETE CASCADE,
    version_n      INTEGER NOT NULL,
    segment_id     TEXT NOT NULL,
    subject        TEXT NOT NULL,
    crop_path      TEXT NOT NULL DEFAULT '[]',
    frames_tracked INTEGER NOT NULL,
    frames_total   INTEGER NOT NULL,
    lost_s         REAL NOT NULL,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (short_id, version_n, segment_id)
);

-- Objects tapped with Find this: the clip, Spark's name and the seconds it is in view.
CREATE TABLE object_tracks (
    id         TEXT PRIMARY KEY,
    clip_id    TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    label      TEXT NOT NULL,
    t_s        REAL NOT NULL,
    start_s    REAL NOT NULL,
    end_s      REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX object_tracks_clip ON object_tracks (clip_id);

-- PE image vectors of tapped objects. A vector whose track is gone is ignored by the KNN join.
CREATE VIRTUAL TABLE object_vectors USING vec0(
    track_id TEXT PRIMARY KEY,
    user_id TEXT PARTITION KEY,
    embedding FLOAT[1024] distance_metric=cosine
);
