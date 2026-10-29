// View rules for the Library and clip detail screens: names, visible people, live streams.
import type { ClipStatus, ClipSummary, Speaker, Track } from '../services/api/types';

const IN_PROGRESS: readonly ClipStatus[] = ['uploading', 'uploaded', 'processing'];

/**
 * True while the server is still working on a clip (more data will arrive).
 * @param status - Clip status.
 * @returns Whether the clip is uploading, uploaded or processing.
 */
export const isInProgress = (status: ClipStatus): boolean => IN_PROGRESS.includes(status);

/** Statuses the server stopped before the AI steps because the clip copies another. */
const COPY_STATUSES: readonly ClipStatus[] = ['duplicate', 'near_copy'];

/**
 * True for a clip that is not searched or counted: a byte-for-byte duplicate or a near-copy
 * waiting for Keep both.
 * @param status - Clip status.
 * @returns Whether the clip is left out of the library's counts.
 */
export const isUncounted = (status: ClipStatus): boolean => COPY_STATUSES.includes(status);

/**
 * True for a clip the Copies filter lists: a duplicate, a near-copy, or a ready clip the library
 * backfill found to copy an older one (it stays ready and only carries `near_copy_of`).
 * @param clip - The clip.
 * @returns Whether it is a copy of another clip.
 */
export const isCopy = (clip: Pick<ClipSummary, 'status' | 'near_copy_of'>): boolean =>
  isUncounted(clip.status) || clip.near_copy_of !== null;

/**
 * Picks which in-progress clips get a live SSE stream. Browsers cap HTTP/1.1 connections per
 * origin at 6, so a long library must not hold one stream per clip.
 * @param clips - Library rows in display order.
 * @param max - Most streams to open.
 * @returns Ids of the first `max` clips still in progress.
 */
export function pickLiveClips(clips: readonly ClipSummary[], max: number): Set<string> {
  return new Set(
    clips.filter((clip) => isInProgress(clip.status)).slice(0, max).map((clip) => clip.clip_id),
  );
}

/**
 * Display name for a speaker: the user's name, else "Speaker <label>". Voice Transcribe labels
 * speakers with letters ("A", "B", …), so the default reads "Speaker A".
 * @param speaker - The speaker row.
 * @returns For example `"Sam"` or `"Speaker A"`; `"Speaker"` when the label is blank.
 */
export function speakerName(speaker: Speaker): string {
  if (speaker.display_name !== null && speaker.display_name.trim() !== '') {
    return speaker.display_name;
  }
  const label = speaker.label.trim();
  return label === '' ? 'Speaker' : `Speaker ${label}`;
}

/**
 * Face tracks to show in "People in this clip": not hidden, in order of first appearance.
 * @param tracks - All tracks of the clip.
 * @returns The visible tracks, sorted by `first_s`.
 */
export function visibleTracks(tracks: readonly Track[]): Track[] {
  return tracks.filter((track) => !track.hidden).sort((a, b) => a.first_s - b.first_s);
}

/**
 * The clip's meta line: "Today 7:42 am · 0:42 · 4 moments · 2 people".
 * @param parts - Day-time label (may be ""), duration text (may be ""), moment and people counts.
 * @returns The line; empty parts are skipped and zero counts left out.
 */
export function clipMetaLine(parts: { when: string; duration: string; moments: number; people: number }): string {
  const plural = (n: number, word: string) => `${String(n)} ${n === 1 ? word : `${word}s`}`;
  return [
    parts.when,
    parts.duration,
    parts.moments > 0 ? plural(parts.moments, 'moment') : '',
    parts.people > 0 ? (parts.people === 1 ? '1 person' : `${String(parts.people)} people`) : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
}
