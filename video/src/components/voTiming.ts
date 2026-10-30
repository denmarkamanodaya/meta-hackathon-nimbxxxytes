// Places a scene's voice-over lines on its timeline: a lead-in, a gap between lines, a hold after
// the last, never shorter than the scene's designed length. Shared by the white-page compositions
// (Demo, NimbytesHook, ...); line lengths come from each one's vo.generated.json (scripts/make-vo.py).

/** Frames per second of the white-page compositions. */
export const VO_FPS = 30;

/** One spoken line, in frames from the start of its scene. */
export interface VoLine {
  id: string;
  text: string;
  from: number;
  durationInFrames: number;
}

/** How a scene spaces its lines, in seconds; `min` is the shortest the scene may be. */
export interface VoSpacing {
  min: number;
  lead: number;
  gap: number;
  tail: number;
  /** Per-gap overrides: `gaps[i]` is the gap before line i + 1 (falls back to `gap`). */
  gaps?: readonly number[];
}

const frames = (seconds: number) => Math.round(seconds * VO_FPS);

/**
 * Lays out one scene's lines.
 * @param lines - The scene's lines in order (id and text).
 * @param spoken - Seconds of speech per line id (missing lines count as 2 s).
 * @param spacing - The scene's spacing.
 * @returns The placed lines and the scene's length in frames.
 */
export function placeLines(lines: readonly { id: string; text: string }[], spoken: Readonly<Record<string, { seconds: number } | undefined>>, spacing: VoSpacing): { lines: VoLine[]; durationInFrames: number } {
  let cursor = frames(spacing.lead);
  const placed = lines.map((line, index) => {
    if (index > 0) cursor += frames(spacing.gaps?.[index - 1] ?? spacing.gap);
    const durationInFrames = frames(spoken[line.id]?.seconds ?? 2);
    const result = { id: line.id, text: line.text, from: cursor, durationInFrames };
    cursor += durationInFrames;
    return result;
  });
  return { lines: placed, durationInFrames: Math.max(frames(spacing.min), placed.length === 0 ? 0 : cursor + frames(spacing.tail)) };
}

/**
 * A line by index, with a zero-length fallback so a missing line never breaks a render.
 * @param lines - Placed lines.
 * @param index - Which line.
 * @returns The line.
 */
export const lineAt = (lines: readonly VoLine[], index: number): VoLine => lines[index] ?? { id: '', text: '', from: 0, durationInFrames: 0 };
