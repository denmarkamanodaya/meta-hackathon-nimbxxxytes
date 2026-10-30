// Parsers for the iListen endpoints: the list, one listen with its lines and versions, and the
// upload answers. Every contract key is always present (null or "" when empty); a missing key
// fails the parse.
import { isBoolean, isNonNegativeInt, isNullable, isPositiveInt, isRecord, isString, isStringArray, oneOf, parseEvery } from './json-guards';
import type { Parse } from './parse';
import {
  LISTEN_SOURCE_KINDS,
  LISTEN_STATUSES,
  LISTEN_STEPS,
  type CompleteListenResponse,
  type CreateListenResponse,
  type HeardLanguage,
  type ListenDetail,
  type ListenSummary,
  type ListenTurn,
  type ListenVersion,
} from './types';

const isListenStatus = oneOf(LISTEN_STATUSES);
const isListenStep = oneOf(LISTEN_STEPS);
const isSourceKind = oneOf(LISTEN_SOURCE_KINDS);
const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);
const isNullableCount = (v: unknown): v is number | null => isNullable(v, isNonNegativeInt);
/** A check score, 0–100. */
const isScore = (v: unknown): v is number => isNonNegativeInt(v) && v <= 100;
const isNullableScore = (v: unknown): v is number | null => isNullable(v, isScore);

const parseHeard = (value: unknown): HeardLanguage | null =>
  isRecord(value) && isString(value.code) && isScore(value.share) ? { code: value.code, share: value.share } : null;

/**
 * Parses one `GET /api/listens` row.
 * @param body - Candidate row.
 * @returns The row, or null when the shape is wrong.
 */
export const parseListenSummary: Parse<ListenSummary> = (body) => {
  if (!isRecord(body)) return null;
  const { id, title, source_name, source_kind, clip_id, status, step, version, target, cover_url, duration_ms, speakers, confidence, passed, created_at, project_ids, size_bytes, error } = body;
  const languages = parseEvery(body.languages, parseHeard);
  if (!isString(id) || !isString(title) || !isString(source_name) || !isSourceKind(source_kind) || !isNullableString(clip_id)) return null;
  if (!isListenStatus(status) || !isNullable(step, isListenStep) || !isNonNegativeInt(version) || !isString(target) || languages === null || !isNullableString(cover_url)) return null;
  if (!isNullableCount(duration_ms) || !isNonNegativeInt(speakers) || !isNullableScore(confidence) || !isBoolean(passed)) return null;
  if (!isString(created_at) || !isStringArray(project_ids) || !isNonNegativeInt(size_bytes) || !isNullableString(error)) return null;
  return { id, title, source_name, source_kind, clip_id, status, step, version, target, languages, cover_url, duration_ms, speakers, confidence, passed, created_at, project_ids, size_bytes, error };
};

/** Parses `GET /api/listens`. One malformed row rejects the whole list. */
export const parseListenList: Parse<ListenSummary[]> = (body) => parseEvery(body, parseListenSummary);

const parseTurn = (value: unknown): ListenTurn | null => {
  if (!isRecord(value)) return null;
  const { index, start_ms, end_ms, speaker, lang, text, translation, score, issue, fixed_in } = value;
  if (!isNonNegativeInt(index) || !isNonNegativeInt(start_ms) || !isNonNegativeInt(end_ms) || !isNullableString(speaker)) return null;
  if (!isString(lang) || !isString(text) || !isString(translation) || !isNullableScore(score) || !isString(issue) || !isPositiveInt(fixed_in)) return null;
  return { index, start_ms, end_ms, speaker, lang, text, translation, score, issue, fixed_in };
};

const parseVersion = (value: unknown): ListenVersion | null => {
  if (!isRecord(value)) return null;
  const { version, confidence, summary_score, passed, notes } = value;
  if (!isPositiveInt(version) || !isNullableScore(confidence) || !isNullableScore(summary_score) || !isBoolean(passed) || !isStringArray(notes)) return null;
  return { version, confidence, summary_score, passed, notes };
};

/**
 * Parses `GET /api/listens/{id}` (and the `PATCH` and `/language` answers).
 * @param body - Candidate listen.
 * @returns The listen, or null when the shape is wrong.
 */
export const parseListen: Parse<ListenDetail> = (body) => {
  if (!isRecord(body)) return null;
  const head = parseListenSummary(body);
  const turns = parseEvery(body.turns, parseTurn);
  const versions = parseEvery(body.versions, parseVersion);
  const { summary, key_points, audio_url, summary_audio_url } = body;
  if (head === null || turns === null || versions === null || !isString(summary) || !isStringArray(key_points) || !isNullableString(audio_url) || !isNullableString(summary_audio_url)) return null;
  return { ...head, summary, key_points, turns, versions, audio_url, summary_audio_url };
};

/**
 * Parses the `POST /api/listens`, `PUT /api/listens/{id}/source` and `POST /api/listens/{id}/complete`
 * answers (one shape: the id and the status).
 */
export const parseListenStarted: Parse<CreateListenResponse & CompleteListenResponse> = (body) =>
  isRecord(body) && isString(body.listen_id) && isListenStatus(body.status) ? { listen_id: body.listen_id, status: body.status } : null;
