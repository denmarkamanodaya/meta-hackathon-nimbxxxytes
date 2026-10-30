// Typed client for the nimbytes API over an `ApiTransport` (fetch in the PWA, Tauri invoke in the
// Mac app), so JSON bodies, the { error: { code, message } } envelope and the 401 lock live in one
// place whatever carries the request.
import type { ApiTransport } from '../../core/ports/api-transport';
import { ApiError } from './api-error';
import { errorFromBody, readJson } from './read-answer';
import { streamSearch } from './search-stream';
import { createFetchTransport } from './fetch-transport';
import { parseIntent, parseTranscribe } from './parse-ask';
import { parseClipDetail } from './parse-clip-detail';
import { parseGuide, parseGuideList, parseGuideStep, parseStartGuide } from './parse-guides';
import {
  parseCompleteDocument,
  parseCreateDocument,
  parseDocument,
  parseDocumentAnswer,
  parseDocumentList,
  parseDocumentPart,
} from './parse-documents';
import { parseListen, parseListenList, parseListenStarted } from './parse-listens';
import { parsePhoto, parsePhotoList, parsePhotoStarted } from './parse-photos';
import { parseCutout, parseFind, parseReframe } from './parse-sam';
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
  parseExports,
  parseFinish,
  parseStarted,
} from './parse-studio';
import {
  parseCosts,
  parseKeep,
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
  type ProjectItemRef,
  type UpdateProjectRequest,
  type BrandKit,
  type BrandResponse,
  type BrandUploadRequest,
  type BrandUploadResponse,
  type EditExportRequest,
  type ExportsResponse,
  type CoverChipStyle,
  type CutoutBackground,
  type CutoutResponse,
  type FindResponse,
  type FramePoint,
  type MoreCoversRequest,
  type ReframeResponse,
  type Platform,
  type SaveBrandRequest,
  type ShortFinish,
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
  type KeepResponse,
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
  type Guide,
  type GuideStep,
  type GuideStepEdit,
  type GuideSummary,
  type RenameGuideRequest,
  type StartGuideResponse,
  type IntentAnswer,
  type IntentRequest,
  type TranscribeResponse,
  type AskDocumentRequest,
  type CompleteDocumentResponse,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type DocumentAnswer,
  type DocumentDetail,
  type DocumentPart,
  type DocumentSummary,
  type RenameDocumentRequest,
  type SpeakDocumentRequest,
  type ChangeListenLanguage,
  type CompleteListenResponse,
  type CreateListenRequest,
  type CreateListenResponse,
  type ListenDetail,
  type ListenSummary,
  type RenameListen,
  type CreatePhotoRequest,
  type CreatePhotoResponse,
  type PhotoDetail,
  type PhotoQueued,
  type PhotoSummary,
  type RenamePhoto,
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
  /** `POST /projects/{id}/items` (204, idempotent): recordings, documents and photos. */
  addProjectItems(projectId: string, items: ProjectItemRef[]): Promise<true>;
  /** `DELETE /projects/{id}/items/{kind}/{item_id}` (204). */
  removeProjectItem(projectId: string, item: ProjectItemRef): Promise<true>;
  /** `DELETE /clips/{id}` (204): removes the clip and its files. Only ever on the owner's tap. */
  deleteClip(clipId: string): Promise<true>;
  /**
   * `POST /clips/{id}/keep` (202), Keep both: a near-copy becomes a normal clip and its ingest
   * resumes. `VALIDATION_FAILED` when the clip is not a near-copy.
   */
  keepClip(clipId: string): Promise<KeepResponse>;
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
  /**
   * `POST /shorts/{id}/exports/{platform}/covers` (202): 3 more covers, in `style` when given; with
   * `style: 'cutout'`, one cutout cover over `background`.
   */
  moreCovers(shortId: string, platform: Platform, style?: CoverChipStyle, background?: CutoutBackground): Promise<StartedResponse>;
  /** `POST /clips/{id}/find` (synchronous, up to 90 s): the object at the point, followed and found elsewhere. */
  findThis(clipId: string, point: FramePoint): Promise<FindResponse>;
  /** `POST /clips/{id}/cutout`: the object at the point as a transparent PNG and a sticker. */
  cutOut(clipId: string, point: FramePoint): Promise<CutoutResponse>;
  /** `GET /shorts/{id}/reframe`: how far subject tracking for 9:16 got. */
  getReframe(shortId: string, signal?: AbortSignal): Promise<ReframeResponse>;
  /** `POST /shorts/{id}/reframe` (202): tracks each shot's subject in the background. */
  startReframe(shortId: string): Promise<StartedResponse>;
  /**
   * Changes what one shot follows. Today this is a timeline edit (`PUT /shorts/{id}/timeline` with
   * that clip's `subject` changed), which saves a new version; kept as its own call so a dedicated
   * subject endpoint can replace it here alone.
   */
  setShotSubject(shortId: string, timeline: Timeline, clipIndex: number, subject: string): Promise<{ version: number }>;
  /** `POST /shorts/{id}/exports/{platform}/covers/{n}/redraw` (202): one new cover from cover `n`. */
  redrawCover(shortId: string, platform: Platform, coverIndex: number, instruction: string): Promise<StartedResponse>;
  /** `POST /projects/{id}/art` (202): draws new key art. */
  newProjectArt(projectId: string): Promise<StartedResponse>;
  /** `POST /clips/{id}/guide` (202): starts a MyWay guide from the clip; the same guide on a second call. */
  startGuide(clipId: string): Promise<StartGuideResponse>;
  /** `GET /guides`: every guide, newest first. */
  listGuides(signal?: AbortSignal): Promise<GuideSummary[]>;
  /** `GET /guides/{id}`: the guide with its steps. */
  getGuide(guideId: string, signal?: AbortSignal): Promise<Guide>;
  /** `PATCH /guides/{id}/steps/{n}`: new title or instruction; resolves the step (its voice remade). */
  editGuideStep(guideId: string, n: number, edit: GuideStepEdit): Promise<GuideStep>;
  /** `PATCH /guides/{id}`: a new title; resolves the whole guide. */
  renameGuide(guideId: string, title: string): Promise<Guide>;
  /** `DELETE /guides/{id}` (204). Only on the owner's tap. */
  deleteGuide(guideId: string): Promise<true>;
  /**
   * `POST /transcribe` with the voice note as the raw body and its media type (parameters such as
   * `;codecs=opus` dropped): what was said.
   */
  transcribe(audio: Blob): Promise<TranscribeResponse>;
  /** `POST /intents`: what the Ask box's request asks for, read by Muse Spark. */
  readIntent(request: IntentRequest): Promise<IntentAnswer>;
  /** `POST /documents`: registers an iRead document (its file follows through `sendDocumentSource`). */
  createDocument(request: CreateDocumentRequest): Promise<CreateDocumentResponse>;
  /**
   * `PUT /documents/{id}/source` (202, idempotent once read): the file itself as the raw body with
   * its type; the server stores it and Muse Spark reads it. Every platform sends the file this
   * way, so no app origin needs storage CORS (the Mac webview's is not allowed there).
   */
  sendDocumentSource(documentId: string, file: Blob): Promise<CompleteDocumentResponse>;
  /** `GET /documents`: every document, newest first. */
  listDocuments(signal?: AbortSignal): Promise<DocumentSummary[]>;
  /** `GET /documents/{id}`: the document with its pages, text and summary. */
  getDocument(documentId: string, signal?: AbortSignal): Promise<DocumentDetail>;
  /** `PATCH /documents/{id}`: a new title; resolves the whole document. */
  renameDocument(documentId: string, title: string): Promise<DocumentDetail>;
  /** `DELETE /documents/{id}` (204): the document, its pages and voice. Only on the owner's tap. */
  deleteDocument(documentId: string): Promise<true>;
  /** `POST /documents/{id}/ask`: Muse Spark answers from the page, and the answer is spoken. */
  askDocument(documentId: string, question: string): Promise<DocumentAnswer>;
  /** `POST /documents/{id}/speak`: one part (0-based) of the full text, spoken. */
  speakDocument(documentId: string, part: number): Promise<DocumentPart>;
  /** `POST /listens`: registers an iListen recording, from a file (its bytes follow) or a clip. */
  createListen(request: CreateListenRequest): Promise<CreateListenResponse>;
  /**
   * `PUT /listens/{id}/source` (202, `listening`): the audio or video file itself as the raw body
   * with its type; the server stores it and starts the listen job (no `complete` needed after it).
   */
  sendListenSource(listenId: string, file: Blob): Promise<CompleteListenResponse>;
  /** `POST /listens/{id}/complete` (202, empty body): starts the job; idempotent after the source PUT. */
  completeListen(listenId: string): Promise<CompleteListenResponse>;
  /** `GET /listens`: every listen, newest first. */
  listListens(signal?: AbortSignal): Promise<ListenSummary[]>;
  /** `GET /listens/{id}`: the listen with its lines and versions. */
  getListen(listenId: string, signal?: AbortSignal): Promise<ListenDetail>;
  /** `PATCH /listens/{id}`: a new title; resolves the whole listen. */
  renameListen(listenId: string, title: string): Promise<ListenDetail>;
  /** `DELETE /listens/{id}` (204). Only on the owner's tap. */
  deleteListen(listenId: string): Promise<true>;
  /** `POST /listens/{id}/language`: a new output language; understand, check and voice run again. */
  changeListenLanguage(listenId: string, target: string): Promise<ListenDetail>;
  /** `POST /photos`: registers a photo (its file follows through `sendPhotoSource`). */
  createPhoto(request: CreatePhotoRequest): Promise<CreatePhotoResponse>;
  /** `PUT /photos/{id}/source` (202, `analysing`): the image itself as the raw body; analysis is queued. */
  sendPhotoSource(photoId: string, file: Blob): Promise<PhotoQueued>;
  /** `GET /photos`: every photo, newest first. */
  listPhotos(signal?: AbortSignal): Promise<PhotoSummary[]>;
  /** `GET /photos/{id}`: the photo with what is in it. */
  getPhoto(photoId: string, signal?: AbortSignal): Promise<PhotoDetail>;
  /** `PATCH /photos/{id}`: a new title; resolves the whole photo. */
  renamePhoto(photoId: string, title: string): Promise<PhotoDetail>;
  /** `DELETE /photos/{id}` (204). Only on the owner's tap. */
  deletePhoto(photoId: string): Promise<true>;
}

