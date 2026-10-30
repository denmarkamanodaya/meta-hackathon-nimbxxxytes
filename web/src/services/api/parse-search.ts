// Parsers for search, people autocomplete, and the track / speaker update answers.
import {
  isNonNegativeInt,
  isNullable,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  oneOf,
  parseEvery,
} from './json-guards';
import type { StreamEvent } from '../../core/ports/api-transport';
import { parseSpeaker, parseTrack } from './parse-clip-detail';
import { readJson } from './read-answer';
import type { Parse } from './parse';
import type {
  Person,
  SearchFace,
  SearchFilters,
  SearchResponse,
  SearchResult,
  SearchResultKind,
  SearchStage,
  Speaker,
  Track,
} from './types';

/** Reads an optional field: missing gives `fallback`; present must pass `guard`, else undefined. */
function optionalField<T>(
  value: unknown,
  guard: (v: unknown) => v is T,
  fallback: T,
): T | undefined {
  if (value === undefined) return fallback;
  return guard(value) ? value : undefined;
}

const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);
const isResultKind = oneOf<SearchResultKind>(['moment', 'photo']);
const isNullableScore = (v: unknown): v is number | null =>
  isNullable(v, (n: unknown): n is number => isNonNegativeInt(n) && n <= 10);

function parseFilters(value: unknown): SearchFilters | null {
  const record = value === undefined ? {} : value;
  if (!isRecord(record)) return null;
  const filters = {
    people: optionalField(record.people, isStringArray, []),
    speakers: optionalField(record.speakers, isStringArray, []),
    place: optionalField(record.place, isNullableString, null),
    from: optionalField(record.from, isNullableString, null),
    to: optionalField(record.to, isNullableString, null),
    min_quality: optionalField(record.min_quality, isNullableScore, null),
  };
  const { people, speakers, place, from, to, min_quality } = filters;
  if (people === undefined || speakers === undefined || place === undefined) return null;
  if (from === undefined || to === undefined || min_quality === undefined) return null;
  return { people, speakers, place, from, to, min_quality };
}

/**
 * Parses one search result row (also used to read rows handed to the editor in router state).
 * @param value - Candidate row.
 * @returns The row, or null when malformed.
 */
export function parseResult(value: unknown): SearchResult | null {
  if (!isRecord(value) || !isString(value.segment_id) || !isString(value.clip_id)) return null;
  // `kind` and `photo_id` came with photos; an older row (router state, a cached answer) is a moment.
  const kind = optionalField(value.kind, isResultKind, 'moment');
  const photo_id = optionalField(value.photo_id, isNullableString, null);
  if (kind === undefined || photo_id === undefined || (kind === 'photo' && photo_id === null)) return null;
  const { start_s, end_s, thumb_url, reason, score, clip_filename, recorded_at } = value;
  if (!isNumber(start_s) || !isNumber(end_s) || !isNumber(score)) return null;
  if (!isNullable(thumb_url, isString) || !isNullable(reason, isString)) return null;
  if (!isString(clip_filename) || !isNullable(recorded_at, isString)) return null;
  const faces = parseEvery(value.faces, parseFace);
  if (!isString(value.clip_title) || faces === null) return null;
  return {
    kind,
    photo_id,
    segment_id: value.segment_id,
    clip_id: value.clip_id,
    start_s,
    end_s,
    thumb_url,
    reason,
    score,
    clip_filename,
    clip_title: value.clip_title,
    recorded_at,
    faces,
  };
}

function parseFace(value: unknown): SearchFace | null {
  if (!isRecord(value) || !isString(value.name) || !isNullable(value.crop_url, isString)) return null;
  return { name: value.name, crop_url: value.crop_url };
}

/** Parses `POST /search`. `rewritten.filters` fields may be omitted (read as no filter). */
export const parseSearch: Parse<SearchResponse> = (body) => {
  if (!isRecord(body) || typeof body.reranked !== 'boolean' || !isRecord(body.rewritten)) return null;
  const keywords = body.rewritten.keywords;
  const filters = parseFilters(body.rewritten.filters);
  const results = parseEvery(body.results, parseResult);
  if (!isStringArray(keywords) || filters === null || results === null) return null;
  const { took_ms, cached, cost_usd } = body;
  if (!isNumber(took_ms) || typeof cached !== 'boolean' || !isNumber(cost_usd)) return null;
  return { rewritten: { keywords, filters }, results, reranked: body.reranked, took_ms, cached, cost_usd };
};

/** SSE event names of `POST /search/stream` that carry a stage. */
const STAGE_EVENTS: readonly SearchStage['stage'][] = ['local', 'ranked'];

const isStageEvent = (name: string | null): name is SearchStage['stage'] =>
  STAGE_EVENTS.some((stage) => stage === name);

/**
 * Parses one event of `POST /search/stream`.
 * @param event - The event as the transport delivered it.
 * @returns The stage for `local` / `ranked` with a valid `SearchResponse` body; null for `done`,
 *   any other event, or a malformed body.
 */
export function parseSearchStage(event: StreamEvent): SearchStage | null {
  if (!isStageEvent(event.event)) return null;
  const response = parseSearch(readJson(event.data));
  return response === null ? null : { stage: event.event, response };
}

function parsePerson(value: unknown): Person | null {
  if (!isRecord(value) || !isString(value.person_id) || !isString(value.name)) return null;
  return { person_id: value.person_id, name: value.name };
}

/** Parses `GET /people?prefix=`. */
export const parsePeople: Parse<Person[]> = (body) => parseEvery(body, parsePerson);

/** Parses `PUT /tracks/{id}`: the updated track. */
export const parseTrackAnswer: Parse<Track> = (body) => parseTrack(body);

/** Parses `PUT /speakers/{id}`: the updated speaker. */
export const parseSpeakerAnswer: Parse<Speaker> = (body) => parseSpeaker(body);
