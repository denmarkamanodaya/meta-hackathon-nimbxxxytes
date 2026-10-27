// The Mac app's sync state (the native side's `SyncStatus`, `sync_status` / `sync://status`) and the
// approved Mac views' wording (docs mocks M1 Library, M3 Sync): the sidebar status block, the
// Library storage tiles and per-clip badges, and the Sync page's cards.
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
  transfers: SyncTransfer[];
  exports: SyncExport[];
  /** On-disk facts; all zero / empty when the native side does not report them. */
  local: LocalFiles;
  /** Seconds between automatic syncs, or null when not reported. */
  pollS: number | null;
}

/** Cache budgets the Sync page offers, in GB. The native default is 20. */
export const CACHE_BUDGET_CHOICES_GB: readonly number[] = [10, 20, 50];

/** Colour family of a status dot or label. */
export type SyncTone = 'ok' | 'busy' | 'warn' | 'error' | 'muted';

const BYTES_PER_GB = 1_000_000_000;

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

/**
 * The Sync page's status line (M3): "Up to date · checked 2 min ago · every 30 s".
 * @param status - The native sync status.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line; the interval part only when the native side reports it.
 */
export function syncHeadline(status: SyncStatus, now: Date, timeZone?: string): string {
  const last = lastSyncLabel(status.lastSyncAt, now, timeZone);
  const parts = [PAGE_STATE[status.state], last === 'Never' ? 'not checked yet' : `checked ${lowerFirst(last)}`];
  if (status.pollS !== null) parts.push(`every ${String(status.pollS)} s`);
  return parts.join(' · ');
}

/** One of the Library's three storage tiles (M1). */
export interface StorageTile {
  label: string;
  value: string;
  line: string;
  /** The value in the accent colour ("On this Mac"). */
  isAccent: boolean;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * Builds the three storage tiles.
 * @param cloud - `GET /storage` cloud bytes and clip count, or null while it loads or failed.
 * @param status - The native sync status, or null while it loads.
 * @param readyClipIds - Clips that are ready (they can play from disk once synced).
 * @returns In your cloud, On this Mac, Originals offline; "—" where data is missing.
 */
export function storageTiles(
  cloud: { bytes: number; clips: number } | null,
  status: SyncStatus | null,
  readyClipIds: readonly string[],
): StorageTile[] {
  const onDisk = status === null ? 0 : readyClipIds.filter((id) => status.local.proxyClipIds.includes(id)).length;
  return [
    {
      label: 'In your cloud',
      value: cloud === null ? '—' : compactBytes(cloud.bytes),
      line: cloud === null ? '' : `${plural(cloud.clips, 'clip', 'clips')} · originals tier themselves`,
      isAccent: false,
    },
    {
      label: 'On this Mac',
      value: status === null ? '—' : compactBytes(status.local.proxyBytes),
      line: status === null ? '' : `${String(onDisk)} of ${plural(readyClipIds.length, 'clip', 'clips')} play from disk`,
      isAccent: true,
    },
    {
      label: 'Originals offline',
      value: status === null ? '—' : String(status.pinnedClipIds.length),
      line:
        status === null
          ? ''
          : `${compactBytes(status.local.pinnedBytes)} of a ${String(status.cache.budgetGb)} GB budget`,
      isAccent: false,
    },
  ];
}

/** Where one ready clip is on this Mac, for its Library tile (M1). */
export type ClipDiskState =
  | { kind: 'syncing'; percent: number; line: string }
  | { kind: 'original'; badge: string; line: string }
  | { kind: 'on-mac'; badge: string; line: string }
  | { kind: 'cloud'; line: string };

const STREAMS = 'Streams from cloud until synced';

/**
 * Picks the tile badge and sub line.
 * @param clipId - The clip.
 * @param status - The native sync status, or null while it loads (cloud, no badge).
 * @returns Syncing (its proxy or original is downloading), Original (on disk), On Mac (proxy on
 *   disk) or cloud.
 */
export function clipDiskState(clipId: string, status: SyncStatus | null): ClipDiskState {
  if (status === null) return { kind: 'cloud', line: STREAMS };
  const transfer = status.transfers.find((t) => t.clipId === clipId && t.direction === 'down');
  const hasProxy = status.local.proxyClipIds.includes(clipId);
  if (transfer !== undefined && !hasProxy) {
    return { kind: 'syncing', percent: transferRow(transfer).percent, line: STREAMS };
  }
  if (status.local.originalClipIds.includes(clipId)) {
    const isPinned = status.pinnedClipIds.includes(clipId);
    return { kind: 'original', badge: 'Original', line: isPinned ? 'Original offline' : 'Original cached for editing' };
  }
  if (hasProxy) return { kind: 'on-mac', badge: 'On Mac', line: 'Proxy on disk' };
  return { kind: 'cloud', line: STREAMS };
}

/** A transfer as the Sync page draws it (M3). */
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

/** An export as the Sync page draws it. */
export interface ExportRow {
  name: string;
  label: string;
  tone: SyncTone;
  error: string | null;
}

const EXPORT_LABEL: Record<ExportState, { label: string; tone: SyncTone }> = {
  waiting: { label: 'Waiting for the file to finish', tone: 'muted' },
  uploading: { label: 'Uploading', tone: 'busy' },
  duplicate: { label: 'Already uploaded, skipped', tone: 'muted' },
  uploaded: { label: 'In your library', tone: 'ok' },
  failed: { label: 'Upload failed', tone: 'error' },
};

/** Everything the Sync page shows, already formatted (M3). */
export interface SyncPanelView {
  headline: string;
  tone: SyncTone;
  error: string | null;
  folder: string;
  /** Library, Originals, Shorts, Projects. */
  folderCounts: { label: string; value: string }[];
  cache: {
    /** Kept-offline and cached shares of the budget, 0–100 each. */
    keptPercent: number;
    cachedPercent: number;
    kept: string;
    cached: string;
    budgetGb: number;
  };
  transfers: TransferRow[];
  exports: ExportRow[];
}

/**
 * Builds the Sync page's view model.
 * @param status - The native sync status.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The formatted page.
 */
export function syncPanelView(status: SyncStatus, now: Date, timeZone?: string): SyncPanelView {
  const budgetBytes = status.cache.budgetGb * BYTES_PER_GB;
  // Exact shares (not whole percents), so a small cache still draws a sliver.
  const share = (bytes: number) => (budgetBytes <= 0 ? 0 : Math.min(100, (bytes / budgetBytes) * 100));
  const keptPercent = share(status.local.pinnedBytes);
  return {
    headline: syncHeadline(status, now, timeZone),
    tone: SIDEBAR_STATE[status.state].tone,
    error: status.error,
    folder: displayFolder(status.folder),
    folderCounts: [
      { label: 'Library', value: plural(status.counts.clips, 'clip', 'clips') },
      { label: 'Originals', value: `${String(status.counts.originalsOffline)} offline` },
      { label: 'Shorts', value: plural(status.local.renders, 'render', 'renders') },
      { label: 'Projects', value: `${String(status.local.projects)} FCPXML` },
    ],
    cache: {
      keptPercent,
      cachedPercent: Math.min(100 - keptPercent, share(status.cache.autoBytes)),
      kept: `Kept offline ${compactBytes(status.local.pinnedBytes)}`,
      cached: `Cached for editing ${compactBytes(status.cache.autoBytes)}`,
      budgetGb: status.cache.budgetGb,
    },
    transfers: status.transfers.map(transferRow),
    exports: status.exports.map((item) => ({ name: item.name, ...EXPORT_LABEL[item.state], error: item.error })),
  };
}
