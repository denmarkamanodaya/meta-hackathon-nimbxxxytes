// Mock Production Studio for `npm run dev:mock`: productions (a new one replays its plan: shot
// list, storyboards one by one, then coverage, then its key art), footage boards and their
// redraw, New art and Use as cover, a story short's acts, finish settings, the brand kit with fake
// uploads, and a publish pack that renders for a few seconds, with styled covers, Make 3 more,
// Redraw with words and a cover title whose still bakes for a moment. Pure request → reply.
import { productionTitleProblem, tidyProductionTitle } from '../../core/production-view';
import { charCount, COVER_TITLE_MAX, MAX_COVERS, REDRAW_MAX, REDRAW_MIN } from '../../core/publish';
import { parseExports, parseBrand, parseProductionDetail } from '../../services/api/parse-studio';
import type {
  BrandKit,
  CoverStyle,
  CoverTitle,
  ExportItem,
  Platform,
  ProductionDetail,
  ProductionListItem,
  ProductionShot,
  ShortFinish,
} from '../../services/api/types';
import { CUTOUT_BACKGROUNDS, CUTOUT_STYLE, PICKABLE_COVER_STYLES, PLATFORMS, type CutoutBackground } from '../../services/api/types';
import brandJson from '../fixtures/brand.json';
import exportsJson from '../fixtures/exports.json';
import productionsJson from '../fixtures/productions.json';
import { fail, json, type MockReply, type MockRoute } from './reply';
import type { ScheduledEvent } from './short-replay';
import { cutoutCover, sceneThumb } from './thumbs';

/** When the plan's shot list lands, after the run starts, ms. */
export const PLAN_SHOT_LIST_MS = 1500;
/** Time per storyboard frame, ms. */
export const PLAN_BOARD_MS = 600;
/** How long the coverage check takes, ms. */
export const PLAN_COVERAGE_MS = 1500;
/** How long a publish run takes, ms. */
export const PUBLISH_MS = 4000;
/** How long "Make 3 more" and a redraw take, ms. */
export const COVERS_MS = 1500;
/** How long a cutout cover takes (SAM, then the scene, then the still), ms. */
export const CUTOUT_COVER_MS = 2500;
/** How long a titled cover still takes to bake, ms. */
export const STILL_MS = 1000;
/** How long a footage board or key art takes to draw, ms. */
export const DRAW_MS = 2000;

/** The short every mock production cuts to (the fixture short). */
const STORY_SHORT_ID = 'sh_fixture';

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}

const parseDetails = (value: unknown): ProductionDetail[] =>
  Array.isArray(value) ? value.map((item, index) => must(parseProductionDetail(item), `productions.json[${String(index)}]`)) : [];

/** A drawing in flight or done: its version (each redraw gets a new picture) and when it lands. */
interface Drawing {
  version: number;
  readyAt: number;
}

/** One cover as the mock keeps it: how it was drawn and when it lands. */
interface MockCover {
  style: CoverStyle;
  instruction: string | null;
  /** A cutout cover's background; null for the others. */
  background: CutoutBackground | null;
  readyAt: number;
}

/** A shot as drawn: its storyboard, its footage board when covered, and its moment's thumbnail. */
const withImages = (shot: ProductionShot, footage: Drawing | undefined, at: number): ProductionShot => ({
  ...shot,
  board_url: sceneThumb(`${shot.shot_id}:board`),
  footage_board_url:
    shot.match === null ? null : sceneThumb(`${shot.shot_id}:footage:${String(drawnVersion(footage, at))}`),
  match: shot.match === null ? null : { ...shot.match, thumb_url: sceneThumb(shot.match.segment_id) },
});

/** The version on screen: a redraw in flight still shows the one before it. */
const drawnVersion = (drawing: Drawing | undefined, at: number) =>
  drawing === undefined ? 0 : at >= drawing.readyAt ? drawing.version : drawing.version - 1;

const isDrawing = (drawing: Drawing | undefined, at: number) => drawing !== undefined && at < drawing.readyAt;

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
  /** Every cover per platform, drawn or on its way. */
  covers: Map<Platform, MockCover[]>;
  /** When each platform's titled still started baking. */
  stillAt: Map<Platform, number>;
  /** Footage boards per shot id. */
  boards: Map<string, Drawing>;
  /** Key art per production id. */
  art: Map<string, Drawing>;
}

