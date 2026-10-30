// Parsers for the photo endpoints: the list, one photo, and the upload answers. Every contract key
// is always present (null or "" when empty); a missing key fails the parse.
import { isNonNegativeInt, isNullable, isPositiveInt, isRecord, isString, isStringArray, oneOf, parseEvery } from './json-guards';
import type { Parse } from './parse';
import { PHOTO_STATUSES, type CreatePhotoResponse, type PhotoDetail, type PhotoQueued, type PhotoSummary } from './types';

const isPhotoStatus = oneOf(PHOTO_STATUSES);
const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);
const isNullableSide = (v: unknown): v is number | null => isNullable(v, isPositiveInt);

/**
 * Parses one `GET /api/photos` row.
 * @param body - Candidate row.
 * @returns The row, or null when the shape is wrong.
 */
export const parsePhotoSummary: Parse<PhotoSummary> = (body) => {
  if (!isRecord(body)) return null;
  const { id, title, filename, status, taken_at, width, height, size_bytes, thumb_url, created_at, project_ids, error } = body;
  if (!isString(id) || !isString(title) || !isString(filename) || !isPhotoStatus(status) || !isNullableString(taken_at)) return null;
  if (!isNullableSide(width) || !isNullableSide(height) || !isNonNegativeInt(size_bytes) || !isNullableString(thumb_url)) return null;
  if (!isString(created_at) || !isStringArray(project_ids) || !isNullableString(error)) return null;
  return { id, title, filename, status, taken_at, width, height, size_bytes, thumb_url, created_at, project_ids, error };
};

/** Parses `GET /api/photos`. One malformed row rejects the whole list. */
export const parsePhotoList: Parse<PhotoSummary[]> = (body) => parseEvery(body, parsePhotoSummary);

/**
 * Parses `GET /api/photos/{id}` (and the `PATCH` answer).
 * @param body - Candidate photo.
 * @returns The photo, or null when the shape is wrong.
 */
export const parsePhoto: Parse<PhotoDetail> = (body) => {
  if (!isRecord(body)) return null;
  const head = parsePhotoSummary(body);
  const { description, things, image_url, original_url, camera } = body;
  if (head === null || !isString(description) || !isStringArray(things) || !isNullableString(image_url)) return null;
  if (!isNullableString(original_url) || !isNullableString(camera)) return null;
  return { ...head, description, things, image_url, original_url, camera };
};

/** Parses the `POST /api/photos` and `PUT /api/photos/{id}/source` answers (the id and the status). */
export const parsePhotoStarted: Parse<CreatePhotoResponse & PhotoQueued> = (body) =>
  isRecord(body) && isString(body.photo_id) && isPhotoStatus(body.status) ? { photo_id: body.photo_id, status: body.status } : null;
