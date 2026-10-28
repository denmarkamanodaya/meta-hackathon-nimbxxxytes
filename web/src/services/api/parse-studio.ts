// Parsers for the Production Studio endpoints: productions, a story short's acts, the finish
// settings, the brand kit, exports and the step events of plan and publish runs.
import {
  isAspect,
  isBoolean,
  isNonNegativeInt,
  isNullable,
  isNumber,
  isPositiveInt,
  isRecord,
  isStepStatus,
  isString,
  isStringArray,
  oneOf,
  parseEvery,
} from './json-guards';
import { parseArtFields } from './parse-art';
import type { Parse } from './parse';
import {
  ACTS,
  COVER_STYLES,
  CUTOUT_BACKGROUNDS,
  PLATFORMS,
  type Act,
  type ActShot,
  type BrandKit,
  type BrandResponse,
  type BrandUploadResponse,
  type CoverStyle,
  type CoverTile,
  type CoverTitle,
  type CoverTitlePosition,
  type CreateProductionResponse,
  type CutoutBackground,
  type CutResponse,
  type ExportAspect,
  type ExportItem,
  type ExportsResponse,
  type ExportStatus,
  type FinishEffect,
  type Platform,
  type ProductionDetail,
  type ProductionFormat,
  type ProductionListItem,
  type ProductionShot,
  type ProductionStatus,
  type ProductionSummary,
  type ShortFinish,
  type ShortProduction,
  type ShotMatch,
  type ArtCoverResponse,
  type StartedResponse,
  type StudioStepEvent,
  type TitleFont,
} from './types';

const isFormat = oneOf<ProductionFormat>(['story', 'short']);
const isAct = oneOf<Act>(ACTS);
const isProductionStatus = oneOf<ProductionStatus>(['planning', 'shooting', 'cutting', 'ready', 'published', 'failed']);
const isEffect = oneOf<FinishEffect>(['none', 'spotlight', 'blur_bg']);
const isTitleFont = oneOf<TitleFont>(['bricolage', 'geist']);
const isPlatform = oneOf<Platform>(PLATFORMS);
const isExportAspect = oneOf<ExportAspect>(['4:5', '1:1', '9:16']);
const isExportStatus = oneOf<ExportStatus>(['queued', 'rendering', 'ready', 'failed']);
const isCoverStyle = oneOf<CoverStyle>(COVER_STYLES);
const isTitlePosition = oneOf<CoverTitlePosition>(['top', 'bottom']);
const isCutoutBackground = oneOf<CutoutBackground>(CUTOUT_BACKGROUNDS);

function parseListItem(value: unknown): ProductionListItem | null {
  if (!isRecord(value) || !isString(value.production_id) || !isString(value.title)) return null;
  const { format, aspect, target_s, status, shot_count, covered_count, missing_titles, cover_url, created_at } = value;
  if (!isFormat(format) || !isAspect(aspect) || !isNumber(target_s) || !isProductionStatus(status)) return null;
  if (!isNonNegativeInt(shot_count) || !isNonNegativeInt(covered_count) || !isStringArray(missing_titles)) return null;
  if (!isNullable(cover_url, isString) || !isString(created_at)) return null;
  const art = parseArtFields(value);
  if (art === null) return null;
  return {
    production_id: value.production_id,
    title: value.title,
    format,
    aspect,
    target_s,
    status,
    shot_count,
    covered_count,
    missing_titles,
    cover_url,
    created_at,
    ...art,
  };
}

/** Parses `GET /productions`. */
export const parseProductionList: Parse<ProductionListItem[]> = (body) => parseEvery(body, parseListItem);

/** Parses `POST /productions`. */
export const parseCreateProduction: Parse<CreateProductionResponse> = (body) =>
  isRecord(body) && isString(body.production_id) ? { production_id: body.production_id } : null;

