// Parsers for the Mist screens' summary endpoints: storage, people overview, shorts list.
import {
  isNonNegativeInt,
  isNullable,
  isNumber,
  isRecord,
  isString,
  oneOf,
  parseEvery,
} from './json-guards';
import type { Parse } from './parse';
import type {
  Aspect,
  FaceSuggestion,
  HiddenFace,
  NamedPerson,
  PeopleOverview,
  ShortListItem,
  ShortStatus,
  StorageLevel,
  StorageSummary,
  UnnamedFace,
} from './types';

const isStorageLevel = oneOf<StorageLevel>(['ok', 'warn', 'high', 'full']);

const isBytes = (value: unknown): value is number => isNumber(value) && value >= 0;

/** Parses `GET /storage`. */
export const parseStorage: Parse<StorageSummary> = (body) => {
  if (!isRecord(body)) return null;
  const { cloud_bytes, phone_bytes, frequent_bytes, resting_bytes, clip_count } = body;
  if (!isBytes(cloud_bytes) || !isBytes(phone_bytes) || !isBytes(frequent_bytes)) return null;
  if (!isBytes(resting_bytes) || !isNonNegativeInt(clip_count)) return null;
  const { used_bytes, cap_bytes, level } = body;
  if (!isBytes(used_bytes) || !isBytes(cap_bytes) || !isStorageLevel(level)) return null;
  return { cloud_bytes, phone_bytes, frequent_bytes, resting_bytes, clip_count, used_bytes, cap_bytes, level };
};

function parsePerson(value: unknown): NamedPerson | null {
  if (!isRecord(value) || !isString(value.person_id) || !isString(value.name)) return null;
  if (!isNonNegativeInt(value.clip_count) || !isNullable(value.crop_url, isString)) return null;
  return { person_id: value.person_id, name: value.name, clip_count: value.clip_count, crop_url: value.crop_url };
}

function parseFaceBase(value: unknown): HiddenFace | null {
  if (!isRecord(value) || !isString(value.track_id) || !isString(value.clip_id)) return null;
  const { clip_title, recorded_at, crop_url } = value;
  if (!isString(clip_title) || !isNullable(recorded_at, isString) || !isNullable(crop_url, isString)) {
    return null;
  }
  return { track_id: value.track_id, clip_id: value.clip_id, clip_title, recorded_at, crop_url };
}

function parseSuggestion(value: unknown): FaceSuggestion | null {
  if (!isRecord(value) || !isString(value.person_id) || !isString(value.name)) return null;
  const { similarity } = value;
  if (!isNumber(similarity) || similarity < 0 || similarity > 1) return null;
  return { person_id: value.person_id, name: value.name, similarity };
}

function parseUnnamed(value: unknown): UnnamedFace | null {
  const face = parseFaceBase(value);
  if (face === null || !isRecord(value) || !isNumber(value.on_screen_s)) return null;
  const { group_id, suggested } = value;
  if (!isNullable(group_id, isString)) return null;
  const suggestion = suggested === null ? null : parseSuggestion(suggested);
  if (suggested !== null && suggestion === null) return null;
  return { ...face, on_screen_s: value.on_screen_s, group_id, suggested: suggestion };
}

/**
 * Parses `GET /people/overview`. Every list is required, `hidden` included (newest clip first).
 */
export const parsePeopleOverview: Parse<PeopleOverview> = (body) => {
  if (!isRecord(body) || !isNonNegativeInt(body.hidden_count)) return null;
  const people = parseEvery(body.people, parsePerson);
  const unnamed = parseEvery(body.unnamed, parseUnnamed);
  const hidden = parseEvery(body.hidden, parseFaceBase);
  if (people === null || unnamed === null || hidden === null) return null;
  return { people, unnamed, hidden_count: body.hidden_count, hidden };
};

const ASPECTS: readonly Aspect[] = ['4:5', '1:1'];
const STATUSES: readonly ShortStatus[] = ['planning', 'rendering', 'critiquing', 'revising', 'ready', 'failed'];

function parseShortRow(value: unknown): ShortListItem | null {
  if (!isRecord(value) || !isString(value.short_id) || !isString(value.prompt)) return null;
  const { aspect, target_s, status, created_at, version_count, best_score, thumb_url } = value;
  const knownAspect = ASPECTS.find((a) => a === aspect);
  const knownStatus = STATUSES.find((s) => s === status);
  if (knownAspect === undefined || knownStatus === undefined || !isNumber(target_s)) return null;
  if (!isString(created_at) || !isNonNegativeInt(version_count)) return null;
  if (!isNullable(best_score, isNumber) || !isNullable(thumb_url, isString)) return null;
  // Older servers leave out the caption and production fields; read those as none.
  const { caption = null, production_id = null, production_title = null } = value;
  if (!isNullable(caption, isString) || !isNullable(production_id, isString) || !isNullable(production_title, isString)) return null;
  return {
    short_id: value.short_id,
    prompt: value.prompt,
    aspect: knownAspect,
    target_s,
    status: knownStatus,
    created_at,
    version_count,
    best_score,
    thumb_url,
    caption,
    production_id,
    production_title,
    ...(isNonNegativeInt(value.max_drafts) && value.max_drafts > 0 ? { max_drafts: value.max_drafts } : {}),
  };
}

/** Parses `GET /shorts`. */
export const parseShortList: Parse<ShortListItem[]> = (body) => parseEvery(body, parseShortRow);
