// The Mac Gallery's view rules (redesign v2, Gallery grid and list): the filter chips, the sort
// (a list column and a direction; the menu's orders are named ones),
// the grid/list choice and thumbnail size, the header line, and the words each tile and list row
// shows. Pure: the clips, the drive state and the clock come in as arguments.
import type { GalleryKind } from './gallery-items';
import type { ClipSummary, Project } from '../services/api/types';
import { isCopy, isUncounted } from './clip-view';
import { AVAILABILITY_COPY } from './copy';
import { formatBytes, formatDuration } from './format';
import type { ClipDrive } from './desktop-sync';
import { secondsUntilFreed, type Availability } from './on-this-mac';
import { copyCountParts, SIMILAR_COPY } from './similar';

/** A filter chip. */
export type GalleryFilter = 'all' | 'on-mac' | 'kept' | 'speech' | 'faces' | 'no-project' | 'copies';

/** The chips, in order; Copies (duplicates and near-copies, for clearing space) last. */
export const GALLERY_FILTERS: readonly GalleryFilter[] = ['all', 'on-mac', 'kept', 'speech', 'faces', 'no-project', 'copies'];

/** Chips about this Mac's drive; a browser has no drive, so it leaves them out. */
const MAC_ONLY_FILTERS: readonly GalleryFilter[] = ['on-mac', 'kept'];

/**
 * The chips a window shows.
 * @param isMacApp - Inside the Mac app (true) or a browser (false).
 * @returns Every chip in the Mac app; the browser's leave out On this Mac and Kept offline.
 */
export const galleryFilters = (isMacApp: boolean): readonly GalleryFilter[] =>
  isMacApp ? GALLERY_FILTERS : GALLERY_FILTERS.filter((filter) => !MAC_ONLY_FILTERS.includes(filter));

/** Each chip's words. */
export const GALLERY_FILTER_LABEL: Readonly<Record<GalleryFilter, string>> = {
  all: 'All',
  'on-mac': 'On this Mac',
  kept: AVAILABILITY_COPY.kept,
  speech: 'Has speech',
  faces: 'Has faces',
  'no-project': 'Not in a project',
  copies: SIMILAR_COPY.copiesFilter,
};

/** Which way a column sorts. */
export type SortDir = 'asc' | 'desc';

/** What the clips are sorted by: a list column and a direction (the list's headers set it). */
export interface GallerySort {
  by: keyof GalleryRow;
  dir: SortDir;
}

/** A named order in the toolbar's sort menu. */
export type GallerySortPreset = 'newest' | 'oldest' | 'longest' | 'name';

/** The menu's orders, in the menu's order. */
export const GALLERY_SORTS: readonly GallerySortPreset[] = ['newest', 'oldest', 'longest', 'name'];

/** Each menu order's words. */
export const GALLERY_SORT_LABEL: Readonly<Record<GallerySortPreset, string>> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  longest: 'Longest first',
  name: 'Name',
};

/** The column and direction each menu order stands for. */
export const GALLERY_SORT_PRESET: Readonly<Record<GallerySortPreset, GallerySort>> = {
  newest: { by: 'recorded', dir: 'desc' },
  oldest: { by: 'recorded', dir: 'asc' },
  longest: { by: 'length', dir: 'desc' },
  name: { by: 'name', dir: 'asc' },
};

/** The order the Gallery opens in. */
export const DEFAULT_GALLERY_SORT: GallerySort = GALLERY_SORT_PRESET.newest;

/**
 * The menu order a sort matches, if any.
 * @param sort - The sort.
 * @returns The preset, or null for a header sort the menu has no name for.
 */
export function sortPreset(sort: GallerySort): GallerySortPreset | null {
  return GALLERY_SORTS.find((preset) => GALLERY_SORT_PRESET[preset].by === sort.by && GALLERY_SORT_PRESET[preset].dir === sort.dir) ?? null;
}

/** Text columns start A to Z; numbers and dates start biggest or newest. */
const FIRST_DIR: Readonly<Record<keyof GalleryRow, SortDir>> = {
  name: 'asc',
  type: 'asc',
  recorded: 'desc',
  length: 'desc',
  size: 'desc',
  moments: 'desc',
  faces: 'desc',
  where: 'asc',
  project: 'asc',
};

/**
 * The sort after a click on a column header: the same column flips, another starts its own way.
 * @param current - The sort now.
 * @param by - The clicked column.
 * @returns The new sort.
 */
export function nextSort(current: GallerySort, by: keyof GalleryRow): GallerySort {
  if (current.by === by) return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { by, dir: FIRST_DIR[by] };
}

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
  /** Which kinds the Gallery shows (All, Videos, Recordings, Documents). */
  kind: GalleryKind;
}

