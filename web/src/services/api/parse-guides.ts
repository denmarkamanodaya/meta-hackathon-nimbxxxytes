// Parsers for the MyWay guide endpoints: the list, one guide with its steps, an edited step and
// the start answer. Every contract key is always present (null when empty); a missing key fails
// the parse.
import { isNonNegativeInt, isNullable, isNumber, isPositiveInt, isRecord, isString, oneOf, parseEvery, type Json } from './json-guards';
import type { Parse } from './parse';
import {
  GUIDE_STAGES,
  type Guide,
  type GuideSafety,
  type GuideStatus,
  type GuideStep,
  type GuideSummary,
  type StartGuideResponse,
} from './types';

const isGuideStatus = oneOf<GuideStatus>(['queued', 'running', 'ready', 'failed', 'refused']);
const isGuideStage = oneOf(GUIDE_STAGES);
const isGuideSafety = oneOf<GuideSafety>(['everyday', 'caution', 'not_supported']);

const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);

/** The fields a summary and a full guide share, or null when one is wrong. */
function parseHead(body: Json): Omit<GuideSummary, 'step_count' | 'cover_url' | 'created_at'> | null {
  const { id, clip_id, title, status, stage, error, clip_title, clip_duration_s } = body;
  if (!isString(id) || !isString(clip_id) || !isString(title) || !isGuideStatus(status)) return null;
  if (!isNullable(stage, isGuideStage) || !isNullableString(error)) return null;
  if (!isNullableString(clip_title) || !isNullable(clip_duration_s, isNumber)) return null;
  return { id, clip_id, title, status, stage, error, clip_title, clip_duration_s };
}

/**
 * Parses one `GET /api/guides` row.
 * @param body - Candidate row.
 * @returns The row, or null when the shape is wrong.
 */
export const parseGuideSummary: Parse<GuideSummary> = (body) => {
  if (!isRecord(body)) return null;
  const head = parseHead(body);
  const { step_count, cover_url, created_at } = body;
  if (head === null || !isNonNegativeInt(step_count) || !isNullableString(cover_url) || !isString(created_at)) return null;
  return { ...head, step_count, cover_url, created_at };
};

/** Parses `GET /api/guides`. One malformed row rejects the whole list. */
export const parseGuideList: Parse<GuideSummary[]> = (body) => parseEvery(body, parseGuideSummary);

/**
 * Parses one step (an element of `steps`, and the `PATCH …/steps/{n}` answer).
 * @param body - Candidate step.
 * @returns The step, or null when the shape is wrong.
 */
export const parseGuideStep: Parse<GuideStep> = (body) => {
  if (!isRecord(body) || !isPositiveInt(body.n) || !isString(body.title) || !isString(body.instruction)) return null;
  const { start_s, end_s, key_s, image_url, audio_url, clip_url, highlight } = body;
  if (!isNumber(start_s) || !isNumber(end_s) || !isNumber(key_s)) return null;
  if (!isNullableString(image_url) || !isNullableString(audio_url) || !isNullableString(clip_url)) return null;
  const label = highlight === null ? null : isRecord(highlight) && isString(highlight.label) ? highlight.label : undefined;
  if (label === undefined) return null;
  return {
    n: body.n,
    title: body.title,
    instruction: body.instruction,
    start_s,
    end_s,
    key_s,
    image_url,
    audio_url,
    clip_url,
    highlight: label === null ? null : { label },
  };
};

/**
 * Parses `GET /api/guides/{id}`.
 * @param body - Candidate guide.
 * @returns The guide, or null when the shape is wrong.
 */
export const parseGuide: Parse<Guide> = (body) => {
  if (!isRecord(body)) return null;
  const head = parseHead(body);
  const steps = parseEvery(body.steps, parseGuideStep);
  const { safety, safety_reason, language } = body;
  if (head === null || steps === null || !isNullable(safety, isGuideSafety)) return null;
  if (!isNullableString(safety_reason) || !isNullableString(language)) return null;
  return { ...head, safety, safety_reason, language, steps };
};

/** Parses the `POST /api/clips/{id}/guide` answer. */
export const parseStartGuide: Parse<StartGuideResponse> = (body) =>
  isRecord(body) && isString(body.guide_id) && isGuideStatus(body.status)
    ? { guide_id: body.guide_id, status: body.status }
    : null;
