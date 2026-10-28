// Mock MyWay guides for `npm run dev:mock`: the kettle guide is ready (from guide.json); the
// front-door guide is being made and walks queued → each stage → ready on the clock; the tablets
// guide was refused. Make a guide on a clip starts a new run the same way (the same guide on a
// second call); Edit text and Delete change the state. Step photos are drawn placeholders; there is no audio or clip in mock mode.
import { parseGuide, parseGuideList } from '../../services/api/parse-guides';
import { GUIDE_STAGES, type Guide, type GuideStage, type GuideSummary } from '../../services/api/types';
import guideJson from '../fixtures/guide.json';
import guidesJson from '../fixtures/guides.json';
import { fail, json, type MockRoute } from './reply';
import { sceneThumb } from './thumbs';

/** How long each stage of a mock run takes, ms (about 10 s for a whole guide). */
export const GUIDE_STAGE_MS = 2000;

/** One guide and, while it is being made, when its run started. */
interface MockGuide {
  guide: Guide;
  createdAt: string;
  startedAt: number | null;
}

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}

/** The fixture's step photos as drawn placeholders, and no audio or clip files. */
const drawnSteps = (guide: Guide): Guide['steps'] =>
  guide.steps.map((step) => ({ ...step, image_url: sceneThumb(`${guide.id}:${String(step.n)}`), audio_url: null, clip_url: null }));

/**
 * Where a run started at `startedAt` is now.
 * @param startedAt - Start time, ms.
 * @param now - Now, ms.
 * @returns The status and stage.
 */
export function runAt(startedAt: number, now: number): Pick<Guide, 'status' | 'stage'> {
  const index = Math.floor((now - startedAt) / GUIDE_STAGE_MS) - 1;
  if (index < 0) return { status: 'queued', stage: null };
  const stage: GuideStage | undefined = GUIDE_STAGES[index];
  return stage === undefined || stage === 'ready' ? { status: 'ready', stage: null } : { status: 'running', stage };
}

/**
 * Builds the guide routes.
 * @param now - Clock in ms.
 * @param clipTitle - The title and length of a clip, by id (null for an unknown clip).
 * @returns The routes.
 */
export function createGuidesMock(
  now: () => number,
  clipTitle: (clipId: string) => { title: string; duration_s: number | null } | null,
): { routes: MockRoute[] } {
  const kettle = must(parseGuide(guideJson), 'guide.json');
  const summaries = must(parseGuideList(guidesJson), 'guides.json');
  const steps = drawnSteps(kettle);
  const fromSummary = (row: GuideSummary): MockGuide => ({
    guide: {
      ...kettle,
      id: row.id,
      clip_id: row.clip_id,
      title: row.title,
      status: row.status,
      stage: row.stage,
      safety: row.status === 'refused' ? 'not_supported' : row.status === 'ready' ? 'everyday' : null,
      safety_reason: row.status === 'refused' ? 'taking medication' : null,
      steps: row.status === 'ready' ? steps : [],
    },
    createdAt: row.created_at,
    startedAt: row.status === 'running' ? now() - GUIDE_STAGE_MS * 3 : null,
  });
  let guides: MockGuide[] = summaries.map(fromSummary);
  let nextId = 1;

  /** The guide as GET reads it now: a run in flight moves on with the clock. */
  const view = (entry: MockGuide): Guide => {
    const clip = clipTitle(entry.guide.clip_id);
    const run = entry.startedAt === null ? null : runAt(entry.startedAt, now());
    const base = { ...entry.guide, clip_title: clip?.title ?? null, clip_duration_s: clip?.duration_s ?? null };
    if (run === null) return base;
    return run.status === 'ready' ? { ...base, ...run, safety: 'everyday', steps } : { ...base, ...run, steps: [] };
  };

  const summary = (entry: MockGuide): GuideSummary => {
    const guide = view(entry);
    return {
      id: guide.id,
      clip_id: guide.clip_id,
      title: guide.title,
      status: guide.status,
      stage: guide.stage,
      error: guide.error,
      step_count: guide.steps.length,
      cover_url: guide.steps[0]?.image_url ?? null,
      created_at: entry.createdAt,
      clip_title: guide.clip_title,
      clip_duration_s: guide.clip_duration_s,
    };
  };

  const find = (match: RegExpMatchArray) => guides.find((g) => g.guide.id === decodeURIComponent(match[1] ?? ''));

  const routes: MockRoute[] = [
    ['POST', /^\/clips\/([^/]+)\/guide$/, (m) => {
      const clipId = decodeURIComponent(m[1] ?? '');
      const clip = clipTitle(clipId);
      if (clip === null) return fail(404, 'NOT_FOUND', 'No such clip');
      const existing = guides.find((g) => g.guide.clip_id === clipId);
      if (existing !== undefined) return json({ guide_id: existing.guide.id, status: view(existing).status }, 300, 202);
      const id = `g_new_${String(nextId)}`;
      nextId += 1;
      guides = [
        {
          guide: { ...kettle, id, clip_id: clipId, title: clip.title, status: 'queued', stage: null, safety: null, steps: [] },
          createdAt: new Date(now()).toISOString(),
          startedAt: now(),
        },
        ...guides,
      ];
      return json({ guide_id: id, status: 'queued' }, 300, 202);
    }],
    ['GET', /^\/guides$/, () => json(guides.map(summary), 250)],
    ['GET', /^\/guides\/([^/]+)$/, (m) => {
      const entry = find(m);
      return entry === undefined ? fail(404, 'NOT_FOUND', 'No such guide') : json(view(entry), 200);
    }],
    ['PATCH', /^\/guides\/([^/]+)\/steps\/(\d+)$/, (m, req) => {
      const entry = find(m);
      const n = Number(m[2]);
      const body = (req.body ?? {}) as { title?: unknown; instruction?: unknown };
      if (entry === undefined || view(entry).status !== 'ready') return fail(404, 'NOT_FOUND', 'No such guide');
      if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) return fail(400, 'VALIDATION_FAILED', 'title must be text');
      if (body.instruction !== undefined && (typeof body.instruction !== 'string' || body.instruction.trim() === '')) return fail(400, 'VALIDATION_FAILED', 'instruction must be text');
      const current = view(entry).steps.find((s) => s.n === n);
      if (current === undefined) return fail(404, 'NOT_FOUND', 'No such step');
      const edited = { ...current, ...(typeof body.title === 'string' ? { title: body.title } : {}), ...(typeof body.instruction === 'string' ? { instruction: body.instruction } : {}) };
      entry.startedAt = null;
      entry.guide = { ...view(entry), steps: view(entry).steps.map((s) => (s.n === n ? edited : s)) };
      return json(edited, 400);
    }],
    ['DELETE', /^\/guides\/([^/]+)$/, (m) => {
      const entry = find(m);
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such guide');
      guides = guides.filter((g) => g !== entry);
      return { kind: 'empty', status: 204 };
    }],
  ];
  return { routes };
}
