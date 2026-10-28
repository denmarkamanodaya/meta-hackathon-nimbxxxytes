// Parsers for the SAM 3.1 endpoints: Find this, Cut out and a short's subject tracking (reframe).
import { isNonNegativeInt, isNullable, isNumber, isRecord, isString, oneOf, parseEvery } from './json-guards';
import type { Parse } from './parse';
import type {
  CutoutResponse,
  FindHit,
  FindOutline,
  FindResponse,
  ReframeResponse,
  ReframeShot,
  ReframeStatus,
  SecondsRange,
} from './types';

const isReframeStatus = oneOf<ReframeStatus>(['idle', 'running', 'ready', 'failed']);
const isSeconds = (value: unknown): value is number => isNumber(value) && value >= 0;

function parseRange(value: unknown): SecondsRange | null {
  if (!isRecord(value) || !isSeconds(value.start_s) || !isSeconds(value.end_s)) return null;
  return value.end_s < value.start_s ? null : { start_s: value.start_s, end_s: value.end_s };
}

/** A missing outline is null; a present one must be whole (undefined = malformed). */
function parseOutline(value: unknown): FindOutline | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isString(value.path) || value.path.trim() === '') return undefined;
  const { frame_w, frame_h } = value;
  if (!isNumber(frame_w) || !isNumber(frame_h) || frame_w <= 0 || frame_h <= 0) return undefined;
  return { path: value.path, frame_w, frame_h };
}

function parseHit(value: unknown): FindHit | null {
  if (!isRecord(value) || !isString(value.clip_id) || !isString(value.clip_title) || !isString(value.segment_id)) return null;
  const { recorded_at, thumb_url, score } = value;
  const range = parseRange(value);
  if (range === null || !isNullable(recorded_at, isString) || !isNullable(thumb_url, isString) || !isNumber(score)) return null;
  return {
    clip_id: value.clip_id,
    clip_title: value.clip_title,
    recorded_at,
    segment_id: value.segment_id,
    start_s: range.start_s,
    end_s: range.end_s,
    thumb_url,
    score,
  };
}

/** Parses `POST /clips/{id}/find`. */
export const parseFind: Parse<FindResponse> = (body) => {
  if (!isRecord(body) || !isString(body.label)) return null;
  const inView = parseRange(body.in_view);
  const outline = parseOutline(body.outline);
  const hits = parseEvery(body.hits, parseHit);
  if (inView === null || outline === undefined || hits === null) return null;
  return { label: body.label, in_view: inView, outline, hits };
};

/** Parses `POST /clips/{id}/cutout`. */
export const parseCutout: Parse<CutoutResponse> = (body) => {
  if (!isRecord(body) || !isString(body.label) || !isString(body.png_url) || !isString(body.sticker_url)) return null;
  return { label: body.label, png_url: body.png_url, sticker_url: body.sticker_url };
};

function parseReframeShot(value: unknown): ReframeShot | null {
  if (!isRecord(value) || !isString(value.segment_id) || !isString(value.subject)) return null;
  const { frames_tracked, frames_total, lost_s } = value;
  if (!isNonNegativeInt(frames_tracked) || !isNonNegativeInt(frames_total) || !isSeconds(lost_s)) return null;
  return { segment_id: value.segment_id, subject: value.subject, frames_tracked, frames_total, lost_s };
}

/** Parses `GET /shorts/{id}/reframe`. */
export const parseReframe: Parse<ReframeResponse> = (body) => {
  if (!isRecord(body) || !isReframeStatus(body.status)) return null;
  const shots = parseEvery(body.shots, parseReframeShot);
  return shots === null ? null : { status: body.status, shots };
};
