// Mock API for `npm run dev:mock`: answers every /api route from the fixtures, with a little
// state (session, uploads, names, saved versions, a replayed agent run) so each screen can be
// seen and used without the backend. Pure request → reply; the Vite plugin does the IO.
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList, parseCosts } from '../../services/api/parse';
import { parsePeople, parseSearch } from '../../services/api/parse-search';
import { parseShortDetail, parseTimeline } from '../../services/api/parse-shorts';
import { PIPELINE_STEPS, type ClipDetail, type ClipSummary, type ShortDetail, type ShortVersion } from '../../services/api/types';
import clipDetailJson from '../fixtures/clip-detail.json';
import clipsJson from '../fixtures/clips.json';
import costsJson from '../fixtures/costs.json';
import peopleJson from '../fixtures/people.json';
import searchJson from '../fixtures/search.json';
import shortJson from '../fixtures/short.json';
import { faceCrop, sceneThumb } from './thumbs';
import { shortAt, stepSchedule, type ScheduledEvent } from './short-replay';

/** A request as the plugin hands it over; `path` is after `/api`. */
export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

/** What the plugin should send back. */
export type MockReply =
  | { kind: 'json'; status: number; body: unknown; delayMs: number }
  | { kind: 'empty'; status: number }
  | { kind: 'sse'; events: ScheduledEvent[]; loopMs: number | null };

/** Time between replayed agent steps, ms. */
export const SHORT_STEP_MS = 700;
/** Time between ingest step events for a processing clip, ms. */
export const CLIP_STEP_MS = 1500;
/** Part size the mock upload hands out, bytes (8 MiB, like the API). */
export const MOCK_PART_SIZE = 8 * 1024 * 1024;

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}

const json = (body: unknown, delayMs = 250, status = 200): MockReply => ({ kind: 'json', status, body, delayMs });
const fail = (status: number, code: string, message: string): MockReply =>
  json({ error: { code, message } }, 150, status);

const withClipThumb = (clip: ClipSummary): ClipSummary =>
  clip.status === 'ready' ? { ...clip, thumb_url: sceneThumb(clip.clip_id) } : clip;

function withDetailImages(detail: ClipDetail): ClipDetail {
  return {
    ...detail,
    clip: withClipThumb(detail.clip),
    segments: detail.segments.map((s) => ({ ...s, thumb_url: sceneThumb(s.segment_id) })),
    tracks: detail.tracks.map((t) => ({ ...t, crop_url: faceCrop(t.track_id) })),
  };
}

const clipEvents = (): ScheduledEvent[] =>
  PIPELINE_STEPS.filter((step) => step !== 'ready').map((step, index) => ({
    delayMs: index * CLIP_STEP_MS,
    data: { step, status: 'running' },
  }));

/** Mutable mock state; one per dev server. */
interface MockState {
  isSignedIn: boolean;
  clips: ClipSummary[];
  detail: ClipDetail;
  uploads: Map<string, string>;
  nextId: number;
  shortStartedAt: number | null;
  renderStartedAt: number | null;
  savedVersions: ShortVersion[];
}

/**
 * Builds the mock API.
 * @param now - Clock in ms; tests pass a fake.
 * @returns `handle`, which answers one request.
 */