function parseSummary(value: unknown): ProductionSummary | null {
  if (!isRecord(value) || !isString(value.production_id) || !isString(value.title) || !isString(value.brief)) return null;
  const { format, aspect, target_s, blur_bystanders, status, short_id, coverage_checked_at, error, created_at } = value;
  if (!isFormat(format) || !isAspect(aspect) || !isNumber(target_s) || !isBoolean(blur_bystanders)) return null;
  if (!isProductionStatus(status) || !isNullable(short_id, isString)) return null;
  if (!isNullable(coverage_checked_at, isString) || !isNullable(error, isString) || !isString(created_at)) return null;
  const art = parseArtFields(value);
  if (art === null) return null;
  return {
    production_id: value.production_id,
    title: value.title,
    brief: value.brief,
    format,
    aspect,
    target_s,
    blur_bystanders,
    status,
    short_id,
    coverage_checked_at,
    error,
    created_at,
    ...art,
  };
}

function parseMatch(value: unknown): ShotMatch | null {
  if (!isRecord(value) || !isString(value.segment_id) || !isString(value.clip_id)) return null;
  const { clip_title, start_s, end_s, recorded_at, description, thumb_url } = value;
  if (!isString(clip_title) || !isNumber(start_s) || !isNumber(end_s)) return null;
  if (!isNullable(recorded_at, isString) || !isString(description) || !isString(thumb_url)) return null;
  return { segment_id: value.segment_id, clip_id: value.clip_id, clip_title, start_s, end_s, recorded_at, description, thumb_url };
}

function parseShot(value: unknown): ProductionShot | null {
  if (!isRecord(value) || !isString(value.shot_id) || !isPositiveInt(value.ord) || !isAct(value.act)) return null;
  const { title, direction, tips, duration_s, board_url, match_reason, take_count } = value;
  if (!isString(title) || !isString(direction) || !isStringArray(tips) || !isNumber(duration_s)) return null;
  if (!isNullable(board_url, isString) || !isNullable(match_reason, isString) || !isNonNegativeInt(take_count)) return null;
  const footage = value.footage_board_url === undefined ? null : value.footage_board_url;
  if (!isNullable(footage, isString)) return null;
  const match = value.match === null ? null : parseMatch(value.match);
  if (value.match !== null && match === null) return null;
  return {
    shot_id: value.shot_id,
    ord: value.ord,
    act: value.act,
    title,
    direction,
    tips,
    duration_s,
    board_url,
    footage_board_url: footage,
    match,
    match_reason,
    take_count,
  };
}

/** Parses `GET /productions/{id}`. */
export const parseProductionDetail: Parse<ProductionDetail> = (body) => {
  if (!isRecord(body) || !isNonNegativeInt(body.covered_count)) return null;
  if (!isBoolean(body.can_cut) || !isBoolean(body.busy)) return null;
  const production = parseSummary(body.production);
  const shots = parseEvery(body.shots, parseShot);
  if (production === null || shots === null) return null;
  return { production, shots, covered_count: body.covered_count, can_cut: body.can_cut, busy: body.busy };
};

/** Parses the 202 answer of coverage, retry, exports, covers, redraws and new art. */
export const parseStarted: Parse<StartedResponse> = (body) =>
  isRecord(body) && isBoolean(body.started) ? { started: body.started } : null;

/** Parses `POST /productions/{id}/art/cover`. */
export const parseArtCover: Parse<ArtCoverResponse> = (body) => {
  if (!isRecord(body) || !Array.isArray(body.platforms) || !body.platforms.every(isPlatform)) return null;
  return { platforms: body.platforms };
};

/** Parses `POST /productions/{id}/cut`. */
export const parseCut: Parse<CutResponse> = (body) =>
  isRecord(body) && isString(body.short_id) ? { short_id: body.short_id } : null;

function parseActShot(value: unknown): ActShot | null {
  if (!isRecord(value) || !isPositiveInt(value.ord) || !isAct(value.act) || !isString(value.title)) return null;
  if (!isNumber(value.duration_s) || !isNullable(value.segment_id, isString)) return null;
  return { ord: value.ord, act: value.act, title: value.title, duration_s: value.duration_s, segment_id: value.segment_id };
}

/** Parses `GET /shorts/{id}/production`. */
export const parseShortProduction: Parse<ShortProduction> = (body) => {
  if (!isRecord(body) || !isString(body.production_id) || !isString(body.title)) return null;
  if (!isProductionStatus(body.status)) return null;
  const shots = parseEvery(body.shots, parseActShot);
  if (shots === null) return null;
  return { production_id: body.production_id, title: body.title, status: body.status, shots };
};

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
 * Parses one SSE `data` string of a production or publish run.
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
