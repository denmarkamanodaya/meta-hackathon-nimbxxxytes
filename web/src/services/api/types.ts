// Wire types for the nimbytes API: the one TypeScript mirror of api/crates/contracts.
// Any change to a wire shape edits both in the same commit.
import errorCodes from './error-codes.json';

declare const errorCodeBrand: unique symbol;

/**
 * One of the API's `UPPER_SNAKE` error codes. The list lives only in `error-codes.json`, which
 * the api crate tests its `ErrorCode` enum against; the brand means a value can only come from
 * `isErrorCode`, never from a hand-typed literal.
 */
export type ErrorCode = string & { readonly [errorCodeBrand]: true };

/**
 * Narrows a value to a known API error code.
 * @param value - Anything, usually `error.code` from a response body.
 * @returns True when `value` is listed in `error-codes.json`.
 */
export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && errorCodes.includes(value);

/** Error envelope every non-2xx API response carries. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/** `GET /api/health` response. */
export interface Health {
  ok: boolean;
}

/** `POST /api/session` response; the session itself travels in the `nb_session` cookie. */
export interface SessionResponse {
  user_id: string;
}

/** Lifecycle of a clip, from first byte to fully understood. */
export type ClipStatus = 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';

/** A presigned S3 `UploadPart` URL for part `n` (1-based). */
export interface PresignedPart {
  n: number;
  url: string;
}

/** `POST /api/uploads` request. */
export interface CreateUploadRequest {
  filename: string;
  size_bytes: number;
  content_type: string;
}

/** `POST /api/uploads` response; `part_size` is in bytes, `parts` covers every part. */
export interface CreateUploadResponse {
  upload_id: string;
  clip_id: string;
  part_size: number;
  parts: PresignedPart[];
}

/** `POST /api/uploads/{id}/parts` request (re-presign for resume). */
export interface PresignPartsRequest {
  part_numbers: number[];
}

/** `POST /api/uploads/{id}/parts` response. */
export interface PresignPartsResponse {
  parts: PresignedPart[];
}

/** A finished part: its number and the `ETag` header S3 returned for it. */
export interface CompletedPart {
  n: number;
  etag: string;
}

/** `POST /api/uploads/{id}/complete` request; parts in ascending `n`. */
export interface CompleteUploadRequest {
  parts: CompletedPart[];
}

/** `POST /api/uploads/{id}/complete` response. */
export interface CompleteUploadResponse {
  clip_id: string;
  status: 'uploaded';
}

/** One row of `GET /api/clips`. Fields unknown until processing are null. */
export interface ClipSummary {
  clip_id: string;
  filename: string;
  duration_s: number | null;
  recorded_at: string | null;
  status: ClipStatus;
  thumb_url: string | null;
  segment_count: number;
  people: string[];
}

/** One 5–10 s window of a clip. Fact fields are null until the describe step has run. */
export interface Segment {
  segment_id: string;
  /** 0-based order within the clip. */
  idx: number;
  /** Seconds from clip start. */
  start_s: number;
  end_s: number;
  description: string | null;
  actions: string[];
  objects: string[];
  place: string | null;
  mood: string | null;
  /** 0–10. */
  quality: number | null;
  /** 0–10. */
  hook_score: number | null;
  thumb_url: string | null;
}

/** One transcript turn. `speaker_id` is null when diarization gave no speaker. */
export interface Turn {
  turn_id: string;
  start_s: number;
  end_s: number;
  text: string;
  speaker_id: string | null;
}

/** A speaker in one clip; `display_name` is null until the user names them. */
export interface Speaker {
  speaker_id: string;
  /** Raw diarization label from Voice Transcribe: a letter, `"A"`, `"B"`, …. */
  label: string;
  display_name: string | null;
}

/** A face track: one detected person across the clip. */
export interface Track {
  track_id: string;
  crop_url: string | null;
  first_s: number;
  last_s: number;
  person_name: string | null;
  hidden: boolean;
}

/** `GET /api/clips/{id}` response. `proxy_url` is null until the proxy is made. */
export interface ClipDetail {
  clip: ClipSummary;
  proxy_url: string | null;
  segments: Segment[];
  turns: Turn[];
  speakers: Speaker[];
  tracks: Track[];
}

/** Ingest pipeline steps, in run order. */
export const PIPELINE_STEPS = [
  'probe',
  'proxy',
  'derivatives',
  'segments',
  'transcribe',
  'describe',
  'faces',
  'embed',
  'index',
  'ready',
] as const;

/** One ingest step. */
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** State of one step. */
export type StepStatus = 'running' | 'done' | 'failed';

/** `GET /api/clips/{id}/events` SSE `data` payload (default `message` event). */
export interface ClipEvent {
  step: PipelineStep;
  status: StepStatus;
}

/** Structured filters the query rewrite extracted. Missing fields mean "no filter". */
export interface SearchFilters {
  people: string[];
  speakers: string[];
  place: string | null;
  /** ISO date or instant, inclusive. */
  from: string | null;
  to: string | null;
  /** 0–10. */
  min_quality: number | null;
}

/** How the server understood the query. */
export interface RewrittenQuery {
  keywords: string[];
  filters: SearchFilters;
}

/** One moment found by search: a segment and why it matched. */
export interface SearchResult {
  segment_id: string;
  clip_id: string;
  start_s: number;
  end_s: number;
  thumb_url: string | null;
  /** One line from the rerank; null when rerank did not run. */
  reason: string | null;
  score: number;
  clip_filename: string;
  recorded_at: string | null;
}

/** `POST /api/search` response. `reranked` is false when results are in fused order. */
export interface SearchResponse {
  rewritten: RewrittenQuery;
  results: SearchResult[];
  reranked: boolean;
}

/** A named person (autocomplete row). */
export interface Person {
  person_id: string;
  name: string;
}

/** `PUT /api/tracks/{id}` request; send only the fields that change. */
export interface TrackUpdate {
  name?: string;
  hidden?: boolean;
}

/** `PUT /api/speakers/{id}` request. */
export interface SpeakerUpdate {
  display_name: string;
}

/**
 * Returns `name` as a typed code, failing at import time when `error-codes.json` lacks it.
 * @throws Error when `name` is not a listed code (the list and the caller drifted).
 */
function knownCode(name: string): ErrorCode {
  if (!isErrorCode(name)) throw new Error(`${name} is missing from error-codes.json`);
  return name;
}

/** Codes the web branches on. Each is checked against `error-codes.json` when loaded. */
export const ERROR = {
  NOT_FOUND: knownCode('NOT_FOUND'),
  FORBIDDEN: knownCode('FORBIDDEN'),
  UNAUTHORIZED: knownCode('UNAUTHORIZED'),
  UPLOAD_INCOMPLETE: knownCode('UPLOAD_INCOMPLETE'),
} as const;
