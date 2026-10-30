// Photo rules the PWA and the Mac app share (mock PhotosMock): which files are photos, a photo's
// title and lines, the upload card's words, and the rename rule. Pure: no IO, no clock.
import { titleProblem } from './copy';
import { formatBytes } from './format';
import { recordedDay } from './gallery';
import type { PhotoDetail, PhotoStatus, PhotoSummary, SearchResult } from '../services/api/types';

/** User-facing words for photos. */
export const PHOTO_COPY = {
  photo: 'Photo',
  whatsInIt: "What's in it",
  things: 'Things',
  openPhoto: 'Open photo',
  analysing: 'Looking at it…',
  analysingLine: 'Muse Spark is looking at the photo. This takes a few seconds.',
  failedTitle: 'This photo could not be read',
  options: 'Photo options',
  renamePhoto: 'Rename…',
  renameTitle: 'Rename photo',
  titleField: 'Title',
  titleEmpty: 'Give the photo a title.',
  addFailed: 'Could not add the photo',
  thenLooks: 'then nimbytes looks at each one',
} as const;

/**
 * A photo's page (the one place its route is written; the hooks and the search bar use it).
 * @param photoId - The photo.
 * @returns `/photos/{id}`.
 */
export const photoPagePath = (photoId: string): string => `/photos/${encodeURIComponent(photoId)}`;

/** The largest photo the API takes, bytes (40 MB). */
export const PHOTO_MAX_BYTES = 40 * 1024 * 1024;

/** The longest title the API stores, in characters after tidying. */
export const MAX_PHOTO_TITLE_CHARS = 80;

/** The photo types the API takes. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

/** One photo type. */
export type PhotoType = (typeof PHOTO_TYPES)[number];

const BY_EXTENSION: Record<string, PhotoType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/**
 * The file's type as the API names it: its own when taken, else from its extension (a picker may
 * leave the type empty).
 * @param name - The file name.
 * @param type - The browser's type for it ("" when unknown).
 * @returns The type, or null when it is not a photo the API takes.
 */
export function photoType(name: string, type: string): PhotoType | null {
  const own = PHOTO_TYPES.find((each) => each === type.toLowerCase());
  if (own !== undefined) return own;
  if (type !== '' && !type.toLowerCase().startsWith('image/')) return null;
  return BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/**
 * Whether a picked file goes to photos (else it is a clip): any image type, or a photo extension.
 * @param file - Its name and type.
 * @returns True for a photo.
 */
export const isPhotoFile = (file: { name: string; type: string }): boolean =>
  file.type.toLowerCase().startsWith('image/') || (file.type === '' && photoType(file.name, '') !== null);

/**
 * What is wrong with a file as a photo, or null when it can go up.
 * @param file - Its name, type and size.
 * @returns The problem, or null.
 */
export function photoFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (photoType(file.name, file.type) === null) return 'nimbytes takes JPEG, PNG, WebP and HEIC photos.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > PHOTO_MAX_BYTES) return 'This photo is over 40 MB.';
  return null;
}

/** Statuses during which a photo is not read yet (poll it). */
export const isPhotoBusy = (status: PhotoStatus): boolean => status === 'uploading' || status === 'analysing';

/**
 * "1 photo", "6 photos".
 * @param count - Photos.
 * @returns The words.
 */
export const photoCount = (count: number): string => `${String(count)} ${count === 1 ? 'photo' : 'photos'}`;

/**
 * The title to show: Spark's, else the file name.
 * @param photo - The photo.
 * @returns The title.
 */
export const photoTitle = (photo: Pick<PhotoSummary, 'title' | 'filename'>): string => (photo.title.trim() === '' ? photo.filename : photo.title);

/**
 * The line under a photo tile: "19 Aug 2026 · Photo".
 * @param photo - The photo.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export const photoTileLine = (photo: Pick<PhotoSummary, 'taken_at' | 'created_at'>, timeZone?: string): string =>
  [recordedDay(photo.taken_at ?? photo.created_at, timeZone), PHOTO_COPY.photo].filter((part) => part !== '').join(' · ');

/**
 * The date and time taken: "19 Aug 2026, 6:42 PM".
 * @param iso - ISO-8601, or null.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The words, or "".
 */
export function takenLine(iso: string | null, timeZone?: string): string {
  const date = iso === null ? null : new Date(iso);
  if (date === null || Number.isNaN(date.getTime())) return '';
  const zone = timeZone === undefined ? {} : { timeZone };
  const day = recordedDay(iso, timeZone);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...zone }).format(date);
  return `${day}, ${time}`;
}

/**
 * The line under a photo's title: "_MG_4210.JPG · 19 Aug 2026, 6:42 PM · 6000 × 4000 · 9.0 MB ·
 * Canon EOS"; parts not known yet are left out.
 * @param photo - The photo.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export function photoSubLine(photo: Pick<PhotoDetail, 'filename' | 'taken_at' | 'width' | 'height' | 'size_bytes' | 'camera'>, timeZone?: string): string {
  const size = photo.width === null || photo.height === null ? '' : `${String(photo.width)} × ${String(photo.height)}`;
  return [photo.filename, takenLine(photo.taken_at, timeZone), size, formatBytes(photo.size_bytes), photo.camera ?? '']
    .filter((part) => part !== '')
    .join(' · ');
}

/** The upload card while photos go up. */
export interface PhotoUploadCard {
  title: string;
  line: string;
  /** 0–100. */
  percent: number;
}

/**
 * "Uploading 12 photos" and "7 of 12 · then nimbytes looks at each one".
 * @param done - Photos sent (or given up on).
 * @param total - Photos picked.
 * @returns The card, or null when none are going up.
 */
export function photoUploadCard(done: number, total: number): PhotoUploadCard | null {
  if (total === 0 || done >= total) return null;
  return {
    title: `Uploading ${photoCount(total)}`,
    line: `${String(done)} of ${String(total)} · ${PHOTO_COPY.thenLooks}`,
    percent: Math.round((done / total) * 100),
  };
}

/**
 * What is wrong with a new title (trimmed, 1–80 characters), or null when it may be saved.
 * @param title - The typed title.
 * @returns The problem, or null.
 */
export const photoTitleProblem = (title: string): string | null => titleProblem(title, MAX_PHOTO_TITLE_CHARS, PHOTO_COPY.titleEmpty);

/**
 * A photo search result's line: "_MG_4210 · 19 Aug 2026" (the file name without its extension and
 * the day taken).
 * @param result - The result.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line.
 */
export function photoResultLine(result: Pick<SearchResult, 'clip_filename' | 'recorded_at'>, timeZone?: string): string {
  const dot = result.clip_filename.lastIndexOf('.');
  const stem = dot > 0 ? result.clip_filename.slice(0, dot) : result.clip_filename;
  return [stem, recordedDay(result.recorded_at, timeZone)].filter((part) => part !== '').join(' · ');
}

/**
 * Picked files sorted for their uploads: photos go to the photo queue, the rest to the clip upload.
 * @param files - What was picked.
 * @returns The photos and the videos, each in pick order.
 */
export function splitPicked<F extends { name: string; type: string }>(files: readonly F[]): { photos: F[]; videos: F[] } {
  return { photos: files.filter(isPhotoFile), videos: files.filter((file) => !isPhotoFile(file)) };
}
