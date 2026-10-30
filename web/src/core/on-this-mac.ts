// The Mac's "On this Mac" view (mock M3) and the sidebar meter (M1): how much the drive holds, what
// is kept offline (pinned, never freed on its own), what is playing and when it is freed (its last
// read plus the release time), and which step of "before you play / while you watch / 3 minutes
// later" is live. Pure: the status and the current instant come in as arguments.
import { formatDuration } from './format';
import { lastSyncLabel, lowerFirst, spaceUsedLabel, type SyncState, type SyncStatus, type SyncTone } from './desktop-sync';

/** Where a clip's original is: only in the cloud, cached for a few minutes, or kept offline. */
export type Availability = 'cloud' | 'cached' | 'kept';

/**
 * Where a clip is: kept offline when pinned, cached while the drive holds some of it, else only in
 * the cloud.
 * @param clipId - The clip.
 * @param status - The native sync status, or null while it loads (then: in the cloud).
 * @returns The availability.
 */
export function clipAvailability(clipId: string, status: SyncStatus | null): Availability {
  if (status === null) return 'cloud';
  if (status.pinnedClipIds.includes(clipId)) return 'kept';
  const cached = status.local.clips.find((clip) => clip.clipId === clipId)?.cachedBytes ?? 0;
  return cached > 0 ? 'cached' : 'cloud';
}

/**
 * Where a recording's, a document's or a photo's original is, as for a clip.
 * @param item - The drive's reference, the Gallery id (`listen:l1`, `doc:d1`).
 * @param status - The native sync status, or null while it loads or in a browser (then: in the cloud).
 * @returns The availability.
 */
export function itemAvailability(item: string, status: SyncStatus | null): Availability {
  if (status === null) return 'cloud';
  const row = status.items.find((each) => each.item === item);
  if (status.pinnedItems.includes(item) || row?.pinned === true) return 'kept';
  return (row?.cachedBytes ?? 0) > 0 ? 'cached' : 'cloud';
}

/**
 * The clip page's line beside the title (redesign v2, V3): how the clip plays and what it holds
 * on this Mac.
 * @param clipId - The clip.
 * @param status - The native sync status, or null while it loads.
 * @returns "Kept offline · 3.4 GB on this Mac", "Streaming · 40.4 MB on this Mac" or "Streaming
 *   from the cloud".
 */
export function clipStreamLine(clipId: string, status: SyncStatus | null): string {
  const availability = clipAvailability(clipId, status);
  const bytes = status?.local.clips.find((clip) => clip.clipId === clipId)?.cachedBytes ?? 0;
  if (availability === 'kept') return bytes > 0 ? `Kept offline · ${spaceUsedLabel(bytes)} on this Mac` : 'Kept offline · downloading';
  if (availability === 'cached') return `Streaming · ${spaceUsedLabel(bytes)} on this Mac`;
  return 'Streaming from the cloud';
}

/** Which step of the before / during / after strip is lit. */
export type StripPhase = 'before' | 'during' | 'after';

/** A clip whose original is cached because it was played, and when it is freed. */
export interface PlayingClip {
  clipId: string;
  bytes: number;
  /** Seconds until the drive frees it, or null when the release time or last read is unknown. */
  freesInS: number | null;
}

/** A clip kept offline (pinned) and what it holds. */
export interface KeptClip {
  clipId: string;
  bytes: number;
}

/** Everything the On this Mac page and the meter show, formatted. */
export interface OnThisMacView {
  /** "0 bytes", "41 MB". */
  spaceUsed: string;
  /** Share of the cache cap held by kept and by playing clips, 0–100 each. */
  keptPercent: number;
  playingPercent: number;
  /** "Cache limit 5 GB · frees early when your Mac is under 15% free"; '' without a cap. */
  capLine: string;
  /** What the bytes are: "Nothing stored", "3.4 GB kept offline", "41 MB playing · frees in 2:40". */
  stateLines: string[];
  /** True while a played (not kept) clip is cached: the strip lights "while you watch". */
  isPlaying: boolean;
  playing: PlayingClip[];
  kept: KeptClip[];
  /** The release time in whole minutes for the strip's words ("3 minutes later"). */
  releaseMinutes: number;
}

/** The drive frees unread files after 3 minutes; used when the native side does not say. */
export const DEFAULT_RELEASE_S = 180;

/** The drive shrinks its cache while the disk has less than this share free. */
const MIN_FREE_PERCENT = 15;

/**
 * Seconds until a played clip's cached bytes are freed: its last read plus the release time.
 * @param lastReadAt - ISO-8601 instant of the last read, or null.
 * @param releaseAfterS - Seconds after the last read, or null when unknown.
 * @param now - The current instant.
 * @returns Whole seconds left (rounded up, never below 0), or null when either input is unknown.
 */
export function secondsUntilFreed(lastReadAt: string | null, releaseAfterS: number | null, now: Date): number | null {
  if (lastReadAt === null || releaseAfterS === null) return null;
  const readMs = new Date(lastReadAt).getTime();
  if (Number.isNaN(readMs)) return null;
  return Math.max(0, Math.ceil((readMs + releaseAfterS * 1000 - now.getTime()) / 1000));
}

/**
 * The strip's next lit step: "while you watch" while anything plays; "3 minutes later" once the
 * playing bytes are freed (it stays lit until the next play); else "before you play".
 * @param previous - The step lit until now.
 * @param isPlaying - Whether a played clip is cached now.
 * @returns The step to light.
 */
