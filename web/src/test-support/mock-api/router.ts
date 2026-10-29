// Mock API for `npm run dev:mock`: answers every /api route from the fixtures, with a little
// state (session, uploads, names, saved versions, a replayed agent run, MyWay guides, Ask requests) so each
// screen can be seen and used without the backend. Pure request → reply; the Vite plugin does the IO.
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList, parseCosts } from '../../services/api/parse';
import { parsePeopleOverview, parseShortList, parseStorage } from '../../services/api/parse-overview';
import { parsePeople, parseSearch } from '../../services/api/parse-search';
import { parseShortDetail, parseTimeline } from '../../services/api/parse-shorts';
import { PIPELINE_STEPS, type ClipDetail, type ClipSummary, type SearchResponse, type ShortDetail, type ShortVersion } from '../../services/api/types';
import clipDetailJson from '../fixtures/clip-detail.json';
import clipsJson from '../fixtures/clips.json';
import costsJson from '../fixtures/costs.json';
import peopleOverviewJson from '../fixtures/people-overview.json';
import shortsListJson from '../fixtures/shorts-list.json';
import storageJson from '../fixtures/storage.json';
import peopleJson from '../fixtures/people.json';
import searchJson from '../fixtures/search.json';
import shortJson from '../fixtures/short.json';
import { deriveProps, ShortPropsSchema, type ShortProps } from '@nimbytes/composition';
import sampleProps from '../../../../render/fixtures/props.sample.json';
import { faceCrop, sceneThumb } from './thumbs';
import { fail, json, type MockReply, type MockRequest, type MockRoute } from './reply';
import { shortAt, stepSchedule, type ScheduledEvent } from './short-replay';
import { createProjectsMock } from './projects';
import { createStudioMock } from './studio';
import { createSamMock } from './sam';
import { createGuidesMock } from './guides';
import { createAskMock } from './ask';

export type { MockReply, MockRequest } from './reply';

/** Time between replayed agent steps, ms. */
export const SHORT_STEP_MS = 700;
/** Time between ingest step events for a processing clip, ms. */
export const CLIP_STEP_MS = 1500;
/** When the mock search stream sends its local and ranked stages, ms (a real local stage takes
 * about 0.2 s, the Spark rewrite and rerank about 3–4 s). */
export const SEARCH_LOCAL_MS = 250;
export const SEARCH_RANKED_MS = 2500;

/** Part size the mock upload hands out, bytes (8 MiB, like the API). */
export const MOCK_PART_SIZE = 8 * 1024 * 1024;

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}


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

/**
 * Player props for every version: one clip per candidate segment with no video (the
 * composition draws a gradient with the subject), the sample's captions where the segment
 * matches, laid out by the version's timeline through the same `deriveProps` the editor uses.
 */
function propsFor(short: ShortDetail): (timeline: ShortVersion['timeline']) => ShortProps {
  const sample = must(ShortPropsSchema.safeParse(sampleProps).data ?? null, 'props.sample.json');
  const base: ShortProps = {
    ...sample,
    clips: short.segments.map((segment) =>
      Object.assign(
        {
          segment_id: segment.segment_id,
          src_url: null,
          in_s: segment.start_s,
          out_s: segment.end_s,
          punch_in: 1,
          subject: segment.description,
          captions: sample.clips.find((clip) => clip.segment_id === segment.segment_id)?.captions ?? [],
        },
        // Keep subject in frame: the crop drifts left to right across the shot, so Follows subject
        // and Centre crop differ once the renderer reads crop_path (source seconds).
        {
          crop_path: [
            { t_s: segment.start_s, cx: 0.35, cy: 0.5 },
            { t_s: segment.end_s, cx: 0.65, cy: 0.5 },
          ],
          // The renderer needs the upright source aspect whenever crop_path is set (3:4 glasses footage).
          source_aspect: 0.75,
        },
      ),
    ),
  };
  return (timeline) => deriveProps({ ...base, aspect: timeline.aspect }, timeline.clips);
}

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
  /** Filename and size of every clip, for the pre-upload duplicate check. */
  fileSizes: Map<string, { filename: string; size_bytes: number }>;
  faceMatching: boolean;
  /** "Also blur screens and number plates". */
  blurObjects: boolean;
  /** Shorts deleted with DELETE /shorts/{id}. */
  deletedShorts: Set<string>;
}

