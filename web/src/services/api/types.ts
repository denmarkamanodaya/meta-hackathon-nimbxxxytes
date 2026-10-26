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

/** Output frame of a short. */
export type Aspect = '4:5' | '1:1';

/** One shot in a timeline. `in` / `out` are seconds on the source clip, inside the segment. */
export interface TimelineClip {
  segment_id: string;
  in: number;
  out: number;
  /** What the shot is about, for a punch-in; null when none. */
  subject: string | null;
  /** Zoom factor >= 1.0 (1.0 = no zoom). */
  punch_in: number;
  /** "Why this shot", from the agent. */
  reason: string;
}

/** Kind of change a revision made. */
export type RevisionAction = 'add' | 'remove' | 'swap' | 'trim' | 'reorder' | 'retime_captions';

/** One change in a revision, and the critique note it answers. */
export interface RevisionChange {
  action: RevisionAction;
  /** What changed, for example `"s7 → s9"`. */
  detail: string;
  /** Why, in words. */
  why: string;
  /** 0-based index into `notes` of the critique of version `from_version`; null if none. */
  note_index: number | null;
}

/** What a v2+ timeline changed relative to `from_version`. */
export interface Revision {
  from_version: number;
  changes: RevisionChange[];
}

/** A cut: shots, captions, post text and the agent's reasoning. */
export interface Timeline {
  aspect: Aspect;
  target_seconds: number;
  clips: TimelineClip[];
  captions: { style: 'phrase' | 'none'; source: 'transcript' };
  post: { caption: string; hashtags: string[] };
  /** Overall reasoning for this cut (<= 200 chars). */
  rationale: string;
  /** Null (or absent on the wire) on v1; required on v2+. */
  revision: Revision | null;
}

/** The five critique dimensions, each scored 0–10. */
export const CRITIQUE_DIMENSIONS = ['hook', 'pacing', 'continuity', 'captions', 'length'] as const;

/** One critique dimension. */
export type CritiqueDimension = (typeof CRITIQUE_DIMENSIONS)[number];

/** A timestamped problem in a preview. `at` is seconds on the preview. */
export interface CritiqueNote {
  at: number;
  issue: string;
  fix: string;
}

/** The agent's review of one preview. `total` is the sum of the scores (0–50). */
export interface Critique {
  version: number;
  scores: Record<CritiqueDimension, number>;
  total: number;
  notes: CritiqueNote[];
  verdict: 'accept' | 'revise';
}

/** Where a short is. */
export type ShortStatus = 'planning' | 'rendering' | 'critiquing' | 'revising' | 'ready' | 'failed';

/** A short and its final render. */
export interface Short {
  short_id: string;
  prompt: string;
  aspect: Aspect;
  target_s: number;
  status: ShortStatus;
  best_version: number | null;
  /** Final render URL; null until a final render finished (reset when a new one starts). */
  render_url: string | null;
}

/** One version of the cut, with its preview and critique. */
export interface ShortVersion {
  /** 1-based. */
  n: number;
  timeline: Timeline;
  preview_url: string | null;
  critique: Critique | null;
  score_total: number | null;
}

/** Kind of agent step. */
export type AgentStepKind = 'plan' | 'tool_call' | 'tool_result' | 'critique' | 'revise' | 'final';

/** One row of the agent's step log (also the SSE `data`). */
export interface AgentStep {
  seq: number;
  kind: AgentStepKind;
  tool: string | null;
  /** The version this step works on, when there is one. */
  version: number | null;
  summary: string;
  at: string;
}

/** A candidate segment the short may use: bounds for trimming, thumb for the cards. */
export interface ShortSegment {
  segment_id: string;
  clip_id: string;
  start_s: number;
  end_s: number;
  thumb_url: string | null;
  description: string | null;
}

/** `GET /api/shorts/{id}` response. */
export interface ShortDetail {
  short: Short;
  versions: ShortVersion[];
  steps: AgentStep[];
  segments: ShortSegment[];
}

/** `POST /api/shorts` request. */
export interface CreateShortRequest {
  prompt: string;
  segment_ids: string[];
  aspect: Aspect;
  target_s: number;
}

/** Spend on one model. */
export interface ModelCost {
  model: string;
  calls: number;
  cost_usd: number;
}

/** `GET /api/costs` response: what the AI calls cost so far. */
export interface CostReport {
  total_usd: number;
  by_model: ModelCost[];
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
