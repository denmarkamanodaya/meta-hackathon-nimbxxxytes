// The Mac Library's view rules (mocks M1/M2): the filter chips (All, Kept offline, Getting ready,
// Duplicates) and the line under each ready tile, which says where the clip is ("Kept offline ·
// 3.4 GB", "Played just now · frees in 2:40") or, when only in the cloud, its day and people.
import type { ClipSummary } from '../services/api/types';
import { isInProgress } from './clip-view';
import { dayLabel } from './day-groups';
import { spaceUsedLabel, type ClipDrive } from './desktop-sync';
import { formatDuration } from './format';
import { secondsUntilFreed, type Availability } from './on-this-mac';

/** A Library filter chip. */
export type LibraryFilter = 'all' | 'kept' | 'getting-ready' | 'duplicates';

/** The chips, in order. */
export const LIBRARY_FILTERS: readonly LibraryFilter[] = ['all', 'kept', 'getting-ready', 'duplicates'];

const FILTER_NAME: Record<LibraryFilter, string> = {
  all: 'All',
  kept: 'Kept offline',
  'getting-ready': 'Getting ready',
  duplicates: 'Duplicates',
};

const matches = (filter: LibraryFilter, clip: ClipSummary, pinned: readonly string[]): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'kept':
      return pinned.includes(clip.clip_id);
    case 'getting-ready':
      return isInProgress(clip.status);
    case 'duplicates':
      return clip.status === 'duplicate';
  }
};

/**
 * The clips a filter shows.
 * @param clips - The library.
 * @param filter - The chip picked.
 * @param pinned - Clip ids kept offline.
 * @returns The matching clips, in library order.
 */
export function filterClips(clips: readonly ClipSummary[], filter: LibraryFilter, pinned: readonly string[]): ClipSummary[] {
  return clips.filter((clip) => matches(filter, clip, pinned));
}

/**
 * A chip's label: "All 13" always counts; the others count only when there is something.
 * @param filter - The chip.
 * @param clips - The library.
 * @param pinned - Clip ids kept offline.
 * @returns For example "All 13", "Kept offline", "Getting ready 1".
 */
export function filterLabel(filter: LibraryFilter, clips: readonly ClipSummary[], pinned: readonly string[]): string {
  const count = filterClips(clips, filter, pinned).length;
  return filter === 'all' || count > 0 ? `${FILTER_NAME[filter]} ${String(count)}` : FILTER_NAME[filter];
}

/**
 * "Played just now" or "Played 2 min ago".
 * @param lastReadAt - ISO-8601 instant of the last read.
 * @param now - The current instant.
 * @returns The words.
 */
function playedAgo(lastReadAt: string | null, now: Date): string {
  const at = lastReadAt === null ? Number.NaN : new Date(lastReadAt).getTime();
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  return Number.isNaN(minutes) || minutes < 1 ? 'Played just now' : `Played ${String(minutes)} min ago`;
}

/** What a ready tile's line needs to know about the drive. */
export interface TileDrive {
  availability: Availability;
  /** The drive's row for the clip, if it reported one. */
  drive: ClipDrive | undefined;
  /** Seconds after its last read a file is freed, or null when unknown. */
  releaseAfterS: number | null;
}

/**
 * The line under a ready tile.
 * @param clip - The clip.
 * @param where - Its availability and drive row.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns "Kept offline · 3.4 GB", "Played just now · frees in 2:40", or "Today · Sam, Leo".
 */
export function readyTileLine(clip: ClipSummary, where: TileDrive, now: Date, timeZone?: string): string {
  const bytes = where.drive?.cachedBytes ?? 0;
  if (where.availability === 'kept') return bytes > 0 ? `Kept offline · ${spaceUsedLabel(bytes)}` : 'Kept offline';
  if (where.availability === 'cached') {
    const lastReadAt = where.drive?.lastReadAt ?? null;
    const left = secondsUntilFreed(lastReadAt, where.releaseAfterS, now);
    return `${playedAgo(lastReadAt, now)}${left === null ? '' : ` · frees in ${formatDuration(left)}`}`;
  }
  const day = clip.recorded_at === null ? '' : dayLabel(clip.recorded_at, now, timeZone);
  return [day, clip.people.join(', ')].filter((part) => part !== '').join(' · ');
}
