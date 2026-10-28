// Typed client for the nimbytes API over an `ApiTransport` (fetch in the PWA, Tauri invoke in the
// Mac app), so JSON bodies, the { error: { code, message } } envelope and the 401 lock live in one
// place whatever carries the request.
import type { ApiTransport } from '../../core/ports/api-transport';
import { ApiError } from './api-error';
import { errorFromBody, readJson } from './read-answer';
import { streamSearch } from './search-stream';
import { createFetchTransport } from './fetch-transport';
import { parseClipDetail } from './parse-clip-detail';
import { parseProject, parseProjectList } from './parse-projects';
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
  parseBrand,
  parseBrandKit,
  parseBrandUpload,
  parseCreateProduction,
  parseCut,
  parseExports,
  parseFinish,
  parseProductionDetail,
  parseProductionList,
  parseShortProduction,
  parseStarted,
} from './parse-studio';
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
  type CreateProjectRequest,
  type Project,
  type UpdateProjectRequest,
  type BrandKit,
  type BrandResponse,
  type BrandUploadRequest,
  type BrandUploadResponse,
  type CreateProductionRequest,
  type EditExportRequest,
  type ExportsResponse,
  type PickableCoverStyle,
  type Platform,
  type ProductionDetail,
  type ProductionListItem,
  type SaveBrandRequest,
  type ShortFinish,
  type ShortProduction,
  type StartedResponse,
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
  /** `GET /storage`: library size in the cloud and on the phone. */
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
  /** `GET /clips?project={id}`: the clips in one project. */
  listProjectClips(projectId: string, signal?: AbortSignal): Promise<ClipSummary[]>;
  /** `GET /projects`: every project, newest first. */
  listProjects(signal?: AbortSignal): Promise<Project[]>;
  /** `POST /projects`: a new project, with the given clips in it. */
  createProject(request: CreateProjectRequest): Promise<Project>;
  /** `PATCH /projects/{id}`: rename or recolour. */
  updateProject(projectId: string, update: UpdateProjectRequest): Promise<Project>;
  /** `DELETE /projects/{id}` (204). The clips stay in the Gallery. */
  deleteProject(projectId: string): Promise<true>;
  /** `POST /projects/{id}/clips` (idempotent): resolves the updated project. */
  addProjectClips(projectId: string, clipIds: string[]): Promise<Project>;
  /** `DELETE /projects/{id}/clips/{clip_id}` (204). */
  removeProjectClip(projectId: string, clipId: string): Promise<true>;
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
  /** `DELETE /shorts/{id}` (204): removes the short, its drafts and render. Only on the owner's tap. */
  deleteShort(shortId: string): Promise<true>;
  /** `GET /shorts/{id}/download`: a presigned URL of the final render. */
  getDownload(shortId: string): Promise<{ url: string }>;
  /** `GET /productions`: every production, newest first, with coverage counts. */
  listProductions(signal?: AbortSignal): Promise<ProductionListItem[]>;
  /** `POST /productions`: stores the production and starts planning it (watch its events). */
  createProduction(request: CreateProductionRequest): Promise<{ production_id: string }>;
  /** `GET /productions/{id}`: the production with its shots, frames and matched moments. */
  getProduction(productionId: string, signal?: AbortSignal): Promise<ProductionDetail>;
  /** `POST /productions/{id}/coverage` (202): rechecks coverage, at most once a minute. */
  recheckCoverage(productionId: string): Promise<StartedResponse>;
  /** `POST /productions/{id}/retry` (202): resumes a failed plan. */
  retryProduction(productionId: string): Promise<StartedResponse>;
  /** `POST /productions/{id}/cut`: the story short (the same one on a second call). */
  cutProduction(productionId: string): Promise<{ short_id: string }>;
  /** `DELETE /productions/{id}` (204). Only on the owner's tap. */
  deleteProduction(productionId: string): Promise<true>;
  /** `GET /shorts/{id}/production`: the production a story short was cut from (404 for others). */
  getShortProduction(shortId: string, signal?: AbortSignal): Promise<ShortProduction>;
  /** `GET /shorts/{id}/finish`: the saved finish, or the defaults. */
  getFinish(shortId: string, signal?: AbortSignal): Promise<ShortFinish>;
  /** `PUT /shorts/{id}/finish`: resolves the finish as saved. */
  saveFinish(shortId: string, finish: ShortFinish): Promise<ShortFinish>;
  /** `GET /brand`: the brand kit, or `kit: null` before one is saved. */
  getBrand(signal?: AbortSignal): Promise<BrandResponse>;
  /** `PUT /brand`: resolves the kit as saved, with signed images. */
  saveBrand(request: SaveBrandRequest): Promise<BrandKit>;
  /** `POST /brand/uploads`: a presigned PUT for a logo or a style reference. */
  createBrandUpload(request: BrandUploadRequest): Promise<BrandUploadResponse>;
  /** `POST /shorts/{id}/exports` (202): captions, covers and renders, in the background. */
  createExports(shortId: string, platforms: Platform[]): Promise<StartedResponse>;
  /** `GET /shorts/{id}/exports`: every platform's export with signed video and covers. */
  listExports(shortId: string, signal?: AbortSignal): Promise<ExportsResponse>;
  /** `PUT /shorts/{id}/exports/{platform}` (204): caption, hashtags or cover pick. */
  editExport(shortId: string, platform: Platform, edit: EditExportRequest): Promise<true>;
  /** `POST /shorts/{id}/exports/{platform}/covers` (202): 3 more covers, in `style` when given. */
  moreCovers(shortId: string, platform: Platform, style?: PickableCoverStyle): Promise<StartedResponse>;
  /** `POST /shorts/{id}/exports/{platform}/covers/{n}/redraw` (202): one new cover from cover `n`. */
  redrawCover(shortId: string, platform: Platform, coverIndex: number, instruction: string): Promise<StartedResponse>;
  /** `POST /productions/{id}/shots/{shot_id}/board` (202): redraws a covered shot's board from footage. */
  redrawShotBoard(productionId: string, shotId: string): Promise<StartedResponse>;
  /** `POST /productions/{id}/art` (202): draws new key art. */
  newProductionArt(productionId: string): Promise<StartedResponse>;
  /** `POST /productions/{id}/art/cover`: adds the key art as a cover to every export of its story. */
  useArtAsCover(productionId: string): Promise<StartedResponse>;
  /** `POST /projects/{id}/art` (202): draws new key art. */
  newProjectArt(projectId: string): Promise<StartedResponse>;
}

