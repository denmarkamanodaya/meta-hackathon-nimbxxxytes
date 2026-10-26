// Response parsers: turn an unknown JSON body into a wire type, or null when the shape is wrong.
// The client reports null as BAD_RESPONSE, so a contract drift fails loudly at the boundary.
import {
  isClipStatus,
  isNullable,
  isNumber,
  isPositiveInt,
  isRecord,
  isString,
  isStringArray,
  parseEvery,
} from './json-guards';
import type {
  ClipSummary,
  CompleteUploadResponse,
  CreateUploadResponse,
  Health,
  PresignPartsResponse,
  PresignedPart,
  SessionResponse,
} from './types';

/** Parses a body into `T`, or returns null when it does not match. */
export type Parse<T> = (body: unknown) => T | null;

function parsePart(value: unknown): PresignedPart | null {
  if (!isRecord(value) || !isPositiveInt(value.n) || !isString(value.url)) return null;
  return { n: value.n, url: value.url };
}

const parseParts = (value: unknown) => parseEvery(value, parsePart);

/** Parses `GET /health`. */
export const parseHealth: Parse<Health> = (body) =>
  isRecord(body) && typeof body.ok === 'boolean' ? { ok: body.ok } : null;

/** Parses `POST /session`. */
export const parseSession: Parse<SessionResponse> = (body) =>
  isRecord(body) && isString(body.user_id) ? { user_id: body.user_id } : null;

/** Parses `POST /uploads`. */
export const parseCreateUpload: Parse<CreateUploadResponse> = (body) => {
  if (!isRecord(body) || !isString(body.upload_id) || !isString(body.clip_id)) return null;
  if (!isPositiveInt(body.part_size)) return null;
  const parts = parseParts(body.parts);
  if (parts === null) return null;
  return { upload_id: body.upload_id, clip_id: body.clip_id, part_size: body.part_size, parts };
};

/** Parses `POST /uploads/{id}/parts`. */
export const parsePresignParts: Parse<PresignPartsResponse> = (body) => {
  const parts = isRecord(body) ? parseParts(body.parts) : null;
  return parts === null ? null : { parts };
};

/** Parses `POST /uploads/{id}/complete`. */
export const parseCompleteUpload: Parse<CompleteUploadResponse> = (body) =>
  isRecord(body) && isString(body.clip_id) && body.status === 'uploaded'
    ? { clip_id: body.clip_id, status: 'uploaded' }
    : null;

/**
 * Parses one clip row (`GET /clips` element, `GET /clips/{id}` `clip`).
 * @param value - Candidate row.
 * @returns The clip, or null when the shape is wrong.
 */
export function parseClip(value: unknown): ClipSummary | null {
  if (!isRecord(value) || !isString(value.clip_id) || !isString(value.filename)) return null;
  const { duration_s, recorded_at, status, thumb_url, segment_count, people } = value;
  if (!isNullable(duration_s, isNumber) || !isNullable(recorded_at, isString)) return null;
  if (!isClipStatus(status) || !isNullable(thumb_url, isString)) return null;
  if (!isNumber(segment_count) || !isStringArray(people)) return null;
  return {
    clip_id: value.clip_id,
    filename: value.filename,
    duration_s,
    recorded_at,
    status,
    thumb_url,
    segment_count,
    people,
  };
}

/** Parses `GET /clips`. One malformed row rejects the whole list. */
export const parseClipList: Parse<ClipSummary[]> = (body) => parseEvery(body, parseClip);
