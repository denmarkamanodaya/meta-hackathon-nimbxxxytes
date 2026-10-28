// Parsers for the Projects endpoints: `GET /projects` (a bare array, newest first) and the
// project every write answers with.
import { isNonNegativeInt, isNumber, isRecord, isString, oneOf, parseEvery } from './json-guards';
import { parseArtFields, parseArtSources } from './parse-art';
import type { Parse } from './parse';
import { PROJECT_COLORS, type Project } from './types';

const isProjectColor = oneOf(PROJECT_COLORS);

/**
 * Parses one project (`GET /projects` element, the answer of `POST`, `PATCH` and `POST …/clips`).
 * @param body - Candidate project.
 * @returns The project, or null when the shape is wrong.
 */
export const parseProject: Parse<Project> = (body) => {
  if (!isRecord(body) || !isString(body.project_id) || !isString(body.name)) return null;
  const { color, clip_count, duration_s, size_bytes, created_at } = body;
  if (!isProjectColor(color) || !isNonNegativeInt(clip_count)) return null;
  if (!isNumber(duration_s) || duration_s < 0 || !isNonNegativeInt(size_bytes) || !isString(created_at)) return null;
  const art = parseArtFields(body);
  const art_sources = parseArtSources(body.art_sources);
  if (art === null || art_sources === null) return null;
  return { project_id: body.project_id, name: body.name, color, clip_count, duration_s, size_bytes, created_at, ...art, art_sources };
};

/** Parses `GET /projects`. One malformed row rejects the whole list. */
export const parseProjectList: Parse<Project[]> = (body) => parseEvery(body, parseProject);
