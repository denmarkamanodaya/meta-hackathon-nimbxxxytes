// Typed client for the nimbytes API over an `ApiTransport` (fetch in the PWA, Tauri invoke in the
// Mac app), so JSON bodies, the { error: { code, message } } envelope and the 401 lock live in one
// place whatever carries the request.
import type { ApiTransport } from '../../core/ports/api-transport';
import { ApiError } from './api-error';
import { errorFromBody, readJson } from './read-answer';
import { streamSearch } from './search-stream';
import { createFetchTransport } from './fetch-transport';
import { parseClipDetail } from './parse-clip-detail';
import { parsePeopleOverview, parseShortList, parseStorage } from './parse-overview';
import { parsePeople, parseSearch, parseSpeakerAnswer, parseTrackAnswer } from './parse-search';
import {
  parseCreateShort,
  parseDownload,
  parseRenderJob,
  parseSavedVersion,
  parseShortDetail,
} from './parse-shorts';
import {
  parseCosts,
  parseNoContent,
  parseClipList,
  parseCompleteUpload,
  parseCreateUpload,
  parseHealth,
  parsePresignParts,
  parseSession,
  parseSettings,
  parseUploadCheck,
  type Parse,
} from './parse';
import {
  type ClipDetail,
  type ClipSummary,
  type CompleteUploadResponse,
  type CompletedPart,
  type CostReport,
  type PeopleOverview,
  type ShortListItem,
  type StorageSummary,
  type CreateShortRequest,
  type ShortDetail,
  type Timeline,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type Health,
  type Person,
  type PresignPartsResponse,
  type SearchResponse,
  type SearchStage,
  type Speaker,
  type SpeakerUpdate,
  type Track,
  type TrackUpdate,
  type SessionResponse,
  type Settings,
  type UploadCheck,
  type UploadCheckRequest,
} from './types';

export { ApiError, type ClientErrorCode } from './api-error';

/** Settings the composition root passes to `createApiClient`. */
export interface ApiClientOptions {
  /** Base path or origin of the API, without a trailing slash (`/api`). */
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Fetch implementation for the default fetch transport. Tests inject a fake. */
  fetchFn?: typeof fetch;
  /** How requests travel; defaults to the fetch transport over `baseUrl`, `timeoutMs`, `fetchFn`. */
  transport?: ApiTransport;
  /** Called on every 401 before the call rejects, so the app can ask for the passcode. */
  onUnauthorized?: () => void;
}

