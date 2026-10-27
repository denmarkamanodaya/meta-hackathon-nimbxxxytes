// The upload screen's words (P6): the queue heading ("Uploading 2 of 3", bytes and time left),
// and each file's progress ("64%", "Waiting") and line ("1.2 GB · about 2 min left").
import type { UploadItem } from '../services/upload/queue';
import { formatBytes } from './format';

/** What the summary card shows. */
export interface UploadSummary {
  sent: number;
  total: number;
  bytesLeft: number;
  /** Seconds left at the current speed, or null when unknown. */
  secondsLeft: number | null;
  /** 0–1 of all bytes sent. */
  fraction: number;
}

/**
 * Sums the queue. Failed files count as not sent; their bytes stay "left".
 * @param items - Queue snapshot.
 * @returns The summary.
 */
export function summarizeUploads(items: readonly UploadItem[]): UploadSummary {
  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const sentBytes = items.reduce((sum, item) => sum + (item.state === 'done' ? item.sizeBytes : item.loadedBytes), 0);
  const bytesLeft = Math.max(0, totalBytes - sentBytes);
  const rate = items.find((item) => item.state === 'uploading')?.bytesPerSecond ?? null;
  return {
    sent: items.filter((item) => item.state === 'done').length,
    total: items.length,
    bytesLeft,
    secondsLeft: rate === null || rate <= 0 ? null : bytesLeft / rate,
    fraction: totalBytes === 0 ? 0 : sentBytes / totalBytes,
  };
}

/**
 * Rough time left, never with false precision: "about 3 min", "about 40 s", "about 1.5 h".
 * @param seconds - Seconds left, or null.
 * @returns The label, or "" when unknown.
 */
export function formatTimeLeft(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `about ${String(Math.max(5, Math.round(seconds / 5) * 5))} s`;
  if (seconds < 3600) return `about ${String(Math.round(seconds / 60))} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

/**
 * The queue heading: "Uploading 2 of 3" while files go up, "All 3 sent" after.
 * @param summary - The queue summary.
 * @returns The heading.
 */
export function queueHeading(summary: Pick<UploadSummary, 'sent' | 'total'>): string {
  if (summary.sent >= summary.total) return summary.total === 1 ? 'Sent' : `All ${String(summary.total)} sent`;
  return `Uploading ${String(summary.sent + 1)} of ${String(summary.total)}`;
}

/**
 * The line beside the heading: bytes left and time left ("2.8 GB · about 3 min").
 * @param summary - The queue summary.
 * @returns The line, or "" when nothing is left to send.
 */
export function queueLeftLine(summary: Pick<UploadSummary, 'bytesLeft' | 'secondsLeft'>): string {
  if (summary.bytesLeft <= 0) return '';
  const time = formatTimeLeft(summary.secondsLeft);
  return time === '' ? formatBytes(summary.bytesLeft) : `${formatBytes(summary.bytesLeft)} · ${time}`;
}

/**
 * A sending file's progress: its percentage, or "Waiting" until bytes move (S7).
 * @param item - The file.
 * @returns "64%" or "Waiting".
 */
export function itemProgress(item: Pick<UploadItem, 'loadedBytes' | 'sizeBytes'>): string {
  if (item.loadedBytes <= 0 || item.sizeBytes <= 0) return 'Waiting';
  return `${String(Math.min(100, Math.floor((item.loadedBytes / item.sizeBytes) * 100)))}%`;
}

/**
 * A sending or queued file's line: its size, then the time it has left, or when it starts.
 * @param item - The file.
 * @param isNext - The first file still waiting for its turn.
 * @returns "1.2 GB · about 2 min left", "0.9 GB · starts next", "0.9 GB · waiting".
 */
export function itemLine(item: Pick<UploadItem, 'state' | 'sizeBytes' | 'loadedBytes' | 'bytesPerSecond'>, isNext: boolean): string {
  const size = formatBytes(item.sizeBytes);
  if (item.state === 'queued') return `${size} · ${isNext ? 'starts next' : 'waiting'}`;
  const rate = item.bytesPerSecond;
  const time = rate === null || rate <= 0 ? '' : formatTimeLeft(Math.max(0, item.sizeBytes - item.loadedBytes) / rate);
  return time === '' ? size : `${size} · ${time} left`;
}
