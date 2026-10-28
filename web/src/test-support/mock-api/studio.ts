// Mock publishing for `npm run dev:mock`: finish settings, the brand kit with fake uploads, and a
// publish pack that renders for a few seconds, with styled covers, Make 3 more, Redraw with words
// and a cover title whose still bakes for a moment. Pure request → reply.
import { charCount, COVER_TITLE_MAX, MAX_COVERS, REDRAW_MAX, REDRAW_MIN } from '../../core/publish';
import { parseExports, parseBrand } from '../../services/api/parse-studio';
import type { BrandKit, CoverStyle, CoverTitle, ExportItem, Platform, ShortFinish } from '../../services/api/types';
import { CUTOUT_BACKGROUNDS, CUTOUT_STYLE, PICKABLE_COVER_STYLES, PLATFORMS, type CutoutBackground } from '../../services/api/types';
import brandJson from '../fixtures/brand.json';
import exportsJson from '../fixtures/exports.json';
import { fail, json, type MockReply, type MockRoute } from './reply';
import type { ScheduledEvent } from './short-replay';
import { cutoutCover, sceneThumb } from './thumbs';

/** How long a publish run takes, ms. */
export const PUBLISH_MS = 4000;
/** How long "Make 3 more" and a redraw take, ms. */
export const COVERS_MS = 1500;
/** How long a cutout cover takes (SAM, then the scene, then the still), ms. */
export const CUTOUT_COVER_MS = 2500;
/** How long a titled cover still takes to bake, ms. */
export const STILL_MS = 1000;
function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`mock fixture ${name} does not parse`);
  return value;
}

/** One cover as the mock keeps it: how it was drawn and when it lands. */
interface MockCover {
  style: CoverStyle;
  instruction: string | null;
  /** A cutout cover's background; null for the others. */
  background: CutoutBackground | null;
  readyAt: number;
}

/** Mutable Studio state; one per dev server. */
interface StudioState {
  finish: Map<string, ShortFinish>;
  brand: BrandKit | null;
  publishStartedAt: number | null;
  exports: ExportItem[];
  /** Every cover per platform, drawn or on its way. */
  covers: Map<Platform, MockCover[]>;
  /** When each platform's titled still started baking. */
  stillAt: Map<Platform, number>;
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
  const finalExports = must(parseExports(exportsJson), 'exports.json').exports;
  const state: StudioState = {
    finish: new Map(),
    brand: must(parseBrand(brandJson), 'brand.json').kit,
    publishStartedAt: null,
    exports: [],
    covers: new Map(),
    stillAt: new Map(),
  };

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

  const routes: MockRoute[] = [
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
