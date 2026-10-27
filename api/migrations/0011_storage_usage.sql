-- The storage cap: the latest measurement of everything an account stores in the bucket (the
-- sum of every object under users/{id}/). One row per account; refreshed at start, every hour and
-- after uploads, renders, exports and deletes. New table only; nothing existing changes.

CREATE TABLE storage_usage (
    user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    used_bytes  INTEGER NOT NULL CHECK (used_bytes >= 0),
    measured_at TEXT NOT NULL
);

-- Uploads by account and state, for the open uploads the cap reserves.
CREATE INDEX uploads_by_user_status ON uploads (user_id, status, created_at);
