// The Gallery's mixed grid (mocks GalleryMixedMock, PhotosMock): videos, photos, iListen recordings
// and iRead documents in one list, newest first, with the kind filter row (All · Videos · Photos ·
// Recordings · Documents and
// their counts), the header's counts and each kind's tile words. The three lists are merged here;
// there is no endpoint for the mix. Pure: no IO, no clock.
import type { ClipSummary, DocumentSummary, ListenSummary, PhotoSummary } from '../services/api/types';
import type { DeleteOutcome, DeleteToast } from './bulk-delete';
import { docKindLabel, docTitle, pageCount } from './iread/documents';
import { listenTitle, recordingCount } from './ilisten/listens';
import { photoCount, photoTileLine, photoTitle } from './photos';
import { languageLabel } from './ilisten/languages';
import type { GalleryRow, GallerySort } from './gallery';
import { NONE, recordedDay } from './gallery';
import { formatBytes, formatDuration } from './format';

/** Which kinds the Gallery shows. */
export type GalleryKind = 'all' | 'videos' | 'photos' | 'recordings' | 'documents';

/** The filter row's order. */
export const GALLERY_KINDS: readonly GalleryKind[] = ['all', 'videos', 'photos', 'recordings', 'documents'];

/** Each kind's chip. */
export const GALLERY_KIND_LABEL: Readonly<Record<GalleryKind, string>> = {
  all: 'All',
  videos: 'Videos',
  photos: 'Photos',
  recordings: 'Recordings',
  documents: 'Documents',
};

/**
 * Reads a stored kind filter.
 * @param raw - Stored text, or null.
 * @returns The kind, `all` for anything else.
 */
export const parseGalleryKind = (raw: string | null): GalleryKind => GALLERY_KINDS.find((kind) => kind === raw) ?? 'all';

/** One Gallery entry. `id` is the clip id for a video and a prefixed id for the others. */
export type GalleryItem =
  | { kind: 'video'; id: string; clip: ClipSummary }
  | { kind: 'photo'; id: string; photo: PhotoSummary }
  | { kind: 'recording'; id: string; listen: ListenSummary }
  | { kind: 'document'; id: string; doc: DocumentSummary };

const PHOTO_PREFIX = 'photo:';
const LISTEN_PREFIX = 'listen:';
const DOC_PREFIX = 'doc:';

/** The Gallery id of a photo. */
export const photoItemId = (photoId: string): string => `${PHOTO_PREFIX}${photoId}`;
/** The Gallery id of a recording. */
export const recordingItemId = (listenId: string): string => `${LISTEN_PREFIX}${listenId}`;
/** The Gallery id of a document. */
export const documentItemId = (documentId: string): string => `${DOC_PREFIX}${documentId}`;

/** What a Gallery id stands for. */
export interface ItemRef {
  kind: GalleryItem['kind'];
  id: string;
}

/**
 * The thing behind a Gallery id (a selection entry).
 * @param itemId - A clip id, `photo:<id>`, `listen:<id>` or `doc:<id>`.
 * @returns Its kind and its own id.
 */
export function itemRef(itemId: string): ItemRef {
  if (itemId.startsWith(PHOTO_PREFIX)) return { kind: 'photo', id: itemId.slice(PHOTO_PREFIX.length) };
  if (itemId.startsWith(LISTEN_PREFIX)) return { kind: 'recording', id: itemId.slice(LISTEN_PREFIX.length) };
  if (itemId.startsWith(DOC_PREFIX)) return { kind: 'document', id: itemId.slice(DOC_PREFIX.length) };
  return { kind: 'video', id: itemId };
}

const videoItem = (clip: ClipSummary): GalleryItem => ({ kind: 'video', id: clip.clip_id, clip });
const photoItem = (photo: PhotoSummary): GalleryItem => ({ kind: 'photo', id: photoItemId(photo.id), photo });
const recordingItem = (listen: ListenSummary): GalleryItem => ({ kind: 'recording', id: recordingItemId(listen.id), listen });
const documentItem = (doc: DocumentSummary): GalleryItem => ({ kind: 'document', id: documentItemId(doc.id), doc });