/** Timeline as sent on the wire: `revision` is omitted rather than null. */
function toWireTimeline(timeline: Timeline): Omit<Timeline, 'revision'> & Partial<Timeline> {
  const { revision, ...rest } = timeline;
  return revision === null ? rest : timeline;
}

interface Call<T> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
  const productionPath = (productionId: string, suffix: string) =>
    `/productions/${encodeURIComponent(productionId)}${suffix}`;
  const exportPath = (shortId: string, platform: Platform, suffix: string) =>
    shortPath(shortId, `/exports/${encodeURIComponent(platform)}${suffix}`);
  const projectPath = (projectId: string, suffix: string) =>
    `/projects/${encodeURIComponent(projectId)}${suffix}`;
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
    listProjectClips: (projectId, signal) =>
      request({ method: 'GET', path: `/clips?project=${encodeURIComponent(projectId)}`, parse: parseClipList, signal }),
    listProjects: (signal) => request({ method: 'GET', path: '/projects', parse: parseProjectList, signal }),
    createProject: (body) => request({ method: 'POST', path: '/projects', parse: parseProject, body }),
    updateProject: (projectId, body) =>
      request({ method: 'PATCH', path: projectPath(projectId, ''), parse: parseProject, body }),
    deleteProject: (projectId) =>
      request({ method: 'DELETE', path: projectPath(projectId, ''), parse: parseNoContent }),
    addProjectClips: (projectId, clipIds) =>
      request({ method: 'POST', path: projectPath(projectId, '/clips'), parse: parseProject, body: { clip_ids: clipIds } }),
    removeProjectClip: (projectId, clipId) =>
      request({
        method: 'DELETE',
        path: projectPath(projectId, `/clips/${encodeURIComponent(clipId)}`),
        parse: parseNoContent,
      }),
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
    deleteShort: (shortId) => request({ method: 'DELETE', path: shortPath(shortId, ''), parse: parseNoContent }),
    getDownload: (shortId) =>
      request({ method: 'GET', path: shortPath(shortId, '/download'), parse: parseDownload }),
    listProductions: (signal) =>
      request({ method: 'GET', path: '/productions', parse: parseProductionList, signal }),
    createProduction: (body) =>
      request({ method: 'POST', path: '/productions', parse: parseCreateProduction, body }),
    getProduction: (productionId, signal) =>
      request({ method: 'GET', path: productionPath(productionId, ''), parse: parseProductionDetail, signal }),
    recheckCoverage: (productionId) =>
      request({ method: 'POST', path: productionPath(productionId, '/coverage'), parse: parseStarted }),
    retryProduction: (productionId) =>
      request({ method: 'POST', path: productionPath(productionId, '/retry'), parse: parseStarted }),
    cutProduction: (productionId) =>
      request({ method: 'POST', path: productionPath(productionId, '/cut'), parse: parseCut }),
    deleteProduction: (productionId) =>
      request({ method: 'DELETE', path: productionPath(productionId, ''), parse: parseNoContent }),
    getShortProduction: (shortId, signal) =>
      request({ method: 'GET', path: shortPath(shortId, '/production'), parse: parseShortProduction, signal }),
    getFinish: (shortId, signal) =>
      request({ method: 'GET', path: shortPath(shortId, '/finish'), parse: parseFinish, signal }),
    saveFinish: (shortId, finish) =>
      request({ method: 'PUT', path: shortPath(shortId, '/finish'), parse: parseFinish, body: finish }),
    getBrand: (signal) => request({ method: 'GET', path: '/brand', parse: parseBrand, signal }),
    saveBrand: (body) => request({ method: 'PUT', path: '/brand', parse: parseBrandKit, body }),
    createBrandUpload: (body) =>
      request({ method: 'POST', path: '/brand/uploads', parse: parseBrandUpload, body }),
    createExports: (shortId, platforms) =>
      request({ method: 'POST', path: shortPath(shortId, '/exports'), parse: parseStarted, body: { platforms } }),
    listExports: (shortId, signal) =>
      request({ method: 'GET', path: shortPath(shortId, '/exports'), parse: parseExports, signal }),
    editExport: (shortId, platform, body) =>
      request({ method: 'PUT', path: exportPath(shortId, platform, ''), parse: parseNoContent, body }),
    moreCovers: (shortId, platform, style) =>
      request({
        method: 'POST',
        path: exportPath(shortId, platform, '/covers'),
        parse: parseStarted,
        ...(style === undefined ? {} : { body: { style } }),
      }),
    redrawCover: (shortId, platform, coverIndex, instruction) =>
      request({
        method: 'POST',
        path: exportPath(shortId, platform, `/covers/${String(coverIndex)}/redraw`),
        parse: parseStarted,
        body: { instruction },
      }),
    redrawShotBoard: (productionId, shotId) =>
      request({
        method: 'POST',
        path: productionPath(productionId, `/shots/${encodeURIComponent(shotId)}/board`),
        parse: parseStarted,
      }),
    newProductionArt: (productionId) =>
      request({ method: 'POST', path: productionPath(productionId, '/art'), parse: parseStarted }),
    useArtAsCover: (productionId) =>
      request({ method: 'POST', path: productionPath(productionId, '/art/cover'), parse: parseStarted }),
    newProjectArt: (projectId) =>
      request({ method: 'POST', path: projectPath(projectId, '/art'), parse: parseStarted }),
    updateSpeaker: (speakerId, update) =>
      request({
        method: 'PUT',
        path: `/speakers/${encodeURIComponent(speakerId)}`,
        parse: parseSpeakerAnswer,
        body: update,
      }),
  };
}
