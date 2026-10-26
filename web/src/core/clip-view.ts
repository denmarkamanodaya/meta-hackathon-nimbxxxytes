// View rules for the Library and clip detail screens: names, visible people, live streams.
import type { ClipStatus, ClipSummary, Speaker, Track } from '../services/api/types';

const IN_PROGRESS: readonly ClipStatus[] = ['uploading', 'uploaded', 'processing'];

/**
 * True while the server is still working on a clip (more data will arrive).
 * @param status - Clip status.
 * @returns Whether the clip is uploading, uploaded or processing.
 */
export const isInProgress = (status: ClipStatus): boolean => IN_PROGRESS.includes(status);

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
