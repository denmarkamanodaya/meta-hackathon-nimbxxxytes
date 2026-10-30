// The Mac app's web layer in a plain browser (`npm run dev:desktop-mock`): the real desktop
// platform and its invoke adapters, over a fake Tauri IPC that forwards `api_request` and
// `api_stream` to the mock API through the fetch transport, as the native side forwards them to
// the server. Dev
// only; never part of a build. `localStorage['mock-native'] = 'get-only'` makes `api_stream`
// ignore `method` and `body`, like a native side from before the request-stream contract.
// Upload (`pick_and_upload`) queues two fake clips and hands back two photos (read once each by
// `read_picked_image`, from the photo fixtures), and "Upload a folder…" (`pick_folder_and_upload`)
// three; they go up one at a time, pushing progress every second, and `cancel_upload` drops one.
import { emit } from '@tauri-apps/api/event';
import { mockConvertFileSrc, mockIPC } from '@tauri-apps/api/mocks';
import type { HttpMethod, TransportRequest } from '../../core/ports/api-transport';
import { createFetchTransport } from '../../services/api/fetch-transport';
import { base64ToBytes } from '../../services/desktop/body-base64';
import photoImages from '../fixtures/photo-images.json';
import syncStatus from '../fixtures/sync-status.json';

/** What a fake Channel argument carries: the id its messages are delivered to. */
interface ChannelArg {
  id: number;
}

/** The mocked Tauri internals `mockIPC` installs. */
interface MockedInternals {
  runCallback: (id: number, data: unknown) => void;
}

const internals = () => (window as unknown as { __TAURI_INTERNALS__: MockedInternals }).__TAURI_INTERNALS__;

const isGetOnlyNative = (): boolean => {
  try {
    return window.localStorage.getItem('mock-native') === 'get-only';
  } catch {
    return false; // Recovers: storage blocked; act as the current native side.
  }
};

/** Clips the mock keeps offline ("Keep on this Mac"), by the mock API's clip ids. */
const pinned = new Set<string>(['clip_walk']);

/** Recordings, documents and photos the mock keeps offline, by drive reference (`listen:<id>`). */
const pinnedItems = new Set<string>(['listen:lis_birthday']);

/** Bytes a kept item holds. */
const KEPT_ITEM_BYTES = 2_450_000;

/** Bytes a kept clip holds, and what a just-played clip has cached. */
const KEPT_BYTES = 3_400_000_000;
const PLAYED_BYTES = 41_000_000;

/** The drive cache cap in GB ("Most space to use"); the native side derives the cap from it. */
let budgetGb = syncStatus.cache_cap_bytes / 1e9;

/** Opening at login (Settings › General); off until turned on. */
let isLoginEnabled = false;

/** Set by "Free up space now": the played kitchen clip is freed before its countdown ends. */
let isFreedNow = false;

/** The version Settings › Account shows (the native side answers its bundle version). */
const MOCK_APP_VERSION = '1.0.4';

/** When the mock "played" the kitchen clip: page load, so the 3-minute countdown runs live. */
const playedAt = new Date().toISOString();

/** One fake picked upload: its transfer id, file name, size and bytes sent. */
interface MockUpload {
  id: string;
  name: string;
  total: number;
  done: number;
}

/** What Upload and Upload a folder… "pick" (names and sizes as in the approved Uploading board). */
const PICKED_FILES: readonly (readonly [string, number])[] = [
  ['VID_20261027_181205.mp4', 1_400_000_000],
  ['VID_20261027_183410.mp4', 900_000_000],
];
const FOLDER_FILES: readonly (readonly [string, number])[] = [
  ['VID_20261026_090112.mp4', 420_000_000],
  ['VID_20261025_204530.mp4', 1_100_000_000],
  ['VID_20261024_120003.mp4', 86_000_000],
];

/** Fake upload speed and how often progress is pushed. */
const MOCK_UPLOAD_BPS = 8_000_000;
const MOCK_UPLOAD_TICK_MS = 1000;

const uploads: MockUpload[] = [];
let uploadTimer: ReturnType<typeof setInterval> | null = null;

/** The native transfer rows of the fake uploads (direction up, as the native side reports them). */
const uploadTransfers = () =>
  uploads.map((u) => ({ id: u.id, kind: 'export', name: u.name, done_bytes: u.done, total_bytes: u.total, direction: 'up', clip_id: null }));

