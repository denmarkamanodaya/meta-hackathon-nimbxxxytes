// HTTP client for the nimbytes API: the only module that calls fetch, so transport concerns
// (cookie session, JSON bodies, the { error: { code, message } } envelope) live in one place.
import { parseClipDetail } from './parse-clip-detail';
import { parsePeople, parseSearch, parseSpeakerAnswer, parseTrackAnswer } from './parse-search';
import {
  parseCreateShort,
  parseDownload,
  parseRenderJob,
  parseSavedVersion,
  parseShortDetail,
} from './parse-shorts';
import {
  parseClipList,
  parseCompleteUpload,
  parseCreateUpload,
  parseHealth,
  parsePresignParts,
  parseSession,
  type Parse,
} from './parse';
import {
  isErrorCode,
  type ClipDetail,
  type ClipSummary,
  type CompleteUploadResponse,
  type CompletedPart,
  type CreateShortRequest,
  type ShortDetail,
  type Timeline,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type ErrorCode,
  type Health,
  type Person,
  type PresignPartsResponse,
  type SearchResponse,
  type Speaker,
  type SpeakerUpdate,
  type Track,
  type TrackUpdate,
  type SessionResponse,
} from './types';

/**
 * Failures raised on the client side, not sent by the API.
 * `PART_FAILED` / `ETAG_MISSING` come from the S3 part upload (`services/upload/put-part.ts`).
 */
export type ClientErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | 'PART_FAILED'
  | 'ETAG_MISSING';

/**
 * Typed failure of an API or storage call.
 * `code` is an API `ErrorCode` when the server sent a known envelope, else a `ClientErrorCode`.
 * `status` is the HTTP status, or null when no response arrived.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  /**
   * @param code - Stable `UPPER_SNAKE` code callers switch on.
   * @param message - Human-readable detail; may change.
   * @param status - HTTP status, or null without a response.
   */
  constructor(
    readonly code: ErrorCode | ClientErrorCode,
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** Settings the composition root passes to `createApiClient`. */
export interface ApiClientOptions {
  /** Base path or origin of the API, without a trailing slash (`/api`). */
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Fetch implementation; defaults to the global `fetch`. Tests inject a fake. */
  fetchFn?: typeof fetch;
  /** Called on every 401 before the call rejects, so the app can ask for the passcode. */
  onUnauthorized?: () => void;
}

/** Typed calls to the nimbytes API. Every method rejects with `ApiError` on failure. */
export interface ApiClient {
  /** `GET /health`. */
  getHealth(signal?: AbortSignal): Promise<Health>;
  /** `POST /session` with the demo passcode; the server sets the session cookie. */
  createSession(passcode: string): Promise<SessionResponse>;
  /** `POST /uploads`: registers a clip and presigns every part. */
  createUpload(request: CreateUploadRequest): Promise<CreateUploadResponse>;
  /** `POST /uploads/{id}/parts`: presigns the given part numbers again (resume, expiry). */
  presignParts(uploadId: string, partNumbers: number[]): Promise<PresignPartsResponse>;
  /** `POST /uploads/{id}/complete` with every part's ETag, ascending by `n`. */
  completeUpload(uploadId: string, parts: CompletedPart[]): Promise<CompleteUploadResponse>;
  /** `GET /clips`. */
  listClips(signal?: AbortSignal): Promise<ClipSummary[]>;
  /** `GET /clips/{id}`: the clip with segments, transcript, speakers and face tracks. */
  getClip(clipId: string, signal?: AbortSignal): Promise<ClipDetail>;
  /** `POST /search`: rewritten query, ranked moments, and whether rerank ran. */
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
  /** `GET /people?prefix=`: names for autocomplete. */
  listPeople(prefix: string, signal?: AbortSignal): Promise<Person[]>;
  /** `PUT /tracks/{id}`: name a face or hide it; resolves the updated track. */
  updateTrack(trackId: string, update: TrackUpdate): Promise<Track>;
  /** `PUT /speakers/{id}`: rename a speaker; resolves the updated speaker. */
  updateSpeaker(speakerId: string, update: SpeakerUpdate): Promise<Speaker>;
  /** `POST /shorts`: queues the editing agent for the picked moments. */
  createShort(request: CreateShortRequest): Promise<{ short_id: string }>;
  /** `GET /shorts/{id}`: short, versions with critiques, step log and candidate segments. */
  getShort(shortId: string, signal?: AbortSignal): Promise<ShortDetail>;
  /** `PUT /shorts/{id}/timeline`: saves the user's edit as a new version. */
  saveTimeline(shortId: string, timeline: Timeline): Promise<{ version: number }>;
  /** `POST /shorts/{id}/render`: queues the final render of a version. */
  renderShort(shortId: string, versionN: number): Promise<{ job_id: string }>;
  /** `GET /shorts/{id}/download`: a presigned URL of the final render. */
  getDownload(shortId: string): Promise<{ url: string }>;
}

/** Timeline as sent on the wire: `revision` is omitted rather than null. */
function toWireTimeline(timeline: Timeline): Omit<Timeline, 'revision'> & Partial<Timeline> {
  const { revision, ...rest } = timeline;
  return revision === null ? rest : timeline;
}

interface Call<T> {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  parse: Parse<T>;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    // Recovers: a non-JSON body is reported by the caller as BAD_RESPONSE.
    return undefined;
  }
}

