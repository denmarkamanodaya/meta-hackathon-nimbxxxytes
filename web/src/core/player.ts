// Pure rules for the Mac clip player (redesign v2, V3): playback speeds, the J/K/L shuttle, the
// player's keys, moment stepping, in/out points, the cached range and the scrubber's hover line.
// The time and spans come in as arguments; nothing here touches the video element.
import { formatDuration } from './format';
import { activeIndex, type Span } from './timeline';

/** Speeds the speed button cycles through, slowest first. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** One playback speed. */
export type Speed = (typeof SPEEDS)[number];

/** Seconds of one frame step (`,` and `.`). The proxies are 30 fps. */
export const FRAME_S = 1 / 30;

/** Seconds the ±10 s buttons move. */
export const JUMP_S = 10;

/** Seconds ← and → move. */
export const NUDGE_S = 5;

/** The fastest shuttle, either way (J/L pressed three times). */
export const MAX_SHUTTLE = 4;

/**
 * The speed button's label.
 * @param speed - Playback rate.
 * @returns For example "1×", "0.75×", "2×".
 */
export function speedLabel(speed: number): string {
  return `${String(speed)}×`;
}

/**
 * The speed after a click on the speed button: the next one, from 2× back to 0.5×.
 * @param speed - The current rate; an unlisted rate goes to 1×.
 * @returns The next speed.
 */
export function nextSpeed(speed: number): Speed {
  const index = SPEEDS.findIndex((s) => s === speed);
  if (index === -1) return 1;
  return SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
}

/**
 * The shuttle rate after J, K or L (editing-app style): L plays forward and doubles up to 4×, J
 * plays backward and doubles up to −4×, K stops. A press against the current direction starts
 * again at 1× that way.
 * @param rate - The current shuttle rate; 0 when stopped, negative backward.
 * @param key - The key pressed.
 * @returns The new rate.
 */
export function nextShuttle(rate: number, key: 'j' | 'k' | 'l'): number {
  if (key === 'k') return 0;
  if (key === 'l') return rate <= 0 ? 1 : Math.min(rate * 2, MAX_SHUTTLE);
  return rate >= 0 ? -1 : Math.max(rate * 2, -MAX_SHUTTLE);
}

/** What a key does in the player. */
export type PlayerAction =
  | { kind: 'toggle-play' }
  | { kind: 'shuttle'; key: 'j' | 'k' | 'l' }
  | { kind: 'nudge'; seconds: number }
  | { kind: 'frame'; frames: number }
  | { kind: 'mark-in' }
  | { kind: 'mark-out' }
  | { kind: 'captions' }
  | { kind: 'next-moment' };

/**
 * Maps a key press in the player to its action. Keys with ⌘, Ctrl or Alt held are left to the app.
 * @param event - The key and modifiers.
 * @returns The action, or null when the player does not use the key.
 */
export function playerKeyAction(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): PlayerAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case ' ':
      return { kind: 'toggle-play' };
    case 'j':
    case 'J':
      return { kind: 'shuttle', key: 'j' };
    case 'k':
    case 'K':
      return { kind: 'shuttle', key: 'k' };
    case 'l':
    case 'L':
      return { kind: 'shuttle', key: 'l' };
    case 'ArrowLeft':
      return { kind: 'nudge', seconds: -NUDGE_S };
    case 'ArrowRight':
      return { kind: 'nudge', seconds: NUDGE_S };
    case ',':
      return { kind: 'frame', frames: -1 };
    case '.':
      return { kind: 'frame', frames: 1 };
    case 'i':
    case 'I':
      return { kind: 'mark-in' };
    case 'o':
    case 'O':
      return { kind: 'mark-out' };
    case 'c':
    case 'C':
      return { kind: 'captions' };
    case 'm':
    case 'M':
      return { kind: 'next-moment' };
    default:
      return null;
  }
}

/** A moment counts as "just started" this long after its start: ‹ then goes to the one before. */
const RESTART_GRACE_S = 1;

/**
 * Where "next moment" goes: the start of the first moment after now.
 * @param spans - Moments sorted by start.
 * @param seconds - Now.
 * @returns The start, or null after the last moment.
 */
export function nextMomentStart(spans: readonly Span[], seconds: number): number | null {
  return spans.find((span) => span.start_s > seconds + 0.01)?.start_s ?? null;
}

