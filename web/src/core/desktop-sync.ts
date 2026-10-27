// The Mac app's sync state (the native side's `SyncStatus`, `sync_status` / `sync://status`) and the
// approved Mac views' wording (mocks M1 Library, V1 Sync): the sidebar status block, the Library
// storage tiles, and the Sync page's status card.
import { STORAGE_COPY } from './copy';
import { dayTimeLabel } from './day-groups';
import { formatBytes, percentOf } from './format';

/** Where the sync loop is. */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'signed_out' | 'error';

/** What a transfer moves. */
export type TransferKind = 'proxy' | 'original' | 'render' | 'export';

/** One file moving between the cloud and `~/nimbytes`. */
export interface SyncTransfer {
  id: string;
  kind: TransferKind;
  name: string;
  doneBytes: number;
  totalBytes: number;
  direction: 'down' | 'up';
  /** The clip this transfer belongs to (proxy, original), or null (render, export, unknown). */
  clipId: string | null;
}

/** What the drive holds for one clip's original (the "On this Mac" page and the tile icons). */
export interface ClipDrive {
  clipId: string;
  /** Bytes of the original cached on this Mac; 0 when nothing is. */
  cachedBytes: number;
  /** ISO-8601 instant of the last read of the cached original, or null when nothing is cached. */
  lastReadAt: string | null;
}

/** What is on disk now, for the Library tiles and badges and the Sync folder counts. */
export interface LocalFiles {
  /** Clips whose proxy is fully on disk (they play from disk). */
  proxyClipIds: string[];
  /** Bytes of those proxies. */
  proxyBytes: number;
  /** Clips whose original is fully on disk (pinned or auto). */
  originalClipIds: string[];
  /** Bytes of the pinned (kept offline) originals. */
  pinnedBytes: number;
  /** Rendered shorts in `Shorts/`. */
  renders: number;
  /** FCPXML timelines in `Projects/`. */
  projects: number;
  /** Per clip: what the drive caches of its original (empty when not reported). */
  clips: ClipDrive[];
}

/** Where a file dropped into `Exports/` is. */
export type ExportState = 'waiting' | 'uploading' | 'duplicate' | 'uploaded' | 'failed';

/** One file in `Exports/`. */
export interface SyncExport {
  name: string;
  state: ExportState;
  error: string | null;
}

/** The whole sync picture the native side reports. */
export interface SyncStatus {
  /** Absolute path of the synced folder (`/Users/me/nimbytes`). */
  folder: string;
  /** ISO-8601 instant of the last finished sync, or null before the first. */
  lastSyncAt: string | null;
  state: SyncState;
  error: string | null;
  counts: { clips: number; shorts: number; originalsOffline: number };
  /** Clips whose original is pinned ("Make available offline"), downloaded or still queued. */
  pinnedClipIds: string[];
  /** Auto-original cache: budget in GB (decimal) and bytes it holds now. */
  cache: { budgetGb: number; autoBytes: number };
  /** Bytes the app keeps on this Mac (its private cache), real on-disk total; 0 when unreported. */
  cacheBytes: number;
  transfers: SyncTransfer[];
  exports: SyncExport[];
  /** On-disk facts; all zero / empty when the native side does not report them. */
  local: LocalFiles;
  /** Seconds between automatic syncs, or null when not reported. */
  pollS: number | null;
  /** The drive cache's cap in bytes (the meter's full scale); 0 when not reported. */
  cacheCapBytes: number;
  /** Seconds after its last read an unpinned file is freed, or null when not reported. */
  releaseAfterS: number | null;
}

/** Colour family of a status dot or label. */
export type SyncTone = 'ok' | 'busy' | 'warn' | 'error' | 'muted';

/** Sizes as the Mac mocks write them: "38 MB", "12.4 MB" (no trailing ".0"). */
const compactBytes = (bytes: number) => formatBytes(bytes).replace(/\.0 /, ' ');

/**
 * The folder as the user reads it: the home folder shortened to `~`.
 * @param path - Absolute path (`/Users/me/nimbytes`).
 * @returns For example `~/nimbytes`; other paths unchanged.
 */
