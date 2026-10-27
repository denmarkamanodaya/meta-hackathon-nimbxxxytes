// Parsers for shorts: timeline, critique, versions, agent steps and the short endpoints.
import {
  isAspect,
  isNonNegativeInt,
  isNullable,
  isNumber,
  isPositiveInt,
  isRecord,
  isString,
  isStringArray,
  oneOf,
  parseEvery,
  type Json,
} from './json-guards';
import type { Parse } from './parse';
import {
  CRITIQUE_DIMENSIONS,
  type AgentStep,
  type AgentStepKind,
  type Critique,
  type CritiqueNote,
  type Revision,
  type RevisionAction,
  type RevisionChange,
  type Short,
  type ShortDetail,
  type ShortSegment,
  type ShortStatus,
  type ShortVersion,
  type Timeline,
  type TimelineClip,
} from './types';

const isAction = oneOf<RevisionAction>(['add', 'remove', 'swap', 'trim', 'reorder', 'retime_captions']);
const isShortStatus = oneOf<ShortStatus>(['planning', 'rendering', 'critiquing', 'revising', 'ready', 'failed']);
const isStepKind = oneOf<AgentStepKind>(['plan', 'tool_call', 'tool_result', 'critique', 'revise', 'final']);
const isScore = (value: unknown): value is number => isNumber(value) && value >= 0 && value <= 10;

function parseClip(value: unknown): TimelineClip | null {
  if (!isRecord(value) || !isString(value.segment_id) || !isString(value.reason)) return null;
  const { in: start, out: end, subject, punch_in } = value;
  if (!isNumber(start) || !isNumber(end) || !isNullable(subject, isString)) return null;
  const zoom = punch_in === undefined ? 1 : punch_in;
  if (!isNumber(zoom) || zoom < 1) return null;
  return { segment_id: value.segment_id, in: start, out: end, subject, punch_in: zoom, reason: value.reason };
}

function parseChange(value: unknown): RevisionChange | null {
  if (!isRecord(value) || !isAction(value.action)) return null;
  if (!isString(value.detail) || !isString(value.why)) return null;
  const note = value.note_index === undefined ? null : value.note_index;
  if (!isNullable(note, isNonNegativeInt)) return null;
  return { action: value.action, detail: value.detail, why: value.why, note_index: note };
}

function parseRevision(value: unknown): Revision | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isPositiveInt(value.from_version)) return undefined;
  const changes = parseEvery(value.changes, parseChange);
  return changes === null ? undefined : { from_version: value.from_version, changes };
}

function parsePost(value: unknown): Timeline['post'] | null {
  if (!isRecord(value) || !isString(value.caption) || !isStringArray(value.hashtags)) return null;
  return { caption: value.caption, hashtags: value.hashtags };
}

function parseCaptions(value: unknown): Timeline['captions'] | null {
  if (!isRecord(value) || (value.style !== 'phrase' && value.style !== 'none')) return null;
  return { style: value.style, source: 'transcript' };
}

/**
 * Parses a timeline (contract "Timeline JSON").
 * @param value - Candidate timeline.
 * @returns The timeline, or null when any part is malformed.
 */
export function parseTimeline(value: unknown): Timeline | null {
  if (!isRecord(value) || !isAspect(value.aspect) || !isNumber(value.target_seconds)) return null;
  const clips = parseEvery(value.clips, parseClip);
  const captions = parseCaptions(value.captions);
  const post = parsePost(value.post);
  const revision = parseRevision(value.revision);
  if (clips === null || captions === null || post === null || revision === undefined) return null;
  if (!isString(value.rationale)) return null;
  return {
    aspect: value.aspect,
    target_seconds: value.target_seconds,
    clips,
    captions,
    post,
    rationale: value.rationale,
    revision,
  };
}

function parseNote(value: unknown): CritiqueNote | null {
  if (!isRecord(value) || !isNumber(value.at) || !isString(value.issue) || !isString(value.fix)) {
    return null;
  }
  return { at: value.at, issue: value.issue, fix: value.fix };
}

function parseScores(value: unknown): Critique['scores'] | null {
  if (!isRecord(value)) return null;
  const record: Json = value;
  if (!CRITIQUE_DIMENSIONS.every((dimension) => isScore(record[dimension]))) return null;
  const score = (dimension: (typeof CRITIQUE_DIMENSIONS)[number]) => record[dimension] as number;
  return {
    hook: score('hook'),
    pacing: score('pacing'),
    continuity: score('continuity'),
    captions: score('captions'),
    length: score('length'),
  };
}

