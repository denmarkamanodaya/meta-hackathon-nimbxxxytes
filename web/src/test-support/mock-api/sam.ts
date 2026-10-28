// Mock SAM 3.1 routes for `npm run dev:mock`: Find this (the fixture's mug, its outline and hits,
// with the tapped clip first), Cut out (two drawn PNG stand-ins) and a short's subject tracking,
// which runs for a moment after POST and goes back to idle when a shot's subject changes.
// Pure request → reply.
import { parseFind, parseReframe } from '../../services/api/parse-sam';
import type { ClipSummary, FindResponse, ReframeResponse, ReframeShot, TimelineClip } from '../../services/api/types';
import findJson from '../fixtures/find.json';
import reframeJson from '../fixtures/reframe.json';
import { fail, json, type MockRoute } from './reply';
import { cutoutImage, sceneThumb } from './thumbs';

/** How long Find this and Cut out take, ms (the real calls take about 6 s). */
export const FIND_MS = 1800;
/** How long tracking a short's subjects takes, ms. */
export const REFRAME_MS = 3000;

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}

/** What the SAM mock reads from the rest of the mock API. */
export interface SamMockDeps {
  now: () => number;
  /** The clips, to name the tapped one. */
  clips: () => readonly ClipSummary[];
  /** The shots of a short's best draft, or null for an unknown short. */
  shots: (shortId: string) => readonly TimelineClip[] | null;
}

/** A point body, or null when it is not one. */
function readPoint(body: unknown): { t_s: number; x: number; y: number } | null {
  const b = (body ?? {}) as { t_s?: unknown; x?: unknown; y?: unknown };
  const ok = (v: unknown, max: number): v is number => typeof v === 'number' && v >= 0 && v <= max;
  return ok(b.t_s, Number.MAX_SAFE_INTEGER) && ok(b.x, 1) && ok(b.y, 1) ? { t_s: b.t_s, x: b.x, y: b.y } : null;
}

/** The subjects a reframe ran on, so a changed subject sends it back to idle. */
const subjectsKey = (shots: readonly TimelineClip[]) => shots.map((s) => `${s.segment_id}=${s.subject ?? ''}`).join('|');

/**
 * Builds the SAM routes.
 * @param deps - Clock and the state they read.
 * @returns The routes.
 */
export function createSamMock(deps: SamMockDeps): { routes: MockRoute[] } {
  const found = must(parseFind(findJson), 'find.json');
  const lostSeconds = new Map(must(parseReframe(reframeJson), 'reframe.json').shots.map((s) => [s.subject, s.lost_s]));
  const runs = new Map<string, { startedAt: number; key: string }>();

  function find(clipId: string, body: unknown) {
    const clip = deps.clips().find((c) => c.clip_id === clipId);
    if (clip === undefined) return fail(404, 'NOT_FOUND', 'No such clip');
    if (readPoint(body) === null) return fail(400, 'VALIDATION_FAILED', 't_s, x and y are required; x and y are 0 to 1');
    const [first, ...rest] = found.hits;
    const here = first === undefined ? [] : [{ ...first, clip_id: clip.clip_id, clip_title: clip.title, recorded_at: clip.recorded_at }];
    const answer: FindResponse = {
      ...found,
      hits: [...here, ...rest.filter((h) => h.clip_id !== clip.clip_id)].map((h) => ({ ...h, thumb_url: sceneThumb(h.segment_id) })),
    };
    return json(answer, FIND_MS);
  }

  function cutout(clipId: string, body: unknown) {
    if (!deps.clips().some((c) => c.clip_id === clipId)) return fail(404, 'NOT_FOUND', 'No such clip');
    if (readPoint(body) === null) return fail(400, 'VALIDATION_FAILED', 't_s, x and y are required; x and y are 0 to 1');
    return json({ label: found.label, png_url: cutoutImage(found.label, false), sticker_url: cutoutImage(found.label, true) }, FIND_MS);
  }

  function reframe(shortId: string): ReframeResponse | null {
    const shots = deps.shots(shortId);
    if (shots === null) return null;
    const followed = shots.filter((s): s is TimelineClip & { subject: string } => s.subject !== null);
    const run = runs.get(shortId);
    if (run?.key !== subjectsKey(shots)) return { status: 'idle', shots: [] };
    if (deps.now() - run.startedAt < REFRAME_MS) return { status: 'running', shots: [] };
    return {
      status: 'ready',
      shots: followed.map((s): ReframeShot => {
        const total = Math.round((s.out - s.in) * 12);
        const lost = lostSeconds.get(s.subject) ?? 0;
        return { segment_id: s.segment_id, subject: s.subject, frames_tracked: Math.max(0, total - lost * 12), frames_total: total, lost_s: lost };
      }),
    };
  }

  const id = (m: RegExpMatchArray) => decodeURIComponent(m[1] ?? '');
  const routes: MockRoute[] = [
    ['POST', /^\/clips\/([^/]+)\/find$/, (m, req) => find(id(m), req.body)],
    ['POST', /^\/clips\/([^/]+)\/cutout$/, (m, req) => cutout(id(m), req.body)],
    ['GET', /^\/shorts\/([^/]+)\/reframe$/, (m) => {
      const answer = reframe(id(m));
      return answer === null ? fail(404, 'NOT_FOUND', 'No such short') : json(answer, 200);
    }],
    ['POST', /^\/shorts\/([^/]+)\/reframe$/, (m) => {
      const shots = deps.shots(id(m));
      if (shots === null) return fail(404, 'NOT_FOUND', 'No such short');
      if (reframe(id(m))?.status === 'running') return json({ started: false }, 200, 202);
      runs.set(id(m), { startedAt: deps.now(), key: subjectsKey(shots) });
      return json({ started: true }, 200, 202);
    }],
  ];
  return { routes };
}
