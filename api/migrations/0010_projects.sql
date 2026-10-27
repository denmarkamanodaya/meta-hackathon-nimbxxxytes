-- Projects: named, coloured groups of the owner's clips. A clip may sit in many projects;
-- deleting a project or a clip removes only the links. New tables only; nothing existing changes.

CREATE TABLE projects (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id),
    name       TEXT NOT NULL,
    color      TEXT NOT NULL
        CHECK (color IN ('orange', 'green', 'blue', 'purple', 'pink', 'grey')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX projects_by_user ON projects (user_id, created_at);
-- Backstop for the use case's check (which also folds non-ASCII case).
CREATE UNIQUE INDEX projects_name_per_user ON projects (user_id, name COLLATE NOCASE);

CREATE TABLE project_clips (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    clip_id    TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (project_id, clip_id)
);
CREATE INDEX project_clips_by_clip ON project_clips (clip_id);
