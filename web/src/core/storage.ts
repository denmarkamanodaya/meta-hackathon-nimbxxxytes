// Storage wording: sizes in GB (decimal, as phones report them), and the account's storage cap
// (the line "44.2 GB of 250 GB", the warning at 80 % and 95 %, and the block when full). The API
// works out the level; this file only words it, so the two never disagree on a threshold.
import type { StorageLevel, StorageSummary } from '../services/api/types';
import { percentOf } from './format';

const GB = 1_000_000_000;

/**
 * A size in GB for the big numbers: one decimal, "0 GB" for nothing.
 * @param bytes - Size in bytes, >= 0.
 * @returns For example `"41.2 GB"`, `"0 GB"`.
 */
export function formatGb(bytes: number): string {
  if (bytes <= 0) return '0 GB';
  return `${(bytes / GB).toFixed(1)} GB`.replace(/\.0 GB$/, ' GB');
}

/** How a cap state is drawn. */
export type CapTone = 'ok' | 'warning' | 'danger';

/** The storage cap as the screens show it. */
export interface CapView {
  /** "44.2 GB of 250 GB". */
  line: string;
  /** "of 250 GB", for lines that already name the size. */
  ofCap: string;
  /** 0–100, for a meter. */
  percent: number;
  tone: CapTone;
  /** A sentence to show above the clips, or null while there is room. */
  notice: string | null;
  /** True when nothing more can be uploaded. */
  isFull: boolean;
}

/** What to do when space runs low. */
const MAKE_ROOM = 'Delete duplicates or old clips to make room.';

/** The message an upload shows when the account is full (also the `STORAGE_FULL` toast). */
export const STORAGE_FULL_TEXT = `Your storage is full, so new uploads can't start. ${MAKE_ROOM}`;

const TONE: Readonly<Record<StorageLevel, CapTone>> = { ok: 'ok', warn: 'warning', high: 'warning', full: 'danger' };

/**
 * Words the storage cap.
 * @param storage - `GET /storage`.
 * @returns The view.
 */
export function capView(storage: Pick<StorageSummary, 'used_bytes' | 'cap_bytes' | 'level'>): CapView {
  const { used_bytes: used, cap_bytes: cap, level } = storage;
  const ofCap = `of ${formatGb(cap)}`;
  const line = `${formatGb(used)} ${ofCap}`;
  const percent = percentOf(used, cap);
  const notice =
    level === 'full' ? STORAGE_FULL_TEXT
    : level === 'ok' ? null
    : `Storage is ${String(percent)}% full: ${line}. ${MAKE_ROOM}`;
  return { line, ofCap, percent, tone: TONE[level], notice, isFull: level === 'full' };
}
