// Response parsers: turn an unknown JSON body into a wire type, or null when the shape is wrong.
// The client reports null as BAD_RESPONSE, so a contract drift fails loudly at the boundary.
import type {
  ClipStatus,
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

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isPositiveInt = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;
const isNullable = <T>(value: unknown, guard: (v: unknown) => v is T): value is T | null =>
  value === null || guard(value);

const CLIP_STATUSES: readonly ClipStatus[] = [
  'uploading',
  'uploaded',
  'processing',
  'ready',
  'failed',
];
const isClipStatus = (value: unknown): value is ClipStatus =>
  CLIP_STATUSES.some((status) => status === value);

function parsePart(value: unknown): PresignedPart | null {
  if (!isRecord(value) || !isPositiveInt(value.n) || !isString(value.url)) return null;
  return { n: value.n, url: value.url };
}

function parseParts(value: unknown): PresignedPart[] | null {
  if (!Array.isArray(value)) return null;
  const parts = value.map(parsePart);
  return parts.every((part) => part !== null) ? parts : null;
}

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

function parseClip(value: unknown): ClipSummary | null {
  if (!isRecord(value) || !isString(value.clip_id) || !isString(value.filename)) return null;
  const { duration_s, recorded_at, status, thumb_url, segment_count, people } = value;
  if (!isNullable(duration_s, isNumber) || !isNullable(recorded_at, isString)) return null;
  if (!isClipStatus(status) || !isNullable(thumb_url, isString)) return null;
  if (!isNumber(segment_count) || !Array.isArray(people) || !people.every(isString)) return null;
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
export const parseClipList: Parse<ClipSummary[]> = (body) => {
  if (!Array.isArray(body)) return null;
  const clips = body.map(parseClip);
  return clips.every((clip) => clip !== null) ? clips : null;
};