const ms = (iso: string | null): number | null => {
  const at = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

/** When it was made: a video's recording time, a photo's date taken, else when it was added. */
function itemDate(item: GalleryItem): number | null {
  switch (item.kind) {
    case 'video':
      return ms(item.clip.recorded_at);
    case 'photo':
      return ms(item.photo.taken_at ?? item.photo.created_at);
    case 'recording':
      return ms(item.listen.created_at);
    case 'document':
      return ms(item.doc.created_at);
  }
}

/** Its length in seconds; a photo or a document has none. */
const itemLength = (item: GalleryItem): number | null => {
  if (item.kind === 'video') return item.clip.duration_s;
  if (item.kind === 'recording') return item.listen.duration_ms === null ? null : item.listen.duration_ms / 1000;
  return null;
};

/** The Gallery's day of an entry, ISO-8601 (what the phone groups it under). */
const itemDay = (item: GalleryItem): string | null => {
  if (item.kind === 'video') return item.clip.recorded_at;
  if (item.kind === 'photo') return item.photo.taken_at ?? item.photo.created_at;
  return item.kind === 'recording' ? item.listen.created_at : item.doc.created_at;
};

/** Its title as the tile shows it. */
export function itemTitle(item: GalleryItem): string {
  switch (item.kind) {
    case 'video':
      return item.clip.title;
    case 'photo':
      return photoTitle(item.photo);
    case 'recording':
      return listenTitle(item.listen);
    case 'document':
      return docTitle(item.doc);
  }
}

type Value = number | string | null;

const MIXED_VALUE: Partial<Record<GallerySort['by'], (item: GalleryItem) => Value>> = {
  recorded: itemDate,
  length: itemLength,
  name: itemTitle,
};

/** Unknown values last either way; ties keep their order. */
function compareMixed(sort: GallerySort, value: (item: GalleryItem) => Value): (a: GalleryItem, b: GalleryItem) => number {
  return (a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null || bv === null) return Number(av === null) - Number(bv === null);
    const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'en', { sensitivity: 'base' });
    return sort.dir === 'asc' ? order : -order;
  };
}

/** What the Gallery mixes. */
export interface GallerySources {
  /** The videos as the toolbar filtered and sorted them. */
  clips: readonly ClipSummary[];
  photos: readonly PhotoSummary[];
  listens: readonly ListenSummary[];
  documents: readonly DocumentSummary[];
}

/**
 * The Gallery's entries for a kind. Recordings and documents join only the plain view (a video
 * filter such as Speech or Copies is about videos), in the toolbar's order when it is by date,
 * length or name, else after the videos, newest first.
 * @param sources - The three lists.
 * @param kind - The kind chip.
 * @param isVideoFilterOn - A video filter other than All is on.
 * @param sort - The toolbar's order.
 * @returns The entries.
 */
export function galleryItems(sources: GallerySources, kind: GalleryKind, isVideoFilterOn: boolean, sort: GallerySort): GalleryItem[] {
  const videos = kind === 'all' || kind === 'videos' ? sources.clips.map(videoItem) : [];
  const others =
    isVideoFilterOn || kind === 'videos'
      ? []
      : [
          ...(kind === 'all' || kind === 'photos' ? sources.photos.map(photoItem) : []),
          ...(kind === 'all' || kind === 'recordings' ? sources.listens.map(recordingItem) : []),
          ...(kind === 'all' || kind === 'documents' ? sources.documents.map(documentItem) : []),
        ];
  if (others.length === 0) return videos;
  const value = MIXED_VALUE[sort.by];
  if (value === undefined) return [...videos, ...others.sort(compareMixed({ by: 'recorded', dir: 'desc' }, itemDate))];
  return [...videos, ...others].sort(compareMixed(sort, value));
}

/** How many of each kind there are. */
export type KindCounts = Readonly<Record<GalleryKind, number>>;

