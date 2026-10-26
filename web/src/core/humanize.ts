// Turns agent text into people text: segment ids become shot names, field names become words,
// and bare seconds become m:ss. A guard for model output; prompts already ask for subjects.
import type { ShortSegment, TimelineClip } from '../services/api/types';
import { formatClipTime, formatDuration } from './format';

/** Shot name by segment id. */
export type ShotNames = ReadonlyMap<string, string>;

const FALLBACK_WORDS = 4;

const firstWords = (text: string) =>
  text.split(/\s+/).filter(Boolean).slice(0, FALLBACK_WORDS).join(' ');

/**
 * Names every shot the text may mention. Precedence: this version's clips (subject, else
 * "Shot N"), then older versions' clips, then the short's candidate segments (description cut
 * to 4 words).
 * @param timelines - Clips of this version first, then older ones.
 * @param segments - The short's candidate segments.
 * @returns Name by segment id.
 */
export function shotNames(
  timelines: readonly (readonly TimelineClip[])[],
  segments: readonly Pick<ShortSegment, 'segment_id' | 'description'>[] = [],
): ShotNames {
  const names = new Map<string, string>();
  for (const segment of segments) {
    if (segment.description !== null) names.set(segment.segment_id, firstWords(segment.description));
  }
  for (const clips of [...timelines].reverse()) {
    clips.forEach((clip, index) => {
      names.set(clip.segment_id, clip.subject ?? `Shot ${String(index + 1)}`);
    });
  }
  return names;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** UUID-like ids the names do not cover (for example `01a179c0-1f2b-7a3c-…-s1`). */
const STRAY_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}(?:-[0-9a-z…]+)+/gi;
/** A bare seconds range, "7.0-12.4" or "7–12 s", not part of an m:ss time. */
const SECONDS_RANGE = /(?<![\d:.])(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s*s\b)?(?![\d:])/g;
/** A bare decimal seconds value, optionally followed by "s", not part of an m:ss time. */
const SECONDS_VALUE = /(?<![\d:.])(\d+\.\d+)(?:\s*s\b)?(?![\d:])/g;
/** Wire field names the model sometimes writes, as words. */
const FIELD_WORDS: Record<string, string> = {
  punch_in: 'zoom',
  segment_id: 'shot',
  hook_score: 'hook score',
};

/** Writes a shot name followed by "in" / "out". */
type EdgeWriter = (label: string, edge: 'in' | 'out') => string;

function replaceIds(text: string, names: ShotNames, writeEdge: EdgeWriter): string {
  const ids = [...names.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`\\b(${ids.join('|')})\\b(?: (in|out)\\b)?`, 'g');
  const named =
    ids.length === 0
      ? text
      : text.replace(pattern, (_m, id: string, edge?: 'in' | 'out') => {
          const label = names.get(id) ?? id;
          return edge === undefined ? label : writeEdge(label, edge);
        });
  return named.replace(STRAY_ID, 'another shot');
}

/** Field names as words, then second ranges as `m:ss–m:ss` and bare seconds as `m:ss.s`. */
function humanizeTerms(text: string): string {
  return text
    .replace(/\b(punch_in|segment_id|hook_score)\b/g, (field: string) => FIELD_WORDS[field] ?? field)
    .replace(SECONDS_RANGE, (_m, a: string, b: string) => {
      return `${formatDuration(Number(a))}–${formatDuration(Number(b))}`;
    })
    .replace(SECONDS_VALUE, (_m, value: string) => formatClipTime(Number(value)));
}

const editEdge: EdgeWriter = (label, edge) => `${label}: ${edge === 'in' ? 'start' : 'end'}`;
const plainEdge: EdgeWriter = (label, edge) => `${label} ${edge}`;

/**
 * Rewrites a revision change's `detail`: shot names, `in` / `out` as start / end, and bare
 * seconds as `m:ss.s` (times already written as m:ss are left alone).
 * @param detail - Raw detail, for example `"seg_desk out 64.0 → 63.5"`.
 * @param names - From `shotNames`.
 * @returns For example `"laptop opening: end 1:04.0 → 1:03.5"`.
 */
export function humanizeDetail(detail: string, names: ShotNames): string {
  return humanizeTerms(replaceIds(detail, names, editEdge));
}

/**
 * Rewrites a critique note's `issue` or `fix`: shot names, field names as words, second ranges
 * as `m:ss–m:ss` and bare seconds as `m:ss.s`.
 * @param text - Raw note text, for example `"Join <id> 7.0-12.4 as one shot"`.
 * @param names - From `shotNames`.
 * @returns For example `"Join kangaroo under shelter 0:07–0:12 as one shot"`.
 */
export function humanizeNote(text: string, names: ShotNames): string {
  return humanizeTerms(replaceIds(text, names, plainEdge));
}
