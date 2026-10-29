// Parsers for `GET /clips/{id}` and the clip SSE payload.
import {
  isBoolean,
  isNonNegativeInt,
  isNullable,
  isNumber,
  isRecord,
  isStepStatus,
  isString,
  isStringArray,
  isUnitScore,
  oneOf,
  parseEvery,
} from './json-guards';
import { parseClip, type Parse } from './parse';
import {
  PIPELINE_STEPS,
  type ClipDetail,
  type ClipLink,
  type ClipLinkKind,
  type ClipEvent,
  type PipelineStep,
  type Segment,
  type Speaker,
  type Track,
  type Turn,
} from './types';

const isScore = (value: unknown): value is number =>
  isNonNegativeInt(value) && value <= 10;

function parseSegment(value: unknown): Segment | null {
  if (!isRecord(value) || !isString(value.segment_id) || !isNonNegativeInt(value.idx)) return null;
  const { start_s, end_s, description, actions, objects, place, mood } = value;
  const { quality, hook_score, thumb_url } = value;
  if (!isNumber(start_s) || !isNumber(end_s) || !isNullable(description, isString)) return null;
  if (!isStringArray(actions) || !isStringArray(objects)) return null;
  if (!isNullable(place, isString) || !isNullable(mood, isString)) return null;
  if (!isNullable(quality, isScore) || !isNullable(hook_score, isScore)) return null;
  if (!isNullable(thumb_url, isString)) return null;
  return {
    segment_id: value.segment_id,
    idx: value.idx,
    start_s,
    end_s,
    description,
    actions,
    objects,
    place,
    mood,
    quality,
    hook_score,
    thumb_url,
  };
}

function parseTurn(value: unknown): Turn | null {
  if (!isRecord(value) || !isString(value.turn_id) || !isString(value.text)) return null;
  const { start_s, end_s, speaker_id } = value;
  if (!isNumber(start_s) || !isNumber(end_s) || !isNullable(speaker_id, isString)) return null;
  return { turn_id: value.turn_id, start_s, end_s, text: value.text, speaker_id };
}

/** Parses one speaker row. */
export function parseSpeaker(value: unknown): Speaker | null {
  if (!isRecord(value) || !isString(value.speaker_id) || !isString(value.label)) return null;
  if (!isNullable(value.display_name, isString)) return null;
  return { speaker_id: value.speaker_id, label: value.label, display_name: value.display_name };
}

/** Parses one face track row. */
export function parseTrack(value: unknown): Track | null {
  if (!isRecord(value) || !isString(value.track_id)) return null;
  const { crop_url, first_s, last_s, person_name, hidden } = value;
  if (!isNullable(crop_url, isString) || !isNumber(first_s) || !isNumber(last_s)) return null;
  if (!isNullable(person_name, isString) || !isBoolean(hidden)) return null;
  return { track_id: value.track_id, crop_url, first_s, last_s, person_name, hidden };
}

const isLinkKind = oneOf<ClipLinkKind>(['near_copy_of', 'copied_by', 'same_moment']);

/** Parses one linked clip (`links[]`). */
export function parseClipLink(value: unknown): ClipLink | null {
  if (!isRecord(value) || !isString(value.clip_id) || !isString(value.title)) return null;
  const { kind, score, recorded_at, thumb_url, duration_s } = value;
  if (!isLinkKind(kind) || !isUnitScore(score) || !isNullable(recorded_at, isString)) return null;
  if (!isNullable(thumb_url, isString) || !isNullable(duration_s, isNumber)) return null;
  return { clip_id: value.clip_id, title: value.title, kind, score, recorded_at, thumb_url, duration_s };
}

/**
 * Parses `GET /clips/{id}`. Any malformed nested row rejects the whole body. A body without
 * `links` (a server from before near-copies) reads as no links.
 */
export const parseClipDetail: Parse<ClipDetail> = (body) => {
  if (!isRecord(body) || !isNullable(body.proxy_url, isString)) return null;
  const clip = parseClip(body.clip);
  const segments = parseEvery(body.segments, parseSegment);
  const turns = parseEvery(body.turns, parseTurn);
  const speakers = parseEvery(body.speakers, parseSpeaker);
  const tracks = parseEvery(body.tracks, parseTrack);
  const links = parseEvery(body.links ?? [], parseClipLink);
  if (!clip || !segments || !turns || !speakers || !tracks || !links) return null;
  return { clip, proxy_url: body.proxy_url, segments, turns, speakers, tracks, links };
};

const isStep = (value: unknown): value is PipelineStep =>
  PIPELINE_STEPS.some((step) => step === value);

/**
 * Parses one SSE `data` string.
 * @param data - The raw event data.
 * @returns The event, or null for invalid JSON or an unknown step or status.
 */
export function parseClipEvent(data: string): ClipEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null; // Recovers: a malformed event is skipped; the next one carries the state.
  }
  if (!isRecord(json) || !isStep(json.step) || !isStepStatus(json.status)) return null;
  return { step: json.step, status: json.status };
}