export function createMockApi(now: () => number): { handle: (request: MockRequest) => MockReply } {
  const fullShort = must(parseShortDetail(shortJson), 'short.json');
  const state: MockState = {
    isSignedIn: false,
    clips: must(parseClipList(clipsJson), 'clips.json'),
    detail: must(parseClipDetail(clipDetailJson), 'clip-detail.json'),
    uploads: new Map(),
    nextId: 1,
    shortStartedAt: null,
    renderStartedAt: null,
    savedVersions: [],
  };
  const people = must(parsePeople(peopleJson), 'people.json');
  const search = must(parseSearch(searchJson), 'search.json');
  const costs = must(parseCosts(costsJson), 'costs.json');

  function detailFor(clipId: string): ClipDetail | null {
    const clip = state.clips.find((c) => c.clip_id === clipId);
    if (clip === undefined) return null;
    if (clip.status !== 'ready') return { clip, proxy_url: null, segments: [], turns: [], speakers: [], tracks: [] };
    return withDetailImages({ ...state.detail, clip });
  }

  function currentShort(): ShortDetail {
    const replayed = state.shortStartedAt === null ? fullShort : shortAt(fullShort, now() - state.shortStartedAt, SHORT_STEP_MS);
    const isRendering = state.renderStartedAt !== null && now() - state.renderStartedAt < 3000;
    return {
      ...replayed,
      short: isRendering ? { ...replayed.short, status: 'rendering' } : replayed.short,
      versions: [...replayed.versions, ...state.savedVersions],
      segments: replayed.segments.map((s) => ({ ...s, thumb_url: sceneThumb(s.segment_id) })),
    };
  }

  const routes: [string, RegExp, (m: RegExpMatchArray, req: MockRequest) => MockReply][] = [
    ['GET', /^\/clips$/, () => json(state.clips.map(withClipThumb), 300)],
    ['GET', /^\/clips\/([^/]+)$/, (m) => {
      const detail = detailFor(decodeURIComponent(m[1] ?? ''));
      return detail === null ? fail(404, 'NOT_FOUND', 'No such clip') : json(detail, 400);
    }],
    ['GET', /^\/clips\/([^/]+)\/events$/, () => ({ kind: 'sse', events: clipEvents(), loopMs: clipEvents().length * CLIP_STEP_MS })],
    ['GET', /^\/people$/, (_m, req) => {
      const prefix = (req.query.get('prefix') ?? '').toLowerCase();
      return json(people.filter((p) => p.name.toLowerCase().startsWith(prefix)), 120);
    }],
    ['PUT', /^\/tracks\/([^/]+)$/, (m, req) => {
      const body = (req.body ?? {}) as { name?: unknown; hidden?: unknown };
      const id = decodeURIComponent(m[1] ?? '');
      const track = state.detail.tracks.find((t) => t.track_id === id);
      if (track === undefined) return fail(404, 'NOT_FOUND', 'No such track');
      if (typeof body.name === 'string') track.person_name = body.name;
      if (typeof body.hidden === 'boolean') track.hidden = body.hidden;
      return json({ ...track, crop_url: faceCrop(track.track_id) }, 300);
    }],
    ['PUT', /^\/speakers\/([^/]+)$/, (m, req) => {
      const body = (req.body ?? {}) as { display_name?: unknown };
      const speaker = state.detail.speakers.find((s) => s.speaker_id === decodeURIComponent(m[1] ?? ''));
      if (speaker === undefined) return fail(404, 'NOT_FOUND', 'No such speaker');
      if (typeof body.display_name === 'string') speaker.display_name = body.display_name;
      return json(speaker, 300);
    }],
    ['POST', /^\/search$/, () => json({
      ...search,
      results: search.results.map((r) => ({ ...r, thumb_url: sceneThumb(r.segment_id) })),
    }, 900)],
    ['POST', /^\/uploads$/, (_m, req) => {
      const body = (req.body ?? {}) as { filename?: unknown; size_bytes?: unknown };
      const size = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
      const uploadId = `up_${String(state.nextId)}`;
      const clipId = `clip_new_${String(state.nextId)}`;
      state.nextId += 1;
      state.uploads.set(uploadId, clipId);
      state.clips = [
        { clip_id: clipId, filename: typeof body.filename === 'string' ? body.filename : 'clip.mp4', duration_s: null, recorded_at: null, status: 'uploading', thumb_url: null, segment_count: 0, people: [] },
        ...state.clips,
      ];
      const count = Math.max(1, Math.ceil(size / MOCK_PART_SIZE));
      const parts = Array.from({ length: count }, (_, i) => ({ n: i + 1, url: `/mock-s3/${uploadId}/${String(i + 1)}` }));
      return json({ upload_id: uploadId, clip_id: clipId, part_size: MOCK_PART_SIZE, parts });
    }],
    ['POST', /^\/uploads\/([^/]+)\/parts$/, (m, req) => {
      const uploadId = decodeURIComponent(m[1] ?? '');
      if (!state.uploads.has(uploadId)) return fail(404, 'NOT_FOUND', 'Upload expired');
      const numbers = ((req.body ?? {}) as { part_numbers?: unknown }).part_numbers;
      const list = Array.isArray(numbers) ? numbers.filter((n): n is number => typeof n === 'number') : [];
      return json({ parts: list.map((n) => ({ n, url: `/mock-s3/${uploadId}/${String(n)}` })) });
    }],
    ['POST', /^\/uploads\/([^/]+)\/complete$/, (m) => {
      const clipId = state.uploads.get(decodeURIComponent(m[1] ?? ''));
      if (clipId === undefined) return fail(404, 'NOT_FOUND', 'Upload expired');
      state.clips = state.clips.map((c) => (c.clip_id === clipId ? { ...c, status: 'uploaded' } : c));
      return json({ clip_id: clipId, status: 'uploaded' });
    }],
    ['POST', /^\/shorts$/, () => {
      state.shortStartedAt = now();
      state.renderStartedAt = null;
      state.savedVersions = [];
      return json({ short_id: fullShort.short.short_id }, 400);
    }],
    ['GET', /^\/shorts\/([^/]+)$/, () => json(currentShort(), 300)],
    ['GET', /^\/shorts\/([^/]+)\/events$/, () => {
      const elapsed = state.shortStartedAt === null ? Number.POSITIVE_INFINITY : now() - state.shortStartedAt;
      return { kind: 'sse', events: stepSchedule(fullShort.steps, elapsed, SHORT_STEP_MS), loopMs: null };
    }],
    ['PUT', /^\/shorts\/([^/]+)\/timeline$/, (_m, req) => {
      const timeline = parseTimeline(((req.body ?? {}) as { timeline?: unknown }).timeline);
      if (timeline === null) return fail(422, 'VALIDATION_FAILED', 'Timeline does not match the contract');
      const n = fullShort.versions.length + state.savedVersions.length + 1;
      state.savedVersions = [...state.savedVersions, { n, timeline, preview_url: null, critique: null, score_total: null }];
      return json({ version: n }, 400);
    }],
    ['POST', /^\/shorts\/([^/]+)\/render$/, () => {
      state.renderStartedAt = now();
      return json({ job_id: `job_${String(now())}` });
    }],
    ['GET', /^\/shorts\/([^/]+)\/download$/, () => fail(404, 'NOT_FOUND', 'Mock mode has no rendered file')],
    ['GET', /^\/costs$/, () => json(costs, 300)],
  ];

  function handle(request: MockRequest): MockReply {
    const { method, path } = request;
    if (method === 'GET' && path === '/health') return json({ ok: true }, 50);
    if (method === 'POST' && path === '/session') {
      state.isSignedIn = true;
      return json({ user_id: 'u_demo' }, 300);
    }
    if (method === 'POST' && path === '/session/logout') {
      state.isSignedIn = false;
      return { kind: 'empty', status: 204 };
    }
    if (!state.isSignedIn) return fail(401, 'UNAUTHORIZED', 'Sign in first');
    for (const [routeMethod, pattern, answer] of routes) {
      const match = routeMethod === method ? pattern.exec(path) : null;
      if (match !== null) return answer(match, request);
    }
    return fail(404, 'NOT_FOUND', `Mock has no route for ${method} ${path}`);
  }

  return { handle };
}
