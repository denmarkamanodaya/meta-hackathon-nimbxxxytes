// Mock Production Studio for `npm run dev:mock`: productions (a new one replays its plan: shot
// list, storyboards one by one, then coverage), a story short's acts, finish settings, the brand
// kit with fake uploads, and a publish pack that renders for a few seconds. Pure request → reply.
import { charCount } from '../../core/publish';
import { parseExports, parseBrand, parseProductionDetail } from '../../services/api/parse-studio';
import type {
  BrandKit,
  ExportItem,
  Platform,
  ProductionDetail,
  ProductionListItem,
  ProductionShot,
  ShortFinish,
} from '../../services/api/types';
import { PLATFORMS } from '../../services/api/types';
import brandJson from '../fixtures/brand.json';
import exportsJson from '../fixtures/exports.json';
import productionsJson from '../fixtures/productions.json';
import { fail, json, type MockReply, type MockRoute } from './reply';
import type { ScheduledEvent } from './short-replay';
import { sceneThumb } from './thumbs';

/** When the plan's shot list lands, after the run starts, ms. */
export const PLAN_SHOT_LIST_MS = 1500;
/** Time per storyboard frame, ms. */
export const PLAN_BOARD_MS = 600;
/** How long the coverage check takes, ms. */
export const PLAN_COVERAGE_MS = 1500;
/** How long a publish run takes, ms. */
export const PUBLISH_MS = 4000;
/** How long "Make 3 more" takes, ms. */
export const COVERS_MS = 1500;

/** The short every mock production cuts to (the fixture short). */
const STORY_SHORT_ID = 'sh_fixture';

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}

const parseDetails = (value: unknown): ProductionDetail[] =>
  Array.isArray(value) ? value.map((item, index) => must(parseProductionDetail(item), `productions.json[${String(index)}]`)) : [];

/** A shot as drawn: its storyboard frame and its moment's thumbnail. */
const withImages = (shot: ProductionShot): ProductionShot => ({
  ...shot,
  board_url: sceneThumb(`${shot.shot_id}:board`),
  match: shot.match === null ? null : { ...shot.match, thumb_url: sceneThumb(shot.match.segment_id) },
});

const coveredCount = (shots: readonly ProductionShot[]) => shots.filter((s) => s.match !== null).length;

const canCut = (covered: number, total: number) => covered >= 3 || (total > 0 && covered / total >= 0.6);

/** When each step of a plan run happens, ms after it starts, for `shots` storyboards. */
function planTimes(shots: number) {
  const boardsEnd = PLAN_SHOT_LIST_MS + shots * PLAN_BOARD_MS;
  return { boardsEnd, doneAt: boardsEnd + PLAN_COVERAGE_MS };
}

/** The plan run's events from `elapsed` on (past ones at once). */
function planEvents(shots: number, elapsed: number): ScheduledEvent[] {
  const { boardsEnd, doneAt } = planTimes(shots);
  const timed: [number, string, string][] = [
    [0, 'planning', 'running'],
    [PLAN_SHOT_LIST_MS / 2, 'shot_list', 'running'],
    ...Array.from({ length: shots }, (_, i): [number, string, string] => [
      PLAN_SHOT_LIST_MS + i * PLAN_BOARD_MS,
      `boards ${String(i)}/${String(shots)}`,
      'running',
    ]),
    [boardsEnd, 'coverage', 'running'],
    [doneAt, 'done', 'done'],
  ];
  const past = timed.filter(([at]) => at <= elapsed);
  const latest = past[past.length - 1];
  const future = timed.filter(([at]) => at > elapsed);
  return [...(latest === undefined ? [] : [latest]), ...future].map(([at, step, status]) => ({
    delayMs: Math.max(0, at - elapsed),
    data: { step, status },
  }));
}

/** Mutable Studio state; one per dev server. */
interface StudioState {
  productions: ProductionDetail[];
  /** Plan runs in flight: production id → start time. */
  planRuns: Map<string, number>;
  nextId: number;
  finish: Map<string, ShortFinish>;
  brand: BrandKit | null;
  publishStartedAt: number | null;
  exports: ExportItem[];
  /** Extra covers per platform and when "Make 3 more" ran. */
  moreCovers: Map<Platform, { count: number; at: number }>;
}

const DEFAULT_FINISH: ShortFinish = { blur_bystanders: true, title_text: null, speaker_colors: false, effect: 'none' };

/**
 * Builds the Studio routes.
 * @param now - Clock in ms.
 * @returns The routes to add to the mock API.
 */