/**
 * The filter row's counts.
 * @param sources - The three lists (the clips unfiltered).
 * @returns Each kind's count; All is their sum.
 */
export function kindCounts(sources: GallerySources): KindCounts {
  const videos = sources.clips.length;
  const photos = sources.photos.length;
  const recordings = sources.listens.length;
  const documents = sources.documents.length;
  return { all: videos + photos + recordings + documents, videos, photos, recordings, documents };
}

/**
 * "1 document", "3 documents".
 * @param count - Documents.
 * @returns The words.
 */
export const docCount = (count: number): string => `${String(count)} ${count === 1 ? 'document' : 'documents'}`;

/**
 * The header's counts of the other kinds ("6 photos", "9 recordings", "1 document"), each only when
 * there are some.
 * @param counts - The kinds' counts.
 * @returns The parts.
 */
export const otherCountParts = (counts: KindCounts): string[] =>
  [counts.photos > 0 ? photoCount(counts.photos) : '', counts.recordings > 0 ? recordingCount(counts.recordings) : '', counts.documents > 0 ? docCount(counts.documents) : ''].filter((part) => part !== '');

/**
 * A recording tile's language chips: each language heard, then the output language ("中文",
 * "日本語", "→ EN").
 * @param listen - The recording.
 * @returns The chips; none before the languages are known.
 */
export function recordingChips(listen: Pick<ListenSummary, 'languages' | 'target'>): string[] {
  if (listen.languages.length === 0) return [];
  return [...listen.languages.map((each) => languageLabel(each.code)), `→ ${listen.target.toUpperCase()}`];
}

/**
 * The line under a recording tile: "30 Oct 2026 · iListen".
 * @param listen - The recording.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export const recordingTileLine = (listen: Pick<ListenSummary, 'created_at'>, timeZone?: string): string =>
  [recordedDay(listen.created_at, timeZone), 'iListen'].filter((part) => part !== '').join(' · ');

/**
 * The line under a document tile: "29 Oct 2026 · iRead · 1 page".
 * @param doc - The document.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export const documentTileLine = (doc: Pick<DocumentSummary, 'created_at' | 'page_count'>, timeZone?: string): string =>
  [recordedDay(doc.created_at, timeZone), 'iRead', doc.page_count > 0 ? pageCount(doc.page_count) : ''].filter((part) => part !== '').join(' · ');

/**
 * A document tile's badge: its kind ("Bill").
 * @param doc - The document.
 * @returns The words.
 */
export const documentBadge = (doc: Pick<DocumentSummary, 'kind'>): string => docKindLabel(doc.kind);

/**
 * The ticked videos: every kind can be deleted, but projects, offline and Make a short take videos
 * only.
 * @param itemIds - The ticked Gallery ids.
 * @returns The clip ids among them.
 */
export function tickedClipIds(itemIds: readonly string[]): string[] {
  return itemIds.filter((id) => itemRef(id).kind === 'video');
}

/**
 * "Delete 3 items?" and its words, for the Select bar's Delete.
 * @param count - Things ticked.
 * @returns The confirm's words.
 */
export function itemsDeleteCopy(count: number): { title: string; body: string; confirmLabel: string } {
  const what = count === 1 ? 'this item' : `${String(count)} items`;
  return {
    title: `Delete ${what}?`,
    body: 'Clips, recordings and documents you ticked are removed from nimbytes, with everything made from them. This can’t be undone.',
    confirmLabel: count === 1 ? 'Delete' : `Delete ${String(count)}`,
  };
}

/**
 * A list row's cells for a photo, a recording or a document: its name, kind, day, length or size;
 * the video columns stay empty.
 * @param item - A photo, a recording or a document.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The cells.
 */