/** A cover title from a request body, or null when it breaks the rules. */
function readTitle(value: unknown): CoverTitle | null {
  const t = (value ?? {}) as { text?: unknown; show?: unknown; position?: unknown };
  if (typeof t.text !== 'string' || typeof t.show !== 'boolean') return null;
  const text = t.text.trim();
  if (text === '' || charCount(text) > COVER_TITLE_MAX) return null;
  if (t.position !== 'top' && t.position !== 'bottom') return null;
  return { text, show: t.show, position: t.position };
}

const DEFAULT_FINISH: ShortFinish = { blur_bystanders: true, title_text: null, speaker_colors: false, effect: 'none', keep_subject: true };

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
    covers: new Map(),
    stillAt: new Map(),
    boards: new Map(),
    // Planned productions got their key art drawn once when planning finished.
    art: new Map(fixtures.filter((p) => p.production.status !== 'planning').map((p) => [p.production.production_id, { version: 1, readyAt: 0 }])),
  };

  /** The production's key art fields as the API shows them now. */
  const artOf = (id: string) => {
    const art = state.art.get(id);
    const version = drawnVersion(art, now());
    return { art_url: version === 0 ? null : sceneThumb(`${id}:art:${String(version)}`), art_drawing: isDrawing(art, now()) };
  };

  const startDrawing = (drawings: Map<string, Drawing>, id: string, delayMs = 0) => {
    drawings.set(id, { version: (drawings.get(id)?.version ?? 0) + 1, readyAt: now() + delayMs + DRAW_MS });
  };

  /** A production as the API shows it now: a plan run in flight reveals its shots over time. */
  function current(stored: ProductionDetail): ProductionDetail {
    const id = stored.production.production_id;
    const startedAt = state.planRuns.get(id);
    if (startedAt === undefined) {
      const boardsBusy = stored.shots.some((shot) => isDrawing(state.boards.get(shot.shot_id), now()));
      return {
        ...stored,
        production: { ...stored.production, ...artOf(id) },
        shots: stored.shots.map((shot) => withImages(shot, state.boards.get(shot.shot_id), now())),
        busy: stored.busy || boardsBusy,
      };
    }
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
      // Key art is drawn once, automatically, when planning finishes.
      if (!state.art.has(id)) startDrawing(state.art, id);
      return current(done);
    }
    const boards = Math.floor((elapsed - PLAN_SHOT_LIST_MS) / PLAN_BOARD_MS);
    const shots =
      elapsed < PLAN_SHOT_LIST_MS
        ? []
        : planned.map((shot, i) => ({ ...shot, match: null, board_url: i < boards ? sceneThumb(`${shot.shot_id}:board`) : null }));
    return {
      ...stored,
      production: { ...stored.production, status: 'planning', error: null, ...artOf(id) },
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
      art_url: p.art_url,
      art_drawing: p.art_drawing,
    };
  }

  const find = (id: string) => state.productions.find((p) => p.production.production_id === id);

  function rename(productionId: string, body: unknown): MockReply {
    const stored = find(productionId);
    if (stored === undefined) return fail(404, 'NOT_FOUND', 'no such production');
    const raw = (body ?? {}) as { title?: unknown };
    const title = typeof raw.title === 'string' ? raw.title : '';
    const problem = productionTitleProblem(title);
    if (problem !== null) return fail(400, 'VALIDATION_FAILED', problem);
    const renamed = { ...stored, production: { ...stored.production, title: tidyProductionTitle(title) } };
    state.productions = state.productions.map((p) => (p.production.production_id === productionId ? renamed : p));
    return json(current(renamed), 300);
  }

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
        art_url: null,
        art_drawing: false,
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

  const coversOf = (platform: Platform) => state.covers.get(platform) ?? [];

  /** Adds covers to a platform, landing `delayMs` from now; null when that passes the cap. */
  function addCovers(platform: Platform, added: Omit<MockCover, 'readyAt'>[], delayMs: number): MockReply | null {
    const covers = coversOf(platform);
    if (covers.length + added.length > MAX_COVERS) return fail(400, 'VALIDATION_FAILED', 'a platform has at most 9 covers');
    state.covers.set(platform, [...covers, ...added.map((c) => ({ ...c, readyAt: now() + delayMs }))]);
    return null;
  }

  /** Every platform's export as the API shows it now. */
  function exportsNow(): { exports: ExportItem[]; busy: boolean } {
    if (state.publishStartedAt === null) return { exports: [], busy: false };
    const elapsed = now() - state.publishStartedAt;
    const coversBusy = PLATFORMS.some((p) => coversOf(p).some((c) => c.readyAt > now()));
    const items = finalExports.map((final): ExportItem => {
      const edited = state.exports.find((e) => e.platform === final.platform);
      const base = edited ?? final;
      const covers = coversOf(final.platform)
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.readyAt <= now())
        .map(({ c, i }) => ({
          url: c.background === null ? sceneThumb(`${String(i)}-${final.platform}-${c.style}`) : cutoutCover(`${String(i)}-${final.platform}`, c.background),
          style: c.style,
          instruction: c.instruction,
          background: c.background,
        }));
      const picked = covers[base.cover_pick] ?? covers[0];
      const title = base.cover_title;
      const baking = now() - (state.stillAt.get(final.platform) ?? 0) < STILL_MS;
      const download =
        picked === undefined || baking ? null : title.show ? sceneThumb(`${picked.url}|${title.text}|${title.position}`) : picked.url;
      return {
        ...base,
        status: elapsed < PUBLISH_MS ? 'rendering' : 'ready',
        caption: elapsed < PUBLISH_MS * 0.4 ? '' : base.caption,
        hashtags: elapsed < PUBLISH_MS * 0.4 ? [] : base.hashtags,
        covers,
        download_cover_url: download,
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
    const b = (body ?? {}) as { caption?: unknown; hashtags?: unknown; cover_pick?: unknown; cover_title?: unknown };
    const caption = typeof b.caption === 'string' ? b.caption.trim() : item.caption;
    if (charCount(caption) > item.caption_limit) {
      return fail(400, 'VALIDATION_FAILED', `the ${platform} caption is at most ${String(item.caption_limit)} characters`);
    }
    if (typeof b.cover_pick === 'number' && (b.cover_pick < 0 || b.cover_pick >= item.covers.length)) {
      return fail(400, 'VALIDATION_FAILED', 'no such cover');
    }
    const title = b.cover_title === undefined ? item.cover_title : readTitle(b.cover_title);
    if (title === null) return fail(400, 'VALIDATION_FAILED', `the cover title is 1 to ${String(COVER_TITLE_MAX)} characters`);
    const next: ExportItem = {
      ...item,
      caption,
      hashtags: Array.isArray(b.hashtags) ? b.hashtags.filter((t): t is string => typeof t === 'string') : item.hashtags,
      cover_pick: typeof b.cover_pick === 'number' ? b.cover_pick : item.cover_pick,
      cover_title: title,
    };
    // A new pick or title re-bakes the titled still in the background.
    if (b.cover_pick !== undefined || b.cover_title !== undefined) state.stillAt.set(item.platform, now());
    state.exports = [...state.exports.filter((e) => e.platform !== item.platform), next];
    return { kind: 'empty', status: 204 };
  }

  const brandBody = (kit: BrandKit): BrandKit => ({
    ...kit,
    logo_url: kit.logo_key === null ? null : sceneThumb(kit.logo_key),
    ref_urls: kit.ref_keys.map((key) => sceneThumb(key)),
  });

  const id = (m: RegExpMatchArray) => decodeURIComponent(m[1] ?? '');
  const platformOf = (m: RegExpMatchArray) => PLATFORMS.find((p) => p === decodeURIComponent(m[2] ?? ''));

  function moreCovers(m: RegExpMatchArray, body: unknown): MockReply {
    const platform = platformOf(m);
    if (platform === undefined) return fail(400, 'VALIDATION_FAILED', 'unknown platform');
    const asked = (body ?? {}) as { style?: unknown; background?: unknown };
    if (asked.style === CUTOUT_STYLE) {
      const background = asked.background === undefined ? 'scene' : CUTOUT_BACKGROUNDS.find((b) => b === asked.background);
      if (background === undefined) return fail(400, 'VALIDATION_FAILED', 'background is scene or blur');
      return addCovers(platform, [{ style: 'cutout', instruction: null, background }], CUTOUT_COVER_MS) ?? json({ started: true }, 200, 202);
    }
    const style = asked.style === undefined ? null : PICKABLE_COVER_STYLES.find((s) => s === asked.style);
    if (style === undefined) return fail(400, 'VALIDATION_FAILED', 'only bright, close_detail, dramatic, illustrated or brand_scene');
    const count = coversOf(platform).length;
    if (count >= MAX_COVERS) return fail(400, 'VALIDATION_FAILED', 'a platform has at most 9 covers');
    // Up to three, stopping at the cap; with no style they run through the first three styles.
    const styles = Array.from({ length: Math.min(3, MAX_COVERS - count) }, (_, i) => style ?? PICKABLE_COVER_STYLES[(count + i) % 3] ?? 'bright');
    return addCovers(platform, styles.map((s) => ({ style: s, instruction: null, background: null })), COVERS_MS) ?? json({ started: true }, 200, 202);
  }

  function redrawCover(m: RegExpMatchArray, body: unknown): MockReply {
    const platform = platformOf(m);
    if (platform === undefined) return fail(400, 'VALIDATION_FAILED', 'unknown platform');
    const n = Number(m[3]);
    if (!Number.isInteger(n) || n < 0 || n >= coversOf(platform).length) return fail(400, 'VALIDATION_FAILED', 'no such cover');
    const words = (body ?? {}) as { instruction?: unknown };
    const instruction = typeof words.instruction === 'string' ? words.instruction.trim() : '';
    if (charCount(instruction) < REDRAW_MIN || charCount(instruction) > REDRAW_MAX) {
      return fail(400, 'VALIDATION_FAILED', `say how to change it in ${String(REDRAW_MIN)} to ${String(REDRAW_MAX)} characters`);
    }
    return addCovers(platform, [{ style: 'redrawn', instruction, background: null }], COVERS_MS) ?? json({ started: true }, 200, 202);
  }

  function useArtAsCover(productionId: string): MockReply {
    if (artOf(productionId).art_url === null) return fail(400, 'VALIDATION_FAILED', 'draw the key art first');
    if (state.publishStartedAt === null) return fail(400, 'VALIDATION_FAILED', 'publish the story first');
    // A platform at the cap is skipped.
    const platforms = PLATFORMS.filter((platform) => addCovers(platform, [{ style: 'key_art', instruction: null, background: null }], 0) === null);
    return json({ platforms }, 200);
  }

  const routes: MockRoute[] = [
    ['GET', /^\/productions$/, () => json(state.productions.map((p) => listItem(current(p))), 300)],
    ['POST', /^\/productions$/, (_m, req) => create(req.body)],
    ['GET', /^\/productions\/([^/]+)$/, (m) => {
      const stored = find(id(m));
      return stored === undefined ? fail(404, 'NOT_FOUND', 'no such production') : json(current(stored), 300);
    }],
    ['PUT', /^\/productions\/([^/]+)$/, (m, req) => rename(id(m), req.body)],
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
    ['POST', /^\/productions\/([^/]+)\/shots\/([^/]+)\/board$/, (m) => {
      const stored = find(id(m));
      if (stored === undefined) return fail(404, 'NOT_FOUND', 'no such production');
      const shot = stored.shots.find((s) => s.shot_id === decodeURIComponent(m[2] ?? ''));
      if (shot === undefined) return fail(404, 'NOT_FOUND', 'no such shot');
      if (shot.match === null) return fail(400, 'VALIDATION_FAILED', 'only a covered shot is drawn from footage');
      startDrawing(state.boards, shot.shot_id);
      return json({ started: true }, 200, 202);
    }],
    ['POST', /^\/productions\/([^/]+)\/art$/, (m) => {
      if (find(id(m)) === undefined) return fail(404, 'NOT_FOUND', 'no such production');
      if (artOf(id(m)).art_drawing) return json({ started: false }, 200, 202);
      startDrawing(state.art, id(m));
      return json({ started: true }, 200, 202);
    }],
    ['POST', /^\/productions\/([^/]+)\/art\/cover$/, (m) =>
      find(id(m)) === undefined ? fail(404, 'NOT_FOUND', 'no such production') : useArtAsCover(id(m))],
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
      const firstThree = PICKABLE_COVER_STYLES.slice(0, 3).map((style) => ({ style, instruction: null, background: null, readyAt: now() + PUBLISH_MS * 0.65 }));
      state.covers = new Map(PLATFORMS.map((p) => [p, firstThree]));
      state.stillAt = new Map(PLATFORMS.map((p) => [p, now() + PUBLISH_MS * 0.65]));
      return json({ started: true }, 300, 202);
    }],
    ['GET', /^\/shorts\/([^/]+)\/exports\/events$/, () => ({ kind: 'sse', events: publishEvents(), loopMs: null })],
    ['PUT', /^\/shorts\/([^/]+)\/exports\/([^/]+)$/, (m, req) => editExport(decodeURIComponent(m[2] ?? ''), req.body)],
    ['POST', /^\/shorts\/([^/]+)\/exports\/([^/]+)\/covers$/, (m, req) => moreCovers(m, req.body)],
    ['POST', /^\/shorts\/([^/]+)\/exports\/([^/]+)\/covers\/(\d+)\/redraw$/, (m, req) => redrawCover(m, req.body)],
  ];
  return { routes };
}