export function createStudioMock(now: () => number): { routes: MockRoute[] } {
  const fixtures = parseDetails(productionsJson);
  const template = fixtures.find((p) => p.production.production_id === 'pr_hills') ?? must(fixtures[0] ?? null, 'productions.json');
  const finalExports = must(parseExports(exportsJson), 'exports.json').exports;
  const state: StudioState = {
    productions: fixtures,
    planRuns: new Map(),
    nextId: 1,
    finish: new Map(),
    brand: must(parseBrand(brandJson), 'brand.json').kit,
    publishStartedAt: null,
    exports: [],
    moreCovers: new Map(),
  };

  /** A production as the API shows it now: a plan run in flight reveals its shots over time. */
  function current(stored: ProductionDetail): ProductionDetail {
    const id = stored.production.production_id;
    const startedAt = state.planRuns.get(id);
    if (startedAt === undefined) return { ...stored, shots: stored.shots.map(withImages) };
    const elapsed = now() - startedAt;
    const planned = template.shots.map((shot) => ({ ...shot, shot_id: `${id}_s${String(shot.ord)}` }));
    const { doneAt } = planTimes(planned.length);
    if (elapsed >= doneAt) {
      state.planRuns.delete(id);
      const covered = coveredCount(planned);
      const done: ProductionDetail = {
        ...stored,
        production: { ...stored.production, status: 'shooting', error: null, coverage_checked_at: new Date(now()).toISOString() },
        shots: planned,
        covered_count: covered,
        can_cut: canCut(covered, planned.length),
        busy: false,
      };
      state.productions = state.productions.map((p) => (p.production.production_id === id ? done : p));
      return { ...done, shots: done.shots.map(withImages) };
    }
    const boards = Math.floor((elapsed - PLAN_SHOT_LIST_MS) / PLAN_BOARD_MS);
    const shots =
      elapsed < PLAN_SHOT_LIST_MS
        ? []
        : planned.map((shot, i) => ({ ...shot, match: null, board_url: i < boards ? sceneThumb(`${shot.shot_id}:board`) : null }));
    return {
      ...stored,
      production: { ...stored.production, status: 'planning', error: null },
      shots,
      covered_count: 0,
      can_cut: false,
      busy: true,
    };
  }

  function listItem(detail: ProductionDetail): ProductionListItem {
    const p = detail.production;
    return {
      production_id: p.production_id,
      title: p.title,
      format: p.format,
      aspect: p.aspect,
      target_s: p.target_s,
      status: p.status,
      shot_count: detail.shots.length,
      covered_count: detail.covered_count,
      missing_titles: detail.shots.filter((s) => s.match === null).map((s) => s.title),
      cover_url: detail.shots[0]?.board_url ?? null,
      created_at: p.created_at,
    };
  }

  const find = (id: string) => state.productions.find((p) => p.production.production_id === id);

  function create(body: unknown): MockReply {
    const b = (body ?? {}) as { brief?: unknown; format?: unknown; aspect?: unknown; target_s?: unknown; blur_bystanders?: unknown };
    if (typeof b.brief !== 'string' || b.brief.trim() === '') return fail(400, 'VALIDATION_FAILED', 'brief must be 1 to 1000 characters');
    const id = `pr_new_${String(state.nextId)}`;
    state.nextId += 1;
    const detail: ProductionDetail = {
      production: {
        production_id: id,
        title: b.brief.trim().split(/\s+/).slice(0, 5).join(' '),
        brief: b.brief.trim(),
        format: b.format === 'short' ? 'short' : 'story',
        aspect: b.aspect === '1:1' ? '1:1' : '4:5',
        target_s: typeof b.target_s === 'number' ? b.target_s : 60,
        blur_bystanders: b.blur_bystanders !== false,
        status: 'planning',
        short_id: null,
        coverage_checked_at: null,
        error: null,
        created_at: new Date(now()).toISOString(),
      },
      shots: [],
      covered_count: 0,
      can_cut: false,
      busy: true,
    };
    state.productions = [detail, ...state.productions];
    state.planRuns.set(id, now());
    return json({ production_id: id }, 400);
  }

  /** Every platform's export as the API shows it now. */
  function exportsNow(): { exports: ExportItem[]; busy: boolean } {
    if (state.publishStartedAt === null) return { exports: [], busy: false };
    const elapsed = now() - state.publishStartedAt;
    const coversBusy = [...state.moreCovers.values()].some((c) => now() - c.at < COVERS_MS);
    const items = finalExports.map((final): ExportItem => {
      const edited = state.exports.find((e) => e.platform === final.platform);
      const base = edited ?? final;
      const more = state.moreCovers.get(final.platform);
      // `count` is the total once "Make 3 more" lands; until then the 3 new ones are not drawn yet.
      const drawn = more === undefined ? 3 : now() - more.at < COVERS_MS ? more.count - 3 : more.count;
      const coverCount = elapsed < PUBLISH_MS * 0.65 ? 0 : drawn;
      return {
        ...base,
        status: elapsed < PUBLISH_MS ? 'rendering' : 'ready',
        caption: elapsed < PUBLISH_MS * 0.4 ? '' : base.caption,
        hashtags: elapsed < PUBLISH_MS * 0.4 ? [] : base.hashtags,
        cover_urls: Array.from({ length: coverCount }, (_, i) => sceneThumb(`cover-${final.platform}-${String(i)}`)),
      };
    });
    return { exports: items, busy: elapsed < PUBLISH_MS || coversBusy };
  }

  function publishEvents(): ScheduledEvent[] {
    const elapsed = state.publishStartedAt === null ? Number.POSITIVE_INFINITY : now() - state.publishStartedAt;
    if (elapsed >= PUBLISH_MS) return [{ delayMs: 0, data: { step: 'done', status: 'done' } }];
    const steps: [number, string][] = [
      [0, 'exports'],
      [PUBLISH_MS * 0.2, 'pack'],
      [PUBLISH_MS * 0.4, 'covers'],
      [PUBLISH_MS * 0.65, 'render'],
    ];
    return [
      ...steps.map(([at, step]) => ({ delayMs: Math.max(0, at - elapsed), data: { step, status: 'running' } })),
      { delayMs: PUBLISH_MS - elapsed, data: { step: 'done', status: 'done' } },
    ];
  }

  function editExport(platform: string, body: unknown): MockReply {
    const item = exportsNow().exports.find((e) => e.platform === platform);
    if (item === undefined) return fail(404, 'NOT_FOUND', 'no export for that platform');
    const b = (body ?? {}) as { caption?: unknown; hashtags?: unknown; cover_pick?: unknown };
    const caption = typeof b.caption === 'string' ? b.caption.trim() : item.caption;
    if (charCount(caption) > item.caption_limit) {
      return fail(400, 'VALIDATION_FAILED', `the ${platform} caption is at most ${String(item.caption_limit)} characters`);
    }
    const next: ExportItem = {
      ...item,
      caption,
      hashtags: Array.isArray(b.hashtags) ? b.hashtags.filter((t): t is string => typeof t === 'string') : item.hashtags,
      cover_pick: typeof b.cover_pick === 'number' ? b.cover_pick : item.cover_pick,
    };
    state.exports = [...state.exports.filter((e) => e.platform !== item.platform), next];
    return { kind: 'empty', status: 204 };
  }

  const brandBody = (kit: BrandKit): BrandKit => ({
    ...kit,
    logo_url: kit.logo_key === null ? null : sceneThumb(kit.logo_key),
    ref_urls: kit.ref_keys.map((key) => sceneThumb(key)),
  });

  const id = (m: RegExpMatchArray) => decodeURIComponent(m[1] ?? '');

  const routes: MockRoute[] = [
    ['GET', /^\/productions$/, () => json(state.productions.map((p) => listItem(current(p))), 300)],
    ['POST', /^\/productions$/, (_m, req) => create(req.body)],
    ['GET', /^\/productions\/([^/]+)$/, (m) => {
      const stored = find(id(m));
      return stored === undefined ? fail(404, 'NOT_FOUND', 'no such production') : json(current(stored), 300);
    }],
    ['DELETE', /^\/productions\/([^/]+)$/, (m) => {
      if (find(id(m)) === undefined) return fail(404, 'NOT_FOUND', 'no such production');
      state.productions = state.productions.filter((p) => p.production.production_id !== id(m));
      return { kind: 'empty', status: 204 };
    }],
    ['GET', /^\/productions\/([^/]+)\/events$/, (m) => {
      const startedAt = state.planRuns.get(id(m));
      if (startedAt === undefined) return { kind: 'sse', events: [{ delayMs: 0, data: { step: 'done', status: 'done' } }], loopMs: null };
      return { kind: 'sse', events: planEvents(template.shots.length, now() - startedAt), loopMs: null };
    }],
    ['POST', /^\/productions\/([^/]+)\/coverage$/, () => json({ started: false }, 200, 202)],
    ['POST', /^\/productions\/([^/]+)\/retry$/, (m) => {
      const stored = find(id(m));
      if (stored === undefined) return fail(404, 'NOT_FOUND', 'no such production');
      if (stored.production.status !== 'failed') return fail(400, 'VALIDATION_FAILED', 'only a stopped plan can be retried');
      state.planRuns.set(id(m), now());
      return json({ started: true }, 200, 202);
    }],
    ['POST', /^\/productions\/([^/]+)\/cut$/, (m) => {
      const stored = find(id(m));
      if (stored === undefined) return fail(404, 'NOT_FOUND', 'no such production');
      if (!stored.can_cut) return fail(400, 'VALIDATION_FAILED', 'film a few more shots first');
      state.productions = state.productions.map((p) =>
        p === stored ? { ...p, production: { ...p.production, status: 'cutting', short_id: STORY_SHORT_ID } } : p,
      );
      return json({ short_id: STORY_SHORT_ID }, 600);
    }],
    ['GET', /^\/shorts\/([^/]+)\/production$/, (m) => {
      const owner = state.productions.find((p) => p.production.short_id === id(m));
      if (owner === undefined) return fail(404, 'NOT_FOUND', 'the short is not a production story');
      return json({
        production_id: owner.production.production_id,
        title: owner.production.title,
        status: owner.production.status,
        shots: owner.shots.map((s) => ({ ord: s.ord, act: s.act, title: s.title, duration_s: s.duration_s, segment_id: s.match?.segment_id ?? null })),
      }, 200);
    }],
    ['GET', /^\/shorts\/([^/]+)\/finish$/, (m) => json(state.finish.get(id(m)) ?? DEFAULT_FINISH, 200)],
    ['PUT', /^\/shorts\/([^/]+)\/finish$/, (m, req) => {
      const b = (req.body ?? {}) as Partial<ShortFinish>;
      if (typeof b.blur_bystanders !== 'boolean') return fail(400, 'VALIDATION_FAILED', 'blur_bystanders must be a boolean');
      const saved: ShortFinish = { ...DEFAULT_FINISH, ...b };
      state.finish.set(id(m), saved);
      return json(saved, 300);
    }],
    ['GET', /^\/brand$/, () => json({ kit: state.brand === null ? null : brandBody(state.brand) }, 250)],
    ['PUT', /^\/brand$/, (_m, req) => {
      const b = (req.body ?? {}) as { colors?: unknown; title_font?: unknown; logo_key?: unknown; ref_keys?: unknown };
      if (!Array.isArray(b.colors) || b.colors.length === 0 || b.colors.length > 3) {
        return fail(400, 'VALIDATION_FAILED', 'colors must be 1 to 3 #rrggbb values');
      }
      state.brand = {
        colors: b.colors.filter((c): c is string => typeof c === 'string'),
        title_font: b.title_font === 'geist' ? 'geist' : 'bricolage',
        logo_key: typeof b.logo_key === 'string' ? b.logo_key : null,
        logo_url: null,
        ref_keys: Array.isArray(b.ref_keys) ? b.ref_keys.filter((k): k is string => typeof k === 'string') : [],
        ref_urls: [],
        updated_at: new Date(now()).toISOString(),
      };
      return json(brandBody(state.brand), 400);
    }],
    ['POST', /^\/brand\/uploads$/, (_m, req) => {
      const b = (req.body ?? {}) as { kind?: unknown; slot?: unknown };
      const name = b.kind === 'logo' ? 'logo' : `ref_${String(typeof b.slot === 'number' ? b.slot : 0)}`;
      return json({ key: `users/u_demo/brand/${name}.png`, url: `/mock-s3/brand/${name}` }, 200);
    }],
    ['GET', /^\/shorts\/([^/]+)\/exports$/, () => json(exportsNow(), 250)],
    ['POST', /^\/shorts\/([^/]+)\/exports$/, () => {
      state.publishStartedAt = now();
      state.exports = [];
      state.moreCovers = new Map();
      return json({ started: true }, 300, 202);
    }],
    ['GET', /^\/shorts\/([^/]+)\/exports\/events$/, () => ({ kind: 'sse', events: publishEvents(), loopMs: null })],
    ['PUT', /^\/shorts\/([^/]+)\/exports\/([^/]+)$/, (m, req) => editExport(decodeURIComponent(m[2] ?? ''), req.body)],
    ['POST', /^\/shorts\/([^/]+)\/exports\/([^/]+)\/covers$/, (m) => {
      const platform = PLATFORMS.find((p) => p === decodeURIComponent(m[2] ?? ''));
      if (platform === undefined) return fail(400, 'VALIDATION_FAILED', 'unknown platform');
      const count = state.moreCovers.get(platform)?.count ?? 3;
      if (count >= 9) return fail(400, 'VALIDATION_FAILED', 'a platform has at most 9 covers');
      state.moreCovers.set(platform, { count: count + 3, at: now() });
      return json({ started: true }, 200, 202);
    }],
  ];
  return { routes };
}
