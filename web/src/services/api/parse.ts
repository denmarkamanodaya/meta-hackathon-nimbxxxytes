// Response parsers: turn an unknown JSON body into a wire type, or null when the shape is wrong.
// The client reports null as BAD_RESPONSE, so a contract drift fails loudly at the boundary.
import {
  isClipStatus,
  isNonNegativeInt,
  isNullable,
  isNumber,
  isPositiveInt,
  isRecord,
  isString,
  isStringArray,
  parseEvery,
} from './json-guards';
import type {
  CostReport,
  ModelCost,
  ClipSummary,
  CompleteUploadResponse,
  CreateUploadResponse,
  Health,
  PresignPartsResponse,
  PresignedPart,
  SessionResponse,
  Settings,
  UploadCheck,
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
  if (!isString(value.title)) return null;
  const { duration_s, recorded_at, status, thumb_url, segment_count, people } = value;
  if (!isNullable(duration_s, isNumber) || !isNullable(recorded_at, isString)) return null;
  if (!isClipStatus(status) || !isNullable(thumb_url, isString)) return null;
  if (!isNumber(segment_count) || !isStringArray(people)) return null;
  if (!isNullable(value.duplicate_of, isString)) return null;
  return {
    clip_id: value.clip_id,
    title: value.title,
    filename: value.filename,
    duration_s,
    recorded_at,
    status,
    thumb_url,
    segment_count,
    people,
    duplicate_of: value.duplicate_of,
  };
}

/** Parses `POST /uploads/check`. */
export const parseUploadCheck: Parse<UploadCheck> = (body) => {
  if (!isRecord(body)) return null;
  const match = body.duplicate_of;
  if (match === null) return { duplicate_of: null };
  if (!isRecord(match) || !isString(match.clip_id) || !isString(match.title)) return null;
  return { duplicate_of: { clip_id: match.clip_id, title: match.title } };
};

/** Parses `GET /settings` and the `PUT /settings` answer. */
export const parseSettings: Parse<Settings> = (body) =>
  isRecord(body) && typeof body.face_matching === 'boolean' ? { face_matching: body.face_matching } : null;

/** Parses `GET /clips`. One malformed row rejects the whole list. */
export const parseClipList: Parse<ClipSummary[]> = (body) => parseEvery(body, parseClip);

/** Parses an empty success (204): any body is accepted and ignored. */
export const parseNoContent: Parse<true> = () => true;

function parseModelCost(value: unknown): ModelCost | null {
  if (!isRecord(value) || !isString(value.model) || !isNumber(value.cost_usd)) return null;
  if (!isNonNegativeInt(value.calls)) return null;
  return { model: value.model, calls: value.calls, cost_usd: value.cost_usd };
}

/** Parses `GET /costs`. */
export const parseCosts: Parse<CostReport> = (body) => {
  if (!isRecord(body) || !isNumber(body.total_usd)) return null;
  const byModel = parseEvery(body.by_model, parseModelCost);
  return byModel === null ? null : { total_usd: body.total_usd, by_model: byModel };
};
