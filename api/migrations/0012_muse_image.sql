-- Muse Image art: cover styles and titles, storyboards redrawn from the footage that covers a
-- shot, and key art for productions and projects. Columns are only added; no table is rebuilt or
-- dropped, so no row that references another is touched.

-- How each cover was made, aligned with cover_keys: JSON [{style, instruction}]. A cover with no
-- entry was drawn before styles existed; its style is its number modulo 3.
ALTER TABLE short_exports ADD COLUMN cover_info TEXT NOT NULL DEFAULT '[]';
-- The title laid over the picked cover: JSON {text, show, position}; NULL until first set.
ALTER TABLE short_exports ADD COLUMN cover_title TEXT;
-- The picked cover with its title, as published; NULL while it is being made.
ALTER TABLE short_exports ADD COLUMN titled_cover_key TEXT;

-- The storyboard redrawn from the covering moment, and the moment it was drawn from.
ALTER TABLE production_shots ADD COLUMN footage_board_key TEXT;
ALTER TABLE production_shots ADD COLUMN footage_board_segment TEXT;

-- Key art, and whether the automatic first drawing already ran.
ALTER TABLE productions ADD COLUMN art_key TEXT;
ALTER TABLE productions ADD COLUMN art_auto INTEGER NOT NULL DEFAULT 0;

-- Key art, the moments it was drawn from (JSON [{clip_id, segment_id, clip_title, title,
-- start_s}]), and whether the automatic first drawing already ran.
ALTER TABLE projects ADD COLUMN art_key TEXT;
ALTER TABLE projects ADD COLUMN art_sources TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN art_auto INTEGER NOT NULL DEFAULT 0;