/** Where one clip is on this Mac, with the drive's row for it. */
export interface TileDrive {
  availability: Availability;
  /** The drive's row for the clip, if it reported one. */
  drive: ClipDrive | undefined;
  /** Seconds after its last read a file is freed, or null when unknown. */
  releaseAfterS: number | null;
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
    case 'copies':
      return isCopy(clip);
  }
};

const recordedMs = (clip: ClipSummary): number | null => {
  const ms = clip.recorded_at === null ? Number.NaN : new Date(clip.recorded_at).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Cloud, then partly on this Mac, then kept offline: more of it here, later A to Z. */
const WHERE_RANK: Readonly<Record<Availability, number>> = { cloud: 0, cached: 1, kept: 2 };

/** What a sort needs beyond the clip: where it is and the projects' names. */
interface SortContext {
  where: AvailabilityOf;
  projects: readonly Project[];
}

/** A column's raw value: a number, text, or null when unknown (always sorted last). */
type SortValue = number | string | null;

const SORT_VALUE: Readonly<Record<keyof GalleryRow, (clip: ClipSummary, context: SortContext) => SortValue>> = {
  name: (clip) => clip.title,
  type: (clip) => clipTypeLabel(clip.filename),
  recorded: (clip) => recordedMs(clip),
  length: (clip) => clip.duration_s,
  size: (clip) => clip.size_bytes,
  moments: (clip) => clip.segment_count,
  faces: (clip) => clip.face_count,
  where: (clip, context) => WHERE_RANK[context.where(clip.clip_id)],
  project: (clip, context) => {
    const names = projectNames(clip, context.projects);
    return names === NONE ? null : names;
  },
};

const compareValues = (a: Exclude<SortValue, null>, b: Exclude<SortValue, null>): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });

/** Compares two clips by a sort: unknown values last either way, ties in list order. */
function compareBy(sort: GallerySort, context: SortContext): (a: ClipSummary, b: ClipSummary) => number {
  const value = SORT_VALUE[sort.by];
  return (a, b) => {
    const av = value(a, context);
    const bv = value(b, context);
    if (av === null || bv === null) return Number(av === null) - Number(bv === null);
    const order = compareValues(av, bv);
    return sort.dir === 'asc' ? order : -order;
  };
}

/**
 * The clips the Gallery shows: filtered, then sorted.
 * @param clips - The library.
 * @param filter - The chip picked.
 * @param sort - The order picked.
 * @param where - Each clip's availability on this Mac.
 * @param projects - Every project, for the Project column's order.
 * @returns A new array.
 */
export function galleryClips(
  clips: readonly ClipSummary[],
  filter: GalleryFilter,
  sort: GallerySort,
  where: AvailabilityOf,
  projects: readonly Project[] = [],
): ClipSummary[] {
  return clips.filter((clip) => matches(filter, clip, where)).sort(compareBy(sort, { where, projects }));
}

/** Clips that count toward the library: duplicates and near-copies are shown but not counted. */
const stored = (clips: readonly ClipSummary[]) => clips.filter((clip) => !isUncounted(clip.status));

/**
 * The size of some clips' originals.
 * @param clips - The clips.
 * @returns Bytes, duplicates and near-copies left out.
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
 * @param others - Counts of the Gallery's other kinds ("9 recordings", "1 document"), after the clips.
 * @returns For example "25 clips · 2 near-copies · 1 duplicate · 9 recordings · 3.5 GB of 250 GB in
 *   the cloud"; the copy counts only when there are copies.
 */
export function galleryHeaderLine(clips: readonly ClipSummary[], cap: string | null, others: readonly string[] = []): string {
  const kept = stored(clips);
  const size = formatBytes(clipsBytes(kept));
  return [clipCount(kept.length), ...copyCountParts(clips), ...others, `${size}${cap === null ? '' : ` ${cap}`} in the cloud`].join(' · ');
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

/** The kind of file each extension is; the Gallery takes video today, so anything else is a video. */
const KIND_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'Image',
  jpeg: 'Image',
  png: 'Image',
  heic: 'Image',
  webp: 'Image',
  gif: 'Image',
  pdf: 'Document',
  txt: 'Document',
  doc: 'Document',
  docx: 'Document',
};

/**
 * A file's kind and format for the Type column: "Video · MOV", "Image · JPG".
 * @param filename - The uploaded file's name.
 * @returns The kind, then the extension in capitals when the name has one.
 */
export function clipTypeLabel(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : '';
  const kind = KIND_BY_EXTENSION[extension] ?? 'Video';
  return extension === '' ? kind : `${kind} · ${extension.toUpperCase()}`;
}

/** One row of the list view, ready to print. */
export interface GalleryRow {
  name: string;
  type: string;
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
    type: clipTypeLabel(clip.filename),
    recorded: recordedDay(clip.recorded_at, timeZone) || NONE,
    length: clip.duration_s === null ? NONE : formatDuration(clip.duration_s),
    size: formatBytes(clip.size_bytes),
    moments: clip.segment_count === 0 ? NONE : String(clip.segment_count),
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
