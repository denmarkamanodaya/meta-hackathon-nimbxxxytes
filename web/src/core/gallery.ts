// The Mac Gallery's view rules (redesign v2, Gallery grid and list): the filter chips, the sort,
// the grid/list choice and thumbnail size, the header line, and the words each tile and list row
// shows. Pure: the clips, the drive state and the clock come in as arguments.
import type { ClipSummary, Project } from '../services/api/types';
import { AVAILABILITY_COPY } from './copy';
import { formatBytes, formatDuration } from './format';
import type { TileDrive } from './mac-library';
import { secondsUntilFreed, type Availability } from './on-this-mac';

/** A filter chip. */
export type GalleryFilter = 'all' | 'on-mac' | 'kept' | 'speech' | 'faces' | 'no-project';

/** The chips, in order. */
export const GALLERY_FILTERS: readonly GalleryFilter[] = ['all', 'on-mac', 'kept', 'speech', 'faces', 'no-project'];

/** Each chip's words. */
export const GALLERY_FILTER_LABEL: Readonly<Record<GalleryFilter, string>> = {
  all: 'All',
  'on-mac': 'On this Mac',
  kept: AVAILABILITY_COPY.kept,
  speech: 'Has speech',
  faces: 'Has faces',
  'no-project': 'Not in a project',
};

/** A sort order. */
export type GallerySort = 'newest' | 'oldest' | 'longest' | 'name';

/** The orders, in the menu's order. */
export const GALLERY_SORTS: readonly GallerySort[] = ['newest', 'oldest', 'longest', 'name'];

/** Each order's words. */
export const GALLERY_SORT_LABEL: Readonly<Record<GallerySort, string>> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  longest: 'Longest first',
  name: 'Name',
};

/** Grid of square tiles or a table. */
export type GalleryView = 'grid' | 'list';

/** Thumbnail size steps on the slider; the mock opens on the middle one. */
export const GALLERY_SIZE_MIN = 1;
export const GALLERY_SIZE_MAX = 5;
export const GALLERY_SIZE_DEFAULT = 3;

/** Grid columns per size step: bigger step, bigger tiles, fewer columns (step 3 is the mock's 5). */
const COLUMNS: Readonly<Record<number, number>> = { 1: 8, 2: 6, 3: 5, 4: 4, 5: 3 };

/** The remembered Gallery choices. */
export interface GalleryPrefs {
  view: GalleryView;
  size: number;
}

/** What a clip's availability means for the filters and the Where column. */
export type AvailabilityOf = (clipId: string) => Availability;

/**
 * Reads a stored view.
 * @param raw - Stored text, or null.
 * @returns `list` only when `list` was stored, else `grid`.
 */
export const parseGalleryView = (raw: string | null): GalleryView => (raw === 'list' ? 'list' : 'grid');

/**
 * Reads a stored size step.
 * @param raw - Stored text, or null.
 * @returns A whole step from 1 to 5; the default for anything else.
 */
export function parseGallerySize(raw: string | null): number {
  const step = Number(raw);
  return Number.isInteger(step) && step >= GALLERY_SIZE_MIN && step <= GALLERY_SIZE_MAX ? step : GALLERY_SIZE_DEFAULT;
}

/**
 * Grid columns for a size step.
 * @param size - Step 1–5.
 * @returns Columns; the default step's for an unknown one.
 */
export const gridColumns = (size: number): number => COLUMNS[size] ?? 5;

const matches = (filter: GalleryFilter, clip: ClipSummary, where: AvailabilityOf): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'on-mac':
      return where(clip.clip_id) !== 'cloud';
    case 'kept':
      return where(clip.clip_id) === 'kept';
    case 'speech':
      return clip.speech_count > 0;
    case 'faces':
      return clip.face_count > 0;
    case 'no-project':
      return clip.project_ids.length === 0;
  }
};

const recordedMs = (clip: ClipSummary): number => (clip.recorded_at === null ? Number.NaN : new Date(clip.recorded_at).getTime());

/** Newest first, clips without a date last, ties in list order. */
function byDate(a: ClipSummary, b: ClipSummary, newest: boolean): number {
  const at = recordedMs(a);
  const bt = recordedMs(b);
  if (Number.isNaN(at) || Number.isNaN(bt)) return Number(Number.isNaN(at)) - Number(Number.isNaN(bt));
  return newest ? bt - at : at - bt;
}

const COMPARE: Readonly<Record<GallerySort, (a: ClipSummary, b: ClipSummary) => number>> = {
  newest: (a, b) => byDate(a, b, true),
  oldest: (a, b) => byDate(a, b, false),
  longest: (a, b) => (b.duration_s ?? -1) - (a.duration_s ?? -1),
  name: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
};

/**
 * The clips the Gallery shows: filtered, then sorted.
 * @param clips - The library.
 * @param filter - The chip picked.
 * @param sort - The order picked.
 * @param where - Each clip's availability on this Mac.
 * @returns A new array.
 */
export function galleryClips(
  clips: readonly ClipSummary[],
  filter: GalleryFilter,
  sort: GallerySort,
  where: AvailabilityOf,
): ClipSummary[] {
  return clips.filter((clip) => matches(filter, clip, where)).sort(COMPARE[sort]);
}

