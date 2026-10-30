// The Mac Gallery list's columns: every column on a wide window, and without Recorded and Size on
// a narrow one (under about 1200 px), so the table fits the middle column without wrapping dates
// and sizes or scrolling sideways. Also how an upload row spreads over whichever columns show, and
// the sort button's words for a header sort.
import { SEGMENT_COPY } from './copy';
import { GALLERY_SORT_LABEL, sortPreset, type GalleryRow, type GallerySort } from './gallery';

/** A data column of the list (the thumbnail column comes first and is always there). */
export type GalleryListColumn = keyof GalleryRow;

/** Every column, in order: the wide window. */
export const GALLERY_LIST_COLUMNS: readonly GalleryListColumn[] = ['name', 'recorded', 'length', 'size', 'type', 'moments', 'faces', 'where', 'project'];

/** The narrow window: Recorded and Size are left out; the rest keep their order. */
export const GALLERY_LIST_COLUMNS_NARROW: readonly GalleryListColumn[] = GALLERY_LIST_COLUMNS.filter(
  (column) => column !== 'recorded' && column !== 'size',
);

/** Column headings. */
export const GALLERY_LIST_HEADING: Readonly<Record<GalleryListColumn, string>> = {
  name: 'Name',
  recorded: 'Recorded',
  length: 'Length',
  size: 'Size',
  type: 'Type',
  moments: 'Moments',
  faces: 'Faces',
  where: 'Where',
  project: SEGMENT_COPY.segment,
};

/** How an upload row covers the data columns after its name. */
export interface UploadRowSpans {
  /** The state and bar: under Recorded and Length, or Length alone when Recorded is hidden. */
  progress: number;
  /** Whether the row has a cell under Size. */
  hasSize: boolean;
  /** Cancel, at the end: every column after Size. */
  end: number;
}

/**
 * The upload row's cell spans for the shown columns, so it lines up with the clip rows.
 * @param columns - The shown data columns, `name` first.
 * @returns The spans.
 */
export function uploadRowSpans(columns: readonly GalleryListColumn[]): UploadRowSpans {
  const progress = columns.filter((column) => column === 'recorded' || column === 'length').length;
  const hasSize = columns.includes('size');
  return { progress, hasSize, end: columns.length - 1 - progress - (hasSize ? 1 : 0) };
}

/**
 * The sort button's words: the menu's name for the order, else the column and an arrow.
 * @param sort - The sort.
 * @returns For example "Newest first" or "Size ↓".
 */
export function sortLabel(sort: GallerySort): string {
  const preset = sortPreset(sort);
  if (preset !== null) return GALLERY_SORT_LABEL[preset];
  return `${GALLERY_LIST_HEADING[sort.by]} ${sort.dir === 'asc' ? '↑' : '↓'}`;
}