export function itemRow(item: Exclude<GalleryItem, { kind: 'video' }>, timeZone?: string): GalleryRow {
  if (item.kind === 'photo') {
    const size = item.photo.width === null || item.photo.height === null ? '' : ` · ${String(item.photo.width)} × ${String(item.photo.height)}`;
    return {
      name: itemTitle(item),
      type: `Photo${size}`,
      recorded: recordedDay(item.photo.taken_at ?? item.photo.created_at, timeZone) || NONE,
      length: NONE,
      size: formatBytes(item.photo.size_bytes),
      moments: NONE,
      faces: NONE,
      where: NONE,
      project: NONE,
    };
  }
  const isRecording = item.kind === 'recording';
  const created = isRecording ? item.listen.created_at : item.doc.created_at;
  const length = isRecording && item.listen.duration_ms !== null ? formatDuration(item.listen.duration_ms / 1000) : NONE;
  return {
    name: itemTitle(item),
    type: isRecording ? 'Recording · iListen' : `${documentBadge(item.doc)} · iRead`,
    recorded: recordedDay(created, timeZone) || NONE,
    length,
    size: NONE,
    moments: NONE,
    faces: NONE,
    where: NONE,
    project: NONE,
  };
}

const items = (n: number) => `${String(n)} ${n === 1 ? 'item' : 'items'}`;

/**
 * Words for the toast after deleting Gallery entries.
 * @param outcome - What went and what stayed.
 * @returns "Deleted", "3 items deleted", "Could not delete it" or "Could not delete 1 of 3 items".
 */
export function itemsDeleteToast(outcome: DeleteOutcome): DeleteToast {
  const total = outcome.deleted.length + outcome.failed.length;
  if (outcome.failed.length === 0) return { tone: 'info', title: total === 1 ? 'Deleted' : `${items(total)} deleted` };
  const title = total === 1 ? 'Could not delete it' : `Could not delete ${String(outcome.failed.length)} of ${items(total)}`;
  return { tone: 'error', title, error: outcome.firstError };
}

/**
 * A Gallery entry as the phone's day groups take it: its day and length, and a status that counts
 * it (a clip keeps its own).
 * @param item - The entry.
 * @returns The dated entry.
 */
export function datedItem(item: GalleryItem): { item: GalleryItem; recorded_at: string | null; duration_s: number | null; status: ClipSummary['status'] } {
  if (item.kind === 'video') return { item, recorded_at: item.clip.recorded_at, duration_s: item.clip.duration_s, status: item.clip.status };
  return { item, recorded_at: itemDay(item), duration_s: null, status: 'ready' };
}

/**
 * A day header's count when the day mixes kinds: "2 clips · 3 photos · 1 recording · 1 document".
 * @param entries - The day's entries.
 * @returns The words.
 */
export function dayItemsLine(entries: readonly GalleryItem[]): string {
  const count = (kind: GalleryItem['kind']) => entries.filter((each) => each.kind === kind).length;
  const clips = count('video');
  return [
    clips > 0 ? `${String(clips)} ${clips === 1 ? 'clip' : 'clips'}` : '',
    ...otherCountParts({ all: entries.length, videos: clips, photos: count('photo'), recordings: count('recording'), documents: count('document') }),
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/**
 * The picture of a photo, a recording (its cover) or a document (its first page).
 * @param item - The entry.
 * @returns The URL, or null while there is none.
 */
export function itemThumb(item: Exclude<GalleryItem, { kind: 'video' }>): string | null {
  if (item.kind === 'photo') return item.photo.thumb_url;
  return item.kind === 'recording' ? item.listen.cover_url : item.doc.thumb_url;
}

/**
 * The line under a photo, recording or document tile.
 * @param item - The entry.
 * @param timeZone - IANA zone; tests pin it.
 * @returns "19 Aug 2026 · Photo", "30 Oct 2026 · iListen" or "29 Oct 2026 · iRead · 1 page".
 */
export function itemTileLine(item: Exclude<GalleryItem, { kind: 'video' }>, timeZone?: string): string {
  if (item.kind === 'photo') return photoTileLine(item.photo, timeZone);
  return item.kind === 'recording' ? recordingTileLine(item.listen, timeZone) : documentTileLine(item.doc, timeZone);
}