/** Typed calls to the nimbytes API. Every method rejects with `ApiError` on failure. */
export interface ApiClient {
  /** `GET /health`. */
  getHealth(signal?: AbortSignal): Promise<Health>;
  /** `POST /session` with the demo passcode; the server sets the session cookie. */
  createSession(passcode: string): Promise<SessionResponse>;
  /** `GET /session`: resolves while the session cookie is valid; a 401 means locked. */
  getSession(signal?: AbortSignal): Promise<SessionResponse>;
  /** `POST /session/logout`: the server clears the session cookie (204). */
  signOut(): Promise<true>;
  /** `GET /costs`: what the AI calls cost so far. */
  getCosts(signal?: AbortSignal): Promise<CostReport>;
  /** `GET /storage`: library size in the cloud and on the phone, by tier. */
  getStorage(signal?: AbortSignal): Promise<StorageSummary>;
  /** `GET /people/overview`: named people, faces to name, hidden bystanders. */
  getPeopleOverview(signal?: AbortSignal): Promise<PeopleOverview>;
  /** `GET /shorts`: every short, newest first. */
  listShorts(signal?: AbortSignal): Promise<ShortListItem[]>;
  /** `POST /uploads/check`: is a file with this name and size already in the library? */
  checkUpload(request: UploadCheckRequest): Promise<UploadCheck>;
  /** `POST /uploads`: registers a clip and presigns every part. */
  createUpload(request: CreateUploadRequest): Promise<CreateUploadResponse>;
  /** `POST /uploads/{id}/parts`: presigns the given part numbers again (resume, expiry). */
  presignParts(uploadId: string, partNumbers: number[]): Promise<PresignPartsResponse>;
  /** `POST /uploads/{id}/complete` with every part's ETag, ascending by `n`. */
  completeUpload(uploadId: string, parts: CompletedPart[]): Promise<CompleteUploadResponse>;
  /** `GET /clips`. */
  listClips(signal?: AbortSignal): Promise<ClipSummary[]>;
  /** `DELETE /clips/{id}` (204): removes the clip and its files. Only ever on the owner's tap. */
  deleteClip(clipId: string): Promise<true>;
  /** `GET /clips/{id}`: the clip with segments, transcript, speakers and face tracks. */
  getClip(clipId: string, signal?: AbortSignal): Promise<ClipDetail>;
  /** `POST /search`: rewritten query, ranked moments, and whether rerank ran. */
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
  /**
   * `POST /search/stream`: delivers the `local` stage, then `ranked`; falls back to `POST /search`
   * when the stream cannot deliver (rules in `search-stream.ts`). Resolves once it ended.
   */
  searchStream(query: string, onStage: (stage: SearchStage) => void, signal?: AbortSignal): Promise<void>;
  /** `GET /people?prefix=`: names for autocomplete. */
  listPeople(prefix: string, signal?: AbortSignal): Promise<Person[]>;
  /** `PUT /tracks/{id}`: name a face or hide it; resolves the updated track. */
  updateTrack(trackId: string, update: TrackUpdate): Promise<Track>;
  /** `POST /tracks/name`: names every face of a confirmed group in one call. */
  nameTracks(trackIds: string[], name: string): Promise<true>;
  /** `GET /settings`. */
  getSettings(signal?: AbortSignal): Promise<Settings>;
  /** `PUT /settings`: resolves the settings as saved. */
  updateSettings(settings: Settings): Promise<Settings>;
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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  parse: Parse<T>;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

/**
 * Builds the API client. With the default fetch transport, requests send the session cookie
 * (`credentials: 'include'`).
 * @param options - Base URL, timeout, optional transport or fetch implementation, 401 callback.
 * @returns A client whose methods resolve parsed bodies or reject with `ApiError`.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const transport =
    options.transport ??
    createFetchTransport({ baseUrl: options.baseUrl, timeoutMs: options.timeoutMs, fetchFn: options.fetchFn });

  async function request<T>({ method, path, parse, body, signal }: Call<T>): Promise<T> {
    const response = await transport.send({
      method,
      path,
      ...(body === undefined ? {} : { body: JSON.stringify(body), contentType: 'application/json' }),
      signal,
    });
    const json = readJson(response.body);
    if (response.status === 401) options.onUnauthorized?.();
    if (response.status < 200 || response.status > 299) throw errorFromBody(response.status, json);
    const parsed = parse(json);
    if (parsed === null) {
      throw new ApiError('BAD_RESPONSE', `Unexpected body from ${path}`, response.status);
    }
    return parsed;
  }

  const search: ApiClient['search'] = (query, signal) =>
    request({ method: 'POST', path: '/search', parse: parseSearch, body: { query }, signal });
  const shortPath = (shortId: string, suffix: string) =>
    `/shorts/${encodeURIComponent(shortId)}${suffix}`;
  const uploadPath = (uploadId: string, action: string) =>
    `/uploads/${encodeURIComponent(uploadId)}/${action}`;

  return {
    getHealth: (signal) => request({ method: 'GET', path: '/health', parse: parseHealth, signal }),
    createSession: (passcode) =>
      request({ method: 'POST', path: '/session', parse: parseSession, body: { passcode } }),
    getSession: (signal) => request({ method: 'GET', path: '/session', parse: parseSession, signal }),
    signOut: () => request({ method: 'POST', path: '/session/logout', parse: parseNoContent }),
    getCosts: (signal) => request({ method: 'GET', path: '/costs', parse: parseCosts, signal }),
    getStorage: (signal) => request({ method: 'GET', path: '/storage', parse: parseStorage, signal }),
    getPeopleOverview: (signal) =>
      request({ method: 'GET', path: '/people/overview', parse: parsePeopleOverview, signal }),
    listShorts: (signal) => request({ method: 'GET', path: '/shorts', parse: parseShortList, signal }),
    checkUpload: (body) =>
      request({ method: 'POST', path: '/uploads/check', parse: parseUploadCheck, body }),
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
    deleteClip: (clipId) =>
      request({ method: 'DELETE', path: `/clips/${encodeURIComponent(clipId)}`, parse: parseNoContent }),
    getClip: (clipId, signal) =>
      request({
        method: 'GET',
        path: `/clips/${encodeURIComponent(clipId)}`,
        parse: parseClipDetail,
        signal,
      }),
    search,
    searchStream: (query, onStage, signal) =>
      streamSearch({ transport, search, onUnauthorized: options.onUnauthorized }, query, onStage, signal),
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
    nameTracks: (trackIds, name) =>
      request({ method: 'POST', path: '/tracks/name', parse: parseNoContent, body: { track_ids: trackIds, name } }),
    getSettings: (signal) => request({ method: 'GET', path: '/settings', parse: parseSettings, signal }),
    updateSettings: (settings) =>
      request({ method: 'PUT', path: '/settings', parse: parseSettings, body: settings }),
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
