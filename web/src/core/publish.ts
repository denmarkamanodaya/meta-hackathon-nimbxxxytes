// Pure rules of the Publish screen: the caption counter, which cover is picked, hashtag edits and
// the text "Copy caption" puts on the clipboard.
import type { ExportItem, ExportStatus } from '../services/api/types';

/** At most this many covers per platform (the server's cap). */
export const MAX_COVERS = 9;

/** The caption counter under the text box. */
export interface CaptionCount {
  /** Characters, counted as the server counts them (trimmed, by code point). */
  count: number;
  /** Characters left; negative when over. */
  left: number;
  isOver: boolean;
  /** "120 / 2,200". */
  label: string;
}

const grouped = (n: number) => n.toLocaleString('en-US');

/**
 * Characters as the server counts them: Unicode code points of the trimmed text.
 * @param text - Any text.
 * @returns The count.
 */
export const charCount = (text: string): number => Array.from(text.trim()).length;

/**
 * Counts a caption against its platform's limit.
 * @param text - The caption as typed.
 * @param limit - The platform's limit, characters.
 * @returns The count, what is left and the label.
 */
export function captionCount(text: string, limit: number): CaptionCount {
  const count = charCount(text);
  return { count, left: limit - count, isOver: count > limit, label: `${grouped(count)} / ${grouped(limit)}` };
}

/** One cover tile. */
export interface CoverTile {
  url: string;
  index: number;
  isPicked: boolean;
}

/**
 * The cover tiles with the pick marked. A pick past the end (covers not drawn yet) marks the
 * first cover.
 * @param urls - Signed covers, in the order made.
 * @param pick - The saved pick.
 * @returns One tile per cover.
 */
export function coverTiles(urls: readonly string[], pick: number): CoverTile[] {
  const picked = pick >= 0 && pick < urls.length ? pick : 0;
  return urls.map((url, index) => ({ url, index, isPicked: index === picked }));
}

/**
 * Whether "Make 3 more" can run.
 * @param count - Covers the platform has.
 * @param isBusy - A publish or cover run is in flight.
 * @returns True below the cap and while nothing runs.
 */
export const canMakeMoreCovers = (count: number, isBusy: boolean): boolean => !isBusy && count < MAX_COVERS;

/**
 * The tags without one of them.
 * @param tags - The hashtags.
 * @param tag - The tag to remove.
 * @returns A new list.
 */
export const withoutHashtag = (tags: readonly string[], tag: string): string[] => tags.filter((t) => t !== tag);

/**
 * What "Copy caption" copies: the caption, a blank line, then the hashtags.
 * @param caption - The caption.
 * @param hashtags - The hashtags.
 * @returns The text.
 */
export function postText(caption: string, hashtags: readonly string[]): string {
  const tags = hashtags.join(' ');
  if (tags === '') return caption.trim();
  if (caption.trim() === '') return tags;
  return `${caption.trim()}\n\n${tags}`;
}

const STATUS_WORD: Record<ExportStatus, string> = {
  queued: 'Waiting to render',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Render failed',
};

/** What the render row knows about the cut, when the short has loaded. */
export interface CutFacts {
  lengthS: number;
  captionsOn: boolean;
}

/**
 * The render row: "9:16 · 58 s · captions on · Rendering".
 * @param item - The platform's export.
 * @param cut - The cut's length and captions, or null while the short loads.
 * @returns The line.
 */
export function renderLine(item: Pick<ExportItem, 'aspect' | 'status'>, cut: CutFacts | null): string {
  const facts = cut === null ? [] : [`${String(Math.round(cut.lengthS))} s`, cut.captionsOn ? 'captions on' : 'no captions'];
  return [item.aspect, ...facts, STATUS_WORD[item.status]].join(' · ');
}
