// Pure rules of the Publish screen: the caption counter, which cover is picked and its label, the
// cover title (its live preview and when it saves), redraw words, hashtag edits and the text
// "Copy caption" puts on the clipboard.
import type {
  CoverStyle,
  CoverTile as WireCover,
  CoverTitle,
  CoverTitlePosition,
  ExportItem,
  ExportStatus,
  ShortDetail,
  StudioStepEvent,
} from '../services/api/types';
import { pickBestVersion } from './agent-trail';
import { COVER_STYLE_COPY, MUSE_IMAGE_COPY, PLATFORM_COPY } from './copy';
import { formatDuration } from './format';
import { timelineLength } from './timeline-edit';

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

/** One cover tile on screen. */
export interface CoverView {
  url: string;
  style: CoverStyle;
  index: number;
  isPicked: boolean;
  /** "2 · Close detail", "4 · Redrawn: golden hour". */
  label: string;
}

/**
 * A cover's name under its tile.
 * @param cover - The cover's style and redraw words.
 * @param index - Its 0-based place.
 * @returns For example `"1 · Bright"`, `"4 · Redrawn: golden hour"`, `"5 · Key art"`.
 */
export function coverLabel(cover: Pick<WireCover, 'style' | 'instruction'>, index: number): string {
  const name = COVER_STYLE_COPY[cover.style];
  const words = cover.style === 'redrawn' && cover.instruction !== null ? `${name}: ${cover.instruction}` : name;
  return `${String(index + 1)} · ${words}`;
}

/**
 * The cover tiles with the pick marked. A pick past the end (covers not drawn yet) marks the
 * first cover.
 * @param covers - The covers, in the order made.
 * @param pick - The saved pick.
 * @returns One tile per cover.
 */
export function coverTiles(covers: readonly WireCover[], pick: number): CoverView[] {
  const picked = pick >= 0 && pick < covers.length ? pick : 0;
  return covers.map((cover, index) => ({
    url: cover.url,
    style: cover.style,
    index,
    isPicked: index === picked,
    label: coverLabel(cover, index),
  }));
}

/**
 * Whether "Make 3 more" or Redraw can add a cover.
 * @param count - Covers the platform has.
 * @param isBusy - A publish or cover run is in flight.
 * @returns True below the cap and while nothing runs.
 */
export const canMakeMoreCovers = (count: number, isBusy: boolean): boolean => !isBusy && count < MAX_COVERS;

/** Longest cover title, characters. */
export const COVER_TITLE_MAX = 32;

/** Redraw words: at least this many characters… */
export const REDRAW_MIN = 3;
/** …and at most this many. */
export const REDRAW_MAX = 120;

/**
 * Cuts typed title text to the longest the server takes (counted by code point).
 * @param text - The text as typed.
 * @returns At most 32 characters.
 */
export const clampCoverTitle = (text: string): string => Array.from(text).slice(0, COVER_TITLE_MAX).join('');

/**
 * The title laid over a cover preview, or null when it is off or empty. The preview is live CSS;
 * the published still is baked on the server from the saved title.
 * @param title - The saved title.
 * @param draft - Text typed and not saved yet; null when none.
 * @returns The text (trimmed, at most 32 characters) and where it sits, or null.
 */
export function titleOverlay(title: CoverTitle, draft: string | null): { text: string; position: CoverTitlePosition } | null {
  if (!title.show) return null;
  const text = clampCoverTitle((draft ?? title.text).trim());
  return text === '' ? null : { text, position: title.position };
}

/**
 * Whether typed title text can be saved: 1–32 characters after trimming, and changed.
 * @param draft - The text as typed.
 * @param saved - The saved text.
 * @returns True when it should be saved.
 */
export function canSaveTitle(draft: string, saved: string): boolean {
  const clean = draft.trim();
  return clean !== '' && charCount(clean) <= COVER_TITLE_MAX && clean !== saved;
}

/**
 * Whether Redraw can run on these words.
 * @param instruction - The words as typed.
 * @param count - Covers the platform has.
 * @param isBusy - A publish or cover run is in flight.
 * @returns True for 3–120 characters below the cover cap while nothing runs.
 */
export function canRedraw(instruction: string, count: number, isBusy: boolean): boolean {
  const length = charCount(instruction);
  return length >= REDRAW_MIN && length <= REDRAW_MAX && canMakeMoreCovers(count, isBusy);
}

/**
 * Adds a suggestion chip's words to the redraw text: "golden hour" then "golden hour, moodier".
 * @param text - The words typed so far.
 * @param suggestion - The chip's words.
 * @returns The new text, unchanged when it already says it.
 */
export function addSuggestion(text: string, suggestion: string): string {
  const clean = text.trim();
  if (clean === '') return suggestion;
  if (clean.toLowerCase().includes(suggestion.toLowerCase())) return clean;
  return `${clean}, ${suggestion}`;
}

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

const RUN_WORD: Record<string, string> = {
  exports: 'Starting the publish pack',
  pack: 'Writing captions and hashtags',
  covers: 'Drawing covers',
  render: 'Rendering the videos',
  done: 'Publish pack ready',
};

/**
 * Words for one step of a publish or cover run.
 * @param step - The step name from the stream, or null before the first event.
 * @param status - Its status.
 * @returns The line.
 */
export function publishStepLine(step: string | null, status: StudioStepEvent['status'] | null): string {
  if (status === 'failed') return 'Publishing stopped. Try again.';
  return step === null ? 'Working on it' : (RUN_WORD[step] ?? 'Working on it');
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
 * The best draft's length and captions, for the render row.
 * @param detail - The short, or null while it loads.
 * @returns The facts, or null.
 */
export function cutFacts(detail: ShortDetail | null): CutFacts | null {
  if (detail === null) return null;
  const version = detail.versions.find((v) => v.n === pickBestVersion(detail.versions, detail.short.best_version));
  if (version === undefined) return null;
  return { lengthS: timelineLength(version.timeline.clips), captionsOn: version.timeline.captions.style !== 'none' };
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

/**
 * A render's status word ("Ready", "Rendering").
 * @param status - The export's status.
 * @returns The word.
 */
export const renderStatusWord = (status: ExportStatus): string => STATUS_WORD[status];

/**
 * The Mac render row's first line: "9:16 render · 0:10".
 * @param aspect - The export's frame.
 * @param cut - The cut's facts, or null while the short loads.
 * @returns The line.
 */
export const macRenderLine = (aspect: ExportItem['aspect'], cut: CutFacts | null): string =>
  cut === null ? `${aspect} render` : `${aspect} render · ${formatDuration(cut.lengthS)}`;

/**
 * Who shares a render: the 9:16 one serves three platforms; the feed keeps the short's frame.
 * @param aspect - The export's frame.
 * @returns The line.
 */
export const renderSharedLine = (aspect: ExportItem['aspect']): string =>
  aspect === '9:16'
    ? `Shared by ${PLATFORM_COPY.tiktok}, ${PLATFORM_COPY.reels} and ${PLATFORM_COPY.shorts}`
    : `${PLATFORM_COPY.feed} only, in the short's ${aspect}`;

/**
 * The cover section's count line: "4 of 9 · drawn by Muse Image from your hook frame".
 * @param count - Covers drawn.
 * @returns The line.
 */
export const coverCountLine = (count: number): string =>
  `${String(count)} of ${String(MAX_COVERS)} · ${MUSE_IMAGE_COPY.coverSource}`;