/**
 * Where "previous moment" goes: the start of the moment playing, or of the one before when it
 * just started (as a music player's back button does).
 * @param spans - Moments sorted by start.
 * @param seconds - Now.
 * @returns The start, or null before the first moment.
 */
export function previousMomentStart(spans: readonly Span[], seconds: number): number | null {
  const started = spans.filter((span) => span.start_s <= seconds - RESTART_GRACE_S);
  return started.at(-1)?.start_s ?? null;
}

/** The moment caption beside the moment arrows. */
export interface MomentCaption {
  /** "Moment 10". */
  label: string;
  /** What the moment shows; '' before it is described. */
  text: string;
}

/**
 * The caption for the moment playing now.
 * @param moments - Moments sorted by start, with their descriptions.
 * @param seconds - Now.
 * @returns The caption, or null in a gap or before the moments exist.
 */
export function momentCaption(moments: readonly (Span & { description: string | null })[], seconds: number): MomentCaption | null {
  const index = activeIndex(moments, seconds);
  const moment = moments[index];
  if (moment === undefined) return null;
  return { label: `Moment ${String(index + 1)}`, text: moment.description ?? '' };
}

/** In and out points, seconds; either may be unset. */
export interface Range {
  inS: number | null;
  outS: number | null;
}

/**
 * Sets the in point; an out point before it is dropped.
 * @param range - The current range.
 * @param seconds - Now.
 * @returns The new range.
 */
export function markIn(range: Range, seconds: number): Range {
  return { inS: seconds, outS: range.outS !== null && range.outS <= seconds ? null : range.outS };
}

/**
 * Sets the out point; an in point after it is dropped.
 * @param range - The current range.
 * @param seconds - Now.
 * @returns The new range.
 */
export function markOut(range: Range, seconds: number): Range {
  return { inS: range.inS !== null && range.inS >= seconds ? null : range.inS, outS: seconds };
}

/**
 * The range as start and end once both points are set.
 * @param range - In and out.
 * @returns The span, or null while a point is missing.
 */
export function rangeSpan(range: Range): Span | null {
  if (range.inS === null || range.outS === null || range.outS <= range.inS) return null;
  return { start_s: range.inS, end_s: range.outS };
}

/**
 * "13 s selected", or how to start one.
 * @param range - In and out.
 * @returns The line.
 */
export function rangeLine(range: Range): string {
  const span = rangeSpan(range);
  if (span === null) return range.inS === null ? 'Press I to set the in point' : 'Press O to set the out point';
  return `${String(Math.round(span.end_s - span.start_s))} s selected`;
}

/**
 * The moments a range touches, in clip order: what "Make a short from this range" hands the editor.
 * @param spans - Moments sorted by start.
 * @param span - The range.
 * @returns The moments that overlap it.
 */
export function spansInRange<T extends Span>(spans: readonly T[], span: Span): T[] {
  return spans.filter((s) => s.end_s > span.start_s && s.start_s < span.end_s);
}

/**
 * How far the cached range reaches, as a share of the clip: the end of the buffered range that
 * holds now (what plays without waiting).
 * @param ranges - The video's buffered ranges, `[start, end]` seconds.
 * @param seconds - Now.
 * @param durationS - The clip's length.
 * @returns 0–100.
 */
export function bufferedPercent(ranges: readonly (readonly [number, number])[], seconds: number, durationS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return 0;
  const holding = ranges.find(([start, end]) => start <= seconds && seconds <= end);
  return holding === undefined ? 0 : Math.min(100, (holding[1] / durationS) * 100);
}

/**
 * The line under the scrubber's hover preview: the time, then "speech" while someone talks, else
 * the moment's number.
 * @param seconds - The hovered second.
 * @param moments - Moments sorted by start.
 * @param turns - Speech turns sorted by start.
 * @returns For example "2:44 · speech", "1:09 · moment 10", "0:03".
 */
export function hoverLine(seconds: number, moments: readonly Span[], turns: readonly Span[]): string {
  const time = formatDuration(seconds);
  if (activeIndex(turns, seconds) !== -1) return `${time} · speech`;
  const moment = activeIndex(moments, seconds);
  return moment === -1 ? time : `${time} · moment ${String(moment + 1)}`;
}
