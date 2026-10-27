// Uploads in the Mac Gallery (redesign v2, Uploading board): the tiles that come first in the grid
// ("Uploading 64%", "Waiting", a failed upload) and the header pill "Uploading 2 clips · 1.1 of
// 2.3 GB · about 3 min left", all read from the native sync status (`transfers` going up, and the
// `exports` rows of files not sending bytes yet). The pace behind the time left is a running total
// of bytes sent, kept per transfer so a finished upload leaving the list never counts backwards.
import { bytesOfLabel, spaceUsedLabel, type SyncStatus, type SyncTransfer } from './desktop-sync';
import { percentOf } from './format';

/** Where one upload is. */
export type GalleryUploadState = 'uploading' | 'waiting' | 'failed';

/** One upload tile or list row. */
export interface GalleryUpload {
  /** Stable key: the transfer id, or `export:<name>` for a file with no transfer yet. */
  key: string;
  /** The transfer to cancel, or null when the native side cannot cancel this one. */
  cancelId: string | null;
  name: string;
  state: GalleryUploadState;
  /** 0–100, for the bar. */
  percent: number;
  /** "Uploading 64%", "Waiting" or "Upload failed". */
  label: string;
  /** "1.4 GB", or "" when the size is not known yet. */
  size: string;
  doneBytes: number;
  totalBytes: number;
  /** The native reason of a failed upload, or null. */
  error: string | null;
}

const STATE_ORDER: Record<GalleryUploadState, number> = { uploading: 0, waiting: 1, failed: 2 };

/**
 * Whether the native side can cancel this transfer. A file picked with Upload (or in a picked
 * folder) has the id `Export:` plus its absolute path; a file dropped into ~/nimbytes/Exports has
 * `Export:` plus its bare name and is not cancelled from the app (it is managed in Finder).
 * @param transferId - The transfer's id.
 * @returns True for a picked upload.
 */
export const isPickedUpload = (transferId: string): boolean => transferId.startsWith('Export:/');

function fromTransfer(transfer: SyncTransfer): GalleryUpload {
  const percent = transfer.totalBytes > 0 ? percentOf(transfer.doneBytes, transfer.totalBytes) : 0;
  const isWaiting = transfer.doneBytes <= 0;
  return {
    key: transfer.id,
    cancelId: isPickedUpload(transfer.id) ? transfer.id : null,
    name: transfer.name,
    state: isWaiting ? 'waiting' : 'uploading',
    percent,
    label: isWaiting ? 'Waiting' : `Uploading ${String(percent)}%`,
    size: transfer.totalBytes > 0 ? spaceUsedLabel(transfer.totalBytes) : '',
    doneBytes: transfer.doneBytes,
    totalBytes: transfer.totalBytes,
    error: null,
  };
}

/**
 * The Gallery's uploads: every transfer going up, then each export row that is waiting, starting
 * or failed and has no transfer; uploading first, then waiting, then failed.
 * @param status - The sync status, or null while it loads.
 * @param hidden - Transfer ids cancelled here, hidden before the native side drops them.
 * @returns The uploads.
 */
export function galleryUploads(status: SyncStatus | null, hidden: ReadonlySet<string> = new Set()): GalleryUpload[] {
  if (status === null) return [];
  const sending = status.transfers.filter((t) => t.direction === 'up' && !hidden.has(t.id));
  const names = new Set(sending.map((t) => t.name));
  const rows = status.exports
    .filter((row) => (row.state === 'waiting' || row.state === 'uploading' || row.state === 'failed') && !names.has(row.name))
    .map(
      (row): GalleryUpload => ({
        key: `export:${row.name}`,
        cancelId: null,
        name: row.name,
        state: row.state === 'failed' ? 'failed' : 'waiting',
        percent: 0,
        label: row.state === 'failed' ? 'Upload failed' : 'Waiting',
        size: '',
        doneBytes: 0,
        totalBytes: 0,
        error: row.error,
      }),
    );
  return [...sending.map(fromTransfer), ...rows].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}

/**
 * Time left, never with false precision.
 * @param bytesLeft - Bytes still to send.
 * @param bytesPerSecond - Recent speed, or null when not known.
 * @returns "less than a minute left", "about 3 min left", "about 1.5 h left", or null when the
 *   speed is unknown or zero.
 */
export function timeLeftLabel(bytesLeft: number, bytesPerSecond: number | null): string | null {
  if (bytesPerSecond === null || !(bytesPerSecond > 0)) return null;
  const seconds = Math.max(0, bytesLeft) / bytesPerSecond;
  if (seconds < 60) return 'less than a minute left';
  if (seconds < 90 * 60) return `about ${String(Math.round(seconds / 60))} min left`;
  return `about ${(seconds / 3600).toFixed(1).replace(/\.0$/, '')} h left`;
}

/**
 * The header pill.
 * @param uploads - The Gallery's uploads.
 * @param bytesPerSecond - Recent upload speed, or null.
 * @returns "Uploading 2 clips · 1.1 of 2.3 GB · about 3 min left" (the bytes and the time only
 *   when known), or null when nothing is uploading or waiting.
 */
export function uploadingLine(uploads: readonly GalleryUpload[], bytesPerSecond: number | null): string | null {
  const active = uploads.filter((u) => u.state !== 'failed');
  if (active.length === 0) return null;
  const parts = [`Uploading ${String(active.length)} ${active.length === 1 ? 'clip' : 'clips'}`];
  const total = active.reduce((sum, u) => sum + u.totalBytes, 0);
  const done = active.reduce((sum, u) => sum + Math.min(u.doneBytes, u.totalBytes), 0);
  if (total > 0) parts.push(bytesOfLabel(done, total));
  const time = total > 0 ? timeLeftLabel(total - done, bytesPerSecond) : null;
  if (time !== null) parts.push(time);
  return parts.join(' · ');
}

/** Bytes sent so far, counted per transfer. */
export interface SentTally {
  /** Bytes sent since the tally started (only grows). */
  sent: number;
  /** The last done bytes seen per transfer id. */
  doneById: Readonly<Record<string, number>>;
}

/** An empty tally. */
export const EMPTY_TALLY: SentTally = { sent: 0, doneById: {} };

/**
 * Adds what each upload sent since the last status. A new transfer counts from its first reading,
 * one that left the list stops counting, and a transfer whose bytes went down (restarted) counts
 * nothing for that step.
 * @param tally - The tally so far.
 * @param transfers - The transfers in the new status.
 * @returns The new tally; empty when nothing goes up.
 */
export function advanceTally(tally: SentTally, transfers: readonly SyncTransfer[]): SentTally {
  const up = transfers.filter((t) => t.direction === 'up');
  if (up.length === 0) return EMPTY_TALLY;
  let sent = tally.sent;
  const doneById: Record<string, number> = {};
  for (const transfer of up) {
    const before = tally.doneById[transfer.id];
    if (before !== undefined) sent += Math.max(0, transfer.doneBytes - before);
    doneById[transfer.id] = transfer.doneBytes;
  }
  return { sent, doneById };
}