/**
 * Parses a critique (contract "Critique JSON").
 * @param value - Candidate critique.
 * @returns The critique, or null when malformed or the verdict is unknown.
 */
export function parseCritique(value: unknown): Critique | null {
  if (!isRecord(value) || !isPositiveInt(value.version) || !isNumber(value.total)) return null;
  if (value.verdict !== 'accept' && value.verdict !== 'revise') return null;
  const scores = parseScores(value.scores);
  const notes = parseEvery(value.notes, parseNote);
  if (scores === null || notes === null) return null;
  return { version: value.version, scores, total: value.total, notes, verdict: value.verdict };
}

function parseVersion(value: unknown): ShortVersion | null {
  if (!isRecord(value) || !isPositiveInt(value.n)) return null;
  const timeline = parseTimeline(value.timeline);
  const critique = value.critique === null ? null : parseCritique(value.critique);
  if (timeline === null || (value.critique !== null && critique === null)) return null;
  if (!isNullable(value.preview_url, isString) || !isNullable(value.score_total, isNumber)) return null;
  return {
    n: value.n,
    timeline,
    preview_url: value.preview_url,
    critique,
    score_total: value.score_total,
    composition_props: value.composition_props ?? null,
  };
}

/**
 * Parses one agent step row (the SSE `data` and `steps[]`).
 * @param value - Candidate row.
 * @returns The step, or null when malformed.
 */
export function parseStep(value: unknown): AgentStep | null {
  if (!isRecord(value) || !isNonNegativeInt(value.seq) || !isStepKind(value.kind)) return null;
  const version = value.version === undefined ? null : value.version;
  if (!isNullable(value.tool, isString) || !isNullable(version, isPositiveInt)) return null;
  if (!isString(value.summary) || !isString(value.at)) return null;
  return { seq: value.seq, kind: value.kind, tool: value.tool, version, summary: value.summary, at: value.at };
}

function parseShort(value: unknown): Short | null {
  if (!isRecord(value) || !isString(value.short_id) || !isString(value.prompt)) return null;
  const { aspect, target_s, status, best_version, render_url } = value;
  if (!isAspect(aspect) || !isNumber(target_s) || !isShortStatus(status)) return null;
  if (!isNullable(best_version, isPositiveInt) || !isNullable(render_url, isString)) return null;
  return { short_id: value.short_id, prompt: value.prompt, aspect, target_s, status, best_version, render_url };
}

function parseShortSegment(value: unknown): ShortSegment | null {
  if (!isRecord(value) || !isString(value.segment_id) || !isString(value.clip_id)) return null;
  const { start_s, end_s, thumb_url, description } = value;
  if (!isNumber(start_s) || !isNumber(end_s)) return null;
  if (!isNullable(thumb_url, isString) || !isNullable(description, isString)) return null;
  return { segment_id: value.segment_id, clip_id: value.clip_id, start_s, end_s, thumb_url, description };
}

/** Parses `GET /shorts/{id}`. */
export const parseShortDetail: Parse<ShortDetail> = (body) => {
  if (!isRecord(body)) return null;
  const short = parseShort(body.short);
  const versions = parseEvery(body.versions, parseVersion);
  const steps = parseEvery(body.steps, parseStep);
  const segments = parseEvery(body.segments, parseShortSegment);
  if (!short || !versions || !steps || !segments) return null;
  return { short, versions, steps, segments };
};

/** Parses `POST /shorts`. */
export const parseCreateShort: Parse<{ short_id: string }> = (body) =>
  isRecord(body) && isString(body.short_id) ? { short_id: body.short_id } : null;

/** Parses `PUT /shorts/{id}/timeline`: the new version number. */
export const parseSavedVersion: Parse<{ version: number }> = (body) =>
  isRecord(body) && isPositiveInt(body.version) ? { version: body.version } : null;

/** Parses `POST /shorts/{id}/render`. */
export const parseRenderJob: Parse<{ job_id: string }> = (body) =>
  isRecord(body) && isString(body.job_id) ? { job_id: body.job_id } : null;

/** Parses `GET /shorts/{id}/download`. */
export const parseDownload: Parse<{ url: string }> = (body) =>
  isRecord(body) && isString(body.url) ? { url: body.url } : null;
