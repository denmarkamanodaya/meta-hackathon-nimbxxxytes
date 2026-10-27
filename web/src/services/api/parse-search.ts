// Parsers for search, people autocomplete, and the track / speaker update answers.
import {
  isNonNegativeInt,
  isNullable,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  parseEvery,
} from './json-guards';
import { parseSpeaker, parseTrack } from './parse-clip-detail';
import type { Parse } from './parse';
import type {
  Person,
  SearchFace,
  SearchFilters,
  SearchResponse,
  SearchResult,
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
  const { start_s, end_s, thumb_url, reason, score, clip_filename, recorded_at } = value;
  if (!isNumber(start_s) || !isNumber(end_s) || !isNumber(score)) return null;
  if (!isNullable(thumb_url, isString) || !isNullable(reason, isString)) return null;
  if (!isString(clip_filename) || !isNullable(recorded_at, isString)) return null;
  const faces = parseEvery(value.faces, parseFace);
  if (!isString(value.clip_title) || faces === null) return null;
  return {
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
