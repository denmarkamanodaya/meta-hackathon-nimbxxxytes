-- Projects hold iListen recordings, iRead documents and photos next to clips. One link table per
-- kind, shaped like project_clips: deleting a project or the item removes only the link. New
-- tables only; nothing existing changes.

CREATE TABLE project_listens (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    listen_id  TEXT NOT NULL REFERENCES listens (id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (project_id, listen_id)
);
CREATE INDEX project_listens_by_listen ON project_listens (listen_id);

CREATE TABLE project_documents (
    project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    added_at    TEXT NOT NULL,
    PRIMARY KEY (project_id, document_id)
);
CREATE INDEX project_documents_by_document ON project_documents (document_id);

CREATE TABLE project_photos (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    photo_id   TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (project_id, photo_id)
);
CREATE INDEX project_photos_by_photo ON project_photos (photo_id);