export function nextStripPhase(previous: StripPhase, isPlaying: boolean): StripPhase {
  if (isPlaying) return 'during';
  return previous === 'before' ? 'before' : 'after';
}

const percentOfCap = (bytes: number, cap: number) => (cap <= 0 ? 0 : Math.min(100, (bytes / cap) * 100));

/**
 * Builds the view.
 * @param status - The native sync status.
 * @param now - The current instant.
 * @returns The formatted view.
 */
export function onThisMacView(status: SyncStatus, now: Date): OnThisMacView {
  const pinned = new Set(status.pinnedClipIds);
  const cached = status.local.clips.filter((clip) => clip.cachedBytes > 0);
  const kept = status.pinnedClipIds.map((clipId) => ({
    clipId,
    bytes: status.local.clips.find((clip) => clip.clipId === clipId)?.cachedBytes ?? 0,
  }));
  const playing = cached
    .filter((clip) => !pinned.has(clip.clipId))
    .map((clip) => ({
      clipId: clip.clipId,
      bytes: clip.cachedBytes,
      freesInS: secondsUntilFreed(clip.lastReadAt, status.releaseAfterS, now),
    }));
  const keptBytes = kept.reduce((sum, clip) => sum + clip.bytes, 0);
  const playingBytes = playing.reduce((sum, clip) => sum + clip.bytes, 0);
  const lastFree = playing.reduce<number | null>((latest, clip) => (clip.freesInS === null ? latest : Math.max(latest ?? 0, clip.freesInS)), null);
  const stateLines = [
    ...(keptBytes > 0 ? [`${spaceUsedLabel(keptBytes)} kept offline`] : []),
    ...(playingBytes > 0
      ? [`${spaceUsedLabel(playingBytes)} playing${lastFree === null ? '' : ` · frees in ${formatDuration(lastFree)}`}`]
      : []),
  ];
  const releaseS = status.releaseAfterS ?? DEFAULT_RELEASE_S;
  return {
    spaceUsed: spaceUsedLabel(status.cacheBytes),
    keptPercent: percentOfCap(keptBytes, status.cacheCapBytes),
    playingPercent: percentOfCap(playingBytes, status.cacheCapBytes),
    capLine:
      status.cacheCapBytes > 0
        ? `Cache limit ${spaceUsedLabel(status.cacheCapBytes)} · frees early when your Mac is under ${String(MIN_FREE_PERCENT)}% free`
        : '',
    stateLines: stateLines.length === 0 ? ['Nothing stored'] : stateLines,
    isPlaying: playing.length > 0,
    playing,
    kept,
    releaseMinutes: Math.max(1, Math.round(releaseS / 60)),
  };
}

/** The sidebar's On this Mac meter (redesign v2). */
export interface SidebarMeter {
  /** "40.4 MB of 5 GB", or the bytes alone without a cache cap. */
  line: string;
  /** Share of the cache cap in use, 0–100. */
  percent: number;
  /** "Frees in 2:41 · 1 kept offline", "Nothing stored", or a sync problem ("Offline"). */
  sub: string;
}

/**
 * The sidebar meter: bytes on this Mac against the cache cap, and what happens to them next.
 * @param status - The native sync status.
 * @param now - The current instant.
 * @returns The meter's words and fill.
 */
export function sidebarMeter(status: SyncStatus, now: Date): SidebarMeter {
  const view = onThisMacView(status, now);
  const cap = status.cacheCapBytes;
  const frees = view.playing.reduce<number | null>((latest, clip) => (clip.freesInS === null ? latest : Math.max(latest ?? 0, clip.freesInS)), null);
  const parts = [
    ...(frees === null ? [] : [`Frees in ${formatDuration(frees)}`]),
    ...(view.kept.length > 0 ? [`${String(view.kept.length)} kept offline`] : []),
  ];
  const problem = status.state === 'idle' || status.state === 'syncing' ? null : METER_STATE[status.state].label;
  return {
    line: cap > 0 ? `${view.spaceUsed} of ${spaceUsedLabel(cap)}` : view.spaceUsed,
    percent: percentOfCap(status.cacheBytes, cap),
    sub: problem ?? (parts.length === 0 ? 'Nothing stored' : parts.join(' · ')),
  };
}

/** The meter's status line (S5): an end state, not "Syncing…" forever. */
export interface MeterStatus {
  /** "Up to date · 2 min ago", "Syncing…", "Offline". */
  line: string;
  tone: SyncTone;
  /** The dot pulses only while work runs. */
  isBusy: boolean;
}

const METER_STATE: Record<SyncState, { label: string; tone: SyncTone }> = {
  idle: { label: 'Up to date', tone: 'ok' },
  syncing: { label: 'Syncing…', tone: 'busy' },
  offline: { label: 'Offline', tone: 'warn' },
  signed_out: { label: 'Signed out', tone: 'warn' },
  error: { label: 'Sync stopped', tone: 'error' },
};

/**
 * The sidebar meter's status line.
 * @param status - The native sync status.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line, its tone and whether work runs.
 */
export function meterStatus(status: SyncStatus, now: Date, timeZone?: string): MeterStatus {
  const { label, tone } = METER_STATE[status.state];
  if (status.state !== 'idle') return { line: label, tone, isBusy: status.state === 'syncing' };
  const last = lastSyncLabel(status.lastSyncAt, now, timeZone);
  const when = last === 'Never' ? '' : ` · ${lowerFirst(last)}`;
  return { line: `${label}${when}`, tone, isBusy: false };
}