function errorFromBody(status: number, body: unknown): ApiError {
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return new ApiError('BAD_RESPONSE', `HTTP ${String(status)} without an error body`, status);
  }
  const code = String(error.code);
  const message = 'message' in error && typeof error.message === 'string' ? error.message : code;
  if (!isErrorCode(code)) {
    return new ApiError('BAD_RESPONSE', `Unknown error code ${code}: ${message}`, status);
  }
  return new ApiError(code, message, status);
}

function errorFromThrown(thrown: unknown, callerSignal: AbortSignal | undefined): unknown {
  if (callerSignal?.aborted === true) return thrown; // caller cancelled: rethrow as-is
  if (thrown instanceof DOMException && thrown.name === 'TimeoutError') {
    return new ApiError('TIMEOUT', 'The server took too long to answer', null);
  }
  return new ApiError('NETWORK_ERROR', 'Could not reach the server', null);
}

/**
 * Builds the API client. Requests send the session cookie (`credentials: 'include'`).
 * @param options - Base URL, timeout, optional fetch implementation and 401 callback.
 * @returns A client whose methods resolve parsed bodies or reject with `ApiError`.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));

  async function request<T>({ method, path, parse, body, signal }: Call<T>): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchFn(`${options.baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (thrown) {
      throw errorFromThrown(thrown, signal);
    }
    const json = await readJson(response);
    if (response.status === 401) options.onUnauthorized?.();
    if (!response.ok) throw errorFromBody(response.status, json);
    const parsed = parse(json);
    if (parsed === null) {
      throw new ApiError('BAD_RESPONSE', `Unexpected body from ${path}`, response.status);
    }
    return parsed;
  }

  const shortPath = (shortId: string, suffix: string) =>
    `/shorts/${encodeURIComponent(shortId)}${suffix}`;
  const uploadPath = (uploadId: string, action: string) =>
    `/uploads/${encodeURIComponent(uploadId)}/${action}`;

  return {
    getHealth: (signal) => request({ method: 'GET', path: '/health', parse: parseHealth, signal }),
    createSession: (passcode) =>
      request({ method: 'POST', path: '/session', parse: parseSession, body: { passcode } }),
    createUpload: (body) =>
      request({ method: 'POST', path: '/uploads', parse: parseCreateUpload, body }),
    presignParts: (uploadId, partNumbers) =>
      request({
        method: 'POST',
        path: uploadPath(uploadId, 'parts'),
        parse: parsePresignParts,
        body: { part_numbers: partNumbers },
      }),
    completeUpload: (uploadId, parts) =>
      request({
        method: 'POST',
        path: uploadPath(uploadId, 'complete'),
        parse: parseCompleteUpload,
        body: { parts },
      }),
    listClips: (signal) => request({ method: 'GET', path: '/clips', parse: parseClipList, signal }),
    getClip: (clipId, signal) =>
      request({
        method: 'GET',
        path: `/clips/${encodeURIComponent(clipId)}`,
        parse: parseClipDetail,
        signal,
      }),
    search: (query, signal) =>
      request({ method: 'POST', path: '/search', parse: parseSearch, body: { query }, signal }),
    listPeople: (prefix, signal) =>
      request({
        method: 'GET',
        path: `/people?prefix=${encodeURIComponent(prefix)}`,
        parse: parsePeople,
        signal,
      }),
    updateTrack: (trackId, update) =>
      request({
        method: 'PUT',
        path: `/tracks/${encodeURIComponent(trackId)}`,
        parse: parseTrackAnswer,
        body: update,
      }),
    createShort: (body) => request({ method: 'POST', path: '/shorts', parse: parseCreateShort, body }),
    getShort: (shortId, signal) =>
      request({ method: 'GET', path: shortPath(shortId, ''), parse: parseShortDetail, signal }),
    saveTimeline: (shortId, timeline) =>
      request({
        method: 'PUT',
        path: shortPath(shortId, '/timeline'),
        parse: parseSavedVersion,
        body: { timeline: toWireTimeline(timeline) },
      }),
    renderShort: (shortId, versionN) =>
      request({
        method: 'POST',
        path: shortPath(shortId, '/render'),
        parse: parseRenderJob,
        body: { version_n: versionN },
      }),
    getDownload: (shortId) =>
      request({ method: 'GET', path: shortPath(shortId, '/download'), parse: parseDownload }),
    updateSpeaker: (speakerId, update) =>
      request({
        method: 'PUT',
        path: `/speakers/${encodeURIComponent(speakerId)}`,
        parse: parseSpeakerAnswer,
        body: update,
      }),
  };
}
