// Mac app native features over Tauri invoke (contract: `server_get`, `sync_status` + the
// `sync://status` event, `pick_and_upload`, `pick_folder_and_upload`, `cancel_upload`,
// `sync_now`, `set_offline`, `set_item_offline`, `set_cache_budget`, `open_in_nle`, `reveal`, `sign_out`, `login_get`,
// `login_set`, `free_up_space`, and Tauri's
// `plugin:app|version`). Maps the
// native snake_case shapes to the core's types and every failure to `DESKTOP_FAILED`.
import type { ClipDrive, ItemDrive, LocalFiles, SyncExport, SyncStatus, SyncTransfer } from '../../core/desktop-sync';
import type { DesktopBridge, OpenedTimeline, PickedFiles, PickedImage, RevealTarget } from '../../core/ports/desktop-bridge';
import { ApiError } from '../api/api-error';
import {
  isNonNegativeInt,
  isNullable,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  parseEvery,
  type Json,
} from '../api/json-guards';
import { readNativeFailure } from './native-error';
import type { TauriIpc } from './tauri-bridge';

/** The event the native side pushes on every status change. */
const STATUS_EVENT = 'sync://status';

/** Tauri's own app command (allowed by `core:default`); `getVersion()` in `@tauri-apps/api/app` calls it. */
const APP_VERSION = 'plugin:app|version';

const SYNC_STATES = ['idle', 'syncing', 'offline', 'signed_out', 'error'] as const;
const TRANSFER_KINDS = ['proxy', 'original', 'render', 'export'] as const;
const EXPORT_STATES = ['waiting', 'uploading', 'duplicate', 'uploaded', 'failed'] as const;

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

const isSyncState = oneOf(SYNC_STATES);
const isTransferKind = oneOf(TRANSFER_KINDS);
const isExportState = oneOf(EXPORT_STATES);

function parseTransfer(value: unknown): SyncTransfer | null {
  if (!isRecord(value) || !isString(value.id) || !isTransferKind(value.kind) || !isString(value.name)) return null;
  if (!isNonNegativeInt(value.done_bytes) || !isNonNegativeInt(value.total_bytes)) return null;
  if (value.direction !== 'down' && value.direction !== 'up') return null;
  if (value.clip_id !== undefined && !isNullable(value.clip_id, isString)) return null;
  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    doneBytes: value.done_bytes,
    totalBytes: value.total_bytes,
    direction: value.direction,
    clipId: value.clip_id ?? null,
  };
}

