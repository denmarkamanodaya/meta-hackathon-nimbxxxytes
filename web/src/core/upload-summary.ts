// The upload screen's dark summary card: files sent out of all, bytes left, time left.
import type { UploadItem } from '../services/upload/queue';

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
 * Rough time left: "~3 min", "~40 s", "under a minute" never shows false precision.
 * @param seconds - Seconds left, or null.
 * @returns The label, or "" when unknown.
 */
export function formatTimeLeft(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `~${String(Math.max(5, Math.round(seconds / 5) * 5))} s`;
  if (seconds < 3600) return `~${String(Math.round(seconds / 60))} min`;
  return `~${(seconds / 3600).toFixed(1)} h`;
}