/**
 * The sync status for the mock API's clips: the fixture's sync state, plus one kept clip and one
 * clip played at page load, so the On this Mac page and the tile icons have something to show.
 */
function mockStatus() {
  const freed = isFreedNow || Date.now() - new Date(playedAt).getTime() > 180_000;
  const kitchen = freed ? 0 : PLAYED_BYTES;
  const kept = [...pinned].map((clipId) => ({ clip_id: clipId, cached_bytes: KEPT_BYTES, last_read_at: playedAt }));
  return {
    ...syncStatus,
    state: 'idle',
    last_sync_at: new Date(Date.now() - 120_000).toISOString(),
    pinned_clip_ids: [...pinned],
    cache_bytes: kept.length * KEPT_BYTES + kitchen,
    cache: { ...syncStatus.cache, budget_gb: budgetGb },
    cache_cap_bytes: Math.round(budgetGb * 1e9),
    transfers: [...syncStatus.transfers.filter((t) => t.direction === 'down'), ...uploadTransfers()],
    exports: uploads.map((u) => ({ name: u.name, state: 'uploading', error: null })),
    pinned_bytes: kept.length * KEPT_BYTES,
    pinned_items: [...pinnedItems],
    items: [...pinnedItems].map((item) => ({ item, cached_bytes: KEPT_ITEM_BYTES, last_read_at: playedAt, pinned: true })),
    clips: [
      ...kept.map((row) => ({ ...row, proxy: 'synced', original: 'pinned', original_on_disk: true, proxy_bytes: 0 })),
      {
        clip_id: 'clip_kitchen',
        proxy: 'synced',
        original: 'auto',
        original_on_disk: false,
        proxy_bytes: 0,
        cached_bytes: kitchen,
        last_read_at: freed ? null : playedAt,
      },
    ],
  };
}

function setOffline(args: Record<string, unknown>) {
  const clipId = String(args.clip_id);
  if (args.offline === true) pinned.add(clipId);
  else pinned.delete(clipId);
  void emit('sync://status', mockStatus());
  return null;
}

function setItemOffline(args: Record<string, unknown>) {
  const item = String(args.item);
  if (args.offline === true) pinnedItems.add(item);
  else pinnedItems.delete(item);
  void emit('sync://status', mockStatus());
  return null;
}

function setCacheBudget(args: Record<string, unknown>) {
  if (typeof args.gb === 'number' && Number.isFinite(args.gb)) budgetGb = Math.max(0, args.gb);
  void emit('sync://status', mockStatus());
  return null;
}

/** Frees the played (not kept) bytes, as the native side does, and pushes the new status. */
function freeUpSpace() {
  const before = mockStatus().cache_bytes;
  isFreedNow = true;
  const status = mockStatus();
  void emit('sync://status', status);
  return before - status.cache_bytes;
}

/** Sends the first unfinished upload a second's worth of bytes; a finished one leaves the list. */
function tickUploads() {
  const current = uploads[0];
  if (current === undefined) {
    if (uploadTimer !== null) clearInterval(uploadTimer);
    uploadTimer = null;
    return;
  }
  current.done = Math.min(current.total, current.done + (MOCK_UPLOAD_BPS * MOCK_UPLOAD_TICK_MS) / 1000);
  if (current.done >= current.total) uploads.shift();
  void emit('sync://status', mockStatus());
}

/** The two photos the mock file dialog picks, with their fixture pictures. */
const PICKED_PHOTOS: Readonly<Record<string, string>> = { '/Users/me/Pictures/_MG_4210.JPG': photoImages._MG_4210, '/Users/me/Pictures/_MG_4950.JPG': photoImages._MG_4950 };
const PICKED_IMAGES = Object.keys(PICKED_PHOTOS).map((path) => ({
  path,
  name: path.split('/').pop() ?? 'photo.jpg',
  content_type: 'image/jpeg',
  size_bytes: 14_000,
  last_modified_ms: Date.UTC(2026, 7, 19, 8, 42),
}));

/** `read_picked_image`: a picked photo's bytes (the fixture's JPEG). */
function pickedImageBytes(args: Record<string, unknown>): ArrayBuffer {
  const url = PICKED_PHOTOS[String(args.path)];
  if (url === undefined) throw new Error('not a picked photo');
  return base64ToBytes(url.slice(url.indexOf(',') + 1)).slice().buffer;
}