function parseExport(value: unknown): SyncExport | null {
  if (!isRecord(value) || !isString(value.name) || !isExportState(value.state)) return null;
  if (!isNullable(value.error, isString)) return null;
  return { name: value.name, state: value.state, error: value.error };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const raw of value) {
    const item = parse(raw);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

function parseCounts(value: unknown): SyncStatus['counts'] | null {
  if (!isRecord(value) || !isNonNegativeInt(value.clips) || !isNonNegativeInt(value.shorts)) return null;
  if (!isNonNegativeInt(value.originals_offline)) return null;
  return { clips: value.clips, shorts: value.shorts, originalsOffline: value.originals_offline };
}

function parseCache(value: unknown): SyncStatus['cache'] | null {
  if (!isRecord(value) || !isNumber(value.budget_gb) || !isNonNegativeInt(value.auto_bytes)) return null;
  return { budgetGb: value.budget_gb, autoBytes: value.auto_bytes };
}

const optionalCount = (value: unknown): number | null =>
  value === undefined ? 0 : isNonNegativeInt(value) ? value : null;

const PROXY_STATES = ['synced', 'downloading', 'missing'] as const;
const ORIGINAL_STATES = ['pinned', 'auto', 'none'] as const;
const isProxyState = oneOf(PROXY_STATES);
const isOriginalState = oneOf(ORIGINAL_STATES);

/** One parsed `clips[]` row. */
interface ClipRow {
  isProxySynced: boolean;
  isOriginalOnDisk: boolean;
  drive: ClipDrive;
}

/**
 * One `clips[]` row: whether its proxy is synced and its original is on disk, and what the drive
 * caches of it. `cached_bytes` and `last_read_at` came later; missing reads as 0 and null.
 */
function parseClipRow(value: unknown): ClipRow | null {
  if (!isRecord(value) || !isString(value.clip_id) || !isProxyState(value.proxy)) return null;
  if (!isOriginalState(value.original) || typeof value.original_on_disk !== 'boolean') return null;
  if (!isNonNegativeInt(value.proxy_bytes)) return null;
  const cachedBytes = optionalCount(value.cached_bytes);
  const lastReadAt = value.last_read_at === undefined ? null : isNullable(value.last_read_at, isString) ? value.last_read_at : undefined;
  if (cachedBytes === null || lastReadAt === undefined) return null;
  return {
    isProxySynced: value.proxy === 'synced',
    isOriginalOnDisk: value.original_on_disk,
    drive: { clipId: value.clip_id, cachedBytes, lastReadAt },
  };
}

/**
 * Reads the on-disk facts: `clips[]` (per ready clip), `local_proxy_bytes`, `pinned_bytes`,
 * `renders`, `projects`. Each is optional; a missing one reads as empty or zero.
 */
function parseLocal(value: Json): LocalFiles | null {
  const rows = value.clips === undefined ? [] : parseList(value.clips, parseClipRow);
  const proxyBytes = optionalCount(value.local_proxy_bytes);
  const pinnedBytes = optionalCount(value.pinned_bytes);
  const renders = optionalCount(value.renders);
  const projects = optionalCount(value.projects);
  if (rows === null || proxyBytes === null || pinnedBytes === null || renders === null || projects === null) return null;
  return {
    proxyClipIds: rows.filter((row) => row.isProxySynced).map((row) => row.drive.clipId),
    proxyBytes,
    originalClipIds: rows.filter((row) => row.isOriginalOnDisk).map((row) => row.drive.clipId),
    pinnedBytes,
    renders,
    projects,
    clips: rows.map((row) => row.drive),
  };
}

const pinnedIds = (value: Json): string[] | null =>
  value.pinned_clip_ids === undefined ? [] : isStringArray(value.pinned_clip_ids) ? value.pinned_clip_ids : null;

/** One `items[]` row: a recording's, a document's or a photo's original on the drive. */
function parseItemRow(value: unknown): ItemDrive | null {
  if (!isRecord(value) || !isString(value.item) || !isNonNegativeInt(value.cached_bytes)) return null;
  if (!isNullable(value.last_read_at, isString) || typeof value.pinned !== 'boolean') return null;
  return { item: value.item, cachedBytes: value.cached_bytes, lastReadAt: value.last_read_at, pinned: value.pinned };
}

/** `items` and `pinned_items` came with the other kinds; missing reads as none. */
function parseItems(value: Json): { items: ItemDrive[]; pinnedItems: string[] } | null {
  const items = value.items === undefined ? [] : parseList(value.items, parseItemRow);
  const pinnedItems = value.pinned_items === undefined ? [] : isStringArray(value.pinned_items) ? value.pinned_items : null;
  return items === null || pinnedItems === null ? null : { items, pinnedItems };
}

/**
 * Parses the native `SyncStatus`. `pinned_clip_ids`, `items`, `pinned_items`, `clips` (and each row's `cached_bytes` and
 * `last_read_at`), the byte and file counts, `cache_bytes` (v1.1), `cache_cap_bytes`,
 * `release_after_s`, `poll_s` and `transfers[].clip_id` are optional (missing reads as none,
 * zero, unknown or null).
 * @param value - The command result or event payload.
 * @returns The status, or null when any field is missing or of the wrong type.
 */
export function parseSyncStatus(value: unknown): SyncStatus | null {
  if (!isRecord(value) || !isString(value.folder) || !isSyncState(value.state)) return null;
  if (!isNullable(value.last_sync_at, isString) || !isNullable(value.error, isString)) return null;
  const counts = parseCounts(value.counts);
  const cache = parseCache(value.cache);
  const transfers = parseList(value.transfers, parseTransfer);
  const exports = parseList(value.exports, parseExport);
  const pinnedClipIds = pinnedIds(value);
  const local = parseLocal(value);
  const items = parseItems(value);
  const pollS = value.poll_s === undefined ? null : isNumber(value.poll_s) && value.poll_s > 0 ? value.poll_s : undefined;
  const cacheBytes = optionalCount(value.cache_bytes);
  const cacheCapBytes = optionalCount(value.cache_cap_bytes);
  const releaseAfterS =
    value.release_after_s === undefined ? null : isNonNegativeInt(value.release_after_s) ? value.release_after_s : undefined;
  if (counts === null || cache === null || transfers === null || exports === null || pinnedClipIds === null) return null;
  if (local === null || items === null || pollS === undefined || cacheBytes === null) return null;
  if (cacheCapBytes === null || releaseAfterS === undefined) return null;
  return {
    folder: value.folder,
    lastSyncAt: value.last_sync_at,
    state: value.state,
    error: value.error,
    counts,
    pinnedClipIds,
    ...items,
    cache,
    cacheBytes,
    transfers,
    exports,
    local,
    pollS,
    cacheCapBytes,
    releaseAfterS,
  };
}

function revealArgs(target: RevealTarget): Record<string, string> {
  switch (target.kind) {
    case 'folder':
      return { kind: 'folder' };
    case 'original':
      return { kind: 'original', id: target.clipId };
    case 'item':
      return { kind: 'item', id: target.itemId };
    case 'fcpxml':
    case 'render':
      return { kind: target.kind, id: target.shortId };
  }
}

const parseServer = (value: unknown): { url: string | null } | null =>
  isRecord(value) && isNullable(value.url, isString) ? { url: value.url } : null;

const parsePath = (value: unknown): { path: string | null } | null =>
  isRecord(value) && isNullable(value.path, isString) ? { path: value.path } : null;

const parseQueued = (value: unknown): number | null =>
  isRecord(value) && isNonNegativeInt(value.queued) ? value.queued : null;

function parsePickedImage(value: unknown): PickedImage | null {
  if (!isRecord(value) || !isString(value.path) || !isString(value.name) || !isString(value.content_type)) return null;
  const { size_bytes, last_modified_ms } = value;
  if (!isNonNegativeInt(size_bytes) || !(last_modified_ms === null || isNonNegativeInt(last_modified_ms))) return null;
  return { path: value.path, name: value.name, contentType: value.content_type, sizeBytes: size_bytes, lastModifiedMs: last_modified_ms };
}

function parsePicked(value: unknown): PickedFiles | null {
  const queued = parseQueued(value);
  if (queued === null || !isRecord(value)) return null;
  // An older native side sends no `images`: nothing but videos was picked.
  const images = value.images === undefined ? [] : parseEvery(value.images, parsePickedImage);
  return images === null ? null : { queued, images };
}

/** The raw bytes `read_picked_image` answers (an ArrayBuffer over Tauri's binary response). */
const parseBytes = (value: unknown): ArrayBuffer | null => (value instanceof ArrayBuffer ? value : ArrayBuffer.isView(value) ? (value.buffer as ArrayBuffer) : null);

function parseOpened(value: unknown): OpenedTimeline | null {
  if (!isRecord(value) || !isString(value.fcpxml_path)) return null;
  if (value.opened_with !== 'final-cut' && value.opened_with !== 'finder') return null;
  return { fcpxmlPath: value.fcpxml_path, openedWith: value.opened_with };
}

/**
 * Builds the bridge.
 * @param ipc - Tauri IPC (the real one, or a fake in tests).
 * @returns The bridge; every method rejects with `ApiError` `DESKTOP_FAILED`.
 */
export function createNativeBridge(ipc: TauriIpc): DesktopBridge {
  async function call(command: string, args?: Record<string, unknown>): Promise<unknown> {
    try {
      return await ipc.invoke(command, args);
    } catch (thrown) {
      throw new ApiError('DESKTOP_FAILED', readNativeFailure(thrown, `${command} failed`).message, null);
    }
  }
  async function parsed<T>(command: string, parse: (value: unknown) => T | null, args?: Record<string, unknown>) {
    const value = parse(await call(command, args));
    if (value === null) throw new ApiError('DESKTOP_FAILED', `Unexpected answer from ${command}`, null);
    return value;
  }
  const done = async (command: string, args?: Record<string, unknown>) => {
    await call(command, args);
  };

  return {
    server: () => parsed('server_get', parseServer).then((answer) => answer.url),
    syncStatus: () => parsed('sync_status', parseSyncStatus),
    pickAndUpload: () => parsed('pick_and_upload', parsePicked),
    readPickedImage: async (image) => {
      const bytes = await parsed('read_picked_image', parseBytes, { path: image.path });
      return new File([bytes], image.name, { type: image.contentType, ...(image.lastModifiedMs === null ? {} : { lastModified: image.lastModifiedMs }) });
    },
    pickFolderAndUpload: () => parsed('pick_folder_and_upload', parseQueued),
    cancelUpload: (transferId) => done('cancel_upload', { transfer_id: transferId }),
    onSyncStatus: (listener) => {
      let stop: (() => void) | null = null;
      let isStopped = false;
      ipc
        .listen(STATUS_EVENT, (payload) => {
          const status = parseSyncStatus(payload);
          if (status !== null && !isStopped) listener(status);
        })
        .then((unlisten) => {
          stop = unlisten;
          if (isStopped) unlisten();
        })
        .catch(() => {
          // Recovers: no pushed updates; the panel still loads the status on open and after actions.
        });
      return () => {
        isStopped = true;
        stop?.();
      };
    },
    syncNow: () => done('sync_now'),
    setOffline: (clipId, offline) => done('set_offline', { clip_id: clipId, offline }),
    setItemOffline: (item, offline) => done('set_item_offline', { item, offline }),
    setCacheBudget: (gb) => done('set_cache_budget', { gb }),
    openInEditor: (shortId) => parsed('open_in_nle', parseOpened, { short_id: shortId }),
    reveal: (target) => done('reveal', revealArgs(target)),
    isOnDisk: (kind, id) =>
      parsed('media_lookup', parsePath, { kind, id }).then((answer) => answer.path !== null && answer.path !== ''),
    signOut: () => done('sign_out'),
    appVersion: () => parsed(APP_VERSION, (value) => (isString(value) && value !== '' ? value : null)),
    loginEnabled: () => parsed('login_get', (value) => (typeof value === 'boolean' ? value : null)),
    setLoginEnabled: (enabled) => done('login_set', { enabled }),
    freeUpSpace: () => parsed('free_up_space', (value) => (isNonNegativeInt(value) ? value : null)),
  };
}
