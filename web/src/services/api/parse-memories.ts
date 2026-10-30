// Parsers for the Memory Lane endpoints: the list, one session with its moments, and the create
// answer. Every contract key is always present (null or "" when empty); a missing key fails the
// parse.
import { isBoolean, isNonNegativeInt, isNullable, isNumber, isRecord, isString, oneOf, parseEvery } from './json-guards';
import type { Parse } from './parse';
import {
  MEMORY_STATUSES,
  MEMORY_STEPS,
  MEMORY_SUBJECT_KINDS,
  type CreateMemoryResponse,
  type MemoryDetail,
  type MemoryMoment,
  type MemoryPerson,
  type MemorySummary,
} from './types';

const isMemoryStatus = oneOf(MEMORY_STATUSES);
const isMemoryStep = oneOf(MEMORY_STEPS);
const isSubjectKind = oneOf(MEMORY_SUBJECT_KINDS);
const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);

/**
 * Parses one `GET /api/memories` row.
 * @param body - Candidate row.
 * @returns The row, or null when the shape is wrong.
 */
export const parseMemorySummary: Parse<MemorySummary> = (body) => {
  if (!isRecord(body)) return null;
  const { id, title, subject_kind, subject_name, viewer_name, status, step, moment_count, fixed_count, cover_url, created_at, error } = body;
  if (!isString(id) || !isString(title) || !isSubjectKind(subject_kind) || !isString(subject_name) || !isNullableString(viewer_name)) return null;
  if (!isMemoryStatus(status) || !isNullable(step, isMemoryStep) || !isNonNegativeInt(moment_count) || !isNonNegativeInt(fixed_count)) return null;
  if (!isNullableString(cover_url) || !isString(created_at) || !isNullableString(error)) return null;
  return { id, title, subject_kind, subject_name, viewer_name, status, step, moment_count, fixed_count, cover_url, created_at, error };
};

/** Parses `GET /api/memories`. One malformed row rejects the whole list. */
export const parseMemoryList: Parse<MemorySummary[]> = (body) => parseEvery(body, parseMemorySummary);

const parsePerson = (value: unknown): MemoryPerson | null =>
  isRecord(value) && isString(value.person_id) && isString(value.name) && isNullableString(value.crop_url)
    ? { person_id: value.person_id, name: value.name, crop_url: value.crop_url }
    : null;

const parseMoment = (value: unknown): MemoryMoment | null => {
  if (!isRecord(value)) return null;
  const { index, clip_id, clip_title, recorded_at, start_s, end_s, proxy_url, thumb_url, line, prompt, checked, fixed_note } = value;
  const people = parseEvery(value.people, parsePerson);
  if (!isNonNegativeInt(index) || !isString(clip_id) || !isString(clip_title) || !isNullableString(recorded_at)) return null;
  if (!isNumber(start_s) || !isNumber(end_s) || !isNullableString(proxy_url) || !isNullableString(thumb_url) || people === null) return null;
  if (!isString(line) || !isString(prompt) || !isBoolean(checked) || !isNullableString(fixed_note)) return null;
  return { index, clip_id, clip_title, recorded_at, start_s, end_s, proxy_url, thumb_url, people, line, prompt, checked, fixed_note };
};

/**
 * Parses `GET /api/memories/{id}`.
 * @param body - Candidate session.
 * @returns The session, or null when the shape is wrong.
 */
export const parseMemory: Parse<MemoryDetail> = (body) => {
  if (!isRecord(body)) return null;
  const summary = parseMemorySummary(body.summary);
  const moments = parseEvery(body.moments, parseMoment);
  return summary === null || moments === null ? null : { summary, moments };
};

/** Parses the `POST /api/memories` answer. */
export const parseMemoryStarted: Parse<CreateMemoryResponse> = (body) =>
  isRecord(body) && isString(body.memory_id) && isMemoryStatus(body.status) ? { memory_id: body.memory_id, status: body.status } : null;
