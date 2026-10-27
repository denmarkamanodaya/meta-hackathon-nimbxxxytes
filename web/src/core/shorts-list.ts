// Pure rules for the Mac Shorts list (redesign v2, V11a): the filters (All, Ready, From
// productions), the header's count line, each row's status chip, draft, score and second line, and
// the right column's line under the title.
import { SCORE_MAX, isShortWorking } from './agent-trail';
import { formatDuration, formatLongDate } from './format';
import type { Aspect, ShortListItem, ShortStatus } from '../services/api/types';

/** Which shorts the list shows. */
export type ShortsFilter = 'all' | 'ready' | 'productions';

/** The filters in header order. */
export const SHORTS_FILTERS: readonly ShortsFilter[] = ['all', 'ready', 'productions'];

/** Each filter's chip label. */
export const SHORTS_FILTER_LABEL: Record<ShortsFilter, string> = {
  all: 'All',
  ready: 'Ready',
  productions: 'From productions',
};

/**
 * The shorts a filter keeps, in the given order.
 * @param shorts - Every short.
 * @param filter - The chosen filter.
 * @returns The kept shorts: all, the ready ones, or the story cuts of a production.
 */
export function filterShorts<T extends Pick<ShortListItem, 'status' | 'production_id'>>(shorts: readonly T[], filter: ShortsFilter): T[] {
  switch (filter) {
    case 'ready':
      return shorts.filter((short) => short.status === 'ready');
    case 'productions':
      return shorts.filter((short) => short.production_id !== null);
    default:
      return [...shorts];
  }
}

/**
 * The header's line: "2 shorts · newest first".
 * @param count - Shorts in the account.
 * @returns The line.
 */
export const shortsCountLine = (count: number): string => `${String(count)} ${count === 1 ? 'short' : 'shorts'} · newest first`;

/** A row's status chip. */
export interface ShortChip {
  label: string;
  tone: 'success' | 'neutral' | 'danger';
  /** The editor or a render is still running: the chip shows a spinner. */
  isBusy: boolean;
}

const WORKING_LABEL: Record<ShortStatus, string> = {
  planning: 'Planning',
  rendering: 'Rendering',
  critiquing: 'Checking',
  revising: 'Revising',
  ready: 'Ready',
  failed: 'Failed',
};

/**
 * The status chip: Ready (green), Failed (red), else what the editor is doing (neutral, busy).
 * @param status - The short's status.
 * @returns The chip.
 */
export function shortChip(status: ShortStatus): ShortChip {
  const tone = status === 'ready' ? 'success' : status === 'failed' ? 'danger' : 'neutral';
  return { label: WORKING_LABEL[status], tone, isBusy: isShortWorking(status) };
}

/**
 * "Draft 2": the latest draft, or "No draft" before the first one.
 * @param versionCount - Drafts made.
 * @returns The label.
 */
export const draftLabel = (versionCount: number): string => (versionCount > 0 ? `Draft ${String(versionCount)}` : 'No draft');

/**
 * "44 / 50", or "– / 50" before any draft was scored.
 * @param score - The best draft's editor score, if any.
 * @returns The label.
 */
export const scoreLabel = (score: number | null): string =>
  `${score === null ? '–' : String(Math.round(score))} / ${String(SCORE_MAX)}`;

/**
 * A row's title: the post caption, else the prompt.
 * @param row - The caption and prompt.
 * @returns The title.
 */
export const shortTitle = (row: Pick<ShortListItem, 'caption' | 'prompt'>): string => row.caption ?? row.prompt;

/**
 * A row's second line: "From production “Sixty and shining” · made 28 Oct 2026" for a story
 * short, "“3 second short” · made 28 Oct 2026" when the title is the post caption, else
 * "Made 28 Oct 2026" (the title already shows the prompt).
 * @param row - Prompt, caption, production title and creation time.
 * @param timeZone - IANA zone; defaults to the device zone. Tests pin it.
 * @returns The line.
 */
export function shortSubLine(row: Pick<ShortListItem, 'prompt' | 'caption' | 'production_title' | 'created_at'>, timeZone?: string): string {
  const made = formatLongDate(row.created_at, timeZone);
  const origin =
    row.production_title !== null ? `From production “${row.production_title}”` : row.caption !== null ? `“${row.prompt}”` : null;
  return origin === null ? `Made ${made}` : `${origin} · made ${made}`;
}

/**
 * The right column's line: "4:5 · 1:00 · Draft 1 · Rendering".
 * @param short - Frame, length, drafts and status.
 * @returns The line.
 */
export const selectedShortLine = (short: { aspect: Aspect; target_s: number; version_count: number; status: ShortStatus }): string =>
  [short.aspect, formatDuration(short.target_s), draftLabel(short.version_count), shortChip(short.status).label].join(' · ');