/**
 * A voice note's media type without parameters (`audio/webm;codecs=opus` → `audio/webm`), the form
 * `POST /transcribe` accepts.
 * @param type - The blob's type.
 * @returns The bare media type.
 */
export const audioType = (type: string): string => type.split(';')[0]?.trim().toLowerCase() ?? '';

/**
 * Find this and Cut out answer synchronously. The server gives up at 50 s with MODEL_UNAVAILABLE;
 * 55 s waits for that answer and stays under the Mac app's 60 s native read timeout.
 */
export const SAM_TIMEOUT_MS = 55_000;

/** Transcribe runs a model on up to 60 s of audio; it answers well inside this, ms. */
export const TRANSCRIBE_TIMEOUT_MS = 45_000;

/** Reading an intent is one Muse Spark call; it answers well inside this, ms. */
export const INTENT_TIMEOUT_MS = 30_000;

/** An answer is one Muse Spark call plus a voice for each sentence; it answers well inside this, ms. */
export const DOCUMENT_ASK_TIMEOUT_MS = 45_000;

/**
 * Sending a letter's file (at most 20 MB) up to the server, ms; under the Mac app's 120 s native
 * call limit.
 */
export const DOCUMENT_SOURCE_TIMEOUT_MS = 110_000;

/** One spoken part of a letter (about 400 characters), ms. */
export const DOCUMENT_SPEAK_TIMEOUT_MS = 30_000;