/** Clips that count toward the library: duplicates stop before they are stored. */
const stored = (clips: readonly ClipSummary[]) => clips.filter((clip) => clip.status !== 'duplicate');

/**
 * The size of some clips' originals.
 * @param clips - The clips.
 * @returns Bytes, duplicates left out.
 */
export const clipsBytes = (clips: readonly ClipSummary[]): number => stored(clips).reduce((sum, clip) => sum + clip.size_bytes, 0);

/**
 * "1 clip" or "5 clips".
 * @param count - Clips.
 * @returns The words.
 */
export const clipCount = (count: number): string => `${String(count)} ${count === 1 ? 'clip' : 'clips'}`;

/**
 * The Gallery header line.
 * @param clips - The library.
 * @param cap - "of 250 GB" when the storage cap is known, else null.
 * @returns For example "5 clips · 3.5 GB of 250 GB in the cloud".
 */
export function galleryHeaderLine(clips: readonly ClipSummary[], cap: string | null): string {
  const kept = stored(clips);
  const size = formatBytes(clipsBytes(kept));
  return `${clipCount(kept.length)} · ${size}${cap === null ? '' : ` ${cap}`} in the cloud`;
}

/**
 * A clip's recording day in full: "26 Oct 2026".
 * @param iso - ISO-8601 instant, or null.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The date, or an empty string when unknown.
 */
export function recordedDay(iso: string | null, timeZone?: string): string {
  const date = iso === null ? null : new Date(iso);
  if (date === null || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}

/**
 * "2 moments", "1 moment".
 * @param count - Moments (segments).
 * @returns The words.
 */
export const momentCount = (count: number): string => `${String(count)} ${count === 1 ? 'moment' : 'moments'}`;

/**
 * The line under a tile: "26 Oct 2026 · 3 moments".
 * @param clip - The clip.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export function tileLine(clip: ClipSummary, timeZone?: string): string {
  return [recordedDay(clip.recorded_at, timeZone), momentCount(clip.segment_count)].filter((part) => part !== '').join(' · ');
}

/** Where a clip is, in the Gallery's words: the tile badge's name and the Where column. */
export const WHERE_LABEL: Readonly<Record<Availability, string>> = {
  cloud: AVAILABILITY_COPY.cloud,
  cached: AVAILABILITY_COPY.partly,
  kept: AVAILABILITY_COPY.kept,
};

/** Shown in a list cell that has nothing. */
export const NONE = '—';

/**
 * The project names of a clip, joined.
 * @param clip - The clip.
 * @param projects - Every project.
 * @returns "Australia trip", "A, B", or "—".
 */
export function projectNames(clip: ClipSummary, projects: readonly Project[]): string {
  const names = projects.filter((p) => clip.project_ids.includes(p.project_id)).map((p) => p.name);
  return names.length === 0 ? NONE : names.join(', ');
}

/** One row of the list view, ready to print. */
export interface GalleryRow {
  name: string;
  recorded: string;
  length: string;
  size: string;
  moments: string;
  faces: string;
  where: string;
  project: string;
}

/**
 * A list row's cells.
 * @param clip - The clip.
 * @param availability - Where it is on this Mac.
 * @param projects - Every project.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The cells.
 */
export function galleryRow(clip: ClipSummary, availability: Availability, projects: readonly Project[], timeZone?: string): GalleryRow {
  return {
    name: clip.title,
    recorded: recordedDay(clip.recorded_at, timeZone) || NONE,
    length: clip.duration_s === null ? NONE : formatDuration(clip.duration_s),
    size: formatBytes(clip.size_bytes),
    moments: String(clip.segment_count),
    faces: clip.face_count === 0 ? NONE : String(clip.face_count),
    where: WHERE_LABEL[availability],
    project: projectNames(clip, projects),
  };
}

/**
 * The right column's line under the title: "19 Aug 2026 · 5:27 · 3.4 GB · in 60th birthday".
 * @param clip - The clip.
 * @param projects - Every project.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export function panelMetaLine(clip: ClipSummary, projects: readonly Project[], timeZone?: string): string {
  const names = projectNames(clip, projects);
  return [
    recordedDay(clip.recorded_at, timeZone),
    clip.duration_s === null ? '' : formatDuration(clip.duration_s),
    formatBytes(clip.size_bytes),
    names === NONE ? '' : `in ${names}`,
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/**
 * The right column's availability line: "In the cloud", "Kept offline · 3.4 GB", or "Partly on this
 * Mac · 40.4 MB · frees in 2:41".
 * @param where - The clip's availability and drive row.
 * @param now - The current instant.
 * @returns The line.
 */
export function availabilityLine(where: TileDrive, now: Date): string {
  const bytes = where.drive?.cachedBytes ?? 0;
  const size = where.availability !== 'cloud' && bytes > 0 ? formatBytes(bytes) : '';
  const left = where.availability === 'cached' ? secondsUntilFreed(where.drive?.lastReadAt ?? null, where.releaseAfterS, now) : null;
  return [WHERE_LABEL[where.availability], size, left === null ? '' : `frees in ${formatDuration(left)}`]
    .filter((part) => part !== '')
    .join(' · ');
}
