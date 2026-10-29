// Parsers for the publishing endpoints: the finish settings, the brand kit, exports and the step
// events of publish runs.
import {
  isBoolean,
  isNonNegativeInt,
  isNullable,
  isPositiveInt,
  isRecord,
  isStepStatus,
  isString,
  isStringArray,
  oneOf,
  parseEvery,
} from './json-guards';
import type { Parse } from './parse';
import {
  COVER_STYLES,
  CUTOUT_BACKGROUNDS,
  PLATFORMS,
  type BrandKit,
  type BrandResponse,
  type BrandUploadResponse,
  type CoverStyle,
  type CoverTile,
  type CoverTitle,
  type CoverTitlePosition,
  type CutoutBackground,
  type ExportAspect,
  type ExportItem,
  type ExportsResponse,
  type ExportStatus,
  type FinishEffect,
  type Platform,
  type ShortFinish,
  type StartedResponse,
  type StudioStepEvent,
  type TitleFont,
} from './types';

const isEffect = oneOf<FinishEffect>(['none', 'spotlight', 'blur_bg']);
const isTitleFont = oneOf<TitleFont>(['bricolage', 'geist']);
const isPlatform = oneOf<Platform>(PLATFORMS);
const isExportAspect = oneOf<ExportAspect>(['4:5', '1:1', '9:16']);
const isExportStatus = oneOf<ExportStatus>(['queued', 'rendering', 'ready', 'failed']);
const isCoverStyle = oneOf<CoverStyle>(COVER_STYLES);
const isTitlePosition = oneOf<CoverTitlePosition>(['top', 'bottom']);
const isCutoutBackground = oneOf<CutoutBackground>(CUTOUT_BACKGROUNDS);

/** Parses the 202 answer of exports, covers, redraws and new art. */
export const parseStarted: Parse<StartedResponse> = (body) =>
  isRecord(body) && isBoolean(body.started) ? { started: body.started } : null;

/** Parses `GET/PUT /shorts/{id}/finish`. */
export const parseFinish: Parse<ShortFinish> = (body) => {
  if (!isRecord(body) || !isBoolean(body.blur_bystanders) || !isBoolean(body.speaker_colors)) return null;
  const title = body.title_text === undefined ? null : body.title_text;
  if (!isNullable(title, isString) || !isEffect(body.effect)) return null;
  // Absent on a server from before the switch: on, its default.
  const keep = body.keep_subject === undefined ? true : body.keep_subject;
  if (!isBoolean(keep)) return null;
  return {
    blur_bystanders: body.blur_bystanders,
    title_text: title,
    speaker_colors: body.speaker_colors,
    effect: body.effect,
    keep_subject: keep,
  };
};

/** Parses a saved brand kit (the `PUT /brand` answer, the `kit` of `GET /brand`). */
export const parseBrandKit: Parse<BrandKit> = (body) => {
  if (!isRecord(body) || !isStringArray(body.colors) || !isTitleFont(body.title_font)) return null;
  const { logo_key, logo_url, ref_keys, ref_urls, updated_at } = body;
  if (!isNullable(logo_key, isString) || !isNullable(logo_url, isString)) return null;
  if (!isStringArray(ref_keys) || !isStringArray(ref_urls) || !isString(updated_at)) return null;
  return { colors: body.colors, title_font: body.title_font, logo_key, logo_url, ref_keys, ref_urls, updated_at };
};

/** Parses `GET /brand`. */
export const parseBrand: Parse<BrandResponse> = (body) => {
  if (!isRecord(body)) return null;
  if (body.kit === null) return { kit: null };
  const kit = parseBrandKit(body.kit);
  return kit === null ? null : { kit };
};

/** Parses `POST /brand/uploads`. */
export const parseBrandUpload: Parse<BrandUploadResponse> = (body) =>
  isRecord(body) && isString(body.key) && isString(body.url) ? { key: body.key, url: body.url } : null;

function parseCoverTile(value: unknown): CoverTile | null {
  if (!isRecord(value) || !isString(value.url) || !isCoverStyle(value.style)) return null;
  const instruction = value.instruction === undefined ? null : value.instruction;
  const background = value.background === undefined ? null : value.background;
  if (!isNullable(instruction, isString) || !isNullable(background, isCutoutBackground)) return null;
  return { url: value.url, style: value.style, instruction, background };
}

function parseCoverTitle(value: unknown): CoverTitle | null {
  if (!isRecord(value) || !isString(value.text) || !isBoolean(value.show) || !isTitlePosition(value.position)) return null;
  return { text: value.text, show: value.show, position: value.position };
}

function parseExport(value: unknown): ExportItem | null {
  if (!isRecord(value) || !isPlatform(value.platform) || !isExportAspect(value.aspect)) return null;
  const { version_n, status, render_url, caption, caption_limit, hashtags, cover_pick, download_cover_url, updated_at } = value;
  if (!isPositiveInt(version_n) || !isExportStatus(status) || !isNullable(render_url, isString)) return null;
  if (!isString(caption) || !isPositiveInt(caption_limit) || !isStringArray(hashtags)) return null;
  if (!isNonNegativeInt(cover_pick) || !isNullable(download_cover_url, isString) || !isString(updated_at)) return null;
  const covers = parseEvery(value.covers, parseCoverTile);
  const cover_title = parseCoverTitle(value.cover_title);
  if (covers === null || cover_title === null) return null;
  return {
    platform: value.platform,
    aspect: value.aspect,
    version_n,
    status,
    render_url,
    caption,
    caption_limit,
    hashtags,
    covers,
    cover_pick,
    cover_title,
    download_cover_url,
    updated_at,
  };
}

/** Parses `GET /shorts/{id}/exports`. */
export const parseExports: Parse<ExportsResponse> = (body) => {
  if (!isRecord(body) || !isBoolean(body.busy)) return null;
  const exports = parseEvery(body.exports, parseExport);
  return exports === null ? null : { exports, busy: body.busy };
};

/**
 * Parses one SSE `data` string of a publish run.
 * @param data - The raw event data.
 * @returns The event, or null for invalid JSON or an unknown status.
 */
export function parseStudioStep(data: string): StudioStepEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null; // Recovers: a malformed event is skipped; polling still has the state.
  }
  if (!isRecord(json) || !isString(json.step) || !isStepStatus(json.status)) return null;
  return { step: json.step, status: json.status };
}