/**
 * Sending a recording (at most 300 MB) up to the server, ms: 300 MB over a slow 3 Mbit/s uplink
 * takes about 14 minutes.
 */
export const LISTEN_SOURCE_TIMEOUT_MS = 15 * 60_000;

/** Sending a photo (at most 40 MB) up to the server, ms; under the Mac app's 120 s native call limit. */
export const PHOTO_SOURCE_TIMEOUT_MS = 110_000;

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
  /** A binary body, sent with its own media type, in place of `body`. */
  bytes?: Blob;
  signal?: AbortSignal | undefined;
  /** A longer timeout for a slow synchronous call, ms. */
  timeoutMs?: number;
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

  async function request<T>({ method, path, parse, body, bytes, signal, timeoutMs }: Call<T>): Promise<T> {
    const response = await transport.send({
      method,
      path,
      ...(body === undefined ? {} : { body: JSON.stringify(body), contentType: 'application/json' }),
      ...(bytes === undefined ? {} : { bytes, contentType: audioType(bytes.type) }),
      signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
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
  const exportPath = (shortId: string, platform: Platform, suffix: string) =>
    shortPath(shortId, `/exports/${encodeURIComponent(platform)}${suffix}`);
  const projectPath = (projectId: string, suffix: string) =>
    `/projects/${encodeURIComponent(projectId)}${suffix}`;
  const guidePath = (guideId: string, suffix: string) => `/guides/${encodeURIComponent(guideId)}${suffix}`;
  const documentPath = (documentId: string, suffix: string) => `/documents/${encodeURIComponent(documentId)}${suffix}`;
  const listenPath = (listenId: string, suffix: string) => `/listens/${encodeURIComponent(listenId)}${suffix}`;
  const photoPath = (photoId: string, suffix: string) => `/photos/${encodeURIComponent(photoId)}${suffix}`;
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
    addProjectItems: (projectId, items) =>
      request({ method: 'POST', path: projectPath(projectId, '/items'), parse: parseNoContent, body: { items } }),
    removeProjectItem: (projectId, item) =>
      request({
        method: 'DELETE',
        path: projectPath(projectId, `/items/${item.kind}/${encodeURIComponent(item.id)}`),
        parse: parseNoContent,
      }),
    deleteClip: (clipId) =>
      request({ method: 'DELETE', path: `/clips/${encodeURIComponent(clipId)}`, parse: parseNoContent }),
    keepClip: (clipId) =>
      request({ method: 'POST', path: `/clips/${encodeURIComponent(clipId)}/keep`, parse: parseKeep }),
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
    moreCovers: (shortId, platform, style, background) => {
      const body: MoreCoversRequest | undefined =
        style === undefined ? undefined : { style, ...(background === undefined ? {} : { background }) };
      return request({
        method: 'POST',
        path: exportPath(shortId, platform, '/covers'),
        parse: parseStarted,
        ...(body === undefined ? {} : { body }),
      });
    },
    findThis: (clipId, point) =>
      request({ method: 'POST', path: `/clips/${encodeURIComponent(clipId)}/find`, parse: parseFind, body: point, timeoutMs: SAM_TIMEOUT_MS }),
    cutOut: (clipId, point) =>
      request({ method: 'POST', path: `/clips/${encodeURIComponent(clipId)}/cutout`, parse: parseCutout, body: point, timeoutMs: SAM_TIMEOUT_MS }),
    getReframe: (shortId, signal) =>
      request({ method: 'GET', path: shortPath(shortId, '/reframe'), parse: parseReframe, signal }),
    startReframe: (shortId) => request({ method: 'POST', path: shortPath(shortId, '/reframe'), parse: parseStarted }),
    setShotSubject: (shortId, timeline, clipIndex, subject) => {
      const clips = timeline.clips.map((clip, index) => (index === clipIndex ? { ...clip, subject } : clip));
      return request({
        method: 'PUT',
        path: shortPath(shortId, '/timeline'),
        parse: parseSavedVersion,
        body: { timeline: toWireTimeline({ ...timeline, clips }) },
      });
    },
    redrawCover: (shortId, platform, coverIndex, instruction) =>
      request({
        method: 'POST',
        path: exportPath(shortId, platform, `/covers/${String(coverIndex)}/redraw`),
        parse: parseStarted,
        body: { instruction },
      }),
    newProjectArt: (projectId) =>
      request({ method: 'POST', path: projectPath(projectId, '/art'), parse: parseStarted }),
    startGuide: (clipId) =>
      request({ method: 'POST', path: `/clips/${encodeURIComponent(clipId)}/guide`, parse: parseStartGuide }),
    listGuides: (signal) => request({ method: 'GET', path: '/guides', parse: parseGuideList, signal }),
    getGuide: (guideId, signal) => request({ method: 'GET', path: guidePath(guideId, ''), parse: parseGuide, signal }),
    editGuideStep: (guideId, n, body) =>
      request({ method: 'PATCH', path: guidePath(guideId, `/steps/${String(n)}`), parse: parseGuideStep, body }),
    renameGuide: (guideId, title) => {
      const body: RenameGuideRequest = { title };
      return request({ method: 'PATCH', path: guidePath(guideId, ''), parse: parseGuide, body });
    },
    deleteGuide: (guideId) => request({ method: 'DELETE', path: guidePath(guideId, ''), parse: parseNoContent }),
    transcribe: (audio) =>
      request({ method: 'POST', path: '/transcribe', parse: parseTranscribe, bytes: audio, timeoutMs: TRANSCRIBE_TIMEOUT_MS }),
    readIntent: (body) =>
      request({ method: 'POST', path: '/intents', parse: parseIntent, body, timeoutMs: INTENT_TIMEOUT_MS }),
    createDocument: (body) => request({ method: 'POST', path: '/documents', parse: parseCreateDocument, body }),
    sendDocumentSource: (documentId, file) =>
      request({
        method: 'PUT',
        path: documentPath(documentId, '/source'),
        parse: parseCompleteDocument,
        bytes: file,
        timeoutMs: DOCUMENT_SOURCE_TIMEOUT_MS,
      }),
    listDocuments: (signal) => request({ method: 'GET', path: '/documents', parse: parseDocumentList, signal }),
    getDocument: (documentId, signal) =>
      request({ method: 'GET', path: documentPath(documentId, ''), parse: parseDocument, signal }),
    renameDocument: (documentId, title) => {
      const body: RenameDocumentRequest = { title };
      return request({ method: 'PATCH', path: documentPath(documentId, ''), parse: parseDocument, body });
    },
    deleteDocument: (documentId) => request({ method: 'DELETE', path: documentPath(documentId, ''), parse: parseNoContent }),
    askDocument: (documentId, question) => {
      const body: AskDocumentRequest = { question };
      return request({ method: 'POST', path: documentPath(documentId, '/ask'), parse: parseDocumentAnswer, body, timeoutMs: DOCUMENT_ASK_TIMEOUT_MS });
    },
    speakDocument: (documentId, part) => {
      const body: SpeakDocumentRequest = { part };
      return request({ method: 'POST', path: documentPath(documentId, '/speak'), parse: parseDocumentPart, body, timeoutMs: DOCUMENT_SPEAK_TIMEOUT_MS });
    },
    createListen: (body) => request({ method: 'POST', path: '/listens', parse: parseListenStarted, body }),
    sendListenSource: (listenId, file) =>
      request({ method: 'PUT', path: listenPath(listenId, '/source'), parse: parseListenStarted, bytes: file, timeoutMs: LISTEN_SOURCE_TIMEOUT_MS }),
    completeListen: (listenId) => request({ method: 'POST', path: listenPath(listenId, '/complete'), parse: parseListenStarted }),
    listListens: (signal) => request({ method: 'GET', path: '/listens', parse: parseListenList, signal }),
    getListen: (listenId, signal) => request({ method: 'GET', path: listenPath(listenId, ''), parse: parseListen, signal }),
    renameListen: (listenId, title) => {
      const body: RenameListen = { title };
      return request({ method: 'PATCH', path: listenPath(listenId, ''), parse: parseListen, body });
    },
    deleteListen: (listenId) => request({ method: 'DELETE', path: listenPath(listenId, ''), parse: parseNoContent }),
    changeListenLanguage: (listenId, target) => {
      const body: ChangeListenLanguage = { target };
      return request({ method: 'POST', path: listenPath(listenId, '/language'), parse: parseListen, body });
    },
    createPhoto: (body) => request({ method: 'POST', path: '/photos', parse: parsePhotoStarted, body }),
    sendPhotoSource: (photoId, file) =>
      request({ method: 'PUT', path: photoPath(photoId, '/source'), parse: parsePhotoStarted, bytes: file, timeoutMs: PHOTO_SOURCE_TIMEOUT_MS }),
    listPhotos: (signal) => request({ method: 'GET', path: '/photos', parse: parsePhotoList, signal }),
    getPhoto: (photoId, signal) => request({ method: 'GET', path: photoPath(photoId, ''), parse: parsePhoto, signal }),
    renamePhoto: (photoId, title) => {
      const body: RenamePhoto = { title };
      return request({ method: 'PATCH', path: photoPath(photoId, ''), parse: parsePhoto, body });
    },
    deletePhoto: (photoId) => request({ method: 'DELETE', path: photoPath(photoId, ''), parse: parseNoContent }),
    updateSpeaker: (speakerId, update) =>
      request({
        method: 'PUT',
        path: `/speakers/${encodeURIComponent(speakerId)}`,
        parse: parseSpeakerAnswer,
        body: update,
      }),
  };
}