/** Queues fake picked files, as the native dialog would after the owner picks them. */
function queueUploads(files: readonly (readonly [string, number])[], folder: string) {
  for (const [name, total] of files) uploads.push({ id: `Export:${folder}/${name}`, name, total, done: 0 });
  uploadTimer ??= setInterval(tickUploads, MOCK_UPLOAD_TICK_MS);
  void emit('sync://status', mockStatus());
  return { queued: files.length };
}

/** Drops a cancelled upload from the transfers and the exports. */
function cancelUpload(args: Record<string, unknown>) {
  const index = uploads.findIndex((u) => u.id === args.transfer_id);
  if (index >= 0) uploads.splice(index, 1);
  void emit('sync://status', mockStatus());
  return null;
}

const streams = new Map<string, AbortController>();
let nextStreamId = 1;

/** The native side's HTTP client: the PWA transport over the same origin, full `/api` paths. */
const http = createFetchTransport({ baseUrl: '', timeoutMs: 60_000 });

/** A bridge call's flat args as a transport request (the native side does the same mapping). */
function toRequest(args: Record<string, unknown>, isGetOnly: boolean, signal?: AbortSignal): TransportRequest {
  const method = !isGetOnly && typeof args.method === 'string' ? (args.method as HttpMethod) : 'GET';
  return {
    method,
    path: String(args.path),
    ...(!isGetOnly && typeof args.body === 'string' ? { body: args.body } : {}),
    ...(!isGetOnly && typeof args.body_base64 === 'string' ? { bytes: new Blob([base64ToBytes(args.body_base64)]) } : {}),
    ...(!isGetOnly && typeof args.content_type === 'string' ? { contentType: args.content_type } : {}),
    signal,
  };
}

async function apiRequest(args: Record<string, unknown>) {
  const response = await http.send(toRequest(args, false));
  return { status: response.status, body: response.body, content_type: response.contentType };
}

/** Pumps one stream into the channel, then sends `__end` as the native side does. */
async function pump(args: Record<string, unknown>, channel: ChannelArg, signal: AbortSignal) {
  let index = 0;
  const send = (message: { event: string | null; data: string }) => {
    internals().runCallback(channel.id, { index, message });
    index += 1;
  };
  try {
    const response = await http.streamRequest(toRequest(args, isGetOnlyNative(), signal), send);
    const isOk = response.status >= 200 && response.status <= 299;
    send({ event: '__end', data: isOk ? '' : `server answered ${String(response.status)}` });
  } catch (thrown) {
    if (!signal.aborted) send({ event: '__end', data: thrown instanceof Error ? thrown.message : 'network' });
  }
}

function apiStream(args: Record<string, unknown>) {
  const streamId = `mock-${String(nextStreamId)}`;
  nextStreamId += 1;
  const controller = new AbortController();
  streams.set(streamId, controller);
  void pump(args, args.on_event as ChannelArg, controller.signal).finally(() => {
    streams.delete(streamId);
  });
  return { stream_id: streamId };
}

mockConvertFileSrc('macos');
mockIPC(
  (command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (command) {
      case 'api_request':
        return apiRequest(args);
      case 'api_stream':
        return apiStream(args);
      case 'api_stream_cancel':
        streams.get(String(args.stream_id))?.abort();
        return null;
      case 'server_get':
        return { url: window.location.origin };
      case 'folder_get':
        return { path: syncStatus.folder };
      case 'sync_status':
        return mockStatus();
      case 'set_offline':
        return setOffline(args);
      case 'set_item_offline':
        return setItemOffline(args);
      case 'set_cache_budget':
        return setCacheBudget(args);
      case 'login_get':
        return isLoginEnabled;
      case 'login_set':
        isLoginEnabled = args.enabled === true;
        return null;
      case 'free_up_space':
        return freeUpSpace();
      case 'plugin:app|version':
        return MOCK_APP_VERSION;
      case 'media_lookup':
        return { path: null };
      case 'pick_and_upload':
        return { ...queueUploads(PICKED_FILES, '/Users/me/Movies'), images: PICKED_IMAGES };
      case 'read_picked_image':
        return pickedImageBytes(args);
      case 'pick_folder_and_upload':
        return queueUploads(FOLDER_FILES, '/Users/me/Movies/Trip');
      case 'cancel_upload':
        return cancelUpload(args);
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

export { createPlatform } from '../../app/platform/desktop';