export function displayFolder(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

/**
 * How long ago the last sync finished.
 * @param iso - ISO-8601 instant, or null before the first sync.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns "Never", "Just now" (under a minute), "12 min ago" (under an hour), else the day
 *   and time ("Today 7:42 am"); "Never" too for an unparsable value.
 */
export function lastSyncLabel(iso: string | null, now: Date, timeZone?: string): string {
  if (iso === null) return 'Never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Never';
  const seconds = Math.max(0, (now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} min ago`;
  return dayTimeLabel(iso, now, timeZone);
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const SIDEBAR_STATE: Record<SyncState, { label: string; tone: SyncTone }> = {
  idle: { label: 'Synced', tone: 'ok' },
  syncing: { label: 'Syncing…', tone: 'busy' },
  offline: { label: 'Offline', tone: 'warn' },
  signed_out: { label: 'Signed out', tone: 'warn' },
  error: { label: 'Sync failed', tone: 'error' },
};

const PAGE_STATE: Record<SyncState, string> = {
  idle: 'Up to date',
  syncing: 'Syncing',
  offline: 'Offline',
  signed_out: 'Signed out',
  error: 'Sync failed',
};

/**
 * The server as the Sync page names it.
 * @param url - The saved server URL, or null.
 * @returns Its origin (`https://box.example`), the text as given when it is not a URL, or
 *   "your server" when none is saved.
 */
export function serverOrigin(url: string | null): string {
  if (url === null || url.trim() === '') return 'your server';
  try {
    return new URL(url).origin;
  } catch {
    return url; // Recovers: a saved value that is not a URL is still worth showing as typed.
  }
}

/** The native side's readable NETWORK message: "Can't reach <origin>" (optionally "(timed out)"). */
const READABLE_NETWORK = /^Can[’']t reach [^\n]{1,200}$/;

/**
 * The Sync page's problem line. Offline uses the native NETWORK message only when it has the
 * readable "Can't reach …" form; any other native text is never shown.
 * @param state - The sync state.
 * @param server - The saved server URL, or null.
 * @param nativeError - `SyncStatus.error`, or null.
 * @returns "Can't reach <origin>" when offline, "Sync stopped" on error, else null.
 */
export function syncProblem(state: SyncState, server: string | null, nativeError: string | null = null): string | null {
  if (state === 'offline') {
    return nativeError !== null && READABLE_NETWORK.test(nativeError) ? nativeError : `Can’t reach ${serverOrigin(server)}`;
  }
  if (state === 'error') return 'Sync stopped';
  return null;
}

/** The sidebar's status block (M1): "Synced" and "2 min ago · ~/nimbytes". */
export interface SidebarStatus {
  label: string;
  tone: SyncTone;
  line: string;
}

/**
 * Builds the sidebar status block.
 * @param status - The native sync status.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The block.
 */
export function sidebarStatus(status: SyncStatus, now: Date, timeZone?: string): SidebarStatus {
  const state = SIDEBAR_STATE[status.state];
  const last = lastSyncLabel(status.lastSyncAt, now, timeZone);
  return { ...state, line: `${last === 'Never' ? 'Not synced yet' : last} · ${displayFolder(status.folder)}` };
}

/** One of the Library's storage tiles (M1). */
export interface StorageTile {
  label: string;
  value: string;
  line: string;
  /** The value in the accent colour ("On this Mac"). */
  isAccent: boolean;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * Builds the two storage tiles (v1.1: "Originals offline" is gone).
 * @param cloud - `GET /storage` cloud bytes and clip count, or null while it loads or failed.
 * @param status - The native sync status, or null while it loads.
 * @returns In your cloud, and On this Mac (`cache_bytes`, as the Sync page's "Space used");
 *   "—" where data is missing.
 */
export function storageTiles(cloud: { bytes: number; clips: number } | null, status: SyncStatus | null): StorageTile[] {
  return [
    {
      label: STORAGE_COPY.inYourCloud,
      value: cloud === null ? '—' : compactBytes(cloud.bytes),
      line: cloud === null ? '' : `${plural(cloud.clips, 'clip', 'clips')} · ${STORAGE_COPY.macCloudLine}`,
      isAccent: false,
    },
    {
      label: STORAGE_COPY.onThisMac,
      value: status === null ? '—' : spaceUsedLabel(status.cacheBytes),
      line: status === null ? '' : STORAGE_COPY.macLocalLine,
      isAccent: true,
    },
  ];
}

/** A transfer as a transfer list draws it (M3; the Mac Upload page). */
export interface TransferRow {
  id: string;
  /** "↓" or "↑". */
  arrow: string;
  name: string;
  /** "proxy", "original", "render", "export". */
  kind: TransferKind;
  /** 0–100. */
  percent: number;
  isDone: boolean;
  /** "4.1/10 MB", or "Done". */
  progress: string;
}

const UNITS = [
  { unit: 'GB', size: 1e9 },
  { unit: 'MB', size: 1e6 },
  { unit: 'KB', size: 1e3 },
] as const;

const trimmed = (value: number) => (value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, ''));

/**
 * Formats done and total bytes in the total's unit.
 * @param done - Bytes done.
 * @param total - Total bytes, > 0.
 * @returns For example `"4.1/10 MB"`.
 */
export function bytePair(done: number, total: number): string {
  const { unit, size } = UNITS.find((u) => total >= u.size) ?? { unit: 'B', size: 1 };
  return `${trimmed(done / size)}/${trimmed(total / size)} ${unit}`;
}

/**
 * Formats one transfer.
 * @param transfer - The transfer.
 * @returns The row; an unknown total (0) shows the bytes done only.
 */
export function transferRow(transfer: SyncTransfer): TransferRow {
  const hasTotal = transfer.totalBytes > 0;
  const isDone = hasTotal && transfer.doneBytes >= transfer.totalBytes;
  return {
    id: transfer.id,
    arrow: transfer.direction === 'down' ? '↓' : '↑',
    name: transfer.name,
    kind: transfer.kind,
    percent: hasTotal ? percentOf(transfer.doneBytes, transfer.totalBytes) : 0,
    isDone,
    progress: isDone ? 'Done' : hasTotal ? bytePair(transfer.doneBytes, transfer.totalBytes) : formatBytes(transfer.doneBytes),
  };
}

/** Everything the Sync page shows, already formatted (V1). */
export interface SyncPanelView {
  /** "Up to date", "Syncing", "Offline", "Signed out" or "Sync failed". */
  title: string;
  tone: SyncTone;
  /** "4 clips and 3 shorts in nimbytes · checked 2 min ago". */
  line: string;
  /** "Space used on this Mac": "0 bytes", "38 MB". */
  spaceUsed: string;
  /** The drive as the user reads it: "~/nimbytes" (the one path every Mac screen names). */
  folder: string;
}

/**
 * Bytes as the Sync page writes them.
 * @param bytes - Bytes on disk.
 * @returns "0 bytes" for none, else for example "38 MB" or "1.2 GB".
 */
export function spaceUsedLabel(bytes: number): string {
  return bytes <= 0 ? '0 bytes' : compactBytes(bytes);
}

/**
 * Builds the Sync page's view model.
 * @param status - The native sync status.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The formatted page.
 */
export function syncPanelView(status: SyncStatus, now: Date, timeZone?: string): SyncPanelView {
  const last = lastSyncLabel(status.lastSyncAt, now, timeZone);
  const held = `${plural(status.counts.clips, 'clip', 'clips')} and ${plural(status.counts.shorts, 'short', 'shorts')} in nimbytes`;
  return {
    title: PAGE_STATE[status.state],
    tone: SIDEBAR_STATE[status.state].tone,
    line: `${held} · ${last === 'Never' ? 'not checked yet' : `checked ${lowerFirst(last)}`}`,
    spaceUsed: spaceUsedLabel(status.cacheBytes),
    folder: displayFolder(status.folder),
  };
}