/** Size the mock gives fixture clips, so re-picking a fixture filename at this size is a match. */
export const MOCK_FIXTURE_SIZE = 3_732_228;

/**
 * Builds the mock API.
 * @param now - Clock in ms; tests pass a fake.
 * @returns `handle`, which answers one request.
 */
export function createMockApi(now: () => number): { handle: (request: MockRequest) => MockReply } {
  const parsedShort = must(parseShortDetail(shortJson), 'short.json');
  const playerProps = propsFor(parsedShort);
  const fullShort: ShortDetail = {
    ...parsedShort,
    versions: parsedShort.versions.map((v) => ({ ...v, composition_props: playerProps(v.timeline) })),
  };
  const state: MockState = {
    isSignedIn: false,
    clips: must(parseClipList(clipsJson), 'clips.json'),
    detail: must(parseClipDetail(clipDetailJson), 'clip-detail.json'),
    uploads: new Map(),
    nextId: 1,
    shortStartedAt: null,
    renderStartedAt: null,
    savedVersions: [],
    fileSizes: new Map(),
    faceMatching: false,
    blurObjects: false,
    deletedShorts: new Set(),
  };
  for (const clip of state.clips) {
    if (clip.status !== 'duplicate') state.fileSizes.set(clip.clip_id, { filename: clip.filename, size_bytes: MOCK_FIXTURE_SIZE });
  }
  const people = must(parsePeople(peopleJson), 'people.json');
  const search = must(parseSearch(searchJson), 'search.json');
  const costs = must(parseCosts(costsJson), 'costs.json');
  const storage = must(parseStorage(storageJson), 'storage.json');
  const shortsList = must(parseShortList(shortsListJson), 'shorts-list.json');
  const overview = must(parsePeopleOverview(peopleOverviewJson), 'people-overview.json');

  /** Keeps the People overview in step with a track edit (name, hide, unhide). */
  function applyTrackEdit(id: string, body: { name?: unknown; hidden?: unknown }) {
    const unnamed = overview.unnamed.find((f) => f.track_id === id);
    const hidden = overview.hidden.find((f) => f.track_id === id);
    const face = unnamed ?? hidden;
    if (typeof body.name === 'string' && face !== undefined) {
      overview.unnamed = overview.unnamed.filter((f) => f.track_id !== id);
      const known = overview.people.find((p) => p.name.toLowerCase() === String(body.name).toLowerCase());
      if (known) known.clip_count += 1;
      else overview.people.push({ person_id: `p_${id}`, name: body.name, clip_count: 1, crop_url: null });
    }
    if (body.hidden === true && unnamed !== undefined) {
      overview.unnamed = overview.unnamed.filter((f) => f.track_id !== id);
      overview.hidden.push({ track_id: id, clip_id: unnamed.clip_id, clip_title: unnamed.clip_title, recorded_at: unnamed.recorded_at, crop_url: null });
    }
    if (body.hidden === false && hidden !== undefined) {
      overview.hidden = overview.hidden.filter((f) => f.track_id !== id);
      overview.unnamed.push({ ...hidden, on_screen_s: 5, group_id: null, suggested: null });
    }
    overview.hidden_count = overview.hidden.length;
  }

  /** The fixture as POST /search answers it, with drawn thumbnails and face crops. */
  function rankedSearch(): SearchResponse {
    return {
      ...search,
      results: search.results.map((r) => ({
        ...r,
        thumb_url: sceneThumb(r.segment_id),
        faces: r.faces.map((f) => ({ ...f, crop_url: faceCrop(f.name) })),
      })),
    };
  }

  /**
   * POST /search/stream: `local` (the ranked hits but the last, reversed, no reasons), then
   * `ranked`, then `done`, then the stream closes; so the screen shows a reorder, a new card and
   * the reasons filling in.
   */
  function searchStream(body: unknown): MockReply {
    const query = typeof body === 'object' && body !== null && 'query' in body ? String(body.query) : '';
    const ranked = rankedSearch();
    const local: SearchResponse = {
      rewritten: {
        keywords: query.toLowerCase().split(/\s+/).filter((word) => word !== '').slice(0, 8),
        filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null },
      },
      results: ranked.results.slice(0, -1).reverse().map((r) => ({ ...r, reason: null })),
      reranked: false,
      took_ms: SEARCH_LOCAL_MS - 20,
      cached: false,
      cost_usd: 0,
    };
    return {
      kind: 'sse',
      events: [
        { delayMs: SEARCH_LOCAL_MS, event: 'local', data: local },
        { delayMs: SEARCH_RANKED_MS, event: 'ranked', data: { ...ranked, took_ms: SEARCH_RANKED_MS - 20 } },
        { delayMs: SEARCH_RANKED_MS + 10, event: 'done', data: {} },
      ],
      loopMs: null,
      closeMs: SEARCH_RANKED_MS + 20,
    };
  }

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

  const studio = createStudioMock(now);
  const projects = createProjectsMock({
    get: () => state.clips,
    set: (clips) => {
      state.clips = clips;
    },
  }, now);
  const sam = createSamMock({
    now,
    clips: () => state.clips,
    // Tracking follows the newest draft, so a subject change (a saved timeline) is what it tracks.
    shots: (shortId) => {
      if (shortId !== fullShort.short.short_id || state.deletedShorts.has(shortId)) return null;
      const versions = currentShort().versions;
      return versions[versions.length - 1]?.timeline.clips ?? [];
    },
  });
  const guides = createGuidesMock(now, (clipId) => {
    const clip = state.clips.find((c) => c.clip_id === clipId);
    return clip === undefined ? null : { title: clip.title, duration_s: clip.duration_s };
  });
  const ask = createAskMock(projects.list);
  const routes: MockRoute[] = [
    ...ask.routes,
    ...guides.routes,
    ...sam.routes,
    ...studio.routes,
    ...projects.routes,
    ['GET', /^\/clips$/, (_m, req) => {
      const project = req.query.get('project');
      const shown = project === null ? state.clips : state.clips.filter((c) => c.project_ids.includes(project));
      return json(shown.map(withClipThumb), 300);
    }],
    ['GET', /^\/clips\/([^/]+)$/, (m) => {
      const detail = detailFor(decodeURIComponent(m[1] ?? ''));
      return detail === null ? fail(404, 'NOT_FOUND', 'No such clip') : json(detail, 400);
    }],
    ['DELETE', /^\/clips\/([^/]+)$/, (m) => {
      const id = decodeURIComponent(m[1] ?? '');
      if (!state.clips.some((c) => c.clip_id === id)) return fail(404, 'NOT_FOUND', 'No such clip');
      state.clips = state.clips.filter((c) => c.clip_id !== id);
      state.fileSizes.delete(id);
      return { kind: 'empty', status: 204 };
    }],
    ['POST', /^\/uploads\/check$/, (_m, req) => {
      const body = (req.body ?? {}) as { filename?: unknown; size_bytes?: unknown };
      const match = [...state.fileSizes.entries()].find(
        ([, f]) => f.filename === body.filename && f.size_bytes === body.size_bytes,
      );
      const clip = match === undefined ? undefined : state.clips.find((c) => c.clip_id === match[0]);
      return json({ duplicate_of: clip === undefined ? null : { clip_id: clip.clip_id, title: clip.title } }, 200);
    }],
    ['POST', /^\/tracks\/name$/, (_m, req) => {
      const body = (req.body ?? {}) as { track_ids?: unknown; name?: unknown };
      if (!Array.isArray(body.track_ids) || typeof body.name !== 'string' || body.name.trim() === '') {
        return fail(400, 'VALIDATION_FAILED', 'track_ids and name are required');
      }
      for (const id of body.track_ids) if (typeof id === 'string') applyTrackEdit(id, { name: body.name });
      return { kind: 'empty', status: 204 };
    }],
    ['GET', /^\/settings$/, () => json({ face_matching: state.faceMatching, blur_objects: state.blurObjects }, 150)],
    ['PUT', /^\/settings$/, (_m, req) => {
      const body = (req.body ?? {}) as { face_matching?: unknown; blur_objects?: unknown };
      if (typeof body.face_matching !== 'boolean') return fail(400, 'VALIDATION_FAILED', 'face_matching must be a boolean');
      if (typeof body.blur_objects !== 'boolean') return fail(400, 'VALIDATION_FAILED', 'blur_objects must be a boolean');
      state.faceMatching = body.face_matching;
      state.blurObjects = body.blur_objects;
      return json({ face_matching: state.faceMatching, blur_objects: state.blurObjects }, 300);
    }],
    ['GET', /^\/clips\/([^/]+)\/events$/, () => ({ kind: 'sse', events: clipEvents(), loopMs: clipEvents().length * CLIP_STEP_MS })],
    ['GET', /^\/people$/, (_m, req) => {
      const prefix = (req.query.get('prefix') ?? '').toLowerCase();
      return json(people.filter((p) => p.name.toLowerCase().startsWith(prefix)), 120);
    }],
    ['PUT', /^\/tracks\/([^/]+)$/, (m, req) => {
      const body = (req.body ?? {}) as { name?: unknown; hidden?: unknown };
      const id = decodeURIComponent(m[1] ?? '');
      const inOverview = [...overview.unnamed, ...overview.hidden].some((f) => f.track_id === id);
      const track = state.detail.tracks.find((t) => t.track_id === id) ??
        (inOverview ? { track_id: id, crop_url: null, first_s: 0, last_s: 1, person_name: null, hidden: false } : undefined);
      if (track === undefined) return fail(404, 'NOT_FOUND', 'No such track');
      if (typeof body.name === 'string') track.person_name = body.name;
      if (typeof body.hidden === 'boolean') track.hidden = body.hidden;
      applyTrackEdit(id, body);
      return json({ ...track, crop_url: faceCrop(track.track_id) }, 300);
    }],
    ['PUT', /^\/speakers\/([^/]+)$/, (m, req) => {
      const body = (req.body ?? {}) as { display_name?: unknown };
      const speaker = state.detail.speakers.find((s) => s.speaker_id === decodeURIComponent(m[1] ?? ''));
      if (speaker === undefined) return fail(404, 'NOT_FOUND', 'No such speaker');
      if (typeof body.display_name === 'string') speaker.display_name = body.display_name;
      return json(speaker, 300);
    }],
    ['POST', /^\/search$/, () => json(rankedSearch(), 900)],
    ['POST', /^\/search\/stream$/, (_m, req) => searchStream(req.body)],
    ['POST', /^\/uploads$/, (_m, req) => {
      const body = (req.body ?? {}) as { filename?: unknown; size_bytes?: unknown };
      const size = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
      const uploadId = `up_${String(state.nextId)}`;
      const clipId = `clip_new_${String(state.nextId)}`;
      state.nextId += 1;
      state.uploads.set(uploadId, clipId);
      state.fileSizes.set(clipId, { filename: typeof body.filename === 'string' ? body.filename : 'clip.mp4', size_bytes: size });
      state.clips = [
        { clip_id: clipId, title: (typeof body.filename === 'string' ? body.filename : 'clip.mp4').replace(/\.[^.]+$/, ''), filename: typeof body.filename === 'string' ? body.filename : 'clip.mp4', duration_s: null, recorded_at: null, status: 'uploading', thumb_url: null, segment_count: 0, people: [], duplicate_of: null, size_bytes: size, project_ids: [], speech_count: 0, face_count: 0 },
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
    ['GET', /^\/shorts\/([^/]+)$/, (m) =>
      state.deletedShorts.has(decodeURIComponent(m[1] ?? '')) ? fail(404, 'NOT_FOUND', 'No such short') : json(currentShort(), 300)],
    ['DELETE', /^\/shorts\/([^/]+)$/, (m) => {
      const id = decodeURIComponent(m[1] ?? '');
      if (state.deletedShorts.has(id) || !shortsList.some((row) => row.short_id === id)) return fail(404, 'NOT_FOUND', 'No such short');
      state.deletedShorts.add(id);
      return { kind: 'empty', status: 204 };
    }],
    ['GET', /^\/shorts\/([^/]+)\/events$/, () => {
      const elapsed = state.shortStartedAt === null ? Number.POSITIVE_INFINITY : now() - state.shortStartedAt;
      return { kind: 'sse', events: stepSchedule(fullShort.steps, elapsed, SHORT_STEP_MS), loopMs: null };
    }],
    ['PUT', /^\/shorts\/([^/]+)\/timeline$/, (_m, req) => {
      const timeline = parseTimeline(((req.body ?? {}) as { timeline?: unknown }).timeline);
      if (timeline === null) return fail(400, 'VALIDATION_FAILED', 'Timeline does not match the contract');
      const n = fullShort.versions.length + state.savedVersions.length + 1;
      state.savedVersions = [
        ...state.savedVersions,
        { n, timeline, preview_url: null, critique: null, score_total: null, composition_props: playerProps(timeline) },
      ];
      return json({ version: n }, 400);
    }],
    ['POST', /^\/shorts\/([^/]+)\/render$/, () => {
      state.renderStartedAt = now();
      return json({ job_id: `job_${String(now())}` });
    }],
    ['GET', /^\/shorts\/([^/]+)\/download$/, () => fail(404, 'NOT_FOUND', 'Mock mode has no rendered file')],
    ['GET', /^\/costs$/, () => json(costs, 300)],
    ['GET', /^\/storage$/, () => json({ ...storage, clip_count: state.clips.length }, 250)],
    ['GET', /^\/people\/overview$/, () => json({
      ...overview,
      people: overview.people.map((p) => ({ ...p, crop_url: faceCrop(p.person_id) })),
      // With matching off the api sends no groups or suggestions.
      unnamed: overview.unnamed.map((f) => ({
        ...f,
        crop_url: faceCrop(f.track_id),
        ...(state.faceMatching ? {} : { group_id: null, suggested: null }),
      })),
      hidden: overview.hidden.map((f) => ({ ...f, crop_url: faceCrop(f.track_id) })),
    }, 300)],
    ['GET', /^\/shorts$/, () => {
      const live = currentShort();
      const best = live.versions.find((v) => v.n === live.short.best_version);
      return json(shortsList.filter((row) => !state.deletedShorts.has(row.short_id)).map((row) =>
        row.short_id === live.short.short_id
          ? { ...row, status: live.short.status, version_count: live.versions.length, best_score: best?.score_total ?? null, thumb_url: sceneThumb(row.short_id) }
          : { ...row, thumb_url: sceneThumb(row.short_id) },
      ), 300);
    }],
  ];

  function handle(request: MockRequest): MockReply {
    const { method, path } = request;
    if (method === 'GET' && path === '/health') return json({ ok: true }, 50);
    if (method === 'POST' && path === '/session') {
      state.isSignedIn = true;
      return json({ user_id: 'u_demo' }, 300);
    }
    if (method === 'GET' && path === '/session') {
      return state.isSignedIn
        ? json({ user_id: 'u_demo' }, 50)
        : fail(401, 'UNAUTHORIZED', 'Sign in first');
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
